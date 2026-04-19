use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use sendme_lib::{progress::*, types::*};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
#[cfg(desktop)]
use tauri::WebviewWindowBuilder;
use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_clerk::ClerkExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

use iroh::{endpoint::Incoming, Endpoint, RelayMode};

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

#[cfg(target_os = "ios")]
fn ios_documents_dir(app: &AppHandle) -> Result<String, String> {
    use tauri_plugin_fs_ios::{models::FSRequest, FsIosExt};

    let response = app
        .fs_ios()
        .current_dir(FSRequest {
            path: None,
            contents: None,
        })
        .map_err(|e| format!("Failed to get Documents directory: {}", e))?;

    response
        .value
        .ok_or_else(|| "Documents directory response was empty".to_string())
}

// Android-specific module
#[cfg(target_os = "android")]
mod android;

// Desktop menubar / system tray module
#[cfg(desktop)]
mod menubar;

#[cfg(desktop)]
mod menubar_cmd;

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
    use tauri_plugin_fs::{FilePath, OpenOptions};

    // Check if this is a content URI (Android)
    if path.starts_with("content://") {
        log_info!("Detected content URI, using tauri_plugin_fs to read file");
        log_info!("Original filename from picker: {}", filename);

        // Use tauri_plugin_fs to open the content URI for streaming read
        let fs = app.fs(); // From FsExt trait

        // Parse the path as a FilePath (which handles content:// URIs)
        let file_path =
            FilePath::from_str(path).map_err(|e| format!("Failed to parse file path: {:?}", e))?;

        // Open the content URI as a File and stream-copy to a temp file
        // (avoids loading large files into memory)
        let mut open_opts = OpenOptions::new();
        open_opts.read(true);
        let mut src = fs
            .open(file_path, open_opts)
            .map_err(|e| format!("Failed to open content URI: {}", e))?;

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

        let mut dst = std::fs::File::create(&temp_file_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        std::io::copy(&mut src, &mut dst)
            .map_err(|e| format!("Failed to copy content URI to temp file: {}", e))?;

        log_info!("Copied content URI to temporary file: {:?}", temp_file_path);

        Ok((temp_file_path, sanitized))
    } else {
        // Regular file path or file:// URL (desktop or iOS).
        // On iOS, tauri-plugin-dialog returns file:// URLs (e.g. "file:///private/var/...").
        // PathBuf::from("file:///...") produces a relative path, causing ENOENT.
        // Parse file:// URLs properly to extract the real filesystem path.
        let path_buf = if path.starts_with("file://") {
            log_info!("Detected file:// URL (iOS), converting to filesystem path");
            let file_path = FilePath::from_str(path)
                .map_err(|e| format!("Failed to parse file URL: {:?}", e))?;
            file_path
                .into_path()
                .map_err(|e| format!("Failed to convert file:// URL to path: {}", e))?
        } else {
            log_info!("Regular file path detected: {}", path);
            std::path::PathBuf::from(path)
        };
        let display_name = if filename.is_empty() {
            path_buf
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path)
                .to_string()
        } else {
            filename.to_string()
        };
        Ok((path_buf, display_name))
    }
}

/// Copy exported files from temp_dir to a content URI on Android.
///
/// Uses tauri_plugin_android_fs API to create files and write content
/// to the selected directory via Android's Storage Access Framework.
#[cfg(target_os = "android")]
async fn copy_files_to_content_uri(
    app: &AppHandle,
    temp_dir: &std::path::Path,
    content_uri: &str,
    collection: &iroh_blobs::format::collection::Collection,
) -> anyhow::Result<()> {
    use tauri_plugin_android_fs::AndroidFsExt;

    log_info!("Starting copy to content URI: {}", content_uri);
    log_info!("Files to copy: {}", collection.len());
    log_info!("Temp directory: {:?}", temp_dir);

    let api = app.android_fs_async();

    // Reconstruct the FileUri from the content URI string.
    // The pick_directory function converts FileUri -> FilePath -> String which only keeps
    // the document URI (e.g., "content://.../tree/.../document/...").
    // We need to extract the tree URI part for documentTopTreeUri so the plugin
    // can properly resolve SAF operations.
    let tree_uri = if let Some(doc_idx) = content_uri.find("/document/") {
        // Extract tree URI: everything before /document/
        &content_uri[..doc_idx]
    } else {
        // If no /document/ part, it's already a tree URI
        content_uri
    };

    let dir_uri: tauri_plugin_android_fs::FileUri = serde_json::from_value(serde_json::json!({
        "uri": content_uri,
        "documentTopTreeUri": tree_uri,
    }))?;

    log_info!("Constructed FileUri: {:?}", dir_uri);

    // Collect file info to copy AND verify files exist
    let mut files_to_copy: Vec<(String, std::path::PathBuf)> = Vec::new();
    let mut missing_files: Vec<String> = Vec::new();

    for (name, _hash) in collection.iter() {
        let source_path = temp_dir.join(name);
        let target_name = strip_nearby_staging_prefix(name).to_string();
        if source_path.exists() {
            log_info!("✅ File exists: {:?} -> {}", source_path, name);
            files_to_copy.push((target_name, source_path));
        } else {
            log_error!(
                "❌ File NOT found: {:?} (looking for: {})",
                source_path,
                name
            );
            missing_files.push(name.to_string());
        }
    }

    // If any files are missing, log error and bail
    if !missing_files.is_empty() {
        log_error!(
            "❌ Missing {} files out of {}",
            missing_files.len(),
            collection.len()
        );
        if let Ok(entries) = std::fs::read_dir(temp_dir) {
            log_error!("Contents of temp_dir:");
            for entry in entries.flatten() {
                log_error!("  - {:?}", entry.path());
            }
        }
        anyhow::bail!(
            "Export verification failed: {} files not found in temp directory. Missing: {:?}",
            missing_files.len(),
            missing_files
        );
    }

    if files_to_copy.is_empty() {
        log_warn!("No files to copy (empty collection)");
        return Ok(());
    }

    log_info!(
        "📋 Ready to copy {} files to content URI",
        files_to_copy.len()
    );

    for (name, source_path) in &files_to_copy {
        log_info!("Copying {} ({:?}) to content URI", name, source_path);

        // Create the file in the target directory using the plugin API
        // create_new_file automatically creates parent directories for nested paths
        let file_uri = api
            .create_new_file(&dir_uri, name, None)
            .await
            .map_err(|e| {
                log_error!(
                    "❌ Failed to create file '{}' in content URI: {:?}",
                    name,
                    e
                );
                anyhow::anyhow!(
                    "Failed to create file '{}' in selected directory: {:?}. \
                     The directory may not be writable or permission may have expired.",
                    name,
                    e
                )
            })?;

        log_info!("Created file URI: {:?}", file_uri);

        // Stream-copy from temp file to content URI to avoid loading large files into memory
        let mut dest = api.open_file_writable(&file_uri).await.map_err(|e| {
            log_error!("❌ Failed to open file '{}' for writing: {:?}", name, e);
            anyhow::anyhow!("Failed to open file '{}' for writing: {:?}", name, e)
        })?;
        let mut src = std::fs::File::open(source_path).map_err(|e| {
            log_error!("Failed to open temp file {:?}: {}", source_path, e);
            anyhow::anyhow!("Failed to open temp file {:?}: {}", source_path, e)
        })?;
        let copied = std::io::copy(&mut src, &mut dest).map_err(|e| {
            log_error!("❌ Failed to copy to file '{}': {:?}", name, e);
            anyhow::anyhow!(
                "Failed to write to file '{}': {:?}. \
                     Check device storage space and directory permissions.",
                name,
                e
            )
        })?;

        log_info!("✅ Copied {} ({} bytes) to content URI", name, copied);

        // Clean up the temp file
        if let Err(e) = std::fs::remove_file(source_path) {
            log_warn!("Failed to remove temp file {:?}: {}", source_path, e);
        }
    }

    log_info!("✅ All {} files copied successfully", files_to_copy.len());
    Ok(())
}

/// Send text request
#[derive(Debug, Serialize, Deserialize)]
pub struct SendTextRequest {
    pub text: String,
    pub filename: Option<String>,
    pub ticket_type: String,
}

/// Receive text request
#[derive(Debug, Serialize, Deserialize)]
pub struct ReceiveTextRequest {
    pub ticket: String,
}

