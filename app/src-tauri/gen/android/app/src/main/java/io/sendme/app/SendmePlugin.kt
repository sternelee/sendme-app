package io.sendme.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ForegroundServiceArgs {
  lateinit var payloadJson: String
}

@InvokeArg
class OpenFileArgs {
  lateinit var filePath: String
}

@TauriPlugin
class SendmePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun upsertForegroundService(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ForegroundServiceArgs::class.java)
      SendmeForegroundService.upsert(activity, args.payloadJson)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("Failed to update foreground service: ${e.message}", e)
    }
  }

  @Command
  fun stopForegroundService(invoke: Invoke) {
    try {
      SendmeForegroundService.stop(activity)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("Failed to stop foreground service: ${e.message}", e)
    }
  }

  @Command
  fun getDeviceModel(invoke: Invoke) {
    val model = Build.MODEL.trim()
    val manufacturer = Build.MANUFACTURER.trim()
    val value =
      if (manufacturer.isNotEmpty() && !model.startsWith(manufacturer, ignoreCase = true)) {
        "$manufacturer $model"
      } else {
        model
      }.ifBlank { "Android Device" }

    invoke.resolve(JSObject().apply { put("value", value) })
  }

  @Command
  fun getDefaultDownloadFolder(invoke: Invoke) {
    val path =
      Environment
        .getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        .absolutePath

    invoke.resolve(JSObject().apply { put("value", path) })
  }

  @Command
  fun openFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(OpenFileArgs::class.java)
      val file = File(args.filePath)
      if (!file.exists()) {
        invoke.reject("File not found: ${args.filePath}")
        return
      }

      val uri =
        FileProvider.getUriForFile(
          activity,
          "${activity.packageName}.fileprovider",
          file,
        )
      val mimeType = mimeTypeFor(file)
      val intent =
        Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, mimeType)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

      activity.startActivity(Intent.createChooser(intent, null))
      invoke.resolve()
    } catch (e: ActivityNotFoundException) {
      invoke.reject("No app can open this file type: ${e.message}", e)
    } catch (e: Exception) {
      invoke.reject("Failed to open file: ${e.message}", e)
    }
  }

  private fun mimeTypeFor(file: File): String {
    val extension = file.extension.lowercase()
    if (extension.isBlank()) {
      return "application/octet-stream"
    }

    return MimeTypeMap
      .getSingleton()
      .getMimeTypeFromExtension(extension)
      ?: "application/octet-stream"
  }
}
