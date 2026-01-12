use netdev::interface::get_interfaces;
use sendme_lib::{progress::*, types::*};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;
use tokio::sync::RwLock;
use uuid::Uuid;

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

// Nearby discovery types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NearbyDevice {
    pub node_id: String,
    pub name: Option<String>,
    pub display_name: String,
    pub addresses: Vec<String>,
    pub ip_addresses: Vec<String>,
    pub last_seen: i64,
    pub available: bool,
}

type NearbyDiscovery = Arc<RwLock<Option<sendme_lib::nearby::NearbyDiscovery>>>;

/// Get the real filename from an Android content URI using ContentResolver.
///
/// This function queries the ContentResolver to get the original filename from the URI.
/// Returns the filename if available, otherwise returns a generic name.
#[cfg(target_os = "android")]
fn get_filename_from_content_uri(uri: &str) -> Result<String, String> {
    use jni::objects::{JObject, JString};

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get VM: {}", e))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("Failed to attach thread: {}", e))?;

    // Get the URI object
    let uri_string = env
        .new_string(uri)
        .map_err(|e| format!("Failed to create URI string: {}", e))?;
    let uri_class = env
        .find_class("android/net/Uri")
        .map_err(|e| format!("Failed to find Uri class: {}", e))?;
    let uri_obj = env
        .call_static_method(
            &uri_class,
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[(&uri_string).into()],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("Failed to parse URI: {}", e))?;

    // Get ContentResolver
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };
    let content_resolver = env
        .call_method(
            &context,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("Failed to get ContentResolver: {}", e))?;

    // Query the content URI for the display name
    let display_name_string = env
        .new_string("_display_name")
        .map_err(|e| format!("Failed to create projection string: {}", e))?;
    let projection = env
        .new_object_array(1, "java/lang/String", &display_name_string)
        .map_err(|e| format!("Failed to create projection array: {}", e))?;

    let cursor = env
        .call_method(
            &content_resolver,
            "query",
            "(Landroid/net/Uri;[Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;)Landroid/database/Cursor;",
            &[
                (&uri_obj).into(),
                (&projection).into(),
                (&JObject::null()).into(),
                (&JObject::null()).into(),
                (&JObject::null()).into(),
            ],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("Failed to query cursor: {}", e))?;

    if cursor.is_null() {
        return Err("Cursor is null".to_string());
    }

    // Move cursor to first row
    let move_result = env
        .call_method(&cursor, "moveToFirst", "()Z", &[])
        .and_then(|v| v.z())
        .map_err(|e| format!("Failed to move cursor: {}", e))?;

    if !move_result {
        // Close cursor and return error
        let _ = env.call_method(&cursor, "close", "()V", &[]);
        return Err("No data in cursor".to_string());
    }

    // Get the display name column index
    let column_name = env
        .new_string("_display_name")
        .map_err(|e| format!("Failed to create column name: {}", e))?;
    let column_index = env
        .call_method(
            &cursor,
            "getColumnIndex",
            "(Ljava/lang/String;)I",
            &[(&column_name).into()],
        )
        .and_then(|v| v.i())
        .map_err(|e| format!("Failed to get column index: {}", e))?;

    if column_index == -1 {
        let _ = env.call_method(&cursor, "close", "()V", &[]);
        return Err("Column not found".to_string());
    }

    // Get the string value
    let filename_obj = env
        .call_method(
            &cursor,
            "getString",
            "(I)Ljava/lang/String;",
            &[column_index.into()],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("Failed to get string: {}", e))?;

    // Close cursor
    let _ = env.call_method(&cursor, "close", "()V", &[]);

    if filename_obj.is_null() {
        return Err("Filename is null".to_string());
    }

    // Convert to Rust string
    let filename_jstring = JString::from(filename_obj);
    let filename: String = env
        .get_string(&filename_jstring)
        .map_err(|e| format!("Failed to convert string: {}", e))?
        .into();

    Ok(filename)
}

