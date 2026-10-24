package local.thingary.preview

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != "${context.packageName}.REMINDER") return
    val id = intent.data?.lastPathSegment ?: return
    val result = goAsync()
    Thread {
      try {
        ReminderSchedule.deliver(context, id)
      } catch (_: Exception) {
        Log.e("ThingaryNotifications", "提醒未能送达，请返回应用后重试")
      } finally {
        result.finish()
      }
    }.start()
  }
}
