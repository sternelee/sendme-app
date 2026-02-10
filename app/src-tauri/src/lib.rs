use pisend_lib::{progress::*, types::*};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;
use tokio::sync::RwLock;
use uuid::Uuid;

// Mobile file picker type aliases
// On Android, we use tauri-plugin-android-fs which returns FileUri
// On desktop/iOS, we define local stubs for compatibility

/// File information returned by the picker (cross-platform)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickerFileInfo {
    pub uri: String,
    pub path: String,
    pub name: String,
    pub size: i64,
    pub mime_type: String,
}

/// Directory information returned by the picker (cross-platform)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickerDirectoryInfo {
    pub uri: String,
    pub path: String,
    pub name: String,
}

// Android-specific module
#[cfg(target_os = "android")]
mod android;

// Import tracing for non-Android platforms
#[cfg(not(target_os = "android"))]
use tracing;

// Logging macros that work on both Android and other platforms
#[cfg(target_os = "android")]
macro_rules! log_info {
    ($($arg:tt)*) => {
        log::info!($($arg)*)
    };
}

#[cfg(not(target_os = "android"))]
macro_rules! log_info {
    ($($arg:tt)*) => {
        tracing::info!($($arg)*)
    };
}

#[cfg(target_os = "android")]
macro_rules! log_error {
    ($($arg:tt)*) => {
        log::error!($($arg)*)
    };
}

#[cfg(not(target_os = "android"))]
macro_rules! log_error {
    ($($arg:tt)*) => {
        tracing::error!($($arg)*)
    };
}

#[cfg(target_os = "android")]
macro_rules! log_warn {
    ($($arg:tt)*) => {
        log::warn!($($arg)*)
    };
}

#[cfg(not(target_os = "android"))]
macro_rules! log_warn {
    ($($arg:tt)*) => {
        tracing::warn!($($arg)*)
    };
}

/// Handle Android content URIs by reading the file and writing to a temporary location.
///
/// On Android, when using the file picker, the returned path may be a `content://` URI
/// which cannot be read directly by `std::fs`. This function uses `tauri_plugin_fs`
/// which can handle content URIs, and copies the content to a temporary file.
///
/// # Arguments
/// * `app` - The Tauri app handle
/// * `path` - The file path or content URI
/// * `filename` - The original filename (from the file picker), used for display
///
/// # Returns
/// (temp_file_path, display_name) where:
/// - temp_file_path is the path to the temporary file (or original path for regular files)
/// - display_name is the filename for UI display purposes
async fn handle_content_uri(
    app: &AppHandle,
    path: &str,
    filename: &str,
) -> Result<(std::path::PathBuf, String), String> {
    use std::str::FromStr;
    use tauri_plugin_fs::FilePath;

    // Check if this is a content URI (Android)
    if path.starts_with("content://") {
        log_info!("Detected content URI, using tauri_plugin_fs to read file");
        log_info!("Original filename from picker: {}", filename);

        // Use tauri_plugin_fs to read the file content
        let fs = app.fs(); // From FsExt trait

        // Parse the path as a FilePath (which handles content:// URIs)
        let file_path =
            FilePath::from_str(path).map_err(|e| format!("Failed to parse file path: {:?}", e))?;

        // Read the file content using the fs plugin which can handle content URIs
        let content = fs
            .read(file_path)
            .map_err(|e| format!("Failed to read content URI: {}", e))?;

        // Create a temporary file to store the content
        let temp_dir = app
            .path()
            .temp_dir()
            .map_err(|e| format!("Failed to get temp directory: {}", e))?;

        // Sanitize the filename to prevent directory traversal and add a unique suffix
        let sanitized = filename.replace(['/', '\\', '\0'], "_");
        let unique_id = &Uuid::new_v4().simple().to_string()[..8];
        let temp_filename = if let Some((stem, ext)) = sanitized.rsplit_once('.') {
            format!("{}-{}.{}", stem, unique_id, ext)
        } else {
            format!("{}-{}", sanitized, unique_id)
        };

        let temp_file_path = temp_dir.join(&temp_filename);

        // Write the content to the temporary file
        let mut file = std::fs::File::create(&temp_file_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        file.write_all(&content)
            .map_err(|e| format!("Failed to write to temp file: {}", e))?;

        log_info!("Copied content URI to temporary file: {:?}", temp_file_path);

        Ok((temp_file_path, sanitized))
    } else {
        // Regular file path (desktop or iOS), just return it as PathBuf
        log_info!("Regular file path detected: {}", path);
        let display_name = if filename.is_empty() {
            std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path)
                .to_string()
        } else {
            filename.to_string()
        };
        Ok((std::path::PathBuf::from(path), display_name))
    }
}

/// Copy exported files from temp_dir to a content URI on Android.
///
/// Uses JNI to call Android's ContentResolver to create and write files
/// to the selected directory.
#[cfg(target_os = "android")]
async fn copy_files_to_content_uri(
    _app: &AppHandle,
    temp_dir: &std::path::Path,
    content_uri: &str,
    collection: &iroh_blobs::format::collection::Collection,
) -> anyhow::Result<()> {
    log_info!("Starting copy to content URI: {}", content_uri);
    log_info!("Files to copy: {}", collection.len());

    // Extract the tree URI part from the content URI
    // Android SAF may return URIs in format: content://.../tree/.../document/...
    // We need only the tree part for DocumentFile.fromTreeUri()
    let tree_uri = extract_tree_uri_from_content_uri(content_uri);
    log_info!("Extracted tree URI: {}", tree_uri);

    // Collect file info to copy
    let files_to_copy: Vec<(String, std::path::PathBuf)> = collection
        .iter()
        .map(|(name, _hash)| (name.to_string(), temp_dir.join(name)))
        .collect();

    // Run JNI operations in a blocking thread to avoid issues with async runtime
    let result = tokio::task::spawn_blocking(move || {
        copy_files_to_content_uri_sync(&tree_uri, &files_to_copy)
    })
    .await
    .map_err(|e| anyhow::anyhow!("Task join error: {:?}", e))??;

    Ok(result)
}

/// Extract the tree URI part from a potentially compound content URI.
///
/// Android SAF may return URIs in these formats:
/// - Simple tree: content://.../tree/primary%3ADownload
/// - Compound: content://.../tree/primary%3ADownload/document/primary%3ADownload
///
/// We only need the tree part for DocumentFile.fromTreeUri().
#[cfg(target_os = "android")]
fn extract_tree_uri_from_content_uri(content_uri: &str) -> String {
    // Check if the URI contains /document/ after the tree part
    if let Some(tree_end) = content_uri.find("/tree/") {
        if let Some(doc_start) = content_uri.find("/document/") {
            // Found both /tree/ and /document/, extract only up to /document/
            if doc_start > tree_end {
                let tree_uri = &content_uri[..doc_start];
                log_info!("Compound URI detected, extracted tree part: {}", tree_uri);
                return tree_uri.to_string();
            }
        }
    }
    // No /document/ part found, return as-is
    content_uri.to_string()
}

/// Helper function to check and clear JNI exceptions
#[cfg(target_os = "android")]
fn check_and_clear_jni_exception(env: &mut jni::AttachGuard) -> Option<String> {
    if env.exception_check().unwrap_or(false) {
        env.exception_clear().ok()?;
        Some("JNI exception occurred".to_string())
    } else {
        None
    }
}

