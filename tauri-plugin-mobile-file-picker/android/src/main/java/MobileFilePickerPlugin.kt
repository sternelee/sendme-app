package com.mobile.file.picker

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID

private const val TAG = "MobileFilePicker"

@TauriPlugin
class MobileFilePickerPlugin(private val activity: Activity) : Plugin(activity) {
    private var currentInvoke: Invoke? = null
    private var currentOptions: FilePickerArgs? = null
    private var currentDirectoryOptions: DirectoryPickerArgs? = null

    // Store picked URIs for later operations (like reading content or writing)
    private val pickedUris = mutableMapOf<String, Uri>()

    @Command
    fun pickFile(invoke: Invoke) {
        currentInvoke = invoke
        val args = invoke.parseArgs(FilePickerArgs::class.java)
        currentOptions = args

        val allowMultiple = args.allowMultiple
        val mimeTypes = args.allowedTypes
        val mode = args.mode

        // Use ACTION_OPEN_DOCUMENT for "open" mode (provides persistent access)
        // Use ACTION_GET_CONTENT for "import" mode (simpler, one-time access)
        val intent = if (mode == "open" || mimeTypes != null && mimeTypes.isNotEmpty()) {
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = if (mimeTypes != null && mimeTypes.isNotEmpty()) mimeTypes[0] else "*/*"
                if (mimeTypes != null && mimeTypes.size > 1) {
                    putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes)
                }
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
                // Add flag for virtual file support if requested
                if (args.allowVirtualFiles) {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
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
        val args = invoke.parseArgs(DirectoryPickerArgs::class.java)
        currentDirectoryOptions = args

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
            // Request persistent access if needed
            if (args.requestLongTermAccess) {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
            }
        }

        startActivityForResult(invoke, intent, "handleDirectoryPickResult")
    }

    @Command
    fun readContent(invoke: Invoke) {
        val args = invoke.parseArgs(ReadContentArgs::class.java)
        val uriString = args.uri ?: run {
            invoke.reject("URI is required")
            return
        }

        try {
            val uri = Uri.parse(uriString)
            val contentResolver = activity.contentResolver
            val convertType = args.convertVirtualAsType

            // Check for virtual file
            val isVirtual = isVirtualFile(uri)
            val inputStream: InputStream? = if (isVirtual && convertType != null) {
                // Open virtual file with type conversion
                getInputStreamForVirtualFile(uri, convertType)
            } else {
                contentResolver.openInputStream(uri)
            }

            inputStream?.use { stream ->
                val bytes = stream.readBytes()
                val base64Data = Base64.encodeToString(bytes, Base64.NO_WRAP)
                val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"

                invoke.resolve(JSObject().apply {
                    put("data", base64Data)
                    put("mimeType", mimeType)
                    put("size", bytes.size.toLong())
                })
            } ?: invoke.reject("Failed to open input stream for URI: $uriString")
        } catch (e: Exception) {
            Log.e(TAG, "Error reading content", e)
            invoke.reject("Error reading content: ${e.message}")
        }
    }

