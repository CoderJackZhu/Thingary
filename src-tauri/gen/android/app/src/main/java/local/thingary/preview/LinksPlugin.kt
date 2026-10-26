package local.thingary.preview

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.util.Locale

@InvokeArg
data class OpenUrlArgs(var url: String = "")

@TauriPlugin
class LinksPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun openUrl(invoke: Invoke) {
    val url = invoke.parseArgs(OpenUrlArgs::class.java).url
    val scheme = url.lowercase(Locale.ROOT)
    if (!scheme.startsWith("https://") && !scheme.startsWith("mailto:")) {
      invoke.reject("不支持此链接")
      return
    }
    activity.runOnUiThread {
      try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        invoke.resolve()
      } catch (error: ActivityNotFoundException) {
        invoke.reject("无法打开浏览器。")
      }
    }
  }
}
