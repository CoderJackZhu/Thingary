package local.thingary.preview

import android.app.Activity
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/** Screen privacy only. All credentials stay in the system prompt; never log results. */
@TauriPlugin
class BiometricPlugin(private val activity: Activity) : Plugin(activity) {
  private val handler = Handler(Looper.getMainLooper())
  private var active: Session? = null

  private class Session(val invoke: Invoke) {
    val deadline = SystemClock.elapsedRealtime() + 120_000L
    var prompt: BiometricPrompt? = null
    var timeout: Runnable? = null
  }

  private fun canAuthenticate(): Boolean {
    val manager = BiometricManager.from(activity)
    return if (Build.VERSION.SDK_INT >= 30) {
      manager.canAuthenticate(BIOMETRIC_STRONG or DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS
    } else {
      canAuthenticateApi29(manager)
    }
  }

  private fun canAuthenticateApi29(manager: BiometricManager): Boolean {
    // API 29 does not support STRONG | DEVICE_CREDENTIAL. The legacy prompt
    // accepts the default (weak or stronger) biometrics plus device credential.
    // Query that same policy, including PIN-only devices (the no-arg query does not).
    return manager.canAuthenticate(BIOMETRIC_WEAK or DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS
  }

  @Suppress("DEPRECATION")
  private fun promptInfoApi29(builder: BiometricPrompt.PromptInfo.Builder): BiometricPrompt.PromptInfo {
    // Only Android 10 uses this legacy API: STRONG | DEVICE_CREDENTIAL throws
    // on API 29. Keep biometrics with system PIN/pattern/password fallback.
    return builder.setDeviceCredentialAllowed(true).build()
  }

  private fun promptInfo(): BiometricPrompt.PromptInfo {
    val english = activity.resources.configuration.locales[0].language != "zh"
    val builder = BiometricPrompt.PromptInfo.Builder()
      .setTitle(if (english) "Unlock Thingary" else "解锁物谱")
      .setSubtitle(if (english) "Verify to view local data" else "验证身份，查看本机资料")
    return if (Build.VERSION.SDK_INT >= 30) {
      builder.setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL).build()
    } else {
      promptInfoApi29(builder)
    }
  }

  private fun respond(invoke: Invoke, status: String) {
    invoke.resolve(JSObject().put("status", status))
  }

  private fun finish(session: Session, status: String, cancel: Boolean = false) {
    // Invalidate before cancellation: error callbacks and late successes from an
    // expired/replaced prompt must never unlock or resolve a subsequent request.
    if (active !== session) return
    val expired = SystemClock.elapsedRealtime() >= session.deadline
    active = null
    session.timeout?.let { handler.removeCallbacks(it) }
    if (cancel || expired) {
      // API 29 may leave the system credential screen open after cancellation;
      // session invalidation above still rejects its eventual result.
      try { session.prompt?.cancelAuthentication() } catch (_: RuntimeException) { /* already invalid */ }
    }
    respond(session.invoke, if (expired) "timeout" else status)
  }

  override fun onDestroy(activity: AppCompatActivity) {
    active?.let { finish(it, "cancelled", cancel = true) }
  }

  @Command
  fun available(invoke: Invoke) {
    activity.runOnUiThread {
      val available = try { canAuthenticate() } catch (_: RuntimeException) { false }
      invoke.resolve(JSObject().put("available", available))
    }
  }

  @Command
  fun authenticate(invoke: Invoke) {
    activity.runOnUiThread {
      // Do not replace an in-flight prompt, or allow its callback to unlock twice.
      if (active != null) {
        respond(invoke, "failed")
        return@runOnUiThread
      }
      val session = Session(invoke)
      active = session
      try {
        val host = activity as? FragmentActivity
        if (host == null || !canAuthenticate()) {
          finish(session, "unavailable")
          return@runOnUiThread
        }
        val callback = object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            finish(session, "success")
          }

          // Non-terminal: the system prompt stays open for another attempt (or the
          // device credential), so one unrecognized biometric must not end the
          // session. iOS keeps the system prompt open in the same situation.
          override fun onAuthenticationFailed() {}

          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            val status = when (errorCode) {
              BiometricPrompt.ERROR_CANCELED, BiometricPrompt.ERROR_USER_CANCELED,
              BiometricPrompt.ERROR_NEGATIVE_BUTTON -> "cancelled"
              BiometricPrompt.ERROR_TIMEOUT -> "timeout"
              BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "locked"
              else -> "error"
            }
            finish(session, status)
          }
        }
        session.prompt = BiometricPrompt(host, ContextCompat.getMainExecutor(activity), callback)
        session.timeout = Runnable { finish(session, "timeout", cancel = true) }
        handler.postDelayed(session.timeout!!, 120_000L)
        session.prompt!!.authenticate(promptInfo())
      } catch (_: RuntimeException) {
        finish(session, "error", cancel = true)
      }
    }
  }
}
