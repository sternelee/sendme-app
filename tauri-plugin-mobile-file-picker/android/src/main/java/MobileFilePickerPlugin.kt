package com.mobile.file.picker

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

private const val TAG = "MobileFilePicker"

@TauriPlugin
class MobileFilePickerPlugin(private val activity: Activity) : Plugin(activity) {
    private var currentInvoke: Invoke? = null

    @Command
    fun pickFile(invoke: Invoke) {
        currentInvoke = invoke

        val args = invoke.parseArgs(FilePickerArgs::class.java)
        val allowMultiple = args.allowMultiple ?: false
        val mimeTypes = args.allowedTypes

        val intent = if (mimeTypes != null && mimeTypes.isNotEmpty()) {
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mimeTypes[0]
                if (mimeTypes.size > 1) {
                    putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes)
                }
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
            }
        } else {
            Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
            }
        }

        startActivityForResult(invoke, Intent.createChooser(intent, "Select File"), "handleFilePickResult")
    }

    @Command
    fun pick_directory(invoke: Invoke) {
        currentInvoke = invoke

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
        }

        startActivityForResult(invoke, intent, "handleDirectoryPickResult")
    }

    @Command
    fun ping(invoke: Invoke) {
        val args = invoke.parseArgs(PingArgs::class.java)
        val value = args.value ?: ""
        invoke.resolve(JSObject().apply {
            put("value", value)
        })
    }

    @ActivityCallback
    private fun handleFilePickResult(invoke: Invoke, result: ActivityResult) {
        val data = result.data

        if (result.resultCode != Activity.RESULT_OK || data == null) {
            invoke.reject("User cancelled")
            currentInvoke = null
            return
        }

        try {
            data.clipData?.let { clipData ->
                // Multiple files - use resolveObject for arrays
                val filesList = mutableListOf<JSObject>()
                for (i in 0 until clipData.itemCount) {
                    val uri = clipData.getItemAt(i).uri
                    filesList.add(getFileInfo(uri))
                }
                invoke.resolveObject(filesList)
            } ?: run {
                // Single file - use resolve with JSObject
                data.data?.let { uri ->
                    invoke.resolve(getFileInfo(uri))
                } ?: invoke.reject("No file selected")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing file pick result", e)
            invoke.reject("Error processing file: ${e.message}")
        }

        currentInvoke = null
    }

    @ActivityCallback
    private fun handleDirectoryPickResult(invoke: Invoke, result: ActivityResult) {
        val data = result.data

        if (result.resultCode != Activity.RESULT_OK || data == null) {
            invoke.reject("User cancelled")
            currentInvoke = null
            return
        }

        try {
            val uri = data.data
            if (uri != null) {
                // Extract directory name from tree URI
                // Tree URIs look like: content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fsendme
                // We need to extract "sendme" from the path
                val directoryName = extractDirectoryNameFromTreeUri(uri)

                val fileInfo = JSObject().apply {
                    put("uri", uri.toString())
                    put("path", uri.path ?: "")
                    put("name", directoryName)
                    put("size", 0L)
                    put("mime_type", "inode/directory")
                }
                invoke.resolve(fileInfo)
            } else {
                invoke.reject("No directory selected")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing directory pick result", e)
            invoke.reject("Error processing directory: ${e.message}")
        }

        currentInvoke = null
    }

    private fun extractDirectoryNameFromTreeUri(uri: Uri): String {
        // For tree URIs, extract the last path segment as the directory name
        // Example: content://.../tree/primary%3ADownload%2Fsendme -> sendme
        val path = uri.path ?: return "Directory"

        // Remove /tree/ prefix if present
        val treePath = path.substringAfter("/tree/")

        // Split by / and get the last segment
        val segments = treePath.split("/")

        // Get the last segment and decode URL encoding
        val lastSegment = segments.lastOrNull() ?: return "Directory"

        // Decode URL encoding (e.g., %2F -> /, %3A -> :)
        val decoded = java.net.URLDecoder.decode(lastSegment, "UTF-8")

        // Extract the actual directory name (after the last /)
        val nameParts = decoded.split("/")
        return nameParts.lastOrNull() ?: "Directory"
    }

    private fun getFileInfo(uri: Uri): JSObject {
        val contentResolver = activity.contentResolver
        val cursor = contentResolver.query(uri, null, null, null, null)

        return try {
            val nameIndex = cursor?.getColumnIndexOrThrow(android.provider.OpenableColumns.DISPLAY_NAME) ?: -1
            val sizeIndex = cursor?.getColumnIndexOrThrow(android.provider.OpenableColumns.SIZE) ?: -1

            val fileInfo = JSObject()
            var name: String? = null
            var size: Long = 0

            cursor?.use {
                if (it.moveToFirst()) {
                    if (nameIndex >= 0) name = it.getString(nameIndex)
                    if (sizeIndex >= 0 && !it.isNull(sizeIndex)) {
                        size = it.getLong(sizeIndex)
                    }
                }
            }

            // Try to get MIME type
            val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"

            // Get file path if available
            val path = getPathFromUri(uri)

            fileInfo.put("uri", uri.toString())
            fileInfo.put("path", path ?: uri.toString())
            fileInfo.put("name", name ?: uri.lastPathSegment ?: "Unknown")
            fileInfo.put("size", size)
            fileInfo.put("mime_type", mimeType)

            fileInfo
        } catch (e: Exception) {
            Log.e(TAG, "Error getting file info", e)
            JSObject().apply {
                put("uri", uri.toString())
                put("path", uri.toString())
                put("name", uri.lastPathSegment ?: "Unknown")
                put("size", 0L)
                put("mime_type", "application/octet-stream")
            }
        } finally {
            cursor?.close()
        }
    }

    private fun getDisplayName(uri: Uri): String? {
        val contentResolver = activity.contentResolver
        val cursor = contentResolver.query(uri, null, null, null, null)

        return try {
            val nameIndex = cursor?.getColumnIndexOrThrow(android.provider.OpenableColumns.DISPLAY_NAME) ?: -1
            cursor?.use {
                if (it.moveToFirst() && nameIndex >= 0) {
                    it.getString(nameIndex)
                } else {
                    null
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error getting display name", e)
            null
        } finally {
            cursor?.close()
        }
    }

    private fun getPathFromUri(uri: Uri): String? {
        // Try to get real file path
        val projection = arrayOf(android.provider.OpenableColumns.DISPLAY_NAME)
        activity.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
            val columnIndex = cursor.getColumnIndexOrThrow(android.provider.OpenableColumns.DISPLAY_NAME)
            if (cursor.moveToFirst()) {
                val name = cursor.getString(columnIndex)
                // Check if it's a file:// URI
                if (uri.scheme == "file") {
                    return uri.path
                }
                // For content URIs, we can't reliably get the file path
                // Return null to indicate the URI should be used instead
            }
        }
        return null
    }
}

// Argument classes for parsing
class FilePickerArgs {
    var allowMultiple: Boolean? = null
    var allowedTypes: Array<String>? = null
}

class PingArgs {
    var value: String? = null
}