/// Text transfer result
#[derive(Debug, Serialize, Deserialize)]
pub struct TextResult {
    pub text: String,
    pub filename: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbySendItemRequest {
    pub path: String,
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
    pub ticket: Option<String>,
}

// Global state for tracking active transfers
type Transfers = Arc<RwLock<HashMap<String, TransferState>>>;

type NearbyState = Arc<RwLock<NearbyRuntime>>;
type CloudPresenceState = Arc<RwLock<CloudPresenceRuntime>>;
type AndroidForegroundState = Arc<RwLock<AndroidForegroundRuntime>>;

#[derive(Debug)]
struct TransferState {
    info: TransferInfo,
    abort_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

struct NearbyRuntime {
    endpoint: Option<Endpoint>,
    discovery: Option<sendme_lib::NearbyDiscovery>,
    pending_requests: HashMap<String, NearbyPendingRequest>,
    device_name: String,
    device_type: sendme_lib::DeviceType,
    listener_started: bool,
}

impl Default for NearbyRuntime {
    fn default() -> Self {
        Self {
            endpoint: None,
            discovery: None,
            pending_requests: HashMap::new(),
            device_name: String::new(),
            device_type: sendme_lib::DeviceType::Unknown,
            listener_started: false,
        }
    }
}

struct NearbyPendingRequest {
    decision_tx: mpsc::Sender<NearbyDecision>,
}

#[derive(Debug)]
enum NearbyDecision {
    Accept { output_dir: Option<String> },
    Decline { reason: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NearbyIncomingFile {
    name: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NearbyIncomingRequestPayload {
    id: String,
    sender_name: String,
    sender_device_type: String,
    files: Vec<NearbyIncomingFile>,
    total_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NearbyTransferProgressPayload {
    transferred: u64,
    total: u64,
    speed: u64,
    eta: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NearbyTransferStatePayload {
    request_id: Option<String>,
    transfer_id: Option<String>,
    state: String,
    device_name: Option<String>,
    device_type: Option<String>,
    message: Option<String>,
    progress: Option<NearbyTransferProgressPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NearbyProfilePayload {
    name: String,
    device_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartCloudPresenceRequest {
    device_id: String,
    api_origin: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudDevicePayload {
    id: String,
    #[serde(default)]
    device_id: Option<String>,
    name: String,
    platform: String,
    online: bool,
    #[serde(default)]
    last_seen_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudFriendUserPayload {
    id: String,
    name: String,
    email: String,
    image: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudFriendDevicePayload {
    id: String,
    name: String,
    platform: String,
    online: bool,
    last_seen_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudFriendPayload {
    id: String,
    user_id: String,
    friend_user_id: String,
    status: String,
    created_at: String,
    updated_at: String,
    accepted_at: Option<String>,
    friend: CloudFriendUserPayload,
    #[serde(default)]
    friend_devices: Vec<CloudFriendDevicePayload>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudTicketPayload {
    id: String,
    ticket: String,
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    file_size: Option<u64>,
    #[serde(default)]
    sender_name: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudTransferReceivedPayload {
    ticket_id: String,
    filename: Option<String>,
    file_size: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudPresenceSnapshotPayload {
    active: bool,
    connected: bool,
    device_id: Option<String>,
    last_error: Option<String>,
    #[serde(default)]
    friends: Vec<CloudFriendPayload>,
    #[serde(default)]
    devices: Vec<CloudDevicePayload>,
    #[serde(default)]
    tickets: Vec<CloudTicketPayload>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
enum CloudServerMessage {
    Friends(Vec<CloudFriendPayload>),
    Devices(Vec<CloudDevicePayload>),
    Tickets(Vec<CloudTicketPayload>),
    Error(String),
    Pong,
    TransferReceived(CloudTransferReceivedPayload),
}

#[derive(Debug)]
struct CloudPresenceRuntime {
    generation: u64,
    api_origin: Option<String>,
    snapshot: CloudPresenceSnapshotPayload,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl Default for CloudPresenceRuntime {
    fn default() -> Self {
        Self {
            generation: 0,
            api_origin: None,
            snapshot: CloudPresenceSnapshotPayload::default(),
            shutdown_tx: None,
        }
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[derive(Debug, Clone)]
struct AndroidForegroundTransfer {
    title: String,
    message: String,
    detail: String,
    progress_current: u32,
    progress_total: u32,
    indeterminate: bool,
}

#[derive(Debug, Default)]
struct AndroidForegroundRuntime {
    active_receive: Option<AndroidForegroundTransfer>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidForegroundNotificationPayload {
    title: String,
    message: String,
    detail: String,
    progress_current: u32,
    progress_total: u32,
    indeterminate: bool,
}

struct PreparedNearbySource {
    send_path: PathBuf,
    cleanup_path: Option<PathBuf>,
    display_name: String,
    manifest: Vec<sendme_lib::nearby::FileInfo>,
    total_size: u64,
}

#[tauri::command]
async fn start_nearby_discovery(
    app: AppHandle,
    nearby: tauri::State<'_, NearbyState>,
) -> Result<(), String> {
    ensure_nearby_runtime(&app, nearby.inner().clone()).await
}

#[tauri::command]
async fn get_nearby_devices(
    nearby: tauri::State<'_, NearbyState>,
) -> Result<Vec<sendme_lib::NearbyDevice>, String> {
    let guard = nearby.read().await;
    Ok(guard
        .discovery
        .as_ref()
        .map(|discovery| discovery.get_devices())
        .unwrap_or_default())
}

#[tauri::command]
async fn get_nearby_profile(
    app: AppHandle,
    nearby: tauri::State<'_, NearbyState>,
) -> Result<NearbyProfilePayload, String> {
    let guard = nearby.read().await;
    if !guard.device_name.trim().is_empty() {
        return Ok(NearbyProfilePayload {
            name: guard.device_name.clone(),
            device_type: guard.device_type.as_str().to_string(),
        });
    }
    drop(guard);

    let (name, device_type) = current_nearby_profile(&app)?;
    Ok(NearbyProfilePayload {
        name,
        device_type: device_type.as_str().to_string(),
    })
}

#[tauri::command]
async fn stop_nearby_discovery(nearby: tauri::State<'_, NearbyState>) -> Result<(), String> {
    let mut guard = nearby.write().await;
    guard.discovery = None;
    guard.pending_requests.clear();
    guard.endpoint = None;
    guard.listener_started = false;
    Ok(())
}

#[tauri::command]
async fn start_cloud_presence(
    app: AppHandle,
    cloud: tauri::State<'_, CloudPresenceState>,
    request: StartCloudPresenceRequest,
) -> Result<CloudPresenceSnapshotPayload, String> {
    let request = normalize_cloud_presence_request(request)?;
    let (shutdown_tx, snapshot) = {
        let mut guard = cloud.write().await;
        let same_config = guard.snapshot.active
            && guard.snapshot.device_id.as_deref() == Some(request.device_id.as_str())
            && guard.api_origin.as_deref() == Some(request.api_origin.as_str());
        if same_config {
            return Ok(guard.snapshot.clone());
        }

        guard.generation += 1;
        let generation = guard.generation;
        let previous_shutdown = guard.shutdown_tx.take();
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        guard.shutdown_tx = Some(shutdown_tx);
        guard.api_origin = Some(request.api_origin.clone());
        guard.snapshot = CloudPresenceSnapshotPayload {
            active: true,
            connected: false,
            device_id: Some(request.device_id.clone()),
            last_error: None,
            friends: Vec::new(),
            devices: Vec::new(),
            tickets: Vec::new(),
        };
        let snapshot = guard.snapshot.clone();
        tauri::async_runtime::spawn(run_cloud_presence_loop(
            app.clone(),
            cloud.inner().clone(),
            generation,
            request,
            shutdown_rx,
        ));
        (previous_shutdown, snapshot)
    };

    if let Some(tx) = shutdown_tx {
        let _ = tx.send(());
    }

    emit_cloud_presence_state(&app, snapshot.clone());
    refresh_android_foreground_notification(&app).await;
    Ok(snapshot)
}

#[tauri::command]
async fn stop_cloud_presence(
    app: AppHandle,
    cloud: tauri::State<'_, CloudPresenceState>,
) -> Result<(), String> {
    let (shutdown_tx, snapshot) = {
        let mut guard = cloud.write().await;
        guard.generation += 1;
        let shutdown_tx = guard.shutdown_tx.take();
        guard.api_origin = None;
        guard.snapshot = CloudPresenceSnapshotPayload::default();
        (shutdown_tx, guard.snapshot.clone())
    };

    if let Some(tx) = shutdown_tx {
        let _ = tx.send(());
    }

    emit_cloud_presence_state(&app, snapshot);
    let _ = app.emit("cloud_friends_updated", Vec::<CloudFriendPayload>::new());
    let _ = app.emit("cloud_devices_updated", Vec::<CloudDevicePayload>::new());
    let _ = app.emit("cloud_tickets_updated", Vec::<CloudTicketPayload>::new());
    refresh_android_foreground_notification(&app).await;
    Ok(())
}

#[tauri::command]
async fn get_cloud_presence_state(
    cloud: tauri::State<'_, CloudPresenceState>,
) -> Result<CloudPresenceSnapshotPayload, String> {
    Ok(cloud.read().await.snapshot.clone())
}

#[tauri::command]
async fn send_to_device(
    app: AppHandle,
    transfers: tauri::State<'_, Transfers>,
    nearby: tauri::State<'_, NearbyState>,
    file_items: Vec<NearbySendItemRequest>,
    device_id: String,
) -> Result<String, String> {
    ensure_nearby_runtime(&app, nearby.inner().clone()).await?;

    let prepared = prepare_nearby_source(&app, &file_items).await?;
    let (peer_addr, fallback_name) = {
        let guard = nearby.read().await;
        let discovery = guard
            .discovery
            .as_ref()
            .ok_or_else(|| "Nearby discovery is not running".to_string())?;
        let peer_addr = discovery
            .get_endpoint_addr(&device_id)
            .ok_or_else(|| "Selected device is no longer available".to_string())?;
        let device_name = discovery
            .get_devices()
            .into_iter()
            .find(|device| device.id == device_id)
            .map(|device| device.name)
            .unwrap_or_else(|| "Nearby device".to_string());
        (peer_addr, device_name)
    };

    let endpoint = {
        let guard = nearby.read().await;
        guard
            .endpoint
            .clone()
            .ok_or_else(|| "Nearby control endpoint is not available".to_string())?
    };

    let transfer_id = Uuid::new_v4().to_string();
    let transfer_info = TransferInfo {
        id: transfer_id.clone(),
        transfer_type: "nearby-send".to_string(),
        path: prepared.display_name.clone(),
        status: "connecting".to_string(),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
        ticket: None,
    };
    {
        let mut transfers_guard = transfers.write().await;
        transfers_guard.insert(
            transfer_id.clone(),
            TransferState {
                info: transfer_info,
                abort_tx: None,
            },
        );
    }

    let current_profile = current_nearby_profile(&app)?;
    let conn = endpoint
        .connect(peer_addr, sendme_lib::nearby::ALPN)
        .await
        .map_err(|e| format!("Failed to connect to nearby device: {e}"))?;
    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|e| format!("Failed to open nearby control stream: {e}"))?;

    write_nearby_message(
        &mut send,
        &sendme_lib::nearby::Message::Hello {
            device_name: current_profile.0.clone(),
            device_type: current_profile.1.as_str().to_string(),
            endpoint_id: endpoint.addr().id.to_string(),
        },
    )
    .await?;

    let receiver_hello = read_nearby_message(&mut recv).await?;
    let (receiver_name, receiver_type) = match receiver_hello {
        sendme_lib::nearby::Message::Hello {
            device_name,
            device_type,
            ..
        } => (device_name, device_type),
        _ => {
            return Err("Nearby device sent an invalid hello message".to_string());
        }
    };

    write_nearby_message(
        &mut send,
        &sendme_lib::nearby::Message::Offer {
            files: prepared.manifest.clone(),
            total_size: prepared.total_size,
        },
    )
    .await?;

    emit_nearby_send_state(
        &app,
        NearbyTransferStatePayload {
            request_id: None,
            transfer_id: Some(transfer_id.clone()),
            state: "waiting".to_string(),
            device_name: Some(receiver_name.clone()),
            device_type: Some(receiver_type.clone()),
            message: Some("Waiting for device confirmation".to_string()),
            progress: Some(NearbyTransferProgressPayload {
                transferred: 0,
                total: prepared.total_size,
                speed: 0,
                eta: 0,
            }),
        },
    );

    let response = read_nearby_message(&mut recv).await?;
    let session_id = match response {
        sendme_lib::nearby::Message::Accept { session_id } => session_id,
        sendme_lib::nearby::Message::Decline { reason, .. } => {
            let reason = reason.unwrap_or_else(|| "Transfer declined".to_string());
            update_transfer_status(
                transfers.inner(),
                &transfer_id,
                &format!("declined: {reason}"),
            )
            .await;
            emit_nearby_send_state(
                &app,
                NearbyTransferStatePayload {
                    request_id: None,
                    transfer_id: Some(transfer_id.clone()),
                    state: "declined".to_string(),
                    device_name: Some(receiver_name),
                    device_type: Some(receiver_type),
                    message: Some(reason.clone()),
                    progress: None,
                },
            );
            if let Some(cleanup_path) = &prepared.cleanup_path {
                let _ = tokio::fs::remove_dir_all(cleanup_path).await;
            }
            return Err(reason);
        }
        sendme_lib::nearby::Message::Cancel { reason, .. } => {
            let reason = reason.unwrap_or_else(|| "Receiver cancelled the request".to_string());
            update_transfer_status(
                transfers.inner(),
                &transfer_id,
                &format!("cancelled: {reason}"),
            )
            .await;
            emit_nearby_send_state(
                &app,
                NearbyTransferStatePayload {
                    request_id: None,
                    transfer_id: Some(transfer_id.clone()),
                    state: "cancelled".to_string(),
                    device_name: Some(receiver_name),
                    device_type: Some(receiver_type),
                    message: Some(reason.clone()),
                    progress: None,
                },
            );
            if let Some(cleanup_path) = &prepared.cleanup_path {
                let _ = tokio::fs::remove_dir_all(cleanup_path).await;
            }
            return Err(reason);
        }
        _ => {
            if let Some(cleanup_path) = &prepared.cleanup_path {
                let _ = tokio::fs::remove_dir_all(cleanup_path).await;
            }
            return Err(format!("Unexpected nearby response from {fallback_name}"));
        }
    };

    update_transfer_status(transfers.inner(), &transfer_id, "preparing").await;
    emit_nearby_send_state(
        &app,
        NearbyTransferStatePayload {
            request_id: None,
            transfer_id: Some(transfer_id.clone()),
            state: "accepted".to_string(),
            device_name: Some(receiver_name.clone()),
            device_type: Some(receiver_type.clone()),
            message: Some("Preparing transfer".to_string()),
            progress: Some(NearbyTransferProgressPayload {
                transferred: 0,
                total: prepared.total_size,
                speed: 0,
                eta: 0,
            }),
        },
    );

    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("Failed to get temp directory: {e}"))?;
    let args = SendArgs {
        path: prepared.send_path.clone(),
        ticket_type: AddrInfoOptions::RelayAndAddresses,
        common: CommonConfig {
            temp_dir: Some(temp_dir),
            ..Default::default()
        },
        import_mode: sendme_lib::ImportMode::Copy,
    };

    let (tx, rx) = tokio::sync::mpsc::channel(32);
    spawn_nearby_send_progress_listener(
        app.clone(),
        transfers.inner().clone(),
        transfer_id.clone(),
        receiver_name.clone(),
        receiver_type.clone(),
        prepared.total_size,
        rx,
    );

    let send_result = sendme_lib::send_with_progress(args, tx)
        .await
        .map_err(|e| format!("Failed to prepare nearby transfer: {e}"))?;

    if let Some(cleanup_path) = prepared.cleanup_path {
        let _ = tokio::fs::remove_dir_all(cleanup_path).await;
    }

    let ticket = send_result.ticket.to_string();
    update_transfer_status(transfers.inner(), &transfer_id, "serving").await;
    update_transfer_ticket(transfers.inner(), &transfer_id, &ticket).await;

    write_nearby_message(
        &mut send,
        &sendme_lib::nearby::Message::BlobTicket { session_id, ticket },
    )
    .await?;

    emit_nearby_send_state(
        &app,
        NearbyTransferStatePayload {
            request_id: None,
            transfer_id: Some(transfer_id.clone()),
            state: "transferring".to_string(),
            device_name: Some(receiver_name),
            device_type: Some(receiver_type),
            message: Some("Receiver is downloading".to_string()),
            progress: Some(NearbyTransferProgressPayload {
                transferred: 0,
                total: prepared.total_size,
                speed: 0,
                eta: 0,
            }),
        },
    );

    Ok(transfer_id)
}

#[tauri::command]
async fn accept_incoming(
    nearby: tauri::State<'_, NearbyState>,
    request_id: String,
    output_dir: Option<String>,
) -> Result<(), String> {
    let decision_tx = {
        let guard = nearby.read().await;
        guard
            .pending_requests
            .get(&request_id)
            .map(|pending| pending.decision_tx.clone())
            .ok_or_else(|| "Incoming nearby request not found".to_string())?
    };

    decision_tx
        .send(NearbyDecision::Accept { output_dir })
        .await
        .map_err(|_| "Incoming nearby request is no longer active".to_string())
}

#[tauri::command]
async fn decline_incoming(
    nearby: tauri::State<'_, NearbyState>,
    request_id: String,
) -> Result<(), String> {
    let decision_tx = {
        let guard = nearby.read().await;
        guard
            .pending_requests
            .get(&request_id)
            .map(|pending| pending.decision_tx.clone())
            .ok_or_else(|| "Incoming nearby request not found".to_string())?
    };

    decision_tx
        .send(NearbyDecision::Decline {
            reason: Some("Declined".to_string()),
        })
        .await
        .map_err(|_| "Incoming nearby request is no longer active".to_string())
}
async fn ensure_nearby_runtime(app: &AppHandle, nearby: NearbyState) -> Result<(), String> {
    let (device_name, device_type) = current_nearby_profile(app)?;
    // Fast-path: check if already fully initialized (read lock only)
    {
        let guard = nearby.read().await;
        if guard.endpoint.is_some() && guard.discovery.is_some() {
            return Ok(());
        }
    }

    // --- Endpoint ---
    let endpoint_needs_init = {
        let guard = nearby.read().await;
        guard.endpoint.is_none()
    };

    if endpoint_needs_init {
        let secret_key = sendme_lib::get_or_create_secret(false)
            .map_err(|e| format!("Failed to create nearby secret: {e}"))?;
        let endpoint = Endpoint::builder(iroh::endpoint::presets::N0)
            .secret_key(secret_key)
            .relay_mode(RelayMode::Disabled)
            .alpns(vec![sendme_lib::nearby::ALPN.to_vec()])
            .bind()
            .await
            .map_err(|e| format!("Failed to bind nearby endpoint: {e}"))?;

        let mut guard = nearby.write().await;
        if guard.endpoint.is_none() {
            guard.endpoint = Some(endpoint.clone());
            guard.device_name = device_name.clone();
            guard.device_type = device_type.clone();
            if !guard.listener_started {
                spawn_nearby_listener(app.clone(), nearby.clone(), endpoint);
                guard.listener_started = true;
            }
        }
    }

    // --- Discovery ---
    let discovery_needs_init = {
        let guard = nearby.read().await;
        guard.discovery.is_none()
    };

    if discovery_needs_init {
        let endpoint = {
            let guard = nearby.read().await;
            guard
                .endpoint
                .clone()
                .ok_or_else(|| "Nearby endpoint is not initialized".to_string())?
        };
        let mut endpoint_addr = endpoint.addr();
        apply_options(&mut endpoint_addr, AddrInfoOptions::Addresses);

        let mut discovery = sendme_lib::NearbyDiscovery::new()
            .map_err(|e| format!("Failed to create nearby discovery: {e}"))?;
        let app_handle = app.clone();
        discovery
            .start_with_callback(
                &device_name,
                device_type.clone(),
                &endpoint_addr,
                Some(Arc::new(move |devices| {
                    emit_nearby_devices_updated(&app_handle, devices);
                })),
            )
            .map_err(|e| format!("Failed to start nearby discovery: {e}"))?;

        let mut guard = nearby.write().await;
        if guard.discovery.is_none() {
            guard.discovery = Some(discovery);
        }
    }

    Ok(())
}

fn current_nearby_profile(_app: &AppHandle) -> Result<(String, sendme_lib::DeviceType), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let device_type = sendme_lib::DeviceType::Phone;
    #[cfg(all(
        not(target_os = "android"),
        not(target_os = "ios"),
        target_os = "macos"
    ))]
    let device_type = sendme_lib::DeviceType::Laptop;
    #[cfg(all(
        not(target_os = "android"),
        not(target_os = "ios"),
        not(target_os = "macos")
    ))]
    let device_type = sendme_lib::DeviceType::Desktop;

    let mut device_name = match device_type {
        sendme_lib::DeviceType::Phone | sendme_lib::DeviceType::Tablet => {
            preferred_mobile_device_name()
        }
        _ => get_hostname().unwrap_or_else(|_| "Sendme".to_string()),
    };

    if device_name.trim().is_empty() || is_loopback_device_name(&device_name) {
        device_name = "Sendme".to_string();
    }

    Ok((device_name, device_type))
}

fn preferred_mobile_device_name() -> String {
    match get_device_model() {
        Ok(device_name)
            if !is_loopback_device_name(&device_name) && !device_name.trim().is_empty() =>
        {
            device_name
        }
        _ => "Mobile Device".to_string(),
    }
}

fn is_loopback_device_name(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "localhost" | "localhost.localdomain" | "127.0.0.1" | "::1"
    )
}

fn spawn_nearby_listener(app: AppHandle, nearby: NearbyState, endpoint: Endpoint) {
    tokio::spawn(async move {
        loop {
            match endpoint.accept().await {
                Some(incoming) => {
                    let app = app.clone();
                    let nearby = nearby.clone();
                    tokio::spawn(async move {
                        if let Err(error) = handle_nearby_incoming(app, nearby, incoming).await {
                            log_error!("Nearby incoming connection failed: {}", error);
                        }
                    });
                }
                None => break,
            }
        }
    });
}

async fn handle_nearby_incoming(
    app: AppHandle,
    nearby: NearbyState,
    incoming: Incoming,
) -> Result<(), String> {
    let connecting = incoming
        .accept()
        .map_err(|e| format!("Failed to accept nearby connection: {e}"))?;
    let conn = connecting
        .await
        .map_err(|e| format!("Failed to establish nearby connection: {e}"))?;
    let (mut send, mut recv) = conn
        .accept_bi()
        .await
        .map_err(|e| format!("Failed to accept nearby bi-stream: {e}"))?;

    let sender_hello = read_nearby_message(&mut recv).await?;
    let (sender_name, sender_device_type) = match sender_hello {
        sendme_lib::nearby::Message::Hello {
            device_name,
            device_type,
            ..
        } => (device_name, device_type),
        _ => return Err("Expected nearby hello message".to_string()),
    };

    let (device_name, device_type) = current_nearby_profile(&app)?;
    let endpoint_id = {
        let guard = nearby.read().await;
        guard
            .endpoint
            .as_ref()
            .ok_or_else(|| "Nearby endpoint unavailable".to_string())?
            .addr()
            .id
            .to_string()
    };
    write_nearby_message(
        &mut send,
        &sendme_lib::nearby::Message::Hello {
            device_name,
            device_type: device_type.as_str().to_string(),
            endpoint_id,
        },
    )
    .await?;

    let offer = read_nearby_message(&mut recv).await?;
    let (files, total_size) = match offer {
        sendme_lib::nearby::Message::Offer { files, total_size } => (files, total_size),
        sendme_lib::nearby::Message::Cancel { .. } => return Ok(()),
        _ => return Err("Expected nearby offer message".to_string()),
    };

    let request_id = Uuid::new_v4().to_string();
    let (decision_tx, mut decision_rx) = mpsc::channel(1);
    {
        let mut guard = nearby.write().await;
        guard
            .pending_requests
            .insert(request_id.clone(), NearbyPendingRequest { decision_tx });
    }

    let request_payload = NearbyIncomingRequestPayload {
        id: request_id.clone(),
        sender_name: sender_name.clone(),
        sender_device_type: sender_device_type.clone(),
        files: files
            .iter()
            .map(|file| NearbyIncomingFile {
                name: file.path.clone(),
                size: file.size,
            })
            .collect(),
        total_size,
    };
    let _ = app.emit("incoming_nearby_request", request_payload);

    let decision = tokio::time::timeout(Duration::from_secs(300), decision_rx.recv())
        .await
        .ok()
        .flatten()
        .unwrap_or(NearbyDecision::Decline {
            reason: Some("Timed out waiting for approval".to_string()),
        });

    {
        let mut guard = nearby.write().await;
        guard.pending_requests.remove(&request_id);
    }

    match decision {
        NearbyDecision::Accept { output_dir } => {
            write_nearby_message(
                &mut send,
                &sendme_lib::nearby::Message::Accept {
                    session_id: request_id.clone(),
                },
            )
            .await?;

            let next_message = read_nearby_message(&mut recv).await?;
            match next_message {
                sendme_lib::nearby::Message::BlobTicket { ticket, .. } => {
                    start_nearby_receive(
                        app.clone(),
                        request_id,
                        sender_name,
                        sender_device_type,
                        ticket,
                        output_dir,
                    )
                    .await?;
                }
                sendme_lib::nearby::Message::Cancel { .. } => {
                    let _ = app.emit(
                        "nearby_request_cancelled",
                        serde_json::json!({ "requestId": request_id }),
                    );
                }
                _ => {
                    return Err("Sender did not provide a blob ticket".to_string());
                }
            }
        }
        NearbyDecision::Decline { reason } => {
            write_nearby_message(
                &mut send,
                &sendme_lib::nearby::Message::Decline {
                    session_id: request_id.clone(),
                    reason: reason.clone(),
                },
            )
            .await?;
            let _ = app.emit(
                "nearby_request_declined",
                serde_json::json!({ "requestId": request_id }),
            );
        }
    }

    Ok(())
}

async fn start_nearby_receive(
    app: AppHandle,
    request_id: String,
    sender_name: String,
    sender_device_type: String,
    ticket: String,
    output_dir: Option<String>,
) -> Result<(), String> {
    let transfer_id = Uuid::new_v4().to_string();
    let transfers = app.state::<Transfers>().inner().clone();
    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("Failed to get temp directory: {e}"))?;
    #[cfg(target_os = "android")]
    let content_uri_output = output_dir
        .as_ref()
        .filter(|dir| dir.starts_with("content://"))
        .cloned();
    let export_dir = resolve_nearby_output_dir(&app, output_dir)?;
    let export_root = export_dir.clone().unwrap_or_else(|| temp_dir.clone());
    let ticket: sendme_lib::BlobTicket = ticket
        .parse()
        .map_err(|e| format!("Invalid nearby transfer ticket: {e}"))?;

    {
        let mut guard = transfers.write().await;
        guard.insert(
            transfer_id.clone(),
            TransferState {
                info: TransferInfo {
                    id: transfer_id.clone(),
                    transfer_type: "nearby-receive".to_string(),
                    path: sender_name.clone(),
                    status: "connecting".to_string(),
                    created_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs() as i64,
                    ticket: Some(ticket.to_string()),
                },
                abort_tx: None,
            },
        );
    }
    set_android_active_receive(
        &app,
        Some(AndroidForegroundTransfer {
            title: format!("Receiving from {}", sender_name),
            message: "Preparing nearby transfer".to_string(),
            detail: "Waiting for transfer data.".to_string(),
            progress_current: 0,
            progress_total: 0,
            indeterminate: true,
        }),
    )
    .await;

    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    let app_clone = app.clone();
    let transfers_clone = transfers.clone();
    let transfer_id_clone = transfer_id.clone();
    let request_id_for_progress = request_id.clone();
    let sender_name_for_progress = sender_name.clone();
    let sender_type_for_progress = sender_device_type.clone();
    tokio::spawn(async move {
        let started = Instant::now();
        const NEARBY_PROGRESS_TIMEOUT: Duration = Duration::from_secs(120);
        loop {
            let event = match tokio::time::timeout(NEARBY_PROGRESS_TIMEOUT, rx.recv()).await {
                Ok(Some(e)) => e,
                Ok(None) => break,
                Err(_) => {
                    log_warn!("[Nearby Receive] No progress events for 120s, exiting listener");
                    break;
                }
            };
            match event {
                ProgressEvent::Download(DownloadProgress::Downloading { offset, total }) => {
                    let progress = nearby_progress_from_offset(offset, total, started);
                    update_transfer_status(&transfers_clone, &transfer_id_clone, "downloading")
                        .await;
                    emit_nearby_receive_state(
                        &app_clone,
                        NearbyTransferStatePayload {
                            request_id: Some(request_id_for_progress.clone()),
                            transfer_id: Some(transfer_id_clone.clone()),
                            state: "receiving".to_string(),
                            device_name: Some(sender_name_for_progress.clone()),
                            device_type: Some(sender_type_for_progress.clone()),
                            message: Some("Receiving nearby transfer".to_string()),
                            progress: Some(progress),
                        },
                    );
                    let (progress_current, progress_total, indeterminate) = if total > 0 {
                        let current = ((offset as f64 / total as f64) * 1000.0).round() as u32;
                        (current.min(1000), 1000, false)
                    } else {
                        (0, 0, true)
                    };
                    set_android_active_receive(
                        &app_clone,
                        Some(AndroidForegroundTransfer {
                            title: format!("Receiving from {}", sender_name_for_progress),
                            message: if total > 0 {
                                format!("{:.0}% received", (offset as f64 / total as f64) * 100.0)
                            } else {
                                "Receiving nearby transfer".to_string()
                            },
                            detail: format!("{offset} / {total} bytes"),
                            progress_current,
                            progress_total,
                            indeterminate,
                        }),
                    )
                    .await;
                }
                ProgressEvent::Download(DownloadProgress::Completed) => {
                    update_transfer_status(&transfers_clone, &transfer_id_clone, "completed").await;
                    emit_nearby_receive_state(
                        &app_clone,
                        NearbyTransferStatePayload {
                            request_id: Some(request_id_for_progress.clone()),
                            transfer_id: Some(transfer_id_clone.clone()),
                            state: "done".to_string(),
                            device_name: Some(sender_name_for_progress.clone()),
                            device_type: Some(sender_type_for_progress.clone()),
                            message: Some("Nearby transfer complete".to_string()),
                            progress: None,
                        },
                    );
                    set_android_active_receive(&app_clone, None).await;
                }
                _ => {}
            }
        }
    });

    let app_clone = app.clone();
    let transfers_clone = transfers.clone();
    let export_root_for_receive = export_root.clone();
    #[cfg(target_os = "android")]
    let temp_dir_for_receive = temp_dir.clone();
    tokio::spawn(async move {
        let args = ReceiveArgs {
            ticket,
            common: CommonConfig {
                temp_dir: Some(temp_dir),
                ..Default::default()
            },
            export_dir,
        };

        match sendme_lib::receive_with_progress(args, tx).await {
            Ok(result) => {
                #[cfg(target_os = "android")]
                if content_uri_output.is_none() {
                    if let Err(error) = flatten_nearby_stage_dir(&export_root_for_receive) {
                        update_transfer_status(
                            &transfers_clone,
                            &transfer_id,
                            &format!("error: {error}"),
                        )
                        .await;
                        emit_nearby_receive_state(
                            &app_clone,
                            NearbyTransferStatePayload {
                                request_id: Some(request_id.clone()),
                                transfer_id: Some(transfer_id.clone()),
                                state: "error".to_string(),
                                device_name: Some(sender_name.clone()),
                                device_type: Some(sender_device_type.clone()),
                                message: Some(error),
                                progress: None,
                            },
                        );
                        set_android_active_receive(&app_clone, None).await;
                        return;
                    }
                }

                #[cfg(not(target_os = "android"))]
                if let Err(error) = flatten_nearby_stage_dir(&export_root_for_receive) {
                    update_transfer_status(
                        &transfers_clone,
                        &transfer_id,
                        &format!("error: {error}"),
                    )
                    .await;
                    emit_nearby_receive_state(
                        &app_clone,
                        NearbyTransferStatePayload {
                            request_id: Some(request_id.clone()),
                            transfer_id: Some(transfer_id.clone()),
                            state: "error".to_string(),
                            device_name: Some(sender_name.clone()),
                            device_type: Some(sender_device_type.clone()),
                            message: Some(error),
                            progress: None,
                        },
                    );
                    set_android_active_receive(&app_clone, None).await;
                    return;
                }

                #[cfg(target_os = "android")]
                if let Some(content_uri) = content_uri_output {
                    if let Err(error) = copy_files_to_content_uri(
                        &app_clone,
                        &temp_dir_for_receive,
                        &content_uri,
                        &result.collection,
                    )
                    .await
                    {
                        update_transfer_status(
                            &transfers_clone,
                            &transfer_id,
                            &format!("error: {error}"),
                        )
                        .await;
                        emit_nearby_receive_state(
                            &app_clone,
                            NearbyTransferStatePayload {
                                request_id: Some(request_id),
                                transfer_id: Some(transfer_id),
                                state: "error".to_string(),
                                device_name: Some(sender_name),
                                device_type: Some(sender_device_type),
                                message: Some(error.to_string()),
                                progress: None,
                            },
                        );
                        set_android_active_receive(&app_clone, None).await;
                    }
                }

                #[cfg(not(target_os = "android"))]
                let _ = result;
            }
            Err(error) => {
                update_transfer_status(&transfers_clone, &transfer_id, &format!("error: {error}"))
                    .await;
                emit_nearby_receive_state(
                    &app_clone,
                    NearbyTransferStatePayload {
                        request_id: Some(request_id),
                        transfer_id: Some(transfer_id),
                        state: "error".to_string(),
                        device_name: Some(sender_name),
                        device_type: Some(sender_device_type),
                        message: Some(error.to_string()),
                        progress: None,
                    },
                );
                set_android_active_receive(&app_clone, None).await;
            }
        }
    });

    Ok(())
}

fn resolve_nearby_output_dir(
    app: &AppHandle,
    output_dir: Option<String>,
) -> Result<Option<PathBuf>, String> {
    if let Some(output_dir) = output_dir {
        if output_dir.starts_with("content://") {
            return Ok(None);
        }
        return Ok(Some(PathBuf::from(output_dir)));
    }

    match app.path().download_dir() {
        Ok(path) => Ok(Some(path)),
        Err(_) => Ok(Some(app.path().temp_dir().map_err(|e| {
            format!("Failed to get fallback temp directory: {e}")
        })?)),
    }
}

fn emit_nearby_send_state(app: &AppHandle, payload: NearbyTransferStatePayload) {
    let _ = app.emit("nearby_send_state", payload);
}

fn emit_nearby_receive_state(app: &AppHandle, payload: NearbyTransferStatePayload) {
    let _ = app.emit("nearby_receive_state", payload);
}

fn emit_nearby_devices_updated(app: &AppHandle, devices: Vec<sendme_lib::NearbyDevice>) {
    let _ = app.emit("nearby_devices_updated", devices);
}

fn emit_cloud_presence_state(app: &AppHandle, payload: CloudPresenceSnapshotPayload) {
    let _ = app.emit("cloud_presence_state", payload);
}

fn normalize_cloud_presence_request(
    request: StartCloudPresenceRequest,
) -> Result<StartCloudPresenceRequest, String> {
    let device_id = request.device_id.trim().to_string();
    let api_origin = request.api_origin.trim().trim_end_matches('/').to_string();

    if device_id.is_empty() {
        return Err("Device ID is required".to_string());
    }

    if api_origin.is_empty() {
        return Err("API origin is required".to_string());
    }

    Ok(StartCloudPresenceRequest {
        device_id,
        api_origin,
    })
}

fn extract_bearer_token(header: &str) -> Option<&str> {
    let mut parts = header.split_whitespace();
    let scheme = parts.next()?;
    let token = parts.next()?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    Some(token)
}

fn current_cloud_authorization_header(app: &AppHandle) -> Result<String, String> {
    app.clerk()
        .get_client_authorization_header()
        .ok_or_else(|| "Cloud presence is not authenticated".to_string())
}

fn cloud_user_agent() -> &'static str {
    #[cfg(target_os = "android")]
    {
        "Sendme Android"
    }
    #[cfg(target_os = "ios")]
    {
        "Sendme iPhone"
    }
    #[cfg(target_os = "macos")]
    {
        "Sendme macOS"
    }
    #[cfg(target_os = "windows")]
    {
        "Sendme Windows"
    }
    #[cfg(all(
        not(target_os = "android"),
        not(target_os = "ios"),
        not(target_os = "macos"),
        not(target_os = "windows")
    ))]
    {
        "Sendme Linux"
    }
}

fn build_cloud_api_url(api_origin: &str, path: &str) -> Result<String, String> {
    let base = format!("{}/", api_origin.trim_end_matches('/'));
    let base_url = Url::parse(&base).map_err(|e| format!("Invalid cloud API origin: {e}"))?;
    base_url
        .join(path.trim_start_matches('/'))
        .map(|url| url.to_string())
        .map_err(|e| format!("Invalid cloud API path: {e}"))
}

fn build_cloud_websocket_url(
    api_origin: &str,
    device_id: &str,
    token: &str,
) -> Result<Url, String> {
    let mut url = Url::parse(&format!("{}/", api_origin.trim_end_matches('/')))
        .map_err(|e| format!("Invalid cloud API origin: {e}"))?;
    match url.scheme() {
        "http" => {
            url.set_scheme("ws")
                .map_err(|_| "Failed to convert http origin to ws".to_string())?;
        }
        "https" => {
            url.set_scheme("wss")
                .map_err(|_| "Failed to convert https origin to wss".to_string())?;
        }
        "ws" | "wss" => {}
        other => {
            return Err(format!("Unsupported cloud API origin scheme: {other}"));
        }
    }
    url.set_path("api/ws");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("deviceId", device_id);
        query.append_pair("token", token);
    }
    Ok(url)
}

async fn update_cloud_connection_state(
    app: &AppHandle,
    cloud: &CloudPresenceState,
    generation: u64,
    connected: bool,
    last_error: Option<String>,
) {
    let snapshot = {
        let mut guard = cloud.write().await;
        if guard.generation != generation {
            return;
        }
        guard.snapshot.connected = connected;
        guard.snapshot.last_error = last_error;
        guard.snapshot.clone()
    };

    emit_cloud_presence_state(app, snapshot);
    refresh_android_foreground_notification(app).await;
}

async fn update_cloud_friends(
    app: &AppHandle,
    cloud: &CloudPresenceState,
    generation: u64,
    friends: Vec<CloudFriendPayload>,
) {
    let snapshot = {
        let mut guard = cloud.write().await;
        if guard.generation != generation {
            return;
        }
        guard.snapshot.friends = friends.clone();
        guard.snapshot.last_error = None;
        guard.snapshot.clone()
    };

    let _ = app.emit("cloud_friends_updated", friends);
    emit_cloud_presence_state(app, snapshot);
    refresh_android_foreground_notification(app).await;
}

async fn update_cloud_devices(
    app: &AppHandle,
    cloud: &CloudPresenceState,
    generation: u64,
    devices: Vec<CloudDevicePayload>,
) {
    let snapshot = {
        let mut guard = cloud.write().await;
        if guard.generation != generation {
            return;
        }
        guard.snapshot.devices = devices.clone();
        guard.snapshot.last_error = None;
        guard.snapshot.clone()
    };

    let _ = app.emit("cloud_devices_updated", devices);
    emit_cloud_presence_state(app, snapshot);
    refresh_android_foreground_notification(app).await;
}

async fn update_cloud_tickets(
    app: &AppHandle,
    cloud: &CloudPresenceState,
    generation: u64,
    tickets: Vec<CloudTicketPayload>,
) {
    let snapshot = {
        let mut guard = cloud.write().await;
        if guard.generation != generation {
            return;
        }
        guard.snapshot.tickets = tickets.clone();
        guard.snapshot.last_error = None;
        guard.snapshot.clone()
    };

    let _ = app.emit("cloud_tickets_updated", tickets);
    emit_cloud_presence_state(app, snapshot);
    refresh_android_foreground_notification(app).await;
}

async fn update_cloud_server_error(
    app: &AppHandle,
    cloud: &CloudPresenceState,
    generation: u64,
    message: String,
) {
    let snapshot = {
        let mut guard = cloud.write().await;
        if guard.generation != generation {
            return;
        }
        guard.snapshot.last_error = Some(message.clone());
        guard.snapshot.clone()
    };

    let _ = app.emit("cloud_presence_error", message);
    emit_cloud_presence_state(app, snapshot);
    refresh_android_foreground_notification(app).await;
}

async fn wait_for_shutdown_or_timeout(
    shutdown_rx: &mut oneshot::Receiver<()>,
    delay: Duration,
) -> bool {
    tokio::select! {
        _ = shutdown_rx => true,
        _ = tokio::time::sleep(delay) => false,
    }
}

async fn ensure_cloud_device_registered(
    app: &AppHandle,
    client: &Client,
    request: &StartCloudPresenceRequest,
    token: &str,
    registered_key: &mut Option<String>,
    registered_at: &mut Option<Instant>,
) -> Result<(), String> {
    let registration_key = format!("{token}:{}", request.device_id);
    let registration_fresh = registered_key.as_deref() == Some(registration_key.as_str())
        && registered_at
            .as_ref()
            .is_some_and(|instant| instant.elapsed() < Duration::from_secs(60));
    if registration_fresh {
        return Ok(());
    }

    let (device_name, _) = current_nearby_profile(app)?;
    let url = build_cloud_api_url(&request.api_origin, "/api/devices")?;
    let response = client
        .post(url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .json(&serde_json::json!({
            "deviceId": request.device_id,
            "name": device_name,
            "hostname": device_name,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to register cloud device: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to register device".to_string());
        return Err(format!(
            "Failed to register cloud device ({status}): {body}"
        ));
    }

    *registered_key = Some(registration_key);
    *registered_at = Some(Instant::now());
    Ok(())
}

async fn handle_cloud_server_message(
    app: &AppHandle,
    cloud: &CloudPresenceState,
    generation: u64,
    message: Message,
) -> Result<(), String> {
    let payload = match message {
        Message::Text(text) => text.to_string(),
        Message::Binary(bytes) => String::from_utf8(bytes.to_vec())
            .map_err(|e| format!("Invalid binary cloud presence message: {e}"))?,
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => return Ok(()),
        Message::Close(frame) => {
            let reason = frame
                .map(|value| value.reason.to_string())
                .unwrap_or_else(|| "Cloud presence websocket closed".to_string());
            return Err(reason);
        }
    };

    let message: CloudServerMessage = serde_json::from_str(&payload)
        .map_err(|e| format!("Failed to parse cloud presence message: {e}"))?;

    match message {
        CloudServerMessage::Friends(friends) => {
            update_cloud_friends(app, cloud, generation, friends).await;
        }
        CloudServerMessage::Devices(devices) => {
            update_cloud_devices(app, cloud, generation, devices).await;
        }
        CloudServerMessage::Tickets(tickets) => {
            update_cloud_tickets(app, cloud, generation, tickets).await;
        }
        CloudServerMessage::Error(message) => {
            update_cloud_server_error(app, cloud, generation, message).await;
        }
        CloudServerMessage::Pong => {}
        CloudServerMessage::TransferReceived(payload) => {
            let _ = app.emit("cloud_transfer_received", payload);
        }
    }

    Ok(())
}

async fn run_cloud_presence_loop(
    app: AppHandle,
    cloud: CloudPresenceState,
    generation: u64,
    request: StartCloudPresenceRequest,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    let client = match Client::builder().user_agent(cloud_user_agent()).build() {
        Ok(client) => client,
        Err(error) => {
            update_cloud_connection_state(
                &app,
                &cloud,
                generation,
                false,
                Some(format!("Failed to initialize cloud client: {error}")),
            )
            .await;
            return;
        }
    };

    let mut reconnect_attempt = 0u32;
    let mut registered_key: Option<String> = None;
    let mut registered_at: Option<Instant> = None;

    'outer: loop {
        let authorization = match current_cloud_authorization_header(&app) {
            Ok(value) => value,
            Err(error) => {
                update_cloud_connection_state(&app, &cloud, generation, false, Some(error)).await;
                if wait_for_shutdown_or_timeout(&mut shutdown_rx, Duration::from_secs(3)).await {
                    break;
                }
                continue;
            }
        };

        let token = match extract_bearer_token(&authorization) {
            Some(token) => token.to_string(),
            None => {
                update_cloud_connection_state(
                    &app,
                    &cloud,
                    generation,
                    false,
                    Some("Cloud presence authorization is missing a bearer token".to_string()),
                )
                .await;
                if wait_for_shutdown_or_timeout(&mut shutdown_rx, Duration::from_secs(3)).await {
                    break;
                }
                continue;
            }
        };

        if let Err(error) = ensure_cloud_device_registered(
            &app,
            &client,
            &request,
            &token,
            &mut registered_key,
            &mut registered_at,
        )
        .await
        {
            update_cloud_connection_state(&app, &cloud, generation, false, Some(error)).await;
            if wait_for_shutdown_or_timeout(&mut shutdown_rx, Duration::from_secs(3)).await {
                break;
            }
            continue;
        }

        let ws_url =
            match build_cloud_websocket_url(&request.api_origin, &request.device_id, &token) {
                Ok(url) => url,
                Err(error) => {
                    update_cloud_connection_state(&app, &cloud, generation, false, Some(error))
                        .await;
                    break;
                }
            };

        match connect_async(ws_url.as_str()).await {
            Ok((stream, _)) => {
                reconnect_attempt = 0;
                update_cloud_connection_state(&app, &cloud, generation, true, None).await;

                let (mut writer, mut reader) = stream.split();
                let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
                heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

                loop {
                    tokio::select! {
                        _ = &mut shutdown_rx => {
                            break 'outer;
                        }
                        _ = heartbeat.tick() => {
                            if let Err(error) = writer.send(Message::Text("{\"type\":\"heartbeat\"}".into())).await {
                                update_cloud_connection_state(
                                    &app,
                                    &cloud,
                                    generation,
                                    false,
                                    Some(format!("Cloud presence heartbeat failed: {error}")),
                                ).await;
                                break;
                            }
                        }
                        message = reader.next() => {
                            match message {
                                Some(Ok(message)) => {
                                    if let Err(error) = handle_cloud_server_message(&app, &cloud, generation, message).await {
                                        update_cloud_connection_state(&app, &cloud, generation, false, Some(error)).await;
                                        break;
                                    }
                                }
                                Some(Err(error)) => {
                                    update_cloud_connection_state(
                                        &app,
                                        &cloud,
                                        generation,
                                        false,
                                        Some(format!("Cloud presence websocket failed: {error}")),
                                    ).await;
                                    break;
                                }
                                None => {
                                    update_cloud_connection_state(
                                        &app,
                                        &cloud,
                                        generation,
                                        false,
                                        Some("Cloud presence websocket closed".to_string()),
                                    ).await;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            Err(error) => {
                update_cloud_connection_state(
                    &app,
                    &cloud,
                    generation,
                    false,
                    Some(format!(
                        "Failed to connect cloud presence websocket: {error}"
                    )),
                )
                .await;
            }
        }

        let delay_ms = (1_000u64 * (1u64 << reconnect_attempt.min(5))).min(30_000);
        reconnect_attempt = reconnect_attempt.saturating_add(1);
        if wait_for_shutdown_or_timeout(&mut shutdown_rx, Duration::from_millis(delay_ms)).await {
            break;
        }
    }

    let snapshot = {
        let mut guard = cloud.write().await;
        if guard.generation != generation {
            return;
        }
        guard.shutdown_tx = None;
        guard.snapshot.connected = false;
        guard.snapshot.clone()
    };
    emit_cloud_presence_state(&app, snapshot);
    refresh_android_foreground_notification(&app).await;
}

async fn set_android_active_receive(
    app: &AppHandle,
    active_receive: Option<AndroidForegroundTransfer>,
) {
    let state = app.state::<AndroidForegroundState>().inner().clone();
    {
        let mut guard = state.write().await;
        guard.active_receive = active_receive;
    }
    refresh_android_foreground_notification(app).await;
}

#[cfg(target_os = "android")]
fn build_android_foreground_notification_payload(
    snapshot: &CloudPresenceSnapshotPayload,
    active_receive: Option<&AndroidForegroundTransfer>,
) -> Option<AndroidForegroundNotificationPayload> {
    if let Some(active_receive) = active_receive {
        return Some(AndroidForegroundNotificationPayload {
            title: active_receive.title.clone(),
            message: active_receive.message.clone(),
            detail: active_receive.detail.clone(),
            progress_current: active_receive.progress_current,
            progress_total: active_receive.progress_total,
            indeterminate: active_receive.indeterminate,
        });
    }

    if !snapshot.active {
        return None;
    }

    let title = if snapshot.connected {
        "Sendme background sync".to_string()
    } else {
        "Sendme reconnecting".to_string()
    };
    let message = format!(
        "{} pending ticket{} · {} friend update{}",
        snapshot.tickets.len(),
        if snapshot.tickets.len() == 1 { "" } else { "s" },
        snapshot.friends.len(),
        if snapshot.friends.len() == 1 { "" } else { "s" },
    );
    let detail = if snapshot.connected {
        "Listening for tickets and friend presence updates.".to_string()
    } else {
        snapshot
            .last_error
            .clone()
            .unwrap_or_else(|| "Reconnecting to the Sendme cloud.".to_string())
    };

    Some(AndroidForegroundNotificationPayload {
        title,
        message,
        detail,
        progress_current: 0,
        progress_total: 0,
        indeterminate: !snapshot.connected,
    })
}

#[cfg(target_os = "android")]
async fn refresh_android_foreground_notification(app: &AppHandle) {
    let cloud = app.state::<CloudPresenceState>().inner().clone();
    let android_state = app.state::<AndroidForegroundState>().inner().clone();
    let snapshot = cloud.read().await.snapshot.clone();
    let active_receive = android_state.read().await.active_receive.clone();
    let payload = build_android_foreground_notification_payload(&snapshot, active_receive.as_ref());

    match payload {
        Some(payload) => match serde_json::to_string(&payload) {
            Ok(payload_json) => {
                if let Err(error) = android::upsert_background_service(&payload_json) {
                    log_warn!("Failed to update Android foreground service: {}", error);
                }
            }
            Err(error) => {
                log_warn!(
                    "Failed to serialize Android foreground service payload: {}",
                    error
                );
            }
        },
        None => {
            if let Err(error) = android::stop_background_service() {
                log_warn!("Failed to stop Android foreground service: {}", error);
            }
        }
    }
}

#[cfg(not(target_os = "android"))]
async fn refresh_android_foreground_notification(_app: &AppHandle) {}

fn transfer_label_for_notification(transfer_type: &str, path: Option<&str>) -> String {
    match transfer_type {
        "nearby-receive" => {
            if let Some(path) = path.filter(|value| !value.is_empty()) {
                format!("Receiving from {path}")
            } else {
                "Receiving nearby transfer".to_string()
            }
        }
        _ => "Receiving transfer".to_string(),
    }
}

async fn update_android_receive_progress_from_update(
    app: &AppHandle,
    transfer_type: &str,
    path: Option<&str>,
    update: &ProgressUpdate,
) {
    let progress = update
        .data
        .get("progress")
        .and_then(|value| value.as_object())
        .cloned();

    let Some(progress) = progress else {
        return;
    };

    let progress_type = progress
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    match progress_type {
        "completed" => {
            set_android_active_receive(app, None).await;
        }
        "downloading" => {
            let offset = progress
                .get("offset")
                .and_then(|value| value.as_u64())
                .unwrap_or_default();
            let total = progress
                .get("total")
                .and_then(|value| value.as_u64())
                .unwrap_or_default();
            let (progress_current, progress_total, indeterminate) = if total > 0 {
                let current = ((offset as f64 / total as f64) * 1000.0).round() as u32;
                (current.min(1000), 1000, false)
            } else {
                (0, 0, true)
            };
            let percent = if total > 0 {
                format!("{:.0}% received", (offset as f64 / total as f64) * 100.0)
            } else {
                "Receiving data".to_string()
            };
            let detail = if total > 0 {
                format!("{offset} / {total} bytes")
            } else {
                "Waiting for size information".to_string()
            };
            set_android_active_receive(
                app,
                Some(AndroidForegroundTransfer {
                    title: transfer_label_for_notification(transfer_type, path),
                    message: percent,
                    detail,
                    progress_current,
                    progress_total,
                    indeterminate,
                }),
            )
            .await;
        }
        "connecting" | "getting_sizes" | "metadata" => {
            set_android_active_receive(
                app,
                Some(AndroidForegroundTransfer {
                    title: transfer_label_for_notification(transfer_type, path),
                    message: "Preparing incoming transfer".to_string(),
                    detail: "Setting up the receive session.".to_string(),
                    progress_current: 0,
                    progress_total: 0,
                    indeterminate: true,
                }),
            )
            .await;
        }
        _ => {}
    }
}

#[cfg(target_os = "android")]
fn strip_nearby_staging_prefix(path: &str) -> &str {
    let mut parts = path.splitn(2, '/');
    let first = parts.next().unwrap_or(path);
    if first.starts_with("sendme-nearby-stage-") {
        parts.next().unwrap_or(path)
    } else {
        path
    }
}

fn flatten_nearby_stage_dir(root: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(root)
        .map_err(|e| {
            format!(
                "Failed to read nearby export directory {}: {e}",
                root.display()
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            format!(
                "Failed to inspect nearby export directory {}: {e}",
                root.display()
            )
        })?;

    if entries.len() != 1 {
        return Ok(());
    }

    let staged_root = entries[0].path();
    let staged_name = staged_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !staged_root.is_dir() || !staged_name.starts_with("sendme-nearby-stage-") {
        return Ok(());
    }

    for entry in std::fs::read_dir(&staged_root).map_err(|e| {
        format!(
            "Failed to read staged nearby directory {}: {e}",
            staged_root.display()
        )
    })? {
        let entry = entry.map_err(|e| e.to_string())?;
        let child_path = entry.path();
        let child_name = entry.file_name();
        let destination = root.join(&child_name);
        if destination.exists() {
            let fallback_name = child_name.to_str().unwrap_or("item");
            copy_path_recursive(&child_path, &unique_child_path(root, fallback_name))?;
        } else {
            if let Err(rename_error) = std::fs::rename(&child_path, &destination) {
                copy_path_recursive(&child_path, &destination).map_err(|copy_error| {
                    format!(
                        "Failed to flatten nearby export item {}: {rename_error}; fallback copy failed: {copy_error}",
                        child_path.display()
                    )
                })?;
                if child_path.is_dir() {
                    std::fs::remove_dir_all(&child_path).map_err(|e| {
                        format!(
                            "Failed to remove staged nearby directory {} after copy: {e}",
                            child_path.display()
                        )
                    })?;
                } else {
                    std::fs::remove_file(&child_path).map_err(|e| {
                        format!(
                            "Failed to remove staged nearby file {} after copy: {e}",
                            child_path.display()
                        )
                    })?;
                }
            }
        }
    }

    std::fs::remove_dir_all(&staged_root).map_err(|e| {
        format!(
            "Failed to remove staged nearby directory {}: {e}",
            staged_root.display()
        )
    })?;

    Ok(())
}

fn nearby_progress_from_offset(
    transferred: u64,
    total: u64,
    started: Instant,
) -> NearbyTransferProgressPayload {
    let elapsed = started.elapsed().as_secs_f64().max(1.0);
    let speed = (transferred as f64 / elapsed) as u64;
    let remaining = total.saturating_sub(transferred);
    let eta = if speed == 0 {
        0
    } else {
        remaining / speed.max(1)
    };
    NearbyTransferProgressPayload {
        transferred,
        total,
        speed,
        eta,
    }
}

fn spawn_nearby_send_progress_listener(
    app: AppHandle,
    transfers: Transfers,
    transfer_id: String,
    receiver_name: String,
    receiver_type: String,
    total_size: u64,
    mut rx: tokio::sync::mpsc::Receiver<ProgressEvent>,
) {
    tokio::spawn(async move {
        let started = Instant::now();
        const NEARBY_PROGRESS_TIMEOUT: Duration = Duration::from_secs(120);
        loop {
            let event = match tokio::time::timeout(NEARBY_PROGRESS_TIMEOUT, rx.recv()).await {
                Ok(Some(e)) => e,
                Ok(None) => break,
                Err(_) => {
                    log_warn!("[Nearby Send] No progress events for 120s, exiting listener");
                    break;
                }
            };
            match event {
                ProgressEvent::Connection(ConnectionStatus::RequestProgress { offset, .. }) => {
                    update_transfer_status(&transfers, &transfer_id, "sending").await;
                    emit_nearby_send_state(
                        &app,
                        NearbyTransferStatePayload {
                            request_id: None,
                            transfer_id: Some(transfer_id.clone()),
                            state: "transferring".to_string(),
                            device_name: Some(receiver_name.clone()),
                            device_type: Some(receiver_type.clone()),
                            message: Some("Sending nearby transfer".to_string()),
                            progress: Some(nearby_progress_from_offset(
                                offset, total_size, started,
                            )),
                        },
                    );
                }
                ProgressEvent::Connection(ConnectionStatus::RequestCompleted { .. }) => {
                    update_transfer_status(&transfers, &transfer_id, "completed").await;
                    emit_nearby_send_state(
                        &app,
                        NearbyTransferStatePayload {
                            request_id: None,
                            transfer_id: Some(transfer_id.clone()),
                            state: "done".to_string(),
                            device_name: Some(receiver_name.clone()),
                            device_type: Some(receiver_type.clone()),
                            message: Some("Nearby transfer complete".to_string()),
                            progress: Some(nearby_progress_from_offset(
                                total_size, total_size, started,
                            )),
                        },
                    );
                }
                _ => {}
            }
        }
    });
}

async fn prepare_nearby_source(
    app: &AppHandle,
    file_items: &[NearbySendItemRequest],
) -> Result<PreparedNearbySource, String> {
    if file_items.is_empty() {
        return Err("Select at least one file to send".to_string());
    }

    let staging_root = app
        .path()
        .temp_dir()
        .map_err(|e| format!("Failed to get temp directory: {e}"))?
        .join(format!("sendme-nearby-stage-{}", Uuid::new_v4()));
    tokio::fs::create_dir_all(&staging_root)
        .await
        .map_err(|e| format!("Failed to create nearby staging directory: {e}"))?;

    for item in file_items {
        let requested_name = item
            .filename
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("item");
        let (source, cleanup_temp_file) = if item.path.starts_with("content://") {
            let (resolved, display_name) =
                handle_content_uri(app, &item.path, requested_name).await?;
            let effective_name = if requested_name == "item" {
                display_name
            } else {
                requested_name.to_string()
            };
            ((resolved, effective_name), true)
        } else {
            // handle_content_uri also resolves file:// URLs (iOS document picker),
            // so delegate to it rather than using PathBuf::from directly.
            let (source_path, display_name) =
                handle_content_uri(app, &item.path, requested_name).await?;
            let effective_name = item
                .filename
                .clone()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or(display_name);
            ((source_path, effective_name), false)
        };
        let (source_path, file_name) = source;
        let destination = unique_child_path(&staging_root, &file_name);
        copy_path_recursive(&source_path, &destination)?;
        if cleanup_temp_file {
            let _ = tokio::fs::remove_file(&source_path).await;
        }
    }

    let manifest = build_manifest(&staging_root, None)?;
    let total_size = manifest.iter().map(|file| file.size).sum();
    Ok(PreparedNearbySource {
        send_path: staging_root.clone(),
        cleanup_path: Some(staging_root),
        display_name: if file_items.len() == 1 {
            file_items[0]
                .filename
                .clone()
                .or_else(|| {
                    Path::new(&file_items[0].path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(ToString::to_string)
                })
                .unwrap_or_else(|| "Selected item".to_string())
        } else {
            format!("{} items", file_items.len())
        },
        manifest,
        total_size,
    })
}

fn build_manifest(
    root: &Path,
    prefix: Option<&Path>,
) -> Result<Vec<sendme_lib::nearby::FileInfo>, String> {
    let metadata = std::fs::metadata(root)
        .map_err(|e| format!("Failed to read selected item {}: {e}", root.display()))?;

    if metadata.is_file() {
        let display_path = prefix
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(root.file_name().unwrap_or_default()));
        return Ok(vec![sendme_lib::nearby::FileInfo {
            path: display_path.to_string_lossy().to_string(),
            size: metadata.len(),
        }]);
    }

    let base = prefix
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(root.file_name().unwrap_or_default()));
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
    {
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|e| format!("Failed to build manifest path: {e}"))?;
        let logical_path = if base.as_os_str().is_empty() {
            relative.to_path_buf()
        } else {
            base.join(relative)
        };
        files.push(sendme_lib::nearby::FileInfo {
            path: logical_path.to_string_lossy().to_string(),
            size: entry.metadata().map_err(|e| e.to_string())?.len(),
        });
    }
    Ok(files)
}

fn unique_child_path(root: &Path, file_name: &str) -> PathBuf {
    let candidate = root.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 2..1000 {
        let name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = root.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    root.join(format!("{}-{}", Uuid::new_v4(), file_name))
}

fn copy_path_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_dir() {
        std::fs::create_dir_all(destination)
            .map_err(|e| format!("Failed to create directory {}: {e}", destination.display()))?;
        for entry in std::fs::read_dir(source)
            .map_err(|e| format!("Failed to read directory {}: {e}", source.display()))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let child_source = entry.path();
            let child_destination = destination.join(entry.file_name());
            copy_path_recursive(&child_source, &child_destination)?;
        }
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
    }
    std::fs::copy(source, destination)
        .map_err(|e| format!("Failed to stage file {}: {e}", source.display()))?;
    Ok(())
}

async fn write_nearby_message(
    send: &mut (impl AsyncWriteExt + Unpin),
    msg: &sendme_lib::nearby::Message,
) -> Result<(), String> {
    let data =
        serde_json::to_vec(msg).map_err(|e| format!("Failed to encode nearby message: {e}"))?;
    send.write_u32(data.len() as u32)
        .await
        .map_err(|e| format!("Failed to write nearby message size: {e}"))?;
    send.write_all(&data)
        .await
        .map_err(|e| format!("Failed to write nearby message: {e}"))?;
    send.flush()
        .await
        .map_err(|e| format!("Failed to flush nearby message: {e}"))?;
    Ok(())
}

async fn read_nearby_message(
    recv: &mut (impl AsyncReadExt + Unpin),
) -> Result<sendme_lib::nearby::Message, String> {
    const READ_TIMEOUT: Duration = Duration::from_secs(30);
    tokio::time::timeout(READ_TIMEOUT, async {
        let len = recv
            .read_u32()
            .await
            .map_err(|e| format!("Failed to read nearby message size: {e}"))?;
        let mut buf = vec![0u8; len as usize];
        recv.read_exact(&mut buf)
            .await
            .map_err(|e| format!("Failed to read nearby message body: {e}"))?;
        serde_json::from_slice(&buf).map_err(|e| format!("Failed to decode nearby message: {e}"))
    })
    .await
    .map_err(|_| "Nearby message read timed out (30s)".to_string())?
}

#[tauri::command]
fn app_ready(app: AppHandle) -> Result<(), String> {
    close_splashscreen(&app);

    Ok(())
}

#[cfg(desktop)]
fn close_splashscreen(app: &AppHandle) {
    if let Some(splashscreen) = app.get_webview_window("splashscreen") {
        let _ = splashscreen.close();
    }

    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
}

#[cfg(not(desktop))]
fn close_splashscreen(_app: &AppHandle) {}

#[cfg(all(target_os = "ios", feature = "ios-web-inspector"))]
fn enable_ios_web_inspector(app: &AppHandle) -> Result<(), String> {
    use objc2::runtime::AnyObject;

    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "Failed to find main webview window".to_string())?;

    main_window
        .with_webview(|webview| unsafe {
            let view: &AnyObject = &*webview.inner().cast();
            let selector = objc2::sel!(setInspectable:);
            let can_enable_inspector: bool = objc2::msg_send![view, respondsToSelector: selector];

            if can_enable_inspector {
                let _: () = objc2::msg_send![view, setInspectable: true];
                tracing::info!("Enabled iOS Safari web inspector");
            } else {
                tracing::warn!("WKWebView inspection is unavailable on this iOS version");
            }
        })
        .map_err(|e| format!("Failed to enable iOS web inspector: {e}"))?;

    Ok(())
}

/// Handle deep link callbacks for Clerk browser-based auth.
/// Skips handshake_client because it can return a 302 redirect that reqwest
/// follows into a system-browser OAuth page, causing a 30-second timeout.
async fn handle_clerk_auth_callback(app: AppHandle, url_str: String) {
    log_info!("Received Clerk auth deep link: {}", url_str);

    let parsed = match Url::parse(&url_str) {
        Ok(u) => u,
        Err(e) => {
            log_error!("Failed to parse deep link URL: {}", e);
            return;
        }
    };

    let mut db_jwt: Option<String> = None;
    for (k, v) in parsed.query_pairs() {
        if k == "__clerk_db_jwt" {
            db_jwt = Some(v.into_owned());
            break;
        }
    }

    let clerk = app.clerk();
    let fapi_client = clerk.get_fapi_client();

    if let Some(token) = db_jwt {
        log_info!("Setting Clerk dev browser token from deep link");
        fapi_client.set_dev_browser_token_id(token);
    }

    // Make sure Clerk is loaded and listeners are registered before we
    // fetch the new client. Otherwise set_client may fail with NotLoaded
    // and the plugin-clerk-auth-cb listener that pushes state to the
    // frontend won't fire.
    if let Err(e) = app.ensure_clerk_initialized().await {
        log_error!("Clerk ensure_clerk_initialized failed before auth callback: {}", e);
    }

    let success =
        match tokio::time::timeout(std::time::Duration::from_secs(5), fapi_client.get_client())
            .await
        {
            Ok(Ok(Some(client))) => {
                log_info!(
                    "Clerk client refreshed, sessions={}, last_active_session_id={:?}",
                    client.sessions.len(),
                    client.last_active_session_id
                );
                match clerk.set_client(client) {
                    Ok(_) => log_info!("Clerk set_client succeeded"),
                    Err(e) => log_warn!("Clerk set_client failed: {}", e),
                }
                true
            }
            Ok(Ok(None)) => {
                log_warn!("Clerk client refreshed but no session found");
                false
            }
            Ok(Err(e)) => {
                log_error!("Failed to reload Clerk client after deep link: {}", e);
                false
            }
            Err(_) => {
                log_error!("Clerk get_client timed out after 5 seconds");
                false
            }
        };

    // Defer the emit so the frontend has time to process the
    // plugin-clerk-auth-cb event that was fired by set_client.
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Err(e) = app_clone.emit(
            "clerk-auth-callback-complete",
            serde_json::json!({ "success": success }),
        ) {
            log_error!("Failed to emit clerk-auth-callback-complete event: {}", e);
        }
    });
}

#[tauri::command]
async fn open_system_browser(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open system browser: {}", e))?;
    Ok(())
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
    let nearby: NearbyState = Arc::new(RwLock::new(NearbyRuntime::default()));
    let cloud_presence: CloudPresenceState = Arc::new(RwLock::new(CloudPresenceRuntime::default()));
    let android_foreground: AndroidForegroundState =
        Arc::new(RwLock::new(AndroidForegroundRuntime::default()));

    // Use compile-time environment variable for Clerk key
    // This is necessary for Android/iOS where runtime env vars are not available
    let clerk_publishable_key =
        option_env!("CLERK_PUBLISHABLE_KEY").unwrap_or("pk_test_placeholder");

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_clerk::ClerkPluginBuilder::new()
                .publishable_key(clerk_publishable_key)
                .build(),
        );

    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(tauri_plugin_android_fs::init());
    }

    #[cfg(target_os = "ios")]
    {
        builder = builder
            .plugin(tauri_plugin_fs_ios::init())
            .plugin(tauri_plugin_media_picker::init());
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

    // macOS NSPanel support
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| {
        if window.label() == "main" {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                let _ = window.app_handle().hide();
                #[cfg(not(target_os = "macos"))]
                let _ = window.hide();
                api.prevent_close();
            }
        }
    });

    builder
        .on_page_load(|window, _payload| {
            if window.label() != "main" {
                return;
            }

            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(1400)).await;
                close_splashscreen(&app);
            });
        })
        .setup(move |app| {
            // Store transfers in app state
            app.manage(transfers.clone());
            // Store nearby runtime in app state
            app.manage(nearby.clone());
            app.manage(cloud_presence.clone());
            app.manage(android_foreground.clone());

            #[cfg(all(target_os = "ios", feature = "ios-web-inspector"))]
            enable_ios_web_inspector(app.handle())?;

            #[cfg(desktop)]
            {
                if let Some(splash_config) = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == "splashscreen")
                {
                    WebviewWindowBuilder::from_config(app.handle(), splash_config)
                        .map_err(|e| format!("Failed to configure splashscreen: {e}"))?
                        .build()
                        .map_err(|e| format!("Failed to create splashscreen: {e}"))?;
                }
            }

            // Create system tray icon on desktop
            #[cfg(desktop)]
            {
                if let Err(e) = menubar::create_tray(app.handle()) {
                    tracing::error!("Failed to create tray icon: {}", e);
                }
            }

            // Deep link handler for Clerk browser auth callbacks
            {
                let app_handle = app.handle().clone();
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    for url in urls {
                        if url.as_str().starts_with("sendme://auth/callback") {
                            let app_clone = app_handle.clone();
                            let url_str = url.to_string();
                            tauri::async_runtime::spawn(async move {
                                handle_clerk_auth_callback(app_clone, url_str).await;
                            });
                        }
                    }
                }

                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if url.as_str().starts_with("sendme://auth/callback") {
                            let app_clone = app_handle.clone();
                            let url_str = url.to_string();
                            tauri::async_runtime::spawn(async move {
                                handle_clerk_auth_callback(app_clone, url_str).await;
                            });
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_file,
            receive_file,
            send_text,
            receive_text,
            cancel_transfer,
            delete_transfer,
            get_transfers,
            get_transfer_status,
            clear_transfers,
            get_hostname,
            get_device_model,
            get_default_download_folder,
            open_received_file,
            list_received_files,
            pick_file,
            pick_directory,
            // Nearby discovery commands
            start_nearby_discovery,
            get_nearby_devices,
            get_nearby_profile,
            stop_nearby_discovery,
            send_to_device,
            accept_incoming,
            decline_incoming,
            start_cloud_presence,
            stop_cloud_presence,
            get_cloud_presence_state,
            app_ready,
            open_system_browser,
            // Menubar commands
            #[cfg(target_os = "macos")]
            menubar_cmd::init_menubar,
            #[cfg(target_os = "macos")]
            menubar_cmd::show_menubar_panel,
            #[cfg(target_os = "macos")]
            menubar_cmd::hide_menubar_panel,
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
        import_mode: sendme_lib::ImportMode::TryReference,
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
        ticket: None,
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
    set_android_active_receive(
        &app,
        Some(AndroidForegroundTransfer {
            title: "Receiving transfer".to_string(),
            message: "Preparing incoming transfer".to_string(),
            detail: "Setting up the receive session.".to_string(),
            progress_current: 0,
            progress_total: 0,
            indeterminate: true,
        }),
    )
    .await;

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
        // Use a timeout to avoid hanging if the progress sender is leaked
        // (e.g. when the task is aborted but the sender lives on in a zombie)
        const PROGRESS_TIMEOUT: Duration = Duration::from_secs(60);
        loop {
            match tokio::time::timeout(PROGRESS_TIMEOUT, rx.recv()).await {
                Ok(Some(event)) => {
                    event_count += 1;
                    log_info!(
                        "  [Progress Task] Event #{}: {:?}",
                        event_count,
                        match &event {
                            ProgressEvent::Import(name, _) => format!("Import({})", name),
                            ProgressEvent::Export(name, _) => format!("Export({})", name),
                            ProgressEvent::Download(_) => "Download".to_string(),
                            ProgressEvent::Connection(status) =>
                                format!("Connection({:?})", status),
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
                            update_transfer_status(
                                &transfers_clone,
                                &transfer_id_clone,
                                "downloading",
                            )
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
                Ok(None) => {
                    log_info!(
                        "  [Progress Task] Channel closed after {} events",
                        event_count
                    );
                    break;
                }
                Err(_) => {
                    log_warn!("  [Progress Task] No events for 60s, exiting");
                    break;
                }
            }
        }

        log_info!("  [Progress Task] Completed. Total events: {}", event_count);
        // Only mark as complete if not already in an error/cancelled state
        let guard = transfers_clone.write().await;
        if let Some(state) = guard.get(&transfer_id_clone) {
            if state.info.status != "completed"
                && !state.info.status.starts_with("error:")
                && !state.info.status.starts_with("cancelled")
            {
                drop(guard);
                update_transfer_status(&transfers_clone, &transfer_id_clone, "completed").await;
            }
        }
    });

    log_info!("🚀 Calling sendme_lib::send_with_progress...");
    let mut send_handle = Some(tokio::spawn(sendme_lib::send_with_progress(args, tx)));
    let send_result = tokio::select! {
        biased;
        _ = abort_rx => {
            if let Some(h) = send_handle.take() {
                h.abort();
            }
            Err("Transfer cancelled by user".to_string())
        }
        result = async {
            match send_handle.take() {
                Some(h) => h.await,
                None => unreachable!(),
            }
        } => match result {
            Ok(Ok(r)) => Ok(r),
            Ok(Err(e)) => Err(e.to_string()),
            Err(join_err) if join_err.is_cancelled() => Err("Transfer cancelled by user".to_string()),
            Err(join_err) => Err(format!("Send task panicked: {}", join_err)),
        }
    };

    match send_result {
        Ok(result) => {
            log_info!("═══════════════════════════════════════════════════");
            log_info!("✅ SEND COMPLETED SUCCESSFULLY");
            log_info!("═══════════════════════════════════════════════════");
            log_info!("🎫 Ticket: {}", result.ticket.to_string());
            log_info!("📊 Transfer ID: {}", transfer_id);
            let ticket_str = result.ticket.to_string();
            update_transfer_status(transfers.inner(), &transfer_id, "serving").await;
            update_transfer_ticket(transfers.inner(), &transfer_id, &ticket_str).await;
            Ok(ticket_str)
        }
        Err(ref e) if e.contains("cancelled by user") => {
            update_transfer_status(transfers.inner(), &transfer_id, e).await;
            Err(e.clone())
        }
        Err(e) => {
            log_error!("═══════════════════════════════════════════════════");
            log_error!("❌ SEND FAILED");
            log_error!("═══════════════════════════════════════════════════");
            log_error!("Error: {}", e);
            log_error!("Transfer ID: {}", transfer_id);
            update_transfer_status(transfers.inner(), &transfer_id, &format!("error: {}", e)).await;
            Err(e)
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
    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel();

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
        if let Some(ref output_dir) = request.output_dir {
            log_info!("Using user-provided output_dir: {:?}", output_dir);
            (Some(std::path::PathBuf::from(output_dir)), None)
        } else {
            log_info!("ℹ️  iOS: No output_dir provided, using Documents directory...");
            match ios_documents_dir(&app) {
                Ok(dir) => {
                    log_info!("✅ iOS Documents directory: {}", dir);
                    (Some(std::path::PathBuf::from(dir)), None)
                }
                Err(e) => {
                    log_error!(
                        "Failed to get Documents directory: {}, falling back to temp_dir",
                        e
                    );
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
        ticket: Some(request.ticket.clone()),
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
        const PROGRESS_TIMEOUT: Duration = Duration::from_secs(60);
        loop {
            match tokio::time::timeout(PROGRESS_TIMEOUT, rx.recv()).await {
                Ok(Some(event)) => {
                    event_count += 1;
                    log_info!(
                        "  [Progress Task] Event #{}: {:?}",
                        event_count,
                        match &event {
                            ProgressEvent::Import(name, _) => format!("Import({})", name),
                            ProgressEvent::Export(name, _) => format!("Export({})", name),
                            ProgressEvent::Download(_) => "Download".to_string(),
                            ProgressEvent::Connection(status) =>
                                format!("Connection({:?})", status),
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
                            update_transfer_status(
                                &transfers_clone,
                                &transfer_id_clone,
                                "downloading",
                            )
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

                    let _ = app_clone.emit("progress", update.clone());
                    update_android_receive_progress_from_update(
                        &app_clone, "receive", None, &update,
                    )
                    .await;
                }
                Ok(None) => {
                    log_info!(
                        "  [Progress Task] Channel closed after {} events",
                        event_count
                    );
                    break;
                }
                Err(_) => {
                    log_warn!("  [Progress Task] No events for 60s, exiting");
                    break;
                }
            }
        }

        log_info!("  [Progress Task] Completed. Total events: {}", event_count);
        let guard = transfers_clone.write().await;
        if let Some(state) = guard.get(&transfer_id_clone) {
            if state.info.status != "completed"
                && !state.info.status.starts_with("error:")
                && !state.info.status.starts_with("cancelled")
            {
                drop(guard);
                update_transfer_status(&transfers_clone, &transfer_id_clone, "completed").await;
            }
        }
    });

    log_info!("Calling sendme_lib::receive_with_progress...");
    let mut receive_handle = Some(tokio::spawn(sendme_lib::receive_with_progress(args, tx)));
    let receive_result = tokio::select! {
        biased;
        _ = abort_rx => {
            if let Some(h) = receive_handle.take() {
                h.abort();
            }
            Err("Transfer cancelled by user".to_string())
        }
        result = async {
            match receive_handle.take() {
                Some(h) => h.await,
                None => unreachable!(),
            }
        } => match result {
            Ok(Ok(r)) => Ok(r),
            Ok(Err(e)) => Err(e.to_string()),
            Err(join_err) if join_err.is_cancelled() => Err("Transfer cancelled by user".to_string()),
            Err(join_err) => Err(format!("Receive task panicked: {}", join_err)),
        }
    };

    match receive_result {
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
                log_info!("Temp directory used for export: {:?}", temp_dir);
                match copy_files_to_content_uri(&app, &temp_dir, &content_uri, &result.collection)
                    .await
                {
                    Ok(_) => {
                        log_info!("✅ Files copied to content URI successfully");
                    }
                    Err(e) => {
                        log_error!("❌ Failed to copy files to content URI: {}", e);
                        log_error!("❌ Troubleshooting tips:");
                        log_error!("   1. Check if the directory permission was granted");
                        log_error!("   2. Check if the device has storage space");
                        log_error!("   3. Try selecting a different directory");
                        log_error!("   4. Check Android logs for more details (adb logcat)");
                        update_transfer_status(
                            transfers.inner(),
                            &transfer_id,
                            &format!("error: {}", e),
                        )
                        .await;
                        set_android_active_receive(&app, None).await;
                        return Err(format!(
                            "Failed to copy files to selected directory. The app may not have \
                            write permission for this location. Try selecting a different directory \
                            or the Downloads folder. Error: {}",
                            e
                        ));
                    }
                }
            }

            update_transfer_status(transfers.inner(), &transfer_id, "completed").await;
            set_android_active_receive(&app, None).await;
            Ok(format!(
                "{{\"transfer_id\": \"{}\", \"files\": {}, \"bytes\": {}}}",
                transfer_id,
                result.total_files,
                result.stats.total_bytes_read()
            ))
        }
        Err(ref e) if e.contains("cancelled by user") => {
            update_transfer_status(transfers.inner(), &transfer_id, e).await;
            set_android_active_receive(&app, None).await;
            Err(e.clone())
        }
        Err(e) => {
            log_error!("❌ RECEIVE FAILED: {}", e);
            update_transfer_status(transfers.inner(), &transfer_id, &format!("error: {}", e)).await;
            set_android_active_receive(&app, None).await;
            Err(e)
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
async fn delete_transfer(
    transfers: tauri::State<'_, Transfers>,
    id: String,
) -> Result<bool, String> {
    let mut transfers_guard = transfers.write().await;
    if let Some(mut state) = transfers_guard.remove(&id) {
        // Send abort signal if still active
        if let Some(abort_tx) = state.abort_tx.take() {
            let _ = abort_tx.send(());
        }
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
    // Fast-path: read check to avoid unnecessary write lock
    {
        let guard = transfers.read().await;
        if let Some(state) = guard.get(id) {
            if state.info.status == status {
                return;
            }
        } else {
            return;
        }
    }
    let mut transfers_guard = transfers.write().await;
    if let Some(state) = transfers_guard.get_mut(id) {
        state.info.status = status.to_string();
    }
}

async fn update_transfer_ticket(transfers: &Transfers, id: &str, ticket: &str) {
    let mut transfers_guard = transfers.write().await;
    if let Some(state) = transfers_guard.get_mut(id) {
        state.info.ticket = Some(ticket.to_string());
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

/// Get the local hostname
#[tauri::command]
fn get_hostname() -> Result<String, String> {
    // Get hostname using tauri-plugin-os for cross-platform compatibility
    use tauri_plugin_os::hostname;

    let hostname = hostname();

    if hostname.is_empty() || is_loopback_device_name(&hostname) {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return Ok(preferred_mobile_device_name());
        }

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

    log_info!("📋 Getting Documents directory via fs-ios...");
    let docs_path = ios_documents_dir(&app).map_err(|e| {
        log_error!("❌ {}", e);
        e
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
        return Ok(());
    }

    // On iOS, use opener plugin with Documents directory
    #[cfg(target_os = "ios")]
    {
        log_info!("🍎 iOS platform detected, using Documents directory");

        let docs_dir = ios_documents_dir(&app)?;

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
        return Ok(());
    }

    // On desktop, use opener plugin
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
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
        let docs_dir = ios_documents_dir(&app)?;

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
            // This is CRITICAL - without persistent permission, writing to the URI will fail!
            match api.take_persistable_uri_permission(&uri).await {
                Ok(_) => {
                    log_info!("✅ Persistable URI permission acquired successfully");
                }
                Err(e) => {
                    // Log as ERROR since this will cause write failures
                    log_error!("❌ Failed to take persistable URI permission: {}", e);
                    log_error!("❌ Writing to this directory will likely FAIL!");
                    log_error!(
                        "❌ This is a common cause of 'permission denied' errors on Android"
                    );
                    // Don't return error - some devices don't support this, but warn prominently
                }
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

/// Pick a file using the iOS photo/media picker (PHPickerViewController).
///
/// Presents the system photo library picker. The user can select one or more
/// photos or videos. Selected files are copied to a temporary directory and
/// their `file://` URIs are returned.
#[tauri::command]
#[cfg(target_os = "ios")]
async fn pick_file(
    app: AppHandle,
    _allowed_types: Option<Vec<String>>,
    _allow_multiple: Option<bool>,
) -> Result<Vec<PickerFileInfo>, String> {
    use tauri_plugin_media_picker::MediaPickerExt;

    log_info!("📁 iOS media picker opening...");

    let media_files = app
        .media_picker()
        .pick_media()
        .await
        .map_err(|e| format!("Media picker failed: {}", e))?;

    if media_files.is_empty() {
        log_info!("📁 Media picker cancelled or no files selected");
        return Ok(vec![]);
    }

    log_info!("✅ Selected {} media files", media_files.len());

    let results = media_files
        .into_iter()
        .map(|f| {
            // Convert file:// URI to filesystem path for the path field
            let path = f.uri.strip_prefix("file://").unwrap_or(&f.uri).to_string();
            PickerFileInfo {
                uri: f.uri,
                path,
                name: f.name,
                size: f.size as i64,
                mime_type: f.mime_type,
            }
        })
        .collect();

    Ok(results)
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

/// Send text as a virtual file and return the ticket
#[tauri::command]
async fn send_text(app: AppHandle, request: SendTextRequest) -> Result<String, String> {
    log_info!("📝 SEND_TEXT STARTED");
    log_info!("Text length: {} chars", request.text.len());

    // Convert text to bytes
    let bytes = request.text.as_bytes();

    // Create filename
    let filename = request
        .filename
        .unwrap_or_else(|| "message.txt".to_string());
    log_info!("Filename: {}", filename);

    // Get temp directory
    let temp_dir = app.path().temp_dir().map_err(|e| {
        let err_msg = format!("Failed to get temp directory: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;

    // Create a unique temp file for the text
    let unique_id = Uuid::new_v4().simple().to_string()[..8].to_string();
    let safe_filename = filename.replace(['/', '\\', '\0'], "_");
    let temp_filename = format!("{}-{}.txt", safe_filename, unique_id);
    let file_path = temp_dir.join(&temp_filename);

    // Write text to temp file
    tokio::fs::write(&file_path, bytes).await.map_err(|e| {
        let err_msg = format!("Failed to write temp file: {}", e);
        log_error!("❌ {}", err_msg);
        err_msg
    })?;
    log_info!("Temp file created: {:?}", file_path);

    // Parse ticket type
    let ticket_type = match request.ticket_type.as_str() {
        "id" => sendme_lib::types::AddrInfoOptions::Id,
        "relay" => sendme_lib::types::AddrInfoOptions::Relay,
        "addresses" => sendme_lib::types::AddrInfoOptions::Addresses,
        "relay_and_addresses" => sendme_lib::types::AddrInfoOptions::RelayAndAddresses,
        _ => {
            let err = format!("Invalid ticket type: {}", request.ticket_type);
            log_error!("❌ {}", err);
            return Err(err);
        }
    };

    let args = SendArgs {
        path: file_path.clone(),
        ticket_type,
        common: CommonConfig {
            temp_dir: Some(temp_dir.clone()),
            ..Default::default()
        },
        import_mode: sendme_lib::ImportMode::Copy,
    };

    log_info!("Calling sendme_lib::send_with_progress...");
    match sendme_lib::send_with_progress(args, tokio::sync::mpsc::channel(32).0).await {
        Ok(result) => {
            log_info!("✅ SEND_TEXT COMPLETED");
            log_info!("Ticket: {}", result.ticket.to_string());

            // Clean up temp file
            let _ = tokio::fs::remove_file(&file_path).await;

            Ok(result.ticket.to_string())
        }
        Err(e) => {
            log_error!("❌ SEND_TEXT FAILED: {}", e);

            // Clean up temp file
            let _ = tokio::fs::remove_file(&file_path).await;

            Err(e.to_string())
        }
    }
}

/// Receive text and return the content
#[tauri::command]
async fn receive_text(app: AppHandle, request: ReceiveTextRequest) -> Result<TextResult, String> {
    log_info!("📥 RECEIVE_TEXT STARTED");
    log_info!("Ticket length: {} chars", request.ticket.len());

    // Parse ticket
    let ticket = request.ticket.parse().map_err(|e| {
        let err = format!("Invalid ticket: {}", e);
        log_error!("❌ {}", err);
        err
    })?;
    log_info!("Ticket parsed successfully");

    // Get temp directory
    let temp_dir = app.path().temp_dir().map_err(|e| {
        let err = format!("Failed to get temp directory: {}", e);
        log_error!("❌ {}", err);
        err
    })?;
    log_info!("Temp dir: {:?}", temp_dir);

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
        export_dir: Some(temp_dir.clone()),
    };

    log_info!("Calling sendme_lib::receive_with_progress...");
    match sendme_lib::receive_with_progress(args, tokio::sync::mpsc::channel(32).0).await {
        Ok(result) => {
            log_info!("✅ RECEIVE_TEXT COMPLETED");
            log_info!("Files: {}", result.total_files);

            // Read the received file content
            let mut text = String::new();
            let mut filename = String::new();

            for (name, _hash) in result.collection.iter() {
                let file_path = temp_dir.join(name);
                if file_path.exists() {
                    filename = name.to_string();
                    text = tokio::fs::read_to_string(&file_path).await.map_err(|e| {
                        let err = format!("Failed to read file: {}", e);
                        log_error!("❌ {}", err);
                        err
                    })?;
                    log_info!("Read {} bytes from {}", text.len(), filename);
                    break;
                }
            }

            // Clean up temp directory
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;

            if text.is_empty() {
                return Err("No text content received".to_string());
            }

            Ok(TextResult { text, filename })
        }
        Err(e) => {
            log_error!("❌ RECEIVE_TEXT FAILED: {}", e);
            Err(e.to_string())
        }
    }
}
