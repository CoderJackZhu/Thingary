package local.thingary.preview

import android.app.Activity
import android.view.WindowManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
data class SetPrivacyCoverArgs(var enabled: Boolean = false)

@TauriPlugin
class ThingaryPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun setPrivacyCover(invoke: Invoke) {
    val args = invoke.parseArgs(SetPrivacyCoverArgs::class.java)
    activity.runOnUiThread {
      if (args.enabled) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
      invoke.resolve()
    }
  }
}
