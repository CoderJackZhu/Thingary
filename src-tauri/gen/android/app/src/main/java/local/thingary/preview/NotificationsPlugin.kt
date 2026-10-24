package local.thingary.preview

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.time.LocalDate
import java.time.ZoneId

@InvokeArg
data class NotificationArgs(var json: String = "[]", var ask: Boolean = false)

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class NotificationsPlugin(private val activity: Activity) : Plugin(activity) {
  private fun reply(invoke: Invoke, message: String) {
    invoke.resolve(JSObject().put("message", message))
  }

  @Command
  fun native(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(NotificationArgs::class.java)
      ReminderSchedule.channel(activity)
      if (args.ask) {
        activity.runOnUiThread {
          try {
            if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
              requestPermissionForAlias("notifications", invoke, "notificationPermissionResult")
            } else {
              notificationPermissionResult(invoke)
            }
          } catch (_: Exception) {
            reply(invoke, "通知权限请求失败，请重试")
          }
        }
      } else {
        reply(invoke, ReminderSchedule.replace(activity, args.json))
      }
    } catch (_: Exception) {
      reply(invoke, "提醒尚未安排成功，请返回应用后重试")
    }
  }

  @PermissionCallback
  fun notificationPermissionResult(invoke: Invoke) {
    reply(invoke, if (ReminderSchedule.enabled(activity)) "" else ReminderSchedule.DENIED)
  }

  @Command
  fun openSettings(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        activity.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName))
        reply(invoke, "")
      } catch (_: Exception) {
        reply(invoke, "无法打开通知设置，请在系统设置中允许物谱通知")
      }
    }
  }
}

/** Private device preferences, separate from the library, exports and backups.
 * A full replacement uses a crash journal of owned IDs before touching alarms.
 * PendingIntent identity uses the entire business ID, avoiding hash collisions.
 */
internal object ReminderSchedule {
  const val CHANNEL = "thingary-reminders"
  const val DENIED = "通知权限未开启，请在“设置 › 通知 › 物谱”中允许通知"
  const val DISABLED = "通知权限未开启；提醒日期已保存，请在“设置 › 通知 › 物谱”中允许通知"
  private const val PREFS = "thingary-notifications"
  // Conservative per-app queue budget, matching the existing iOS horizon.
  // Do not exhaust Android/OEM alarm limits; retain the full plan for refill.
  private const val CAPACITY = 64
  data class Plan(val id: String, val time: Long, val title: String, val body: String)

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun channel(context: Context) {
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "物谱提醒", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "盘点、付款与保障到期提醒"
        lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
      })
  }

  fun enabled(context: Context): Boolean {
    val manager = context.getSystemService(NotificationManager::class.java)
    return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
      manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun parse(json: String): List<Plan> {
    val array = try { JSONArray(json) } catch (_: Exception) { throw IllegalArgumentException("提醒计划无效") }
    val ids = mutableSetOf<String>()
    return (0 until array.length()).map { index ->
      val p = array.optJSONObject(index) ?: throw IllegalArgumentException("提醒计划无效")
      fun text(key: String) = p.opt(key) as? String ?: throw IllegalArgumentException("提醒计划无效")
      val id = text("id")
      require(id.startsWith("thingary-") && id.length > 9 && !id.contains('\u0000') && ids.add(id)) { "提醒计划无效" }
      val date = text("date")
      val time = try {
        require(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(date))
        val local = LocalDate.parse(date).atTime(9, 0)
        require(local.year in 1..9999)
        val offsets = ZoneId.systemDefault().rules.getValidOffsets(local)
        require(offsets.size == 1)
        local.toInstant(offsets.single()).toEpochMilli()
      } catch (_: Exception) { throw IllegalArgumentException("提醒日期无效") }
      Plan(id, time, text("title"), text("body"))
    }.sortedWith(compareBy<Plan> { it.time }.thenBy { it.id })
  }

  private fun pending(context: Context, id: String, flags: Int): PendingIntent? = PendingIntent.getBroadcast(
    context, 0, Intent(context, ReminderReceiver::class.java).apply {
      action = "${context.packageName}.REMINDER"
      data = Uri.Builder().scheme("thingary-reminder").authority(context.packageName).appendPath(id).build()
    }, flags or PendingIntent.FLAG_IMMUTABLE)

  private fun cancel(context: Context, ids: Set<String>) {
    val alarms = context.getSystemService(AlarmManager::class.java)
    for (id in ids) {
      pending(context, id, PendingIntent.FLAG_NO_CREATE)?.let { alarms.cancel(it); it.cancel() }
    }
  }

  @Synchronized
  fun replace(context: Context, json: String): String {
    val plans = try { parse(json) } catch (error: IllegalArgumentException) { return error.message ?: "提醒计划无效" }
    channel(context)
    val future = plans.filter { it.time > System.currentTimeMillis() }
    val selected = future.take(CAPACITY)
    val storage = prefs(context)
    val owned = storage.getStringSet("owned", emptySet()).orEmpty().toSet()
    val wanted = selected.map { it.id }.toSet()
    // Journal the union so an interrupted replacement can cancel both batches.
    if (!storage.edit().putString("plans", json).putStringSet("owned", owned + wanted).commit()) {
      return "提醒计划未能保存在本机，请重试"
    }
    cancel(context, owned + wanted)
    if (future.isNotEmpty() && !enabled(context)) {
      storage.edit().putStringSet("owned", emptySet()).commit()
      return DISABLED
    }
    try {
      val alarms = context.getSystemService(AlarmManager::class.java)
      for (plan in selected) {
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, plan.time,
          requireNotNull(pending(context, plan.id, PendingIntent.FLAG_UPDATE_CURRENT)))
      }
      check(storage.edit().putStringSet("owned", wanted).commit())
    } catch (_: Exception) {
      cancel(context, wanted)
      return "提醒尚未安排成功，请返回应用后重试"
    }
    return if (future.size > selected.size) {
      "Android 提醒队列容量有限：已安排最近 ${selected.size} 条，另有 ${future.size - selected.size} 条待后续打开物谱时补排；提醒日期已保留。"
    } else ""
  }

  @Synchronized
  fun restore(context: Context): String = replace(context, prefs(context).getString("plans", "[]") ?: "[]")

  /** Deliver only IDs still owned by the newest replacement; no content in intents. */
  @Synchronized
  fun deliver(context: Context, id: String) {
    val storage = prefs(context)
    if (!storage.getStringSet("owned", emptySet()).orEmpty().contains(id)) return
    val plan = parse(storage.getString("plans", "[]") ?: "[]").firstOrNull { it.id == id } ?: return
    // A stale delivery from a cancelled batch must not fire a newly moved date early.
    if (plan.time > System.currentTimeMillis()) return
    channel(context)
    if (!enabled(context)) return
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    val click = PendingIntent.getActivity(context, 0, launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = android.app.Notification.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle(plan.title).setContentText(plan.body)
      .setStyle(android.app.Notification.BigTextStyle().bigText(plan.body))
      .setVisibility(android.app.Notification.VISIBILITY_PRIVATE)
      .setContentIntent(click).setAutoCancel(true).build()
    context.getSystemService(NotificationManager::class.java).notify(id, 0, notification)
    storage.edit().putStringSet("owned", storage.getStringSet("owned", emptySet()).orEmpty() - id).commit()
  }
}
