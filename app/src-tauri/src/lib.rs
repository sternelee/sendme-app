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

/// Handle Android content URIs by reading the file and writing to a temporary location.
///
/// On Android, when using the file picker, the returned path may be a `content://` URI
/// which cannot be read directly by `std::fs`. This function uses `tauri_plugin_fs`
/// which can handle content URIs, and copies the content to a temporary file.
async fn handle_content_uri(app: &AppHandle, path: &str) -> Result<std::path::PathBuf, String> {
    use std::str::FromStr;
    use tauri_plugin_fs::FilePath;

    // Check if this is a content URI
    if path.starts_with("content://") {
        tracing::info!("Detected content URI, using tauri_plugin_fs to read file");

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

        // Generate a unique filename using timestamp and UUID suffix
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let unique_id = Uuid::new_v4().simple().to_string();
        let filename = format!("sendme-content-{}-{}.bin", timestamp, &unique_id[..8]);

        let temp_file_path = temp_dir.join(filename);

        // Write the content to the temporary file
        let mut file = std::fs::File::create(&temp_file_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        file.write_all(&content)
            .map_err(|e| format!("Failed to write to temp file: {}", e))?;

        tracing::info!("Copied content URI to temporary file: {:?}", temp_file_path);

        Ok(temp_file_path)
    } else {
        // Regular file path, just return it as PathBuf
        Ok(std::path::PathBuf::from(path))
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
    let transfers: Transfers = Arc::new(RwLock::new(HashMap::new()));
    let nearby_discovery: NearbyDiscovery = Arc::new(RwLock::new(None));

    let mut builder = tauri::Builder::default()
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
            check_wifi_connection
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
    let transfer_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel();

    // Parse ticket type
    let ticket_type = match request.ticket_type.as_str() {
        "id" => Ok(sendme_lib::types::AddrInfoOptions::Id),
        "relay" => Ok(sendme_lib::types::AddrInfoOptions::Relay),
        "addresses" => Ok(sendme_lib::types::AddrInfoOptions::Addresses),
        "relay_and_addresses" => Ok(sendme_lib::types::AddrInfoOptions::RelayAndAddresses),
        _ => Err("Invalid ticket type".to_string()),
    }?;

    // Get temp directory for macOS sandbox compatibility
    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("Failed to get temp directory: {}", e))?;

    // Handle Android content URIs - if path is a content:// URI, copy to temp file
    let file_path = handle_content_uri(&app, &request.path).await?;

    let args = SendArgs {
        path: file_path,
        ticket_type,
        common: CommonConfig {
            temp_dir: Some(temp_dir),
            ..Default::default()
        },
    };

    // Create transfer info
    let transfer_info = TransferInfo {
        id: transfer_id.clone(),
        transfer_type: "send".to_string(),
        path: request.path.clone(),
        status: "initializing".to_string(),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    };

    // Store transfer
    let mut transfers_guard = transfers.write().await;
    transfers_guard.insert(
        transfer_id.clone(),
        TransferState {
            info: transfer_info.clone(),
            abort_tx: Some(abort_tx),
        },
    );
    drop(transfers_guard);

    let app_clone = app.clone();
    let transfers_clone = transfers.inner().clone();
    let transfer_id_clone = transfer_id.clone();
    let transfer_id_for_abort = transfer_id.clone();

    tokio::spawn(async move {
        // Listen for abort signal
        tokio::spawn(async move {
            let _ = abort_rx.await;
            tracing::info!("Transfer {} aborted", transfer_id_for_abort);
        });

        while let Some(event) = rx.recv().await {
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

        // Mark transfer as complete
        update_transfer_status(&transfers_clone, &transfer_id_clone, "completed").await;
    });

    match sendme_lib::send_with_progress(args, tx).await {
        Ok(result) => {
            update_transfer_status(transfers.inner(), &transfer_id, "serving").await;
            Ok(result.ticket.to_string())
        }
        Err(e) => {
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
    let transfer_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    let (abort_tx, _abort_rx) = tokio::sync::oneshot::channel();

    // Change to output directory if specified
    if let Some(ref output_dir) = request.output_dir {
        std::env::set_current_dir(output_dir).map_err(|e| e.to_string())?;
    }

    let ticket = request
        .ticket
        .parse()
        .map_err(|e| format!("Invalid ticket: {}", e))?;

    // Get temp directory for macOS sandbox compatibility
    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("Failed to get temp directory: {}", e))?;

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

    // Store transfer
    let mut transfers_guard = transfers.write().await;
    transfers_guard.insert(
        transfer_id.clone(),
        TransferState {
            info: transfer_info.clone(),
            abort_tx: Some(abort_tx),
        },
    );
    drop(transfers_guard);

    let app_clone = app.clone();
    let transfers_clone = transfers.inner().clone();
    let transfer_id_clone = transfer_id.clone();

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
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

        // Mark transfer as complete
        update_transfer_status(&transfers_clone, &transfer_id_clone, "completed").await;
    });

    match sendme_lib::receive_with_progress(args, tx).await {
        Ok(result) => {
            update_transfer_status(transfers.inner(), &transfer_id, "completed").await;
            Ok(format!(
                "{{\"transfer_id\": \"{}\", \"files\": {}, \"bytes\": {}}}",
                transfer_id,
                result.total_files,
                result.stats.total_bytes_read()
            ))
        }
        Err(e) => {
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
        tracing::info!("Removing temporary directory: {:?}", path);
        let _ = std::fs::remove_dir_all(&path);
    }

    Ok(())
}

/// Start nearby device discovery
#[tauri::command]
async fn start_nearby_discovery(
    nearby: tauri::State<'_, NearbyDiscovery>,
) -> Result<String, String> {
    let mut nearby_guard = nearby.write().await;

    // Check if already running
    if nearby_guard.is_some() {
        return Err("Nearby discovery already running".to_string());
    }

    // Check WiFi connection before starting
    if !check_wifi_connection()? {
        return Err("WiFi connection required for nearby device discovery. Please connect to a WiFi network and try again.".to_string());
    }

    // Get device model (hostname on desktop, device model on mobile)
    let device_name = get_device_model()?;

    // Create new discovery instance with the device name
    let discovery = sendme_lib::nearby::NearbyDiscovery::new_with_hostname(device_name)
        .await
        .map_err(|e| e.to_string())?;

    let node_id = discovery.node_id().to_string();

    // Store discovery instance
    *nearby_guard = Some(discovery);

    Ok(node_id)
}

/// Get list of nearby devices
#[tauri::command]
async fn get_nearby_devices(
    nearby: tauri::State<'_, NearbyDiscovery>,
) -> Result<Vec<NearbyDevice>, String> {
    let mut nearby_guard = nearby.write().await;

    let discovery = nearby_guard
        .as_mut()
        .ok_or("Nearby discovery not running".to_string())?;

    // Poll for updates
    let _ = discovery.poll().await;

    let devices = discovery.recent_devices(std::time::Duration::from_secs(600)); // 10 minutes

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
    let mut nearby_guard = nearby.write().await;

    if nearby_guard.is_none() {
        return Err("Nearby discovery not running".to_string());
    }

    *nearby_guard = None;

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
    #[cfg(target_os = "android")]
    {
        use jni::objects::JObject;
        use jni::signature::JavaType;

        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("Failed to get VM: {}", e))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("Failed to attach to VM: {}", e))?;

        // Get Build.MODEL
        let build_class = env
            .find_class("android/os/Build")
            .map_err(|e| format!("Failed to find Build class: {}", e))?;
        let model_field = env
            .get_static_field_id(&build_class, "MODEL", "Ljava/lang/String;")
            .map_err(|e| format!("Failed to get MODEL field: {}", e))?;
        let model_obj = env
            .get_static_field_unchecked(
                &build_class,
                model_field,
                JavaType::Object("java/lang/String".to_string()),
            )
            .map_err(|e| format!("Failed to get MODEL value: {}", e))?;

        // Get Build.MANUFACTURER
        let manufacturer_field = env
            .get_static_field_id(&build_class, "MANUFACTURER", "Ljava/lang/String;")
            .map_err(|e| format!("Failed to get MANUFACTURER field: {}", e))?;
        let manufacturer_obj = env
            .get_static_field_unchecked(
                &build_class,
                manufacturer_field,
                JavaType::Object("java/lang/String".to_string()),
            )
            .map_err(|e| format!("Failed to get MANUFACTURER value: {}", e))?;

        // Get the JObject values
        let model_jobj: JObject = model_obj
            .l()
            .map_err(|e| format!("Failed to get model object: {}", e))?;
        let manufacturer_jobj: JObject = manufacturer_obj
            .l()
            .map_err(|e| format!("Failed to get manufacturer object: {}", e))?;

        // Convert to JString and then to Rust String
        let model_jstring = jni::objects::JString::from(model_jobj);
        let manufacturer_jstring = jni::objects::JString::from(manufacturer_jobj);

        let model_str: String = env
            .get_string(&model_jstring)
            .map_err(|e| format!("Failed to get model string: {}", e))?
            .into();
        let manufacturer_str: String = env
            .get_string(&manufacturer_jstring)
            .map_err(|e| format!("Failed to get manufacturer string: {}", e))?
            .into();

        // Format as "Manufacturer Model" or just "Model" if they start the same
        if model_str.starts_with(&manufacturer_str) {
            Ok(model_str)
        } else {
            Ok(format!("{} {}", manufacturer_str, model_str))
        }
    }

    #[cfg(target_os = "ios")]
    {
        // Use uname to get machine identifier
        use std::mem;

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

            // Map common machine identifiers to friendly names
            Ok(map_ios_machine_to_name(&machine))
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Desktop: just return hostname
        Ok(get_hostname()?)
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
    // Get all network interfaces
    let interfaces = get_interfaces();

    // Check if any interface is connected and appears to be WiFi
    for interface in interfaces {
        // Skip loopback and down interfaces
        if interface.is_loopback() || !interface.is_up() {
            continue;
        }

        // Check if interface has an IP address (v4 or v6)
        let has_ip = !interface.ipv4.is_empty() || !interface.ipv6.is_empty();

        if !has_ip {
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

        if is_wifi {
            tracing::info!(
                "Found WiFi connection on interface: {} ({})",
                interface.name,
                interface
                    .friendly_name
                    .as_ref()
                    .unwrap_or(&"Unknown".to_string())
            );
            return Ok(true);
        }
    }

    tracing::warn("No WiFi connection detected");
    Ok(false)
}