/// Synchronous version of copy_files_to_content_uri for use in spawn_blocking
#[cfg(target_os = "android")]
fn copy_files_to_content_uri_sync(
    content_uri: &str,
    files_to_copy: &[(String, std::path::PathBuf)],
) -> anyhow::Result<()> {
    use jni::objects::{JObject, JValue};
    use ndk_context::android_context;

    // Get JNI environment properly
    let ctx = android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| anyhow::anyhow!("Failed to get JavaVM: {:?}", e))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| anyhow::anyhow!("Failed to attach to JVM: {:?}", e))?;

    // Get the activity context for ContentResolver access
    let activity_raw = ctx.context() as jni::sys::jobject;
    let activity = unsafe { JObject::from_raw(activity_raw) };

    // Find the FileUtils class once - check for exceptions after
    let class = match env.find_class("sendmd/leechat/app/FileUtils") {
        Ok(c) => c,
        Err(e) => {
            if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                return Err(anyhow::anyhow!("Failed to find FileUtils class: {} (JNI: {})", e, msg));
            }
            return Err(anyhow::anyhow!("Failed to find FileUtils class: {:?}", e));
        }
    };
    
    // Check for any pending exception after find_class
    if let Some(msg) = check_and_clear_jni_exception(&mut env) {
        return Err(anyhow::anyhow!("JNI exception after finding FileUtils class: {}", msg));
    }

    for (name, source_path) in files_to_copy {
        log_info!("Reading file from: {:?}", source_path);

        if !source_path.exists() {
            log_error!("Source file does not exist: {:?}", source_path);
            anyhow::bail!("Source file does not exist: {:?}", source_path);
        }

        let content = std::fs::read(source_path).map_err(|e| {
            log_error!("Failed to read file {:?}: {}", source_path, e);
            anyhow::anyhow!("Failed to read file {:?}: {}", source_path, e)
        })?;

        log_info!("Writing {} ({} bytes) to content URI", name, content.len());

        // Push a local frame to manage JNI local references
        if let Err(e) = env.push_local_frame(16) {
            check_and_clear_jni_exception(&mut env);
            return Err(anyhow::anyhow!("Failed to push local frame: {:?}", e));
        }

        let result = (|| -> anyhow::Result<()> {
            // Convert content to Java byte array
            let byte_array = match env.byte_array_from_slice(&content) {
                Ok(arr) => arr,
                Err(e) => {
                    if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                        anyhow::bail!("Failed to create byte array: {} (JNI: {})", e, msg);
                    }
                    anyhow::bail!("Failed to create byte array: {:?}", e);
                }
            };
            
            // Check for exception after byte_array_from_slice
            if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                anyhow::bail!("JNI exception after creating byte array: {}", msg);
            }

            // Create JObject wrappers
            let dir_uri_jstring = match env.new_string(content_uri) {
                Ok(s) => s,
                Err(e) => {
                    if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                        anyhow::bail!("Failed to create dir URI string: {} (JNI: {})", e, msg);
                    }
                    anyhow::bail!("Failed to create dir URI string: {:?}", e);
                }
            };
            
            if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                anyhow::bail!("JNI exception after creating dir URI string: {}", msg);
            }

            let file_name_jstring = match env.new_string(name) {
                Ok(s) => s,
                Err(e) => {
                    if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                        anyhow::bail!("Failed to create filename string: {} (JNI: {})", e, msg);
                    }
                    anyhow::bail!("Failed to create filename string: {:?}", e);
                }
            };
            
            if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                anyhow::bail!("JNI exception after creating filename string: {}", msg);
            }

            // Call static method with context parameter
            let call_result = match env.call_static_method(
                &class,
                "writeFileToContentUri",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;[B)Z",
                &[
                    JValue::Object(&activity),
                    JValue::Object(&JObject::from(dir_uri_jstring)),
                    JValue::Object(&JObject::from(file_name_jstring)),
                    JValue::Object(&JObject::from(byte_array)),
                ],
            ) {
                Ok(r) => r,
                Err(e) => {
                    if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                        anyhow::bail!("Failed to call writeFileToContentUri: {} (JNI: {})", e, msg);
                    }
                    anyhow::bail!("Failed to call writeFileToContentUri: {:?}", e);
                }
            };
            
            // Check for Java exception thrown by the method (even if call_static_method returned Ok)
            if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                anyhow::bail!("Java exception in writeFileToContentUri: {}", msg);
            }

            // Extract the boolean result
            let success = match call_result.z() {
                Ok(b) => b,
                Err(e) => {
                    if let Some(msg) = check_and_clear_jni_exception(&mut env) {
                        anyhow::bail!("Failed to extract boolean result: {} (JNI: {})", e, msg);
                    }
                    anyhow::bail!("Failed to extract boolean result: {:?}", e);
                }
            };

            if !success {
                anyhow::bail!("writeFileToContentUri returned false for file {}", name);
            }

            log_info!("✅ Copied {} to content URI", name);
            Ok(())
        })();

        // Pop the local frame (passing null since we don't need to return an object)
        // Ignore errors here as we're cleaning up
        unsafe {
            let _ = env.pop_local_frame(&JObject::null());
        }

        // Propagate any error from inside the frame
        if let Err(e) = result {
            return Err(e);
        }

        // Clean up the temp file only on success
        if let Err(e) = std::fs::remove_file(source_path) {
            log_warn!("Failed to remove temp file {:?}: {}", source_path, e);
        }
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendFileRequest {
    pub path: String,
    pub ticket_type: String,
    /// Optional filename (from file picker). Used for display purposes and
    /// for preserving the original filename when handling content URIs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReceiveFileRequest {
    pub ticket: String,
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressUpdate {
    pub event_type: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferInfo {
    pub id: String,
    pub transfer_type: String,
    pub path: String,
    pub status: String,
    pub created_at: i64,
}

// Global state for tracking active transfers
type Transfers = Arc<RwLock<HashMap<String, TransferState>>>;

#[derive(Debug)]
struct TransferState {
    info: TransferInfo,
    abort_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging for Android
    #[cfg(target_os = "android")]
    {
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(log::LevelFilter::Debug)
                .with_tag("sendmd"),
        );
    }

    // Initialize tracing subscriber for non-Android platforms
    #[cfg(not(target_os = "android"))]
    {
        tracing_subscriber::fmt::init();
    }

    let transfers: Transfers = Arc::new(RwLock::new(HashMap::new()));

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(tauri_plugin_android_fs::init());
    }

    #[cfg(target_os = "ios")]
    {
        builder = builder.plugin(tauri_plugin_fs_ios::init());
    }

    #[cfg(mobile)]
    {
        builder = builder
            .plugin(tauri_plugin_barcode_scanner::init())
            .plugin(tauri_plugin_sharesheet::init());
    }

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(move |app| {
            // Store transfers in app state
            app.manage(transfers.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_file,
            receive_file,
            cancel_transfer,
            get_transfers,
            get_transfer_status,
            clear_transfers,
            get_hostname,
            get_device_model,
            get_default_download_folder,
            open_received_file,
            list_received_files,
            pick_file,
            pick_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn send_file(
    app: AppHandle,
    transfers: tauri::State<'_, Transfers>,
    request: SendFileRequest,
) -> Result<String, String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("📤 SEND_FILE STARTED");
    log_info!("═══════════════════════════════════════════════════");
    log_info!("📋 Request details:");
    log_info!("  - Path: {}", request.path);
    log_info!("  - Ticket type: {}", request.ticket_type);
    log_info!(
        "  - Is content URI: {}",
        request.path.starts_with("content://")
    );

    let transfer_id = Uuid::new_v4().to_string();
    log_info!("📝 Generated transfer_id: {}", transfer_id);

    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel();

    // Parse ticket type
    let ticket_type = match request.ticket_type.as_str() {
        "id" => {
            log_info!("🎫 Ticket type: ID only");
            Ok(pisend_lib::types::AddrInfoOptions::Id)
        }
        "relay" => {
            log_info!("🎫 Ticket type: Relay");
            Ok(pisend_lib::types::AddrInfoOptions::Relay)
        }
        "addresses" => {
            log_info!("🎫 Ticket type: Addresses (local-only)");
            Ok(pisend_lib::types::AddrInfoOptions::Addresses)
        }
        "relay_and_addresses" => {
            log_info!("🎫 Ticket type: Relay + Addresses");
            Ok(pisend_lib::types::AddrInfoOptions::RelayAndAddresses)
        }
        _ => {
            let err = format!("Invalid ticket type: {}", request.ticket_type);
            log_error!("❌ {}", err);
            Err(err)
        }
    }?;

    // Get temp directory for macOS sandbox compatibility
    log_info!("📁 Getting temp directory...");
    let temp_dir = app.path().temp_dir().map_err(|e| {
        let err_msg = format!("Failed to get temp directory: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;
    log_info!("✅ Temp dir: {:?}", temp_dir);

    // Handle Android content URIs - if path is a content:// URI, copy to temp file
    // Use filename from request if provided (from file picker), otherwise use empty string
    let filename = request.filename.as_deref().unwrap_or("");
    log_info!("🔍 Handling content URI...");
    log_info!("📄 Filename from picker: {}", filename);
    let (file_path, display_name) = handle_content_uri(&app, &request.path, filename).await?;
    log_info!("✅ File path resolved: {:?}", file_path);
    log_info!("✅ Display name: {}", display_name);

    let args = SendArgs {
        path: file_path,
        ticket_type,
        common: CommonConfig {
            temp_dir: Some(temp_dir),
            ..Default::default()
        },
    };
    log_info!("⚙️  SendArgs created successfully");

    // Create transfer info - use display_name for better UI
    log_info!("📊 Creating transfer info...");
    let transfer_info = TransferInfo {
        id: transfer_id.clone(),
        transfer_type: "send".to_string(),
        path: display_name,
        status: "initializing".to_string(),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    };
    log_info!(
        "✅ Transfer info created: {} - {}",
        transfer_info.id,
        transfer_info.path
    );

    // Store transfer
    log_info!("💾 Storing transfer in state...");
    let mut transfers_guard = transfers.write().await;
    transfers_guard.insert(
        transfer_id.clone(),
        TransferState {
            info: transfer_info.clone(),
            abort_tx: Some(abort_tx),
        },
    );
    drop(transfers_guard);
    log_info!("✅ Transfer stored with id: {}", transfer_id);

    let app_clone = app.clone();
    let transfers_clone = transfers.inner().clone();
    let transfer_id_clone = transfer_id.clone();
    let transfer_id_for_abort = transfer_id.clone();

    log_info!("🔄 Spawning progress listener task...");
    tokio::spawn(async move {
        log_info!(
            "  [Progress Task] Started for transfer: {}",
            transfer_id_clone
        );

        // Listen for abort signal
        tokio::spawn(async move {
            let _ = abort_rx.await;
            log_info!(
                "  [Progress Task] Transfer {} aborted",
                transfer_id_for_abort
            );
        });

        let mut event_count = 0;
        while let Some(event) = rx.recv().await {
            event_count += 1;
            log_info!(
                "  [Progress Task] Event #{}: {:?}",
                event_count,
                match &event {
                    ProgressEvent::Import(name, _) => format!("Import({})", name),
                    ProgressEvent::Export(name, _) => format!("Export({})", name),
                    ProgressEvent::Download(_) => "Download".to_string(),
                    ProgressEvent::Connection(status) => format!("Connection({:?})", status),
                }
            );

            let update = match event {
                ProgressEvent::Import(name, progress) => {
                    update_transfer_status(
                        &transfers_clone,
                        &transfer_id_clone,
                        &format!("importing: {}", name),
                    )
                    .await;
                    ProgressUpdate {
                        event_type: "import".to_string(),
                        data: serde_json::json!({
                            "transfer_id": transfer_id_clone,
                            "name": name,
                            "progress": serialize_import_progress(&progress),
                        }),
                    }
                }
                ProgressEvent::Export(name, progress) => {
                    update_transfer_status(
                        &transfers_clone,
                        &transfer_id_clone,
                        &format!("exporting: {}", name),
                    )
                    .await;
                    ProgressUpdate {
                        event_type: "export".to_string(),
                        data: serde_json::json!({
                            "transfer_id": transfer_id_clone,
                            "name": name,
                            "progress": serialize_export_progress(&progress),
                        }),
                    }
                }
                ProgressEvent::Download(progress) => {
                    update_transfer_status(&transfers_clone, &transfer_id_clone, "downloading")
                        .await;
                    ProgressUpdate {
                        event_type: "download".to_string(),
                        data: serde_json::json!({
                            "transfer_id": transfer_id_clone,
                            "progress": serialize_download_progress(&progress),
                        }),
                    }
                }
                ProgressEvent::Connection(status) => {
                    update_transfer_status(
                        &transfers_clone,
                        &transfer_id_clone,
                        &format!("connection: {:?}", status),
                    )
                    .await;
                    ProgressUpdate {
                        event_type: "connection".to_string(),
                        data: serde_json::json!({
                            "transfer_id": transfer_id_clone,
                            "status": format!("{:?}", status),
                        }),
                    }
                }
            };

            let _ = app_clone.emit("progress", update);
        }

        log_info!("  [Progress Task] Completed. Total events: {}", event_count);
        // Mark transfer as complete
        update_transfer_status(&transfers_clone, &transfer_id_clone, "completed").await;
    });

    log_info!("🚀 Calling pisend_lib::send_with_progress...");
    match pisend_lib::send_with_progress(args, tx).await {
        Ok(result) => {
            log_info!("═══════════════════════════════════════════════════");
            log_info!("✅ SEND COMPLETED SUCCESSFULLY");
            log_info!("═══════════════════════════════════════════════════");
            log_info!("🎫 Ticket: {}", result.ticket.to_string());
            log_info!("📊 Transfer ID: {}", transfer_id);
            update_transfer_status(transfers.inner(), &transfer_id, "serving").await;
            Ok(result.ticket.to_string())
        }
        Err(e) => {
            log_error!("═══════════════════════════════════════════════════");
            log_error!("❌ SEND FAILED");
            log_error!("═══════════════════════════════════════════════════");
            log_error!("Error: {}", e);
            log_error!("Transfer ID: {}", transfer_id);
            update_transfer_status(transfers.inner(), &transfer_id, &format!("error: {}", e)).await;
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn receive_file(
    app: AppHandle,
    transfers: tauri::State<'_, Transfers>,
    request: ReceiveFileRequest,
) -> Result<String, String> {
    log_info!("🚀 RECEIVE_FILE STARTED");
    log_info!("Ticket length: {} chars", request.ticket.len());

    let transfer_id = Uuid::new_v4().to_string();
    log_info!("Transfer ID: {}", transfer_id);

    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    let (abort_tx, _abort_rx) = tokio::sync::oneshot::channel();

    // On Android, set_current_dir doesn't work with public directories due to sandboxing.
    #[cfg(not(target_os = "android"))]
    if let Some(ref output_dir) = request.output_dir {
        std::env::set_current_dir(output_dir).map_err(|e| {
            format!(
                "Failed to change to output directory '{}': {}",
                output_dir, e
            )
        })?;
    }

    log_info!("Parsing ticket...");
    let ticket = request
        .ticket
        .parse()
        .map_err(|e| format!("Invalid ticket: {}", e))?;
    log_info!("Ticket parsed successfully");

    // Get temp directory for blob storage
    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("Failed to get temp directory: {}", e))?;
    log_info!("Temp dir (for blob storage): {:?}", temp_dir);

    // On Android, detect content URIs and handle them specially
    // Content URIs (like "content://...") cannot be used directly as PathBuf
    // We'll export to temp first, then copy to the content URI location
    #[cfg(target_os = "android")]
    let (export_dir, content_uri_output) = if let Some(ref output_dir) = request.output_dir {
        if output_dir.starts_with("content://") {
            log_info!("Detected content URI as output_dir: {}", output_dir);
            log_info!("Will export to temp_dir first, then copy to content URI");
            // Export to temp directory first, then copy to content URI later
            // IMPORTANT: export_dir must be Some(temp_dir) so files are written to temp
            (Some(temp_dir.clone()), Some(output_dir.clone()))
        } else {
            log_info!("Using user-provided output_dir: {:?}", output_dir);
            (Some(std::path::PathBuf::from(output_dir)), None)
        }
    } else {
        log_info!("No output_dir provided, getting public Downloads directory...");
        match get_default_download_folder_impl() {
            Ok(dir) => {
                log_info!("Using public Downloads directory: {:?}", dir);
                (Some(std::path::PathBuf::from(dir)), None)
            }
            Err(e) => {
                log_error!(
                    "Failed to get Downloads directory: {}, falling back to temp_dir",
                    e
                );
                (None, None)
            }
        }
    };

    // On iOS, always use the Documents directory when no output_dir is provided
    #[cfg(target_os = "ios")]
    let (export_dir, _content_uri_output): (Option<std::path::PathBuf>, Option<String>) = {
        use tauri_plugin_fs_ios::FsIosExt;

        if let Some(ref output_dir) = request.output_dir {
            log_info!("Using user-provided output_dir: {:?}", output_dir);
            (Some(std::path::PathBuf::from(output_dir)), None)
        } else {
            log_info!("ℹ️  iOS: No output_dir provided, using Documents directory...");
            let fs_ios = app.fs_ios();
            match fs_ios.current_dir() {
                Ok(dir) => {
                    log_info!("✅ iOS Documents directory: {}", dir);
                    (Some(std::path::PathBuf::from(dir)), None)
                }
                Err(e) => {
                    log_error!("Failed to get Documents directory: {}, falling back to temp_dir", e);
                    (None, None)
                }
            }
        }
    };

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let (export_dir, _content_uri_output): (Option<std::path::PathBuf>, Option<String>) = (
        request
            .output_dir
            .as_ref()
            .map(|d| std::path::PathBuf::from(d)),
        None,
    );

    let args = ReceiveArgs {
        ticket,
        common: CommonConfig {
            format: Format::Hex,
            relay: RelayModeOption::Default,
            show_secret: false,
            magic_ipv4_addr: None,
            magic_ipv6_addr: None,
            temp_dir: Some(temp_dir.clone()),
        },
        export_dir,
    };

    // Create transfer info
    let transfer_info = TransferInfo {
        id: transfer_id.clone(),
        transfer_type: "receive".to_string(),
        path: request.ticket.clone(),
        status: "initializing".to_string(),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    };
    log_info!("✅ Transfer info created");

    // Store transfer
    log_info!("💾 Storing transfer in state...");
    let mut transfers_guard = transfers.write().await;
    transfers_guard.insert(
        transfer_id.clone(),
        TransferState {
            info: transfer_info.clone(),
            abort_tx: Some(abort_tx),
        },
    );
    drop(transfers_guard);
    log_info!("✅ Transfer stored with id: {}", transfer_id);

    let app_clone = app.clone();
    let transfers_clone = transfers.inner().clone();
    let transfer_id_clone = transfer_id.clone();

    log_info!("🔄 Spawning progress listener task...");
    tokio::spawn(async move {
        log_info!(
            "  [Progress Task] Started for transfer: {}",
            transfer_id_clone
        );
        let mut event_count = 0;
        while let Some(event) = rx.recv().await {
            event_count += 1;
            log_info!(
                "  [Progress Task] Event #{}: {:?}",
                event_count,
                match &event {
                    ProgressEvent::Import(name, _) => format!("Import({})", name),
                    ProgressEvent::Export(name, _) => format!("Export({})", name),
                    ProgressEvent::Download(_) => "Download".to_string(),
                    ProgressEvent::Connection(status) => format!("Connection({:?})", status),
                }
            );

            let update = match event {
                ProgressEvent::Import(name, progress) => {
                    update_transfer_status(
                        &transfers_clone,
                        &transfer_id_clone,
                        &format!("importing: {}", name),
                    )
                    .await;
                    ProgressUpdate {
                        event_type: "import".to_string(),
                        data: serde_json::json!({
                            "transfer_id": transfer_id_clone,
                            "name": name,
                            "progress": serialize_import_progress(&progress),
                        }),
                    }
                }
                ProgressEvent::Export(name, progress) => {
                    update_transfer_status(
                        &transfers_clone,
                        &transfer_id_clone,
                        &format!("exporting: {}", name),
                    )
                    .await;
                    ProgressUpdate {
                        event_type: "export".to_string(),
                        data: serde_json::json!({
                            "transfer_id": transfer_id_clone,
                            "name": name,
                            "progress": serialize_export_progress(&progress),
                        }),
                    }
                }
                ProgressEvent::Download(progress) => {
                    update_transfer_status(&transfers_clone, &transfer_id_clone, "downloading")
                        .await;
                    ProgressUpdate {
                        event_type: "download".to_string(),
                        data: serde_json::json!({
                            "transfer_id": transfer_id_clone,
                            "progress": serialize_download_progress(&progress),
                        }),
                    }
                }
                ProgressEvent::Connection(status) => {
                    update_transfer_status(
                        &transfers_clone,
                        &transfer_id_clone,
                        &format!("connection: {:?}", status),
                    )
                    .await;
                    ProgressUpdate {
                        event_type: "connection".to_string(),
                        data: serde_json::json!({
                            "transfer_id": transfer_id_clone,
                            "status": format!("{:?}", status),
                        }),
                    }
                }
            };

            let _ = app_clone.emit("progress", update);
        }

        log_info!("  [Progress Task] Completed. Total events: {}", event_count);
        // Mark transfer as complete
        update_transfer_status(&transfers_clone, &transfer_id_clone, "completed").await;
    });

    log_info!("Calling pisend_lib::receive_with_progress...");

    match pisend_lib::receive_with_progress(args, tx).await {
        Ok(result) => {
            log_info!("✅ RECEIVE COMPLETED");
            log_info!(
                "Files: {}, Bytes: {}",
                result.total_files,
                result.stats.total_bytes_read()
            );

            // If output was a content URI, copy files from temp_dir to the content URI
            #[cfg(target_os = "android")]
            if let Some(content_uri) = content_uri_output {
                log_info!("Copying files to content URI: {}", content_uri);
                if let Err(e) =
                    copy_files_to_content_uri(&app, &temp_dir, &content_uri, &result.collection)
                        .await
                {
                    log_error!("Failed to copy files to content URI: {}", e);
                    update_transfer_status(
                        transfers.inner(),
                        &transfer_id,
                        &format!("error: {}", e),
                    )
                    .await;
                    return Err(format!("Failed to copy files to content URI: {}", e));
                }
                log_info!("✅ Files copied to content URI successfully");
            }

            update_transfer_status(transfers.inner(), &transfer_id, "completed").await;
            Ok(format!(
                "{{\"transfer_id\": \"{}\", \"files\": {}, \"bytes\": {}}}",
                transfer_id,
                result.total_files,
                result.stats.total_bytes_read()
            ))
        }
        Err(e) => {
            log_error!("❌ RECEIVE FAILED: {}", e);
            update_transfer_status(transfers.inner(), &transfer_id, &format!("error: {}", e)).await;
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn cancel_transfer(
    transfers: tauri::State<'_, Transfers>,
    id: String,
) -> Result<bool, String> {
    let mut transfers_guard = transfers.write().await;

    if let Some(mut state) = transfers_guard.remove(&id) {
        // Send abort signal
        if let Some(abort_tx) = state.abort_tx.take() {
            let _ = abort_tx.send(());
        }
        state.info.status = "cancelled".to_string();
        transfers_guard.insert(id.clone(), state);
        Ok(true)
    } else {
        Err("Transfer not found".to_string())
    }
}

#[tauri::command]
async fn get_transfers(
    transfers: tauri::State<'_, Transfers>,
) -> Result<Vec<TransferInfo>, String> {
    let transfers_guard = transfers.read().await;
    Ok(transfers_guard
        .values()
        .map(|state| state.info.clone())
        .collect())
}

#[tauri::command]
async fn get_transfer_status(
    transfers: tauri::State<'_, Transfers>,
    id: String,
) -> Result<String, String> {
    let transfers_guard = transfers.read().await;
    if let Some(state) = transfers_guard.get(&id) {
        Ok(state.info.status.clone())
    } else {
        Err("Transfer not found".to_string())
    }
}

// Helper functions
async fn update_transfer_status(transfers: &Transfers, id: &str, status: &str) {
    let mut transfers_guard = transfers.write().await;
    if let Some(state) = transfers_guard.get_mut(id) {
        state.info.status = status.to_string();
    }
}

fn serialize_import_progress(progress: &ImportProgress) -> serde_json::Value {
    match progress {
        ImportProgress::Started { total_files } => {
            serde_json::json!({"type": "started", "total_files": total_files})
        }
        ImportProgress::FileStarted { name, size } => {
            serde_json::json!({"type": "file_started", "name": name, "size": size})
        }
        ImportProgress::FileProgress { name, offset } => {
            serde_json::json!({"type": "file_progress", "name": name, "offset": offset})
        }
        ImportProgress::FileCompleted { name } => {
            serde_json::json!({"type": "file_completed", "name": name})
        }
        ImportProgress::Completed { total_size: _ } => {
            serde_json::json!({"type": "completed"})
        }
    }
}

fn serialize_export_progress(progress: &ExportProgress) -> serde_json::Value {
    match progress {
        ExportProgress::Started { total_files } => {
            serde_json::json!({"type": "started", "total_files": total_files})
        }
        ExportProgress::FileStarted { name, size } => {
            serde_json::json!({"type": "file_started", "name": name, "size": size})
        }
        ExportProgress::FileProgress { name, offset } => {
            serde_json::json!({"type": "file_progress", "name": name, "offset": offset})
        }
        ExportProgress::FileCompleted { name } => {
            serde_json::json!({"type": "file_completed", "name": name})
        }
        ExportProgress::Completed => {
            serde_json::json!({"type": "completed"})
        }
    }
}

fn serialize_download_progress(progress: &DownloadProgress) -> serde_json::Value {
    match progress {
        DownloadProgress::Connecting => {
            serde_json::json!({"type": "connecting"})
        }
        DownloadProgress::GettingSizes => {
            serde_json::json!({"type": "getting_sizes"})
        }
        DownloadProgress::Metadata {
            total_size,
            file_count,
            names,
        } => {
            serde_json::json!({
                "type": "metadata",
                "total_size": total_size,
                "file_count": file_count,
                "names": names
            })
        }
        DownloadProgress::Downloading { offset, total } => {
            serde_json::json!({"type": "downloading", "offset": offset, "total": total})
        }
        DownloadProgress::Completed => {
            serde_json::json!({"type": "completed"})
        }
    }
}

#[tauri::command]
async fn clear_transfers(transfers: tauri::State<'_, Transfers>) -> Result<(), String> {
    // Cancel all active transfers
    let mut transfers_guard = transfers.write().await;
    for (_id, mut state) in transfers_guard.drain() {
        // Send abort signal
        if let Some(abort_tx) = state.abort_tx.take() {
            let _ = abort_tx.send(());
        }
    }
    drop(transfers_guard);

    // Clean up temporary sendmd directories
    let temp_dirs = std::fs::read_dir(".")
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(".sendmd-"))
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.path())
        .collect::<Vec<_>>();

    for path in temp_dirs {
        log_info!("Removing temporary directory: {:?}", path);
        let _ = std::fs::remove_dir_all(&path);
    }

    Ok(())
}

/// Get the local hostname
#[tauri::command]
fn get_hostname() -> Result<String, String> {
    // Get hostname using tauri-plugin-os for cross-platform compatibility
    use tauri_plugin_os::hostname;

    let hostname = hostname();

    if hostname.is_empty() {
        // Fallback to a default name
        Ok("My Device".to_string())
    } else {
        Ok(hostname)
    }
}

/// Get the device model (mobile-specific)
#[tauri::command]
fn get_device_model() -> Result<String, String> {
    log_info!("📱 GET_DEVICE_MODEL called");

    #[cfg(target_os = "android")]
    {
        use jni::objects::JObject;
        use jni::signature::JavaType;

        log_info!("🤖 Android platform detected");
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| {
            let err_msg = format!("Failed to get VM: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?;
        let mut env = vm.attach_current_thread().map_err(|e| {
            let err_msg = format!("Failed to attach to VM: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?;
        log_info!("✅ Attached to Java VM");

        // Get Build.MODEL
        log_info!("📋 Getting Build.MODEL...");
        let build_class = env.find_class("android/os/Build").map_err(|e| {
            let err_msg = format!("Failed to find Build class: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?;
        let model_field = env
            .get_static_field_id(&build_class, "MODEL", "Ljava/lang/String;")
            .map_err(|e| {
                let err_msg = format!("Failed to get MODEL field: {}", e);
                log_error!("❌ {}", err_msg);
                err_msg
            })?;
        let model_obj = env
            .get_static_field_unchecked(
                &build_class,
                model_field,
                JavaType::Object("java/lang/String".to_string()),
            )
            .map_err(|e| {
                let err_msg = format!("Failed to get MODEL value: {}", e);
                log_error!("❌ {}", err_msg);
                err_msg
            })?;

        // Get Build.MANUFACTURER
        log_info!("📋 Getting Build.MANUFACTURER...");
        let manufacturer_field = env
            .get_static_field_id(&build_class, "MANUFACTURER", "Ljava/lang/String;")
            .map_err(|e| {
                let err_msg = format!("Failed to get MANUFACTURER field: {}", e);
                log_error!("❌ {}", err_msg);
                err_msg
            })?;
        let manufacturer_obj = env
            .get_static_field_unchecked(
                &build_class,
                manufacturer_field,
                JavaType::Object("java/lang/String".to_string()),
            )
            .map_err(|e| {
                let err_msg = format!("Failed to get MANUFACTURER value: {}", e);
                log_error!("❌ {}", err_msg);
                err_msg
            })?;

        // Get the JObject values
        let model_jobj: JObject = model_obj.l().map_err(|e| {
            let err_msg = format!("Failed to get model object: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?;
        let manufacturer_jobj: JObject = manufacturer_obj.l().map_err(|e| {
            let err_msg = format!("Failed to get manufacturer object: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?;

        // Convert to JString and then to Rust String
        let model_jstring = jni::objects::JString::from(model_jobj);
        let manufacturer_jstring = jni::objects::JString::from(manufacturer_jobj);

        let model_str: String = env
            .get_string(&model_jstring)
            .map_err(|e| {
                let err_msg = format!("Failed to get model string: {}", e);
                log_error!("❌ {}", err_msg);
                err_msg
            })?
            .into();
        let manufacturer_str: String = env
            .get_string(&manufacturer_jstring)
            .map_err(|e| {
                let err_msg = format!("Failed to get manufacturer string: {}", e);
                log_error!("❌ {}", err_msg);
                err_msg
            })?
            .into();

        log_info!(
            "📋 Model: {}, Manufacturer: {}",
            model_str,
            manufacturer_str
        );

        // Format as "Manufacturer Model" or just "Model" if they start the same
        let result = if model_str.starts_with(&manufacturer_str) {
            model_str.clone()
        } else {
            format!("{} {}", manufacturer_str, model_str)
        };
        log_info!("✅ Device model: {}", result);
        Ok(result)
    }

    #[cfg(target_os = "ios")]
    {
        // Use uname to get machine identifier
        use std::mem;

        log_info!("🍎 iOS platform detected");

        #[repr(C)]
        struct Utsname {
            sysname: [i8; 256],
            nodename: [i8; 256],
            release: [i8; 256],
            version: [i8; 256],
            machine: [i8; 256],
        }

        extern "C" {
            fn uname(buf: *mut Utsname) -> i32;
        }

        unsafe {
            let mut info: Utsname = mem::zeroed();
            if uname(&mut info as *mut Utsname) != 0 {
                log_warn!("⚠️  Failed to call uname, returning generic name");
                return Ok("Unknown iOS Device".to_string());
            }

            // Convert machine to string
            let machine = info
                .machine
                .iter()
                .map(|&c| if c == 0 { 0 } else { c as u8 })
                .take_while(|&c| c != 0)
                .map(|c| c as char)
                .collect::<String>();

            log_info!("📱 Machine identifier: {}", machine);

            // Map common machine identifiers to friendly names
            let result = machine.to_string();
            log_info!("✅ Device model: {}", result);
            Ok(result)
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Desktop: just return hostname
        log_info!("💻 Desktop platform detected");
        let hostname = get_hostname()?;
        log_info!("✅ Using hostname: {}", hostname);
        Ok(hostname)
    }
}

/// Get the default download folder path for mobile devices
///
/// Internal implementation: Get the public Downloads directory on Android.
#[cfg(target_os = "android")]
fn get_default_download_folder_impl() -> Result<String, String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("📁 GET_DEFAULT_DOWNLOAD_FOLDER_IMPL (Android)");
    log_info!("═══════════════════════════════════════════════════");

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| {
        let err_msg = format!("Failed to get VM: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;
    let mut env = vm.attach_current_thread().map_err(|e| {
        let err_msg = format!("Failed to attach thread: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;
    log_info!("✅ Attached to Java VM");

    // Get Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    log_info!("📋 Getting Environment class...");
    let environment_class = env.find_class("android/os/Environment").map_err(|e| {
        let err_msg = format!("Failed to find Environment class: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;

    log_info!("📋 Calling Environment.getExternalStoragePublicDirectory...");
    let downloads_string = env.new_string("Download").map_err(|e| {
        let err_msg = format!("Failed to create Downloads string: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;

    let downloads_file = env
        .call_static_method(
            &environment_class,
            "getExternalStoragePublicDirectory",
            "(Ljava/lang/String;)Ljava/io/File;",
            &[(&downloads_string).into()],
        )
        .and_then(|v| v.l())
        .map_err(|e| {
            let err_msg = format!("Failed to get Downloads directory: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?;
    log_info!("✅ Got Downloads File object");

    // Get the absolute path
    log_info!("📋 Getting absolute path...");
    let path_obj = env
        .call_method(
            &downloads_file,
            "getAbsolutePath",
            "()Ljava/lang/String;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| {
            let err_msg = format!("Failed to get absolute path: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?;

    // Convert to Rust string
    let path_jstring = jni::objects::JString::from(path_obj);
    let path: String = env
        .get_string(&path_jstring)
        .map_err(|e| {
            let err_msg = format!("Failed to convert path to string: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?
        .into();

    log_info!("✅ Download folder: {}", path);
    Ok(path)
}

/// On Android, returns the path to the public Downloads directory.
/// On iOS, returns the Documents directory.
/// On desktop platforms, returns an error.
#[tauri::command]
#[cfg(target_os = "android")]
fn get_default_download_folder() -> Result<String, String> {
    get_default_download_folder_impl()
}

#[tauri::command]
#[cfg(target_os = "ios")]
fn get_default_download_folder(app: AppHandle) -> Result<String, String> {
    log_info!("═════════════════════════════════════════════════");
    log_info!("📁 GET_DEFAULT_DOWNLOAD_FOLDER (iOS)");
    log_info!("═══════════════════════════════════════════════════");

    // On iOS, use tauri-plugin-fs-ios to get the Documents directory
    use tauri_plugin_fs_ios::FsIosExt;

    log_info!("📋 Getting Documents directory via fs-ios...");
    let fs_ios = app.fs_ios();
    let docs_path = fs_ios.current_dir().map_err(|e| {
        let err_msg = format!("Failed to get Documents directory: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;

    log_info!("✅ Documents directory: {}", docs_path);
    Ok(docs_path)
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_default_download_folder() -> Result<String, String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("📁 GET_DEFAULT_DOWNLOAD_FOLDER (Desktop)");
    log_info!("═══════════════════════════════════════════════════");
    log_warn!("⚠️  This function is only available on mobile platforms");
    Err("This function is only available on mobile platforms".to_string())
}

/// Open a received file using the platform's default application
///
/// On Android: Uses FileProvider + Intent to open the file
/// On iOS: Uses UIDocumentInteractionController or similar
/// On Desktop: Uses opener plugin to open the file directly
#[tauri::command]
async fn open_received_file(
    app: AppHandle,
    transfers: tauri::State<'_, Transfers>,
    transfer_id: String,
    filename: Option<String>,
) -> Result<(), String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("📂 OPEN_RECEIVED_FILE");
    log_info!("═══════════════════════════════════════════════════");
    log_info!("Transfer ID: {}", transfer_id);
    log_info!("Filename: {:?}", filename);

    // Get transfer info
    let transfers_guard = transfers.read().await;
    let transfer = transfers_guard
        .get(&transfer_id)
        .ok_or_else(|| format!("Transfer not found: {}", transfer_id))?;

    if transfer.info.transfer_type != "receive" {
        return Err("Can only open received files".to_string());
    }

    if !transfer.info.status.contains("complete") {
        return Err("Transfer not complete yet".to_string());
    }

    // On Android, use JNI to open the file
    #[cfg(target_os = "android")]
    {
        log_info!("📱 Android platform detected, using JNI");

        // Get public Downloads directory where files are stored
        let downloads_dir = get_default_download_folder_impl()
            .map_err(|e| format!("Failed to get Downloads directory: {}", e))?;

        log_info!("Downloads directory: {:?}", downloads_dir);

        // Find the file to open
        let file_to_open = if let Some(ref fname) = filename {
            // User specified a filename
            let file_path = std::path::PathBuf::from(&downloads_dir).join(fname);
            if !file_path.exists() {
                return Err(format!("File not found: {}", fname));
            }
            file_path
        } else {
            // No filename specified, find the first file in Downloads directory
            let files = android::find_received_files(&downloads_dir);
            if files.is_empty() {
                return Err("No files found in Downloads directory".to_string());
            }
            std::path::PathBuf::from(&files[0])
        };

        let file_path_str = file_to_open.to_str().ok_or("Invalid file path")?;
        let file_name = file_to_open
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        log_info!("Opening file: {:?}", file_path_str);
        log_info!("Filename: {}", file_name);

        // Use JNI to open the file
        android::open_file_with_intent(file_path_str, file_name)
            .map_err(|e| format!("Failed to open file: {:?}", e))?;

        log_info!("✅ File opened successfully");
        Ok(())
    }

    // On iOS, use opener plugin with Documents directory
    #[cfg(target_os = "ios")]
    {
        use tauri_plugin_fs_ios::FsIosExt;

        log_info!("🍎 iOS platform detected, using Documents directory");

        let fs_ios = app.fs_ios();
        let docs_dir = fs_ios.current_dir()
            .map_err(|e| format!("Failed to get Documents directory: {}", e))?;

        log_info!("Documents directory: {:?}", docs_dir);

        // Find the file to open
        let file_to_open = if let Some(ref fname) = filename {
            let file_path = std::path::PathBuf::from(&docs_dir).join(fname);
            if !file_path.exists() {
                return Err(format!("File not found: {}", fname));
            }
            file_path
        } else {
            // No filename specified, find the first file in Documents directory
            let entries = std::fs::read_dir(&docs_dir)
                .map_err(|e| format!("Failed to read Documents directory: {}", e))?;

            entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .find(|p| {
                    p.is_file()
                        && !p
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .starts_with('.')
                })
                .ok_or("No files found in Documents directory".to_string())?
        };

        let file_path_str = file_to_open.to_str().ok_or("Invalid file path")?;
        log_info!("Opening file: {:?}", file_path_str);

        // Use opener plugin to open the file
        tauri_plugin_opener::open_path(&file_to_open, None::<&str>)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        log_info!("✅ File opened successfully");
        Ok(())
    }

    // On desktop, use opener plugin
    #[cfg(not(target_os = "android"))]
    {
        log_info!("🖥️  Desktop platform detected, using opener plugin");

        // Get temp directory
        let temp_dir = app
            .path()
            .temp_dir()
            .map_err(|e| format!("Failed to get temp directory: {}", e))?;

        // Find the file to open
        let file_to_open = if let Some(ref fname) = filename {
            let file_path = temp_dir.join(fname);
            if !file_path.exists() {
                return Err(format!("File not found: {}", fname));
            }
            file_path
        } else {
            // Find first file in directory
            let entries = std::fs::read_dir(&temp_dir)
                .map_err(|e| format!("Failed to read temp directory: {}", e))?;

            let first_file = entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .find(|p| {
                    p.is_file()
                        && !p
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .starts_with('.')
                })
                .ok_or("No files found in cache directory".to_string())?;

            first_file
        };

        let file_path_str = file_to_open.to_str().ok_or("Invalid file path")?;
        log_info!("Opening file: {:?}", file_path_str);

        // Use opener plugin - openPath returns a Result that we map
        tauri_plugin_opener::open_path(&file_to_open, None::<&str>)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        log_info!("✅ File opened successfully");
        Ok(())
    }
}

/// List received files in the cache directory
#[tauri::command]
async fn list_received_files(app: AppHandle) -> Result<Vec<String>, String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("📂 LIST_RECEIVED_FILES");
    log_info!("═══════════════════════════════════════════════════");

    #[cfg(target_os = "android")]
    {
        // Use public Downloads directory on Android
        let downloads_dir = get_default_download_folder_impl()?;
        log_info!("Downloads directory: {:?}", downloads_dir);
        let files = android::find_received_files(&downloads_dir);
        log_info!("Found {} files", files.len());
        Ok(files)
    }

    #[cfg(target_os = "ios")]
    {
        // Use Documents directory on iOS
        use tauri_plugin_fs_ios::FsIosExt;

        let fs_ios = app.fs_ios();
        let docs_dir = fs_ios.current_dir().map_err(|e| format!("Failed to get Documents directory: {}", e))?;

        log_info!("Documents directory: {:?}", docs_dir);

        let entries = std::fs::read_dir(&docs_dir)
            .map_err(|e| format!("Failed to read Documents directory: {}", e))?;

        let files: Vec<String> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && !p
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .starts_with('.')
            })
            .filter_map(|p| p.to_str().map(String::from))
            .collect();

        log_info!("Found {} files", files.len());
        Ok(files)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Use temp directory on other platforms
        let temp_dir = app
            .path()
            .temp_dir()
            .map_err(|e| format!("Failed to get temp directory: {}", e))?;

        log_info!("Temp directory: {:?}", temp_dir);

        let entries = std::fs::read_dir(&temp_dir)
            .map_err(|e| format!("Failed to read temp directory: {}", e))?;

        let files: Vec<String> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && !p
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .starts_with('.')
            })
            .filter_map(|p| p.to_str().map(String::from))
            .collect();

        log_info!("Found {} files", files.len());
        Ok(files)
    }
}

/// Pick a file using the native mobile file picker
///
/// Opens the platform's native file picker to select one or more files.
/// Returns information about the selected files including URI, path, name, size, and MIME type.
///
/// Only available on mobile platforms (Android/iOS).
#[tauri::command]
#[cfg(target_os = "android")]
async fn pick_file(
    app: AppHandle,
    allowed_types: Option<Vec<String>>,
    allow_multiple: Option<bool>,
) -> Result<Vec<PickerFileInfo>, String> {
    use tauri_plugin_android_fs::{AndroidFsExt, FileUri};

    let api = app.android_fs_async();
    let allow_multiple = allow_multiple.unwrap_or(false);

    // Build MIME types filter - default to all files if none specified
    let mime_types: Vec<&str> = allowed_types
        .as_ref()
        .map(|types| types.iter().map(|s| s.as_str()).collect())
        .unwrap_or_else(|| vec!["*/*"]);

    log_info!("📁 Opening file picker...");
    log_info!("  - MIME types: {:?}", mime_types);
    log_info!("  - Allow multiple: {}", allow_multiple);

    // Use the file picker API
    let selected_uris = api
        .file_picker()
        .pick_files(None, &mime_types, false)
        .await
        .map_err(|e| format!("File picker failed: {}", e))?;

    if selected_uris.is_empty() {
        log_info!("📁 File picker cancelled");
        return Ok(vec![]);
    }

    log_info!("✅ Selected {} files", selected_uris.len());

    // Convert FileUri results to PickerFileInfo
    // Note: We convert to FilePath to get the URI string representation
    let mut results = Vec::new();
    for uri in selected_uris {
        // Convert FileUri to tauri_plugin_fs::FilePath to get string representation
        use tauri_plugin_fs::FilePath;
        let file_path: FilePath = uri.clone().into();
        let uri_str = file_path.to_string();
        log_info!("  - URI: {}", uri_str);

        // Get file metadata
        let name = api
            .get_name(&uri)
            .await
            .map_err(|e| format!("Failed to get file name: {}", e))?;

        let mime_type = api
            .get_mime_type(&uri)
            .await
            .map_err(|e| format!("Failed to get MIME type: {}", e))?;

        // Get file size by opening the file
        let size = api
            .open_file_readable(&uri)
            .await
            .map_err(|e| format!("Failed to open file: {}", e))?
            .metadata()
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .len();

        log_info!("    Name: {}, MIME: {}, Size: {}", name, mime_type, size);

        results.push(PickerFileInfo {
            uri: uri_str.clone(),
            path: uri_str,
            name,
            size: size as i64,
            mime_type,
        });
    }

    Ok(results)
}

/// Pick a directory using the native mobile directory picker
///
/// Opens the platform's native directory picker to select a directory.
/// Returns information about the selected directory including URI, path, and name.
///
/// Only available on mobile platforms (Android/iOS).
#[tauri::command]
#[cfg(target_os = "android")]
async fn pick_directory(
    app: AppHandle,
    start_directory: Option<String>,
) -> Result<PickerDirectoryInfo, String> {
    use tauri_plugin_android_fs::{AndroidFsExt, FileUri};

    let api = app.android_fs_async();

    log_info!("📂 Opening directory picker...");

    // Use the directory picker API
    let selected_uri = api
        .file_picker()
        .pick_dir(None, false)
        .await
        .map_err(|e| format!("Directory picker failed: {}", e))?;

    match selected_uri {
        Some(uri) => {
            // Convert FileUri to tauri_plugin_fs::FilePath to get string representation
            use tauri_plugin_fs::FilePath;
            let file_path: FilePath = uri.clone().into();
            let uri_str = file_path.to_string();
            log_info!("✅ Selected directory: {}", uri_str);

            // Take persistable URI permission for long-term access
            if let Err(e) = api.take_persistable_uri_permission(&uri).await {
                log_warn!("Failed to take persistable URI permission: {}", e);
            }

            // Try to get the directory name from the URI
            // The URI format is typically: content://com.android.externalstorage.documents/tree/primary%3ADownload
            let name = uri_str
                .rsplit("%3A")
                .next()
                .or_else(|| uri_str.rsplit('/').next())
                .unwrap_or("Selected Directory")
                .to_string();

            log_info!("  - Name: {}", name);

            Ok(PickerDirectoryInfo {
                uri: uri_str.clone(),
                path: uri_str,
                name,
            })
        }
        None => {
            log_info!("📂 Directory picker cancelled");
            Err("Directory picker cancelled".to_string())
        }
    }
}

/// Pick a file using the iOS dialog plugin
///
/// On iOS, file picking is done via the system document picker.
/// Files are automatically saved to the app's Documents directory.
#[tauri::command]
#[cfg(target_os = "ios")]
async fn pick_file(
    app: AppHandle,
    allowed_types: Option<Vec<String>>,
    _allow_multiple: Option<bool>,
) -> Result<Vec<PickerFileInfo>, String> {
    use tauri_plugin_fs_ios::FsIosExt;

    log_info!("📁 iOS file picker - files will be saved to Documents directory");

    // On iOS, we can't pick files from outside the app's sandbox
    // Instead, we return information about the Documents directory
    // where received files are automatically saved
    let fs_ios = app.fs_ios();
    let docs_path = fs_ios.current_dir().map_err(|e| e.to_string())?;

    log_info!("📂 Documents directory: {}", docs_path);

    // Return a placeholder file info indicating files should be accessed via Documents
    Ok(vec![PickerFileInfo {
        uri: format!("file://{}", docs_path),
        path: docs_path.clone(),
        name: "Documents Directory".to_string(),
        size: 0,
        mime_type: "application/directory".to_string(),
    }])
}

/// Pick a directory using the iOS - NOT SUPPORTED
///
/// iOS does not support directory picking.
/// All received files are automatically saved to the app's Documents directory.
#[tauri::command]
#[cfg(target_os = "ios")]
fn pick_directory(
    _app: AppHandle,
    _start_directory: Option<String>,
) -> Result<PickerDirectoryInfo, String> {
    log_info!("❌ iOS does not support directory picking");
    log_info!("ℹ️  Files are automatically saved to the Documents directory");

    Err(
        "iOS does not support directory picking. Received files are automatically saved to the app's Documents directory.".to_string()
    )
}

/// Pick a file (desktop stub)
///
/// On desktop platforms, this function returns an error since file picking
/// should be done using tauri-plugin-dialog instead.
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn pick_file(
    _app: AppHandle,
    _allowed_types: Option<Vec<String>>,
    _allow_multiple: Option<bool>,
) -> Result<Vec<PickerFileInfo>, String> {
    Err(
        "File picking is only available on mobile platforms. Use tauri-plugin-dialog on desktop."
            .to_string(),
    )
}

/// Pick a directory (desktop stub)
///
/// On desktop platforms, this function returns an error since directory picking
/// should be done using tauri-plugin-dialog instead.
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn pick_directory(
    _app: AppHandle,
    _start_directory: Option<String>,
) -> Result<PickerDirectoryInfo, String> {
    Err("Directory picking is only available on mobile platforms. Use tauri-plugin-dialog on desktop.".to_string())
}
