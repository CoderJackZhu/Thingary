package local.thingary.preview

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
        Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED)) return
    val result = goAsync()
    Thread {
      try {
        val message = ReminderSchedule.restore(context)
        if (message.isNotEmpty()) Log.w("ThingaryNotifications", message)
      } catch (_: Exception) {
        Log.e("ThingaryNotifications", "提醒尚未恢复，请返回应用后重试")
      } finally {
        result.finish()
      }
    }.start()
  }
}
