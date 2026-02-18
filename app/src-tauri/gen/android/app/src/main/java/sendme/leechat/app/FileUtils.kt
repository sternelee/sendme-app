package sendme.leechat.app

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.documentfile.provider.DocumentFile

private const val TAG = "FileUtils"

object FileUtils {
    /**
     * Write file data to a content URI directory.
     *
     * @param context The Android context (activity)
     * @param dirUri The directory URI (tree URI) from the file picker
     * @param fileName The name of the file to create
     * @param data The file data as a byte array
     * @return true if successful, false otherwise
     */
    @JvmStatic
    fun writeFileToContentUri(context: Context, dirUri: String, fileName: String, data: ByteArray): Boolean {
        return try {
            val contentResolver = context.contentResolver

            // Parse the directory tree URI
            val treeUri = Uri.parse(dirUri)

            Log.d(TAG, "Writing file: $fileName to tree URI: $dirUri")
            Log.d(TAG, "Data size: ${data.size} bytes")

            // Use DocumentFile API for reliable tree URI handling
            val documentTree = DocumentFile.fromTreeUri(context, treeUri)
            if (documentTree == null) {
                Log.e(TAG, "Failed to get DocumentFile from tree URI: $dirUri")
                throw IllegalStateException("Failed to get DocumentFile from tree URI. This may indicate the URI permission has expired. Please re-select the directory.")
            }

            Log.d(TAG, "DocumentTree name: ${documentTree.name}, canWrite: ${documentTree.canWrite()}")

            if (!documentTree.canWrite()) {
                Log.e(TAG, "DocumentTree is not writable: $dirUri")
                // Check if permission was granted
                val persistedUris = context.contentResolver.persistedUriPermissions
                val hasPermission = persistedUris.any { it.uri.toString() == dirUri && it.isReadPermission }
                Log.e(TAG, "Permission check: has persisted permission = $hasPermission")
                throw SecurityException("Cannot write to directory. The app does not have write permission for this location. Please re-select the directory and grant permission.")
            }

            // Handle subdirectory paths (e.g., "subdir/file.txt")
            // Split the fileName by '/' and create intermediate directories
            val parts = fileName.split("/")
            val actualFileName = parts.last()
            var targetDir: DocumentFile = documentTree

            // Create intermediate directories if needed
            if (parts.size > 1) {
                for (dirName in parts.dropLast(1)) {
                    if (dirName.isEmpty()) continue
                    val existingDir = targetDir.findFile(dirName)
                    targetDir = if (existingDir != null && existingDir.isDirectory) {
                        Log.d(TAG, "Using existing subdirectory: $dirName")
                        existingDir
                    } else {
                        val newDir = targetDir.createDirectory(dirName)
                        if (newDir == null) {
                            Log.e(TAG, "Failed to create subdirectory: $dirName in ${targetDir.uri}")
                            throw IllegalStateException("Failed to create subdirectory '$dirName'. The directory may be read-only or the URI permission may not cover this path.")
                        }
                        Log.d(TAG, "Created subdirectory: $dirName")
                        newDir
                    }
                }
            }

            // Check if file already exists, if so delete it
            val existingFile = targetDir.findFile(actualFileName)
            if (existingFile != null) {
                Log.d(TAG, "File already exists, deleting: $actualFileName")
                existingFile.delete()
            }

            // Determine MIME type
            val mimeType = getMimeType(actualFileName)
            Log.d(TAG, "Creating file with MIME type: $mimeType")

            // Create new file in the target directory
            val newFile = targetDir.createFile(mimeType, actualFileName)
            if (newFile == null) {
                Log.e(TAG, "Failed to create file: $actualFileName in ${targetDir.uri}")
                // Try to get more info
                val canCreate = targetDir.canWrite()
                Log.e(TAG, "Target directory canWrite: $canCreate, canRead: ${targetDir.canRead()}")
                throw IllegalStateException("Failed to create file '$actualFileName'. The directory may be full or read-only. Check device storage space and directory permissions.")
            }

            Log.d(TAG, "Created file: ${newFile.uri}")

            // Write data to the file
            contentResolver.openOutputStream(newFile.uri)?.use { outputStream ->
                outputStream.write(data)
                outputStream.flush()
                Log.d(TAG, "Successfully wrote ${data.size} bytes to ${newFile.uri}")
                true
            } ?: run {
                Log.e(TAG, "Failed to open output stream for ${newFile.uri}")
                throw IllegalStateException("Failed to open output stream for file '$actualFileName'. The file may have been created but could not be written to.")
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "Security exception - URI permission may have expired: $dirUri", e)
            throw SecurityException("Permission denied. The directory access permission may have expired. Please re-select the directory and grant permission when prompted. Original error: ${e.message}")
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "Invalid URI argument: $dirUri", e)
            throw IllegalArgumentException("Invalid directory URI: $dirUri. The selected directory may no longer exist or be accessible. Original error: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Error writing file to content URI", e)
            e.printStackTrace()
            throw RuntimeException("Failed to write file '$fileName': ${e.javaClass.simpleName} - ${e.message}")
        }
    }

    private fun getMimeType(fileName: String): String {
        val extension = fileName.substringAfterLast('.', "").lowercase()
        return when (extension) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "bmp" -> "image/bmp"
            "svg" -> "image/svg+xml"
            "pdf" -> "application/pdf"
            "zip" -> "application/zip"
            "7z" -> "application/x-7z-compressed"
            "rar" -> "application/vnd.rar"
            "tar" -> "application/x-tar"
            "gz", "gzip" -> "application/gzip"
            "txt" -> "text/plain"
            "html", "htm" -> "text/html"
            "css" -> "text/css"
            "js" -> "application/javascript"
            "json" -> "application/json"
            "xml" -> "application/xml"
            "mp4" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "avi" -> "video/x-msvideo"
            "mov" -> "video/quicktime"
            "webm" -> "video/webm"
            "mp3" -> "audio/mpeg"
            "wav" -> "audio/wav"
            "ogg" -> "audio/ogg"
            "flac" -> "audio/flac"
            "m4a" -> "audio/mp4"
            "doc" -> "application/msword"
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "xls" -> "application/vnd.ms-excel"
            "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            "ppt" -> "application/vnd.ms-powerpoint"
            "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            "apk" -> "application/vnd.android.package-archive"
            else -> "application/octet-stream"
        }
    }
}