    @Command
    fun copyToLocal(invoke: Invoke) {
        val args = invoke.parseArgs(CopyToLocalArgs::class.java)
        val uriString = args.uri ?: run {
            invoke.reject("URI is required")
            return
        }

        try {
            val uri = Uri.parse(uriString)
            val contentResolver = activity.contentResolver
            val convertType = args.convertVirtualAsType

            // Determine destination directory
            val destDir = when (args.destination ?: "cache") {
                "documents" -> activity.filesDir
                else -> activity.cacheDir
            }

            // Create a unique subdirectory to avoid conflicts
            val uniqueDir = File(destDir, ".sendme-${UUID.randomUUID()}")
            uniqueDir.mkdirs()

            // Get filename
            val filename = args.filename ?: getDisplayName(uri) ?: "file_${System.currentTimeMillis()}"
            val destFile = File(uniqueDir, filename)

            // Check for virtual file
            val isVirtual = isVirtualFile(uri)
            val inputStream: InputStream? = if (isVirtual && convertType != null) {
                getInputStreamForVirtualFile(uri, convertType)
            } else {
                contentResolver.openInputStream(uri)
            }

            inputStream?.use { input ->
                FileOutputStream(destFile).use { output ->
                    input.copyTo(output)
                }
            } ?: run {
                invoke.reject("Failed to open input stream for URI: $uriString")
                return
            }

            val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"

            invoke.resolve(JSObject().apply {
                put("path", destFile.absolutePath)
                put("name", filename)
                put("size", destFile.length())
                put("mimeType", mimeType)
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error copying to local", e)
            invoke.reject("Error copying to local: ${e.message}")
        }
    }

    @Command
    fun writeContent(invoke: Invoke) {
        val args = invoke.parseArgs(WriteContentArgs::class.java)
        val uriString = args.uri ?: run {
            invoke.reject("URI is required")
            return
        }
        val data = args.data ?: run {
            invoke.reject("Data is required")
            return
        }

        try {
            val uri = Uri.parse(uriString)
            val contentResolver = activity.contentResolver
            val bytes = Base64.decode(data, Base64.DEFAULT)

            contentResolver.openOutputStream(uri)?.use { output ->
                output.write(bytes)
            } ?: run {
                invoke.reject("Failed to open output stream for URI: $uriString")
                return
            }

            invoke.resolve(JSObject().apply {
                put("success", true)
                put("bytesWritten", bytes.size.toLong())
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error writing content", e)
            invoke.reject("Error writing content: ${e.message}")
        }
    }

    @Command
    fun releaseLongTermAccess(invoke: Invoke) {
        val args = invoke.parseArgs(ReleaseAccessArgs::class.java)
        val uris = args.uris ?: run {
            invoke.reject("URIs array is required")
            return
        }

        var releasedCount = 0
        for (uriString in uris) {
            try {
                val uri = Uri.parse(uriString)
                activity.contentResolver.releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
                pickedUris.remove(uriString)
                releasedCount++
            } catch (e: Exception) {
                Log.w(TAG, "Failed to release permission for $uriString: ${e.message}")
            }
        }

        invoke.resolve(JSObject().apply {
            put("releasedCount", releasedCount)
        })
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
            currentOptions = null
            return
        }

        try {
            val requestLongTermAccess = currentOptions?.requestLongTermAccess ?: false

            data.clipData?.let { clipData ->
                // Multiple files
                val filesList = mutableListOf<JSObject>()
                for (i in 0 until clipData.itemCount) {
                    val uri = clipData.getItemAt(i).uri
                    if (requestLongTermAccess) {
                        takePersistablePermission(uri)
                    }
                    filesList.add(getFileInfo(uri, requestLongTermAccess))
                }
                invoke.resolveObject(filesList)
            } ?: run {
                // Single file
                data.data?.let { uri ->
                    if (requestLongTermAccess) {
                        takePersistablePermission(uri)
                    }
                    invoke.resolve(getFileInfo(uri, requestLongTermAccess))
                } ?: invoke.reject("No file selected")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing file pick result", e)
            invoke.reject("Error processing file: ${e.message}")
        }

        currentInvoke = null
        currentOptions = null
    }

    @ActivityCallback
    private fun handleDirectoryPickResult(invoke: Invoke, result: ActivityResult) {
        val data = result.data

        if (result.resultCode != Activity.RESULT_OK || data == null) {
            invoke.reject("User cancelled")
            currentInvoke = null
            currentDirectoryOptions = null
            return
        }

        try {
            val uri = data.data
            if (uri != null) {
                val requestLongTermAccess = currentDirectoryOptions?.requestLongTermAccess ?: false

                if (requestLongTermAccess) {
                    takePersistablePermission(uri)
                }

                val directoryName = extractDirectoryNameFromTreeUri(uri)
                val bookmark = if (requestLongTermAccess) {
                    Base64.encodeToString(uri.toString().toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                } else null

                val fileInfo = JSObject().apply {
                    put("uri", uri.toString())
                    put("path", uri.path ?: "")
                    put("name", directoryName)
                    if (bookmark != null) {
                        put("bookmark", bookmark)
                    }
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
        currentDirectoryOptions = null
    }

    private fun takePersistablePermission(uri: Uri) {
        try {
            val takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            activity.contentResolver.takePersistableUriPermission(uri, takeFlags)
            pickedUris[uri.toString()] = uri
        } catch (e: Exception) {
            Log.w(TAG, "Failed to take persistable permission: ${e.message}")
        }
    }

    private fun isVirtualFile(uri: Uri): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return false
        }

        if (!DocumentsContract.isDocumentUri(activity, uri)) {
            return false
        }

        try {
            val cursor = activity.contentResolver.query(
                uri,
                arrayOf(DocumentsContract.Document.COLUMN_FLAGS),
                null, null, null
            )

            cursor?.use {
                if (it.moveToFirst()) {
                    val flags = it.getInt(0)
                    return (flags and DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT) != 0
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error checking virtual file: ${e.message}")
        }

        return false
    }

    private fun getConvertibleMimeTypes(uri: Uri): List<String>? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return null
        }

        try {
            val streamTypes = activity.contentResolver.getStreamTypes(uri, "*/*")
            return streamTypes?.toList()
        } catch (e: Exception) {
            Log.w(TAG, "Error getting convertible types: ${e.message}")
        }

        return null
    }

    private fun getInputStreamForVirtualFile(uri: Uri, mimeType: String): InputStream? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return null
        }

        return try {
            activity.contentResolver
                .openTypedAssetFileDescriptor(uri, mimeType, null)
                ?.createInputStream()
        } catch (e: Exception) {
            Log.e(TAG, "Error opening virtual file: ${e.message}")
            null
        }
    }

    private fun extractDirectoryNameFromTreeUri(uri: Uri): String {
        val path = uri.path ?: return "Directory"
        val treePath = path.substringAfter("/tree/")
        val segments = treePath.split("/")
        val lastSegment = segments.lastOrNull() ?: return "Directory"
        val decoded = java.net.URLDecoder.decode(lastSegment, "UTF-8")
        val nameParts = decoded.split("/")
        return nameParts.lastOrNull() ?: "Directory"
    }

    private fun getFileInfo(uri: Uri, includeLongTermAccess: Boolean = false): JSObject {
        val contentResolver = activity.contentResolver
        val cursor = contentResolver.query(uri, null, null, null, null)

        return try {
            val nameIndex = cursor?.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME) ?: -1
            val sizeIndex = cursor?.getColumnIndexOrThrow(OpenableColumns.SIZE) ?: -1

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

            val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"
            val path = getPathFromUri(uri)
            val isVirtual = isVirtualFile(uri)

            fileInfo.put("uri", uri.toString())
            fileInfo.put("path", path ?: uri.toString())
            fileInfo.put("name", name ?: getFilenameFromUri(uri))
            fileInfo.put("size", size)
            fileInfo.put("mimeType", mimeType)
            fileInfo.put("isVirtual", isVirtual)

            if (isVirtual) {
                val convertibleTypes = getConvertibleMimeTypes(uri)
                if (convertibleTypes != null) {
                    val typesArray = org.json.JSONArray(convertibleTypes)
                    fileInfo.put("convertibleToMimeTypes", typesArray)
                }
            }

            if (includeLongTermAccess) {
                val bookmark = Base64.encodeToString(uri.toString().toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                fileInfo.put("bookmark", bookmark)
            }

            // Store URI for later operations
            pickedUris[uri.toString()] = uri

            fileInfo
        } catch (e: Exception) {
            Log.e(TAG, "Error getting file info", e)
            JSObject().apply {
                put("uri", uri.toString())
                put("path", uri.toString())
                put("name", getFilenameFromUri(uri))
                put("size", 0L)
                put("mimeType", "application/octet-stream")
                put("isVirtual", false)
            }
        } finally {
            cursor?.close()
        }
    }

    private fun getDisplayName(uri: Uri): String? {
        val contentResolver = activity.contentResolver
        val cursor = contentResolver.query(uri, null, null, null, null)

        return try {
            val nameIndex = cursor?.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME) ?: -1
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

    private fun getFilenameFromUri(uri: Uri): String {
        uri.lastPathSegment?.let { segment ->
            if (segment.contains(":")) {
                val filenamePart = segment.substringAfter(":")
                if (filenamePart.contains(".")) {
                    return filenamePart
                }
                val mimeType = activity.contentResolver.getType(uri) ?: "application/octet-stream"
                val extension = getExtensionFromMimeType(mimeType)
                return "file_$filenamePart$extension"
            }
            if (segment.contains(".")) {
                return segment
            }
            return "file_$segment"
        }
        return "Unknown"
    }

    private fun getExtensionFromMimeType(mimeType: String): String {
        return when (mimeType) {
            "image/jpeg" -> ".jpg"
            "image/png" -> ".png"
            "image/gif" -> ".gif"
            "image/webp" -> ".webp"
            "video/mp4" -> ".mp4"
            "video/avi" -> ".avi"
            "audio/mpeg", "audio/mp3" -> ".mp3"
            "audio/wav" -> ".wav"
            "text/plain" -> ".txt"
            "application/pdf" -> ".pdf"
            "application/vnd.google-apps.document" -> ".gdoc"
            "application/vnd.google-apps.spreadsheet" -> ".gsheet"
            "application/vnd.google-apps.presentation" -> ".gslides"
            else -> when {
                mimeType.startsWith("image/") -> ".jpg"
                mimeType.startsWith("video/") -> ".mp4"
                mimeType.startsWith("audio/") -> ".mp3"
                mimeType.startsWith("text/") -> ".txt"
                else -> ""
            }
        }
    }

    private fun getPathFromUri(uri: Uri): String? {
        if (uri.scheme == "file") {
            return uri.path
        }

        if (uri.scheme == "content") {
            try {
                if (DocumentsContract.isDocumentUri(activity, uri)) {
                    val docId = DocumentsContract.getDocumentId(uri)

                    when (uri.authority) {
                        "com.android.externalstorage.documents" -> {
                            val split = docId.split(":")
                            val type = split[0]
                            val relativePath = if (split.size > 1) split[1] else ""

                            if ("primary".equals(type, ignoreCase = true)) {
                                return "${android.os.Environment.getExternalStorageDirectory()}/$relativePath"
                            }
                        }
                        "com.android.providers.downloads.documents" -> {
                            if (docId.startsWith("raw:")) {
                                return docId.substringAfter("raw:")
                            }
                        }
                        "com.android.providers.media.documents" -> {
                            val split = docId.split(":")
                            val type = split[0]
                            val id = if (split.size > 1) split[1] else null

                            if (id != null) {
                                val contentUri = when (type) {
                                    "image" -> android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                                    "video" -> android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                                    "audio" -> android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                                    else -> null
                                }

                                if (contentUri != null) {
                                    val selection = "_id=?"
                                    val selectionArgs = arrayOf(id)
                                    return getDataColumn(contentUri, selection, selectionArgs)
                                }
                            }
                        }
                    }
                }

                return getDataColumn(uri, null, null)
            } catch (e: Exception) {
                Log.w(TAG, "Could not resolve path from URI: ${e.message}")
            }
        }

        return null
    }

    private fun getDataColumn(uri: Uri, selection: String?, selectionArgs: Array<String>?): String? {
        val column = "_data"
        val projection = arrayOf(column)

        try {
            activity.contentResolver.query(uri, projection, selection, selectionArgs, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val columnIndex = cursor.getColumnIndexOrThrow(column)
                    return cursor.getString(columnIndex)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not get data column: ${e.message}")
        }

        return null
    }
}

// Argument classes for parsing - using @InvokeArg annotation for Tauri compatibility
@InvokeArg
class FilePickerArgs {
    var allowMultiple: Boolean = false
    var allowedTypes: Array<String>? = null
    var mode: String = "import"  // "import" or "open"
    var requestLongTermAccess: Boolean = false
    var allowVirtualFiles: Boolean = false
}

@InvokeArg
class DirectoryPickerArgs {
    var startDirectory: String? = null
    var requestLongTermAccess: Boolean = false
}

@InvokeArg
class ReadContentArgs {
    var uri: String? = null
    var convertVirtualAsType: String? = null
}

@InvokeArg
class CopyToLocalArgs {
    var uri: String? = null
    var destination: String = "cache"  // "cache" or "documents"
    var filename: String? = null
    var convertVirtualAsType: String? = null
}

@InvokeArg
class WriteContentArgs {
    var uri: String? = null
    var data: String? = null
    var mimeType: String? = null
}

@InvokeArg
class ReleaseAccessArgs {
    var uris: Array<String>? = null
}

@InvokeArg
class PingArgs {
    var value: String? = null
}
