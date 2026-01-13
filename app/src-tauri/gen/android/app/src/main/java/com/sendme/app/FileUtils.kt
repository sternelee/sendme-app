package com.sendme.app

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.util.Log
import java.io.File
import java.io.FileOutputStream

private const val TAG = "FileUtils"

object FileUtils {
    /**
     * Write file data to a content URI directory.
     *
     * @param dirUri The directory URI (tree URI) from the file picker
     * @param fileName The name of the file to create
     * @param data The file data as a byte array
     * @return true if successful, false otherwise
     */
    @JvmStatic
    fun writeFileToContentUri(dirUri: String, fileName: String, data: ByteArray): Boolean {
        return try {
            val context = getContext()
            val contentResolver = context.contentResolver

            // Parse the directory tree URI
            val treeUri = Uri.parse(dirUri)

            Log.d(TAG, "Writing file: $fileName to tree URI: $dirUri")

            // Create the document URI for the new file
            // For tree URIs, we need to use DocumentsContract API
            val documentUri = createDocumentUri(treeUri, fileName)

            Log.d(TAG, "Created document URI: $documentUri")

            // Create the document
            val contentValues = ContentValues().apply {
                put(DocumentsContract.Document.COLUMN_DISPLAY_NAME, fileName)
                put(DocumentsContract.Document.COLUMN_MIME_TYPE, getMimeType(fileName))
            }

            // Try to create the document
            val createdUri = contentResolver.insert(documentUri, contentValues)

            if (createdUri == null) {
                Log.e(TAG, "Failed to create document: $documentUri")
                // Fallback: try using DocumentsContract.createDocument
                val altUri = DocumentsContract.createDocument(
                    contentResolver,
                    treeUri,
                    DocumentsContract.Document.MIME_TYPE_DIR,
                    fileName
                )

                if (altUri != null) {
                    Log.d(TAG, "Created document using createDocument: $altUri")
                    writeToFile(contentResolver, altUri, data)
                } else {
                    Log.e(TAG, "Failed to create document using createDocument")
                    false
                }
            } else {
                Log.d(TAG, "Created document: $createdUri")
                writeToFile(contentResolver, createdUri, data)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error writing file to content URI", e)
            false
        }
    }

    private fun createDocumentUri(treeUri: Uri, fileName: String): Uri {
        // Build the document URI from tree URI
        // tree URI: content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fsendme
        // document URI: content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fsendme/document/primary%3ADownload%2Fsendme%2Ffilename.jpg

        val treePath = treeUri.lastPathSegment ?: return treeUri

        // Decode the tree path and encode the filename
        val decodedTreePath = java.net.URLDecoder.decode(treePath, "UTF-8")
        val encodedFileName = java.net.URLEncoder.encode(fileName, "UTF-8")

        val documentPath = "$decodedTreePath/$encodedFileName"

        return DocumentsContract.buildDocumentUriUsingTree(treeUri, documentPath)
    }

    private fun writeToFile(contentResolver: android.content.ContentResolver, uri: Uri, data: ByteArray): Boolean {
        return try {
            contentResolver.openOutputStream(uri)?.use { outputStream ->
                outputStream.write(data)
                outputStream.flush()
                Log.d(TAG, "Successfully wrote ${data.size} bytes to $uri")
                true
            } ?: run {
                Log.e(TAG, "Failed to open output stream for $uri")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error writing to output stream", e)
            false
        }
    }

    private fun getMimeType(fileName: String): String {
        val extension = fileName.substringAfterLast('.', "")
        return when (extension.lowercase()) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "pdf" -> "application/pdf"
            "zip" -> "application/zip"
            "txt" -> "text/plain"
            "mp4" -> "video/mp4"
            "mp3" -> "audio/mpeg"
            else -> "application/octet-stream"
        }
    }

    private fun getContext(): Context {
        // Try to get the context from the current activity
        val activity = getCurrentActivity()
        return activity ?: throw IllegalStateException("No activity available")
    }

    private fun getCurrentActivity(): android.app.Activity? {
        // This is a simplified approach - in practice you'd get this from Tauri
        return try {
            Class.forName("android.app.ActivityThread")
                .getMethod("currentActivityThread")
                .invoke(null)
                .let { it.javaClass.getMethod("getActivities").invoke(it) as Array<android.app.Activity> }
                .firstOrNull()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get current activity", e)
            null
        }
    }
}
