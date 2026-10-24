package local.thingary.preview

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.Context
import android.content.IntentFilter
import android.os.Build
import android.system.Os
import android.system.OsConstants
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

@InvokeArg
data class ShareFileArgs(
  var path: String = "",
  var mime: String = "application/octet-stream",
)

@InvokeArg
data class PickBackupArgs(
  var stagingDir: String = "",
  var uploadName: String = "",
  var maxBytes: Long = 0,
)

/**
 * File hand-off for the mobile pages: private directories, the system share
 * sheet through FileProvider, and a Storage Access Framework backup picker
 * whose selection is copied into a private staging directory before inspection.
 */
@TauriPlugin
class FilesPlugin(private val activity: Activity) : Plugin(activity) {
  private val busy = AtomicBoolean(false)
  private var shareReceiver: BroadcastReceiver? = null
  private val shareChosen = AtomicBoolean(false)

  private fun begin(invoke: Invoke): Boolean {
    if (busy.compareAndSet(false, true)) return true
    invoke.reject("另一个文件面板尚未完成")
    return false
  }

  @Command
  fun appDirs(invoke: Invoke) {
    invoke.resolveObject(
      mapOf(
        "files" to activity.filesDir.absolutePath,
        "cache" to activity.cacheDir.absolutePath,
      )
    )
  }

  @Command
  fun shareFile(invoke: Invoke) {
    if (!begin(invoke)) return
    activity.runOnUiThread {
      try {
        val args = invoke.parseArgs(ShareFileArgs::class.java)
        val original = File(args.path)
        if (!OsConstants.S_ISREG(Os.lstat(original.absolutePath).st_mode))
          throw IOException("请选择普通导出文件")
        val file = original.canonicalFile
        val exports = File(activity.filesDir, "exports").canonicalFile
        val transient = File(activity.cacheDir, "share").canonicalFile
        val parent = file.parentFile ?: throw IOException("导出文件不在应用分享目录")
        if (original.absoluteFile != file || parent !in listOf(exports, transient))
          throw IOException("导出文件不在应用分享目录")
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
          type = args.mime
          putExtra(Intent.EXTRA_STREAM, uri)
          clipData = ClipData.newRawUri("导出文件", uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        shareChosen.set(false)
        val action = "${activity.packageName}.files.SHARE_CHOSEN"
        val receiver = object : BroadcastReceiver() {
          override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == action && intent.hasExtra(Intent.EXTRA_CHOSEN_COMPONENT))
              shareChosen.set(true)
          }
        }
        if (Build.VERSION.SDK_INT >= 33) {
          activity.registerReceiver(receiver, IntentFilter(action), Context.RECEIVER_NOT_EXPORTED)
        } else {
          @Suppress("DEPRECATION")
          activity.registerReceiver(receiver, IntentFilter(action))
        }
        shareReceiver = receiver
        val callback = PendingIntent.getBroadcast(activity, 0,
          Intent(action).setPackage(activity.packageName),
          PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_MUTABLE)
        val chooser = Intent.createChooser(send, "分享", callback.intentSender)
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivityForResult(invoke, chooser, "shareFileResult")
      } catch (error: Exception) {
        finishShare()
        invoke.reject(error.message ?: "无法打开系统分享面板")
      }
    }
  }

  /** A chosen target acknowledges hand-off, not delivery or saving by that app. */
  @ActivityCallback
  private fun shareFileResult(invoke: Invoke, result: ActivityResult) {
    val completed = shareChosen.get() || result.resultCode == Activity.RESULT_OK
    finishShare()
    invoke.resolveObject(mapOf("completed" to completed))
  }

  private fun finishShare() {
    shareReceiver?.let { activity.unregisterReceiver(it) }
    shareReceiver = null
    busy.set(false)
  }

  @Command
  fun pickBackup(invoke: Invoke) {
    if (!begin(invoke)) return
    activity.runOnUiThread {
      try {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityForResult(invoke, intent, "pickBackupResult")
      } catch (error: Exception) {
        busy.set(false)
        invoke.reject(error.message ?: "无法打开系统文件选择面板")
      }
    }
  }

  @ActivityCallback
  private fun pickBackupResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      busy.set(false)
      invoke.resolveObject(mapOf("cancelled" to true))
      return
    }
    // Activity callbacks run on the UI thread. Providers can be remote or slow;
    // keep the panel reserved until background copying has finished.
    Thread({
      try {
        val args = invoke.parseArgs(PickBackupArgs::class.java)
        val name = displayName(uri)
        if (name.isBlank() || name == "." || name == ".." ||
          name.any { it == '/' || it == '\\' || it.isISOControl() })
          throw IOException("所选文件名不能包含路径")
        val target = copyToStaging(uri, args)
        invoke.resolveObject(mapOf("cancelled" to false,
          "path" to target.absolutePath, "name" to name))
      } catch (error: Exception) {
        invoke.reject(error.message ?: "无法复制所选备份")
      } finally {
        busy.set(false)
      }
    }, "thingary-backup-copy").start()
  }

  /**
   * Copies the content URI through a `.part` file and renames only after the
   * full read and sync, so cancellation, a size overrun or an I/O failure
   * cannot leave a half-written backup in staging.
   */
  private fun copyToStaging(uri: Uri, args: PickBackupArgs): File {
    val original = File(args.stagingDir)
    val directory = original.canonicalFile
    val root = File(activity.cacheDir, "backup-staging").canonicalFile
    if (original.absoluteFile != directory || directory.parentFile != root ||
      !directory.name.startsWith("pick-") || !directory.isDirectory ||
      !args.uploadName.matches(Regex("[a-f0-9-]{36}")) || args.maxBytes <= 0)
      throw IOException("备份暂存目录不可用")
    val part = File(directory, "${args.uploadName}.part")
    val target = File(directory, args.uploadName)
    val limit = args.maxBytes
    if (target.exists() || !part.createNewFile()) throw IOException("备份暂存文件已存在")
    try {
      // A provider may omit or lie about SIZE; the streaming check below is
      // authoritative even when this early rejection is unavailable.
      val knownSize = try {
        activity.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
          val column = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (cursor.moveToFirst() && column >= 0 && !cursor.isNull(column)) cursor.getLong(column) else null
        }
      } catch (_: Exception) { null }
      if (knownSize != null && knownSize > limit) throw IOException("所选备份超过备份大小上限")
      val source = activity.contentResolver.openInputStream(uri)
        ?: throw IOException("无法读取所选文件")
      source.use { input ->
        FileOutputStream(part).use { output ->
          val buffer = ByteArray(256 * 1024)
          var total = 0L
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            if (read.toLong() > limit - total) throw IOException("所选备份超过备份大小上限")
            total += read
            output.write(buffer, 0, read)
          }
          output.fd.sync()
        }
      }
      if (!part.renameTo(target)) throw IOException("无法保存所选文件")
      return target
    } catch (error: Exception) {
      part.delete()
      target.delete()
      throw error
    }
  }

  private fun displayName(uri: Uri): String {
    try {
      activity.contentResolver
        .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
          if (cursor.moveToFirst()) {
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0) {
              val name = cursor.getString(index)
              if (!name.isNullOrBlank()) return name
            }
          }
        }
    } catch (_: Exception) {
    }
    return uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "backup.thingary"
  }
}