#[cfg(not(target_os = "android"))]
fn get_filename_from_content_uri(_uri: &str) -> Result<String, String> {
    Err("Not supported on this platform".to_string())
}

/// Handle Android content URIs by reading the file and writing to a temporary location.
///
/// On Android, when using the file picker, the returned path may be a `content://` URI
/// which cannot be read directly by `std::fs`. This function uses `tauri_plugin_fs`
/// which can handle content URIs, and copies the content to a temporary file.
///
/// The function attempts to preserve the original filename by querying the ContentResolver.
/// Returns (temp_file_path, display_name) where display_name is the original filename without UUID suffix.
async fn handle_content_uri(
    app: &AppHandle,
    path: &str,
) -> Result<(std::path::PathBuf, String), String> {
    use std::str::FromStr;
    use tauri_plugin_fs::FilePath;

    // Check if this is a content URI
    if path.starts_with("content://") {
        log_info!("Detected content URI, using tauri_plugin_fs to read file");

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

        // Try to get the original filename from the content URI
        let (filename, display_name) = match get_filename_from_content_uri(path) {
            Ok(name) if !name.is_empty() => {
                log_info!("Retrieved original filename from content URI: {}", name);
                // Sanitize the filename to prevent directory traversal
                let sanitized = name.replace(['/', '\\', '\0'], "_");
                // Add a unique suffix to prevent conflicts
                let unique_id = &Uuid::new_v4().simple().to_string()[..8];
                let filename_with_uuid = if let Some((stem, ext)) = sanitized.rsplit_once('.') {
                    format!("{}-{}.{}", stem, unique_id, ext)
                } else {
                    format!("{}-{}", sanitized, unique_id)
                };
                (filename_with_uuid, sanitized)
            }
            Ok(_name) => {
                log_warn!("Retrieved empty filename, using fallback");
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let unique_id = Uuid::new_v4().simple().to_string();
                let filename = format!("sendme-content-{}-{}.bin", timestamp, &unique_id[..8]);
                (filename.clone(), filename)
            }
            Err(e) => {
                log_warn!(
                    "Failed to get filename from content URI: {}, using fallback",
                    e
                );
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let unique_id = Uuid::new_v4().simple().to_string();
                let filename = format!("sendme-content-{}-{}.bin", timestamp, &unique_id[..8]);
                (filename.clone(), filename)
            }
        };

        let temp_file_path = temp_dir.join(&filename);

        // Write the content to the temporary file
        let mut file = std::fs::File::create(&temp_file_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        file.write_all(&content)
            .map_err(|e| format!("Failed to write to temp file: {}", e))?;

        log_info!("Copied content URI to temporary file: {:?}", temp_file_path);

        Ok((temp_file_path, display_name))
    } else {
        // Regular file path, just return it as PathBuf with the path as display name
        let display_name = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path)
            .to_string();
        Ok((std::path::PathBuf::from(path), display_name))
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendFileRequest {
    pub path: String,
    pub ticket_type: String,
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
                .with_tag("sendme"),
        );
    }

    // Initialize tracing subscriber for non-Android platforms
    #[cfg(not(target_os = "android"))]
    {
        tracing_subscriber::fmt::init();
    }

    let transfers: Transfers = Arc::new(RwLock::new(HashMap::new()));
    let nearby_discovery: NearbyDiscovery = Arc::new(RwLock::new(None));

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(mobile)]
    {
        builder = builder
            .plugin(tauri_plugin_barcode_scanner::init())
            .plugin(tauri_plugin_sharesheet::init());
    }

    builder
        .setup(move |app| {
            // Store transfers in app state
            app.manage(transfers.clone());
            app.manage(nearby_discovery.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_file,
            receive_file,
            cancel_transfer,
            get_transfers,
            get_transfer_status,
            clear_transfers,
            start_nearby_discovery,
            get_nearby_devices,
            stop_nearby_discovery,
            get_hostname,
            get_device_model,
            check_wifi_connection,
            get_default_download_folder,
            open_received_file,
            list_received_files,
            scan_barcode
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
            Ok(sendme_lib::types::AddrInfoOptions::Id)
        }
        "relay" => {
            log_info!("🎫 Ticket type: Relay");
            Ok(sendme_lib::types::AddrInfoOptions::Relay)
        }
        "addresses" => {
            log_info!("🎫 Ticket type: Addresses (local-only)");
            Ok(sendme_lib::types::AddrInfoOptions::Addresses)
        }
        "relay_and_addresses" => {
            log_info!("🎫 Ticket type: Relay + Addresses");
            Ok(sendme_lib::types::AddrInfoOptions::RelayAndAddresses)
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
    log_info!("🔍 Handling content URI...");
    let (file_path, display_name) = handle_content_uri(&app, &request.path).await?;
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

    log_info!("🚀 Calling sendme_lib::send_with_progress...");
    match sendme_lib::send_with_progress(args, tx).await {
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

    // On Android, use public Downloads directory for file export if no output_dir provided
    #[cfg(target_os = "android")]
    let export_dir = if let Some(ref output_dir) = request.output_dir {
        log_info!("Using user-provided output_dir: {:?}", output_dir);
        Some(std::path::PathBuf::from(output_dir))
    } else {
        log_info!("No output_dir provided, getting public Downloads directory...");
        match get_default_download_folder_impl() {
            Ok(dir) => {
                log_info!("Using public Downloads directory: {:?}", dir);
                Some(std::path::PathBuf::from(dir))
            }
            Err(e) => {
                log_error!("Failed to get Downloads directory: {}, falling back to temp_dir", e);
                None
            }
        }
    };

    #[cfg(not(target_os = "android"))]
    let export_dir = request.output_dir.as_ref().map(|d| std::path::PathBuf::from(d));

    let args = ReceiveArgs {
        ticket,
        common: CommonConfig {
            format: Format::Hex,
            relay: RelayModeOption::Default,
            show_secret: false,
            magic_ipv4_addr: None,
            magic_ipv6_addr: None,
            temp_dir: Some(temp_dir),
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

    log_info!("Calling sendme_lib::receive_with_progress...");

    match sendme_lib::receive_with_progress(args, tx).await {
        Ok(result) => {
            log_info!("✅ RECEIVE COMPLETED");
            log_info!(
                "Files: {}, Bytes: {}",
                result.total_files,
                result.stats.total_bytes_read()
            );
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

    // Clean up temporary sendme directories
    let temp_dirs = std::fs::read_dir(".")
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(".sendme-"))
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.path())
        .collect::<Vec<_>>();

    for path in temp_dirs {
        log_info!("Removing temporary directory: {:?}", path);
        let _ = std::fs::remove_dir_all(&path);
    }

    Ok(())
}

/// Start nearby device discovery
#[tauri::command]
async fn start_nearby_discovery(
    nearby: tauri::State<'_, NearbyDiscovery>,
) -> Result<String, String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("🔍 START_NEARBY_DISCOVERY");
    log_info!("═══════════════════════════════════════════════════");

    let mut nearby_guard = nearby.write().await;

    // Check if already running
    if nearby_guard.is_some() {
        log_warn!("⚠️  Nearby discovery already running");
        return Err("Nearby discovery already running".to_string());
    }

    // Check WiFi connection before starting
    log_info!("📡 Checking WiFi connection...");
    if !check_wifi_connection()? {
        log_error!("❌ WiFi not connected. Nearby discovery requires WiFi.");
        return Err("WiFi connection required for nearby device discovery. Please connect to a WiFi network and try again.".to_string());
    }
    log_info!("✅ WiFi connection confirmed");

    // Get device model (hostname on desktop, device model on mobile)
    log_info!("📱 Getting device model/hostname...");
    let device_name = get_device_model()?;
    log_info!("✅ Device name: {}", device_name);

    // Create new discovery instance with the device name
    log_info!("🔭 Creating NearbyDiscovery instance...");
    let discovery = sendme_lib::nearby::NearbyDiscovery::new_with_hostname(device_name)
        .await
        .map_err(|e| {
            let err_msg = format!("Failed to create NearbyDiscovery: {}", e);
            log_error!("❌ {}", err_msg);
            err_msg
        })?;

    let node_id = discovery.node_id().to_string();
    log_info!("✅ NearbyDiscovery created successfully");
    log_info!("🆔 Local node ID: {}", node_id);

    // Store discovery instance
    *nearby_guard = Some(discovery);

    log_info!("✅ Nearby discovery started successfully");

    Ok(node_id)
}

/// Get list of nearby devices
#[tauri::command]
async fn get_nearby_devices(
    nearby: tauri::State<'_, NearbyDiscovery>,
) -> Result<Vec<NearbyDevice>, String> {
    log_info!("📋 GET_NEARBY_DEVICES called");

    let mut nearby_guard = nearby.write().await;

    let discovery = nearby_guard
        .as_mut()
        .ok_or("Nearby discovery not running".to_string())?;

    // Poll for updates
    log_info!("🔄 Polling for device updates...");
    let _ = discovery.poll().await;

    let devices = discovery.recent_devices(std::time::Duration::from_secs(600)); // 10 minutes
    log_info!("✅ Found {} recent devices", devices.len());

    // Convert to frontend format with friendly display names
    let result = devices
        .into_iter()
        .map(|d| {
            // Extract IP addresses from the debug-formatted transport addresses
            let ip_addresses: Vec<String> = d
                .addresses
                .iter()
                .filter_map(|addr| {
                    // Parse "Ip(127.0.0.1:8080)" format
                    if addr.starts_with("Ip(") {
                        let inner = &addr[3..addr.len() - 1];
                        // Split by ':' to separate IP from port
                        inner.split(':').next().map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect();

            // Create a friendly display name
            let display_name = if let Some(ref name) = d.name {
                name.clone()
            } else if !ip_addresses.is_empty() {
                // Use first IP address as identifier
                ip_addresses[0].clone()
            } else {
                // Fallback to short node ID
                format!("...{}", &d.node_id[d.node_id.len().saturating_sub(8)..])
            };

            NearbyDevice {
                node_id: d.node_id,
                name: d.name,
                display_name,
                addresses: d.addresses,
                ip_addresses,
                last_seen: d.last_seen,
                available: d.available,
            }
        })
        .collect();

    Ok(result)
}

/// Stop nearby device discovery
#[tauri::command]
async fn stop_nearby_discovery(nearby: tauri::State<'_, NearbyDiscovery>) -> Result<(), String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("🛑 STOP_NEARBY_DISCOVERY");
    log_info!("═══════════════════════════════════════════════════");

    let mut nearby_guard = nearby.write().await;

    if nearby_guard.is_none() {
        log_warn!("⚠️  Nearby discovery not running");
        return Err("Nearby discovery not running".to_string());
    }

    *nearby_guard = None;

    log_info!("✅ Nearby discovery stopped");

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
            let result = map_ios_machine_to_name(&machine);
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

/// Map iOS machine identifiers to friendly names
#[cfg(target_os = "ios")]
fn map_ios_machine_to_name(machine: &str) -> String {
    match machine {
        // iPhone 15 series
        "iPhone15,4" | "iPhone15,5" => "iPhone 15 Plus".to_string(),
        "iPhone15,2" | "iPhone15,3" => "iPhone 15 Pro".to_string(),
        "iPhone16,1" | "iPhone16,2" => "iPhone 15 Pro Max".to_string(),

        // iPhone 14 series
        "iPhone14,7" | "iPhone14,8" => "iPhone 14".to_string(),
        "iPhone14,5" | "iPhone14,6" => "iPhone 13".to_string(),
        "iPhone14,2" | "iPhone14,3" => "iPhone 13 Pro".to_string(),
        "iPhone14,4" => "iPhone 13 mini".to_string(),
        "iPhone14,9" => "iPhone SE (3rd gen)".to_string(),

        // iPhone 12 series
        "iPhone13,2" | "iPhone13,3" => "iPhone 12".to_string(),
        "iPhone13,1" => "iPhone 12 mini".to_string(),
        "iPhone13,4" | "iPhone13,5" => "iPhone 12 Pro".to_string(),
        "iPhone13,6" | "iPhone13,7" => "iPhone 12 Pro Max".to_string(),

        // iPad Pro
        "iPad13,16" | "iPad13,17" => "iPad Pro 12.9 (6th gen)".to_string(),
        "iPad13,18" | "iPad13,19" => "iPad Pro 12.9 (6th gen)".to_string(),
        "iPad13,10" | "iPad13,11" => "iPad Pro 11 (4th gen)".to_string(),
        "iPad13,6" | "iPad13,7" => "iPad Pro 12.9 (5th gen)".to_string(),
        "iPad13,4" | "iPad13,5" => "iPad Pro 11 (3rd gen)".to_string(),
        "iPad13,1" | "iPad13,2" => "iPad Pro 11 (3rd gen)".to_string(),

        // iPad Air
        "iPad13,16" | "iPad13,17" => "iPad Air (5th gen)".to_string(),
        "iPad13,18" | "iPad13,19" => "iPad Air (5th gen)".to_string(),

        // iPad mini
        "iPad14,1" | "iPad14,2" => "iPad mini (6th gen)".to_string(),

        // Fallback - return the machine identifier
        _ => machine.to_string(),
    }
}

/// Check if device is connected to WiFi
///
/// Returns true if the device has an active WiFi connection,
/// false otherwise. This is required for nearby device discovery
/// which uses mDNS over the local network.
#[tauri::command]
fn check_wifi_connection() -> Result<bool, String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("📡 CHECK_WIFI_CONNECTION");
    log_info!("═══════════════════════════════════════════════════");

    // Get all network interfaces
    log_info!("🔍 Scanning network interfaces...");
    let interfaces = get_interfaces();
    log_info!("📊 Found {} network interfaces", interfaces.len());

    // Check if any interface is connected and appears to be WiFi
    for (index, interface) in interfaces.iter().enumerate() {
        log_info!("📋 Interface #{}: {}", index, interface.name);
        log_info!("  - Loopback: {}", interface.is_loopback());
        log_info!("  - Up: {}", interface.is_up());
        log_info!("  - IPv4: {:?}", interface.ipv4);
        log_info!("  - IPv6: {:?}", interface.ipv6);

        // Skip loopback and down interfaces
        if interface.is_loopback() {
            log_info!("  ⏭️  Skipping (loopback)");
            continue;
        }
        if !interface.is_up() {
            log_info!("  ⏭️  Skipping (down)");
            continue;
        }

        // Check if interface has an IP address (v4 or v6)
        let has_ip = !interface.ipv4.is_empty() || !interface.ipv6.is_empty();

        if !has_ip {
            log_info!("  ⏭️  Skipping (no IP)");
            continue;
        }

        // Interface name patterns that indicate WiFi:
        // - Contains "wi-fi", "wifi", "wlan" (case insensitive)
        // - macOS: "en0" is typically WiFi on most Macs
        // - Windows: name may contain "Wi-Fi" or "Wireless"
        // - Linux: "wlan0", "wlp*"
        // - Android/iOS: various patterns
        let name_lower = interface.name.to_lowercase();

        // Check for common WiFi interface name patterns
        let is_wifi = name_lower.contains("wi-fi")
            || name_lower.contains("wifi")
            || name_lower.contains("wlan")
            || name_lower.contains("wireless")
            || name_lower.starts_with("wlp")
            // macOS common WiFi interface
            || (cfg!(target_os = "macos") && interface.name == "en0")
            // iOS WiFi interface
            || (cfg!(target_os = "ios") && interface.name.starts_with("en"));

        log_info!("  - WiFi match: {}", is_wifi);

        if is_wifi {
            log_info!(
                "✅ Found WiFi connection on interface: {} ({})",
                interface.name,
                interface
                    .friendly_name
                    .as_ref()
                    .unwrap_or(&"Unknown".to_string())
            );
            return Ok(true);
        }
    }

    log_warn!("⚠️  No WiFi connection detected");
    Ok(false)
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

    // On iOS, use the Documents directory
    log_info!("📋 Getting Documents directory...");
    let path = app.path().document_dir().map_err(|e| {
        let err_msg = format!("Failed to get Documents directory: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;

    log_info!("✅ Documents directory: {:?}", path);
    Ok(path.to_string_lossy().to_string())
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
        let downloads_dir = get_default_download_folder_impl().map_err(|e| {
            format!("Failed to get Downloads directory: {}", e)
        })?;

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
        android::open_file_with_intent(file_path_str, file_name).map_err(|e| {
            format!("Failed to open file: {:?}", e)
        })?;

        log_info!("✅ File opened successfully");
        Ok(())
    }

    // On desktop, use opener plugin
    #[cfg(not(target_os = "android"))]
    {
        log_info!("🖥️  Desktop platform detected, using opener plugin");

        // Get temp directory
        let temp_dir = app.path().temp_dir().map_err(|e| {
            format!("Failed to get temp directory: {}", e)
        })?;

        // Find the file to open
        let file_to_open = if let Some(ref fname) = filename {
            let file_path = temp_dir.join(fname);
            if !file_path.exists() {
                return Err(format!("File not found: {}", fname));
            }
            file_path
        } else {
            // Find first file in directory
            let entries = std::fs::read_dir(&temp_dir).map_err(|e| {
                format!("Failed to read temp directory: {}", e)
            })?;

            let first_file = entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .find(|p| {
                    p.is_file()
                        && !p.file_name()
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
async fn list_received_files(
    app: AppHandle,
) -> Result<Vec<String>, String> {
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

    #[cfg(not(target_os = "android"))]
    {
        // Use temp directory on other platforms
        let temp_dir = app.path().temp_dir().map_err(|e| {
            format!("Failed to get temp directory: {}", e)
        })?;

        log_info!("Temp directory: {:?}", temp_dir);

        let entries = std::fs::read_dir(&temp_dir).map_err(|e| {
            format!("Failed to read temp directory: {}", e)
        })?;

        let files: Vec<String> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && !p.file_name()
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

/// Scan a barcode/QR code using the device camera
///
/// This function uses the tauri-plugin-barcode-scanner to open the camera
/// and scan a QR code or barcode. Returns the scanned text content.
///
/// Only available on mobile platforms (Android/iOS).
#[tauri::command]
#[cfg(mobile)]
async fn scan_barcode() -> Result<String, String> {
    log_info!("═══════════════════════════════════════════════════");
    log_info!("📷 SCAN_BARCODE");
    log_info!("═══════════════════════════════════════════════════");

    use tauri_plugin_barcode_scanner::{scan, BarcodeFormat};

    log_info!("Opening camera scanner...");

    // Scan for QR codes and common barcode formats
    let formats = vec![
        BarcodeFormat::QrCode,
        BarcodeFormat::Code128,
        BarcodeFormat::Code39,
        BarcodeFormat::Ean13,
        BarcodeFormat::Ean8,
        BarcodeFormat::UpcA,
        BarcodeFormat::UpcE,
    ];

    match scan(formats).await {
        Ok(result) => {
            log_info!("✅ Scan successful: {}", result);
            Ok(result)
        }
        Err(e) => {
            let err_msg = format!("Scan failed: {:?}", e);
            log_error!("❌ {}", err_msg);
            Err(err_msg)
        }
    }
}

/// Scan a barcode/QR code (desktop stub)
///
/// On desktop platforms, this function returns an error since barcode
/// scanning is only supported on mobile platforms.
#[tauri::command]
#[cfg(not(mobile))]
async fn scan_barcode() -> Result<String, String> {
    Err("Barcode scanning is only available on mobile platforms (Android/iOS)".to_string())
}
