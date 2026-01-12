package com.sendme.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
  companion object {
    private const val TAG = "SendmeMainActivity"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * Open a file using the appropriate app on the device.
   * This method handles Android 10+ scoped storage by using MediaStore content URIs.
   *
   * @param filePath The absolute path to the file
   * @return true if the file was opened successfully, false otherwise
   */
  fun openFile(filePath: String): Boolean {
    Log.d(TAG, "openFile called with: $filePath")

    val file = File(filePath)
    if (!file.exists()) {
      Log.e(TAG, "File does not exist: $filePath")
      return false
    }

    try {
      // Get the content URI for the file
      val contentUri = getContentUri(file)
      Log.d(TAG, "Content URI: $contentUri")

      // Get MIME type
      val mimeType = getMimeType(file.absolutePath) ?: "*/*"
      Log.d(TAG, "MIME type: $mimeType")

      // Create intent with FLAG_GRANT_READ_URI_PERMISSION
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, mimeType)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }

      // Check if there's an app to handle this intent
      if (intent.resolveActivity(packageManager) != null) {
        startActivity(intent)
        Log.d(TAG, "Activity started successfully")
        return true
      } else {
        Log.e(TAG, "No app can handle this intent")
        // Try with a chooser
        val chooser = Intent.createChooser(intent, "Open file").apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(chooser)
        return true
      }
    } catch (e: ActivityNotFoundException) {
      Log.e(TAG, "ActivityNotFoundException: ${e.message}", e)
      return false
    } catch (e: Exception) {
      Log.e(TAG, "Exception opening file: ${e.message}", e)
      e.printStackTrace()
      return false
    }
  }

  /**
   * Get a content URI for the file.
   * For files in external storage, queries MediaStore to get the content URI.
   * For files in app storage, uses FileProvider.
   */
  private fun getContentUri(file: File): Uri {
    val absolutePath = file.absolutePath
    Log.d(TAG, "Getting content URI for: $absolutePath")

    // Check if file is in external storage
    val isExternalStorage = absolutePath.contains("/storage/emulated/") ||
                           absolutePath.contains("/sdcard/")

    if (isExternalStorage) {
      Log.d(TAG, "File is in external storage")

      // Query MediaStore for the content URI
      val contentResolver = contentResolver
      val projection = arrayOf(MediaStore.Files.FileColumns._ID)
      val selection = "${MediaStore.Files.FileColumns.DATA} = ?"
      val selectionArgs = arrayOf(absolutePath)

      // Try to find the file in MediaStore by DATA column (file path)
      contentResolver.query(
        MediaStore.Files.getContentUri("external"),
        projection,
        selection,
        selectionArgs,
        null
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val id = cursor.getLong(0)
          val uri = Uri.withAppendedPath(MediaStore.Files.getContentUri("external"), "/$id")
          Log.d(TAG, "Found in MediaStore by DATA: $uri")
          return uri
        }
      }

      // Not found by DATA, try by DISPLAY_NAME
      val fileName = file.name
      val selectionByName = "${MediaStore.Files.FileColumns.DISPLAY_NAME} = ?"
      val selectionArgsByName = arrayOf(fileName)

      contentResolver.query(
        MediaStore.Files.getContentUri("external"),
        projection,
        selectionByName,
        selectionArgsByName,
        null
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val id = cursor.getLong(0)
          val uri = Uri.withAppendedPath(MediaStore.Files.getContentUri("external"), "/$id")
          Log.d(TAG, "Found in MediaStore by DISPLAY_NAME: $uri")
          return uri
        }
      }

      Log.w(TAG, "File not found in MediaStore, using file URI (may crash on Android 10+)")
      // As a last resort, try file URI - this may crash on Android 10+
      // but we wrap the whole openFile in try-catch
      return Uri.fromFile(file)
    }

    // For internal storage, use FileProvider
    Log.d(TAG, "File is in internal storage, using FileProvider")
    return androidx.core.content.FileProvider.getUriForFile(
      this,
      "${applicationContext.packageName}.fileprovider",
      file
    )
  }

  /**
   * Get MIME type for a file based on its extension
   */
  private fun getMimeType(filePath: String): String? {
    val extension = MimeTypeMap.getFileExtensionFromUrl(filePath)
    val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
    Log.d(TAG, "Extension: $extension, MIME type: $mimeType")
    return mimeType
  }
}
