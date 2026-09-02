//! Nearby runtime built on the LocalSend protocol (v2.2).
//!
//! Combines the three building blocks of the vendored `localsend` crate —
//! UDP-multicast discovery, the HTTP(S) server that receives files, and the
//! HTTP(S) client that sends them — behind one handle that the Tauri backend
//! (and potentially the CLI) drives.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use localsend::discovery::{
    self, DiscoveredDevice, DiscoveryConfig, DiscoveryEvent, DiscoveryHandle,
};
use localsend::http::client::{LsHttpClient, LsHttpClientVersion};
use localsend::http::dto::{PrepareUploadRequestDto, RegisterDto};
use localsend::http::server::common::save::FileUploadTarget;
use localsend::http::server::v2::{PrepareUploadDecisionV2, ServerEventV2, SessionEndReasonV2};
use localsend::http::server::web::WebConfig;
use localsend::http::server::{self, ServerConfigV2, ServerHandle, TlsConfig};
use localsend::http::state::ClientInfo;
use localsend::model::discovery::{ProtocolType, PROTOCOL_VERSION_V2};
use localsend::model::transfer::{FileContent, FileDto, FileMetadata};
use localsend::multicast::{self, MulticastDevice};
use localsend::util::filename::{self, Rules};
use localsend::util::interface::InterfaceFilter;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_util::sync::CancellationToken;

use super::identity::NearbyIdentity;
use super::types::{DeviceType, NearbyDevice};

/// The port LocalSend devices listen on by default.
pub const DEFAULT_PORT: u16 = multicast::DEFAULT_PORT;

/// How long the sender waits for the receiver to answer a prepare-upload
/// before giving up.
const PREPARE_UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);

/// Configuration for starting the nearby runtime.
pub struct NearbyRuntimeConfig {
    /// Display name announced to peers (LocalSend `alias`).
    pub alias: String,
    /// Device category announced to peers.
    pub device_type: DeviceType,
    /// Device model announced to peers (e.g. "macOS", "Android").
    pub device_model: Option<String>,
    /// This device's persisted LocalSend identity.
    pub identity: NearbyIdentity,
    /// Preferred port for the HTTP server; falls back to an OS-assigned port
    /// when it is taken. The actual port is announced to peers.
    pub port: u16,
    /// Channel on which runtime events are delivered to the application.
    pub event_tx: mpsc::Sender<NearbyEvent>,
}

/// Events emitted by the runtime. The application maps these onto its
/// UI-facing events and transfer registry.
#[derive(Debug)]
pub enum NearbyEvent {
    /// The set of discovered devices changed.
    DevicesChanged(Vec<NearbyDevice>),

    /// A peer wants to send files to this device.
    /// The application must answer on `decision_tx`; dropping it declines.
    ReceiveRequest(ReceiveRequest),

    /// A pending receive request went away before the application decided
    /// (the sender aborted while waiting).
    ReceiveRequestAborted { session_id: String },

    /// Progress of an accepted incoming transfer, in cumulative bytes.
    ReceiveProgress {
        session_id: String,
        transferred: u64,
        total: u64,
        /// Name of the file currently being written.
        current_file: Option<String>,
    },

    /// An incoming transfer ended.
    ReceiveFinished {
        session_id: String,
        outcome: ReceiveOutcome,
    },

    /// The remote device cancelled a transfer this device is sending to it.
    SendCancelledByPeer { session_id: String },

    /// The HTTP server socket failed permanently (e.g. iOS reclaimed it
    /// while suspended). The application should restart the runtime.
    ListenerFailed(String),
}

/// Why an incoming transfer ended.
#[derive(Debug)]
pub enum ReceiveOutcome {
    /// All accepted files were written.
    Completed { saved: Vec<PathBuf> },
    /// The sender cancelled the session, or the receiver cancelled it.
    Cancelled,
    /// At least one file failed; saved files are still reported.
    Failed {
        message: String,
        saved: Vec<PathBuf>,
    },
}

/// A peer's request to send files to this device.
#[derive(Debug)]
pub struct ReceiveRequest {
    /// The session ID; also used as the request ID on the UI contract.
    pub session_id: String,
    pub sender_alias: String,
    pub sender_device_type: DeviceType,
    pub sender_fingerprint: String,
    /// The IP address the request came from.
    pub sender_ip: String,
    pub files: Vec<IncomingFile>,
    pub total_size: u64,
    /// Answer channel for the application's decision.
    pub decision_tx: oneshot::Sender<NearbyIncomingDecision>,
}

/// A file offered by a peer.
#[derive(Debug, Clone)]
pub struct IncomingFile {
    pub id: String,
    pub name: String,
    pub size: u64,
}

/// The application's answer to a [`ReceiveRequest`].
#[derive(Debug)]
pub enum NearbyIncomingDecision {
    /// Accept all offered files, writing them into this directory.
    Accept {
        output_dir: PathBuf,
    },
    Decline,
}

/// A file to send to a peer.
#[derive(Debug, Clone)]
pub struct OutgoingFile {
    /// Local path the content is read from.
    pub path: PathBuf,
    /// Logical name presented to the receiver (may contain `/` for folders).
    pub name: String,
}

/// Progress events of an outgoing transfer.
#[derive(Debug, Clone)]
pub enum NearbySendEvent {
    /// Contacting the receiver and waiting for confirmation.
    Waiting {
        receiver_alias: String,
        receiver_device_type: DeviceType,
        total: u64,
    },
    /// The receiver accepted; uploading starts.
    Accepted { session_id: String },
    /// The receiver declined.
    Declined,
    /// Cumulative upload progress in bytes.
    Progress { transferred: u64, total: u64 },
    /// All accepted files were uploaded.
    Done,
    /// The receiver cancelled mid-transfer.
    Cancelled,
}

/// State tracked per incoming session.
struct ReceiveSession {
    files: HashMap<String, FileDto>,
    total: u64,
    output_dir: PathBuf,
    /// Bytes of files that finished before the one currently transferring.
    transferred_base: u64,
    saved: Vec<PathBuf>,
    failed: Vec<String>,
    cancelled: bool,
}

/// Internal shared state of the runtime.
struct RuntimeInner {
    identity: NearbyIdentity,
    alias: String,
    device_type: DeviceType,
    device_model: Option<String>,
    server: ServerHandle,
    discovery: DiscoveryHandle,
    event_tx: mpsc::Sender<NearbyEvent>,
    sessions: Mutex<HashMap<String, ReceiveSession>>,
    /// Last emitted device list, for change detection (peers re-register on
    /// every announcement; only actual changes are signalled).
    last_devices: Mutex<Option<Vec<NearbyDevice>>>,
    /// Cancellation tokens of outgoing sends, by session ID, so that a
    /// peer-initiated cancel can abort them.
    send_sessions: std::sync::Mutex<HashMap<String, CancellationToken>>,
    server_stop: Mutex<Option<oneshot::Sender<()>>>,
    discovery_stop: Mutex<Option<oneshot::Sender<()>>>,
    pump: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

/// Why a send could not be prepared.
#[derive(Debug)]
pub enum NearbyPrepareError {
    /// The receiver declined the transfer.
    Declined,
    /// The device disappeared or has no usable address.
    Unavailable(String),
    /// Any other failure (network, I/O, protocol).
    Failed(anyhow::Error),
}

impl NearbyPrepareError {
    /// A short, user-presentable description.
    pub fn message(&self) -> String {
        match self {
            NearbyPrepareError::Declined => "Transfer declined".to_string(),
            NearbyPrepareError::Unavailable(message) => message.clone(),
            NearbyPrepareError::Failed(err) => format!("{err:#}"),
        }
    }
}

/// An accepted send session, ready to upload.
pub struct NearbySendSession {
    inner: Arc<RuntimeInner>,
    client: LsHttpClient,
    channel: localsend::discovery::HttpChannel,
    session_id: String,
    staged: Vec<(String, OutgoingFile, u64)>,
    /// File ID -> token of the files the receiver accepted.
    tokens: HashMap<String, String>,
    total: u64,
    receiver_alias: String,
    receiver_device_type: DeviceType,
}

impl NearbySendSession {
    pub fn receiver_alias(&self) -> &str {
        &self.receiver_alias
    }

    pub fn receiver_device_type(&self) -> &DeviceType {
        &self.receiver_device_type
    }

    /// The session ID assigned by the receiver; empty when the receiver
    /// accepted the session but no files (nothing to upload).
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Total size of all offered files in bytes.
    pub fn total(&self) -> u64 {
        self.total
    }

    /// Uploads the accepted files, reporting progress on `event_tx`.
    /// Cancelling `cancel` aborts the transfer and notifies the receiver.
    pub async fn upload(
        self,
        event_tx: mpsc::Sender<NearbySendEvent>,
        cancel: CancellationToken,
    ) -> Result<()> {
        self.inner.arm_send_session(&self.session_id, &cancel);

        let result = self.run_upload(&event_tx, &cancel).await;

        self.inner
            .send_sessions
            .lock()
            .unwrap()
            .remove(&self.session_id);

        match result {
            Ok(()) => {
                let _ = event_tx.send(NearbySendEvent::Done).await;
                Ok(())
            }
            Err(err) => {
                if cancel.is_cancelled() {
                    // Best effort: tell the receiver the session is over.
                    let _ = self
                        .client
                        .cancel(
                            self.channel.protocol,
                            &self.channel.host,
                            self.channel.port,
                            &self.session_id,
                        )
                        .await;
                    let _ = event_tx.send(NearbySendEvent::Cancelled).await;
                }
                Err(err)
            }
        }
    }

    async fn run_upload(
        &self,
        event_tx: &mpsc::Sender<NearbySendEvent>,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let mut transferred_base = 0u64;
        for (file_id, file, file_size) in &self.staged {
            let Some(token) = self.tokens.get(file_id) else {
                // The receiver did not want this file.
                continue;
            };
            if cancel.is_cancelled() {
                return Err(anyhow!("transfer cancelled"));
            }
            self.client
                .upload(
                    self.channel.protocol,
                    &self.channel.host,
                    self.channel.port,
                    None,
                    &self.session_id,
                    file_id,
                    token,
                    FileContent::Path(file.path.clone()),
                    {
                        let event_tx = event_tx.clone();
                        let total = self.total;
                        move |sent| {
                            let _ = event_tx.try_send(NearbySendEvent::Progress {
                                transferred: transferred_base + sent,
                                total,
                            });
                        }
                    },
                    cancel.clone(),
                )
                .await?;
            transferred_base += file_size;
        }
        Ok(())
    }
}

impl Drop for NearbySendSession {
    fn drop(&mut self) {
        if !self.session_id.is_empty() {
            self.inner
                .send_sessions
                .lock()
                .unwrap()
                .remove(&self.session_id);
        }
    }
}

/// A running nearby service: HTTP(S) server + multicast discovery.
///
/// Cloning is cheap (an `Arc`); every clone controls the same service.
#[derive(Clone)]
pub struct NearbyRuntime {
    inner: Arc<RuntimeInner>,
}

impl NearbyRuntime {
    /// Starts the HTTP(S) server and multicast discovery.
    ///
    /// Events arrive on `config.event_tx`. The runtime serves HTTPS with the
    /// identity certificate (the LocalSend default); peers announcing plain
    /// HTTP can still be *sent* to, but only HTTPS peers can upload to us.
    pub async fn start(config: NearbyRuntimeConfig) -> Result<Self> {
        let (server_event_tx, server_event_rx) = mpsc::channel(64);
        let identity = config.identity;

        let tls = TlsConfig {
            cert: identity.cert_pem.clone(),
            private_key: identity.private_key_pem.clone(),
        };
        let info = ClientInfo {
            alias: config.alias.clone(),
            version: PROTOCOL_VERSION_V2.to_string(),
            device_model: config.device_model.clone(),
            device_type: config.device_type.to_protocol(),
            token: identity.fingerprint.clone(),
        };
        let make_v2_config = || ServerConfigV2 {
            pin: None,
            verify_checksums: true,
            event_tx: server_event_tx.clone(),
        };

        // Prefer the well-known LocalSend port so peers scanning their subnet
        // find us without multicast; fall back to an OS-assigned port when it
        // is taken (e.g. by an actual LocalSend instance running alongside).
        let preferred_port = config.port;
        let (server_stop_tx, server_stop_rx) = oneshot::channel();
        let (server, server_stop) = match server::start_with_port(
            preferred_port,
            Some(tls.clone()),
            info.clone(),
            None,
            Some(make_v2_config()),
            WebConfig::default(),
            server_stop_rx,
        )
        .await
        {
            Ok(handle) => (handle, server_stop_tx),
            Err(err) => {
                tracing::warn!(
                    "Could not bind nearby port {preferred_port}: {err:#}; \
                     falling back to an OS-assigned port"
                );
                let (stop_tx, stop_rx) = oneshot::channel();
                let handle = server::start_with_port(
                    0,
                    Some(tls),
                    info,
                    None,
                    Some(make_v2_config()),
                    WebConfig::default(),
                    stop_rx,
                )
                .await
                .context("failed to start nearby HTTP server")?;
                (handle, stop_tx)
            }
        };
        let port = server.port();

        let (discovery_stop_tx, discovery_stop_rx) = oneshot::channel();
        let (discovery_event_tx, mut discovery_event_rx) = mpsc::channel(64);
        let device = MulticastDevice {
            alias: config.alias.clone(),
            version: PROTOCOL_VERSION_V2.to_string(),
            device_model: config.device_model.clone(),
            device_type: config.device_type.to_protocol(),
            fingerprint: identity.fingerprint.clone(),
            port,
            protocol: ProtocolType::Https,
            download: false,
        };
        let discovery = discovery::start(
            DiscoveryConfig {
                group: multicast::DEFAULT_MULTICAST_GROUP,
                group_v6: Some(multicast::DEFAULT_MULTICAST_GROUP_V6),
                port: multicast::DEFAULT_PORT,
                interface_filter: InterfaceFilter::default(),
                device,
                identity: discovery::DeviceIdentity {
                    cert_pem: identity.cert_pem.clone(),
                    private_key_pem: identity.private_key_pem.clone(),
                },
                timeout: discovery::DEFAULT_DISCOVERY_TIMEOUT,
                event_tx: Some(discovery_event_tx),
            },
            discovery_stop_rx,
        )
        .await;
        if let Some(err) = discovery.multicast_error() {
            tracing::warn!("Nearby multicast unavailable: {err:#}");
        }

        let inner = Arc::new(RuntimeInner {
            identity,
            alias: config.alias,
            device_type: config.device_type,
            device_model: config.device_model,
            server,
            discovery,
            event_tx: config.event_tx,
            sessions: Mutex::new(HashMap::new()),
            last_devices: Mutex::new(None),
            send_sessions: std::sync::Mutex::new(HashMap::new()),
            server_stop: Mutex::new(Some(server_stop)),
            discovery_stop: Mutex::new(Some(discovery_stop_tx)),
            pump: Mutex::new(None),
        });

        let pump = tokio::spawn({
            let inner = inner.clone();
            let mut server_event_rx = server_event_rx;
            async move {
                loop {
                    tokio::select! {
                        event = server_event_rx.recv() => {
                            match event {
                                Some(event) => inner.handle_server_event(event).await,
                                None => break,
                            }
                        }
                        event = discovery_event_rx.recv() => {
                            // Discovery stopped; keep serving until the
                            // server channel closes too.
                            if let Some(event) = event {
                                inner.handle_discovery_event(event).await;
                            }
                        }
                    }
                }
            }
        });

        inner.pump.lock().await.replace(pump);

        Ok(Self { inner })
    }

    /// The port the HTTP server is reachable on.
    pub fn port(&self) -> u16 {
        self.inner.server.port()
    }

    /// This device's LocalSend fingerprint.
    pub fn fingerprint(&self) -> &str {
        &self.inner.identity.fingerprint
    }

    /// The currently discovered devices.
    pub fn devices(&self) -> Vec<NearbyDevice> {
        self.inner
            .discovery
            .devices()
            .iter()
            .map(stateful_to_nearby)
            .collect()
    }

    /// Probes a device at a known address (manual/favorite pairing, or
    /// networks without multicast) and adds it to the store when it answers.
    /// Returns `true` when the device answered and is not this device itself.
    pub async fn discover(&self, host: &str, port: u16, protocol: ProtocolType) -> Result<bool> {
        let found = self
            .inner
            .discovery
            .discover(host, port, protocol)
            .await
            .context("probe failed")?;
        Ok(found.is_some())
    }

    /// Announces this device on the network, prompting every listening peer
    /// to register with our HTTP server.
    pub async fn announce(&self) {
        self.inner.discovery.announce().await;
    }

    /// Asks the device with the given fingerprint to receive `files`.
    ///
    /// On acceptance returns a [`NearbySendSession`] whose
    /// [`NearbySendSession::upload`] performs the actual transfer. The
    /// session must be uploaded or dropped; dropping it declines silently.
    pub async fn prepare_send(
        &self,
        device_id: &str,
        files: Vec<OutgoingFile>,
    ) -> Result<NearbySendSession, NearbyPrepareError> {
        if files.is_empty() {
            return Err(NearbyPrepareError::Failed(anyhow!("no files to send")));
        }

        let device = self
            .inner
            .discovery
            .device_by_fingerprint(device_id)
            .ok_or_else(|| {
                NearbyPrepareError::Unavailable("device is no longer available".into())
            })?;
        let channel = device
            .get_best_channel()
            .and_then(|channel| channel.http().cloned())
            .ok_or_else(|| {
                NearbyPrepareError::Unavailable("device has no reachable HTTP address".into())
            })?;

        let client = LsHttpClient::new(
            &self.inner.identity.private_key_pem,
            &self.inner.identity.cert_pem,
            LsHttpClientVersion::V2,
            Some(device_id.to_string()),
            None,
        )
        .context("failed to create nearby HTTP client")
        .map_err(NearbyPrepareError::Failed)?;

        // Pair every outgoing file with a stable ID so the receiver's
        // accepted-file map can be resolved back to local paths.
        let mut staged: Vec<(String, OutgoingFile, u64)> = Vec::with_capacity(files.len());
        let mut file_dtos = HashMap::new();
        let mut total = 0u64;
        for file in files {
            let meta = std::fs::metadata(&file.path)
                .with_context(|| format!("failed to read {}", file.path.display()))
                .map_err(NearbyPrepareError::Failed)?;
            total += meta.len();
            let id = uuid::Uuid::new_v4().to_string();
            file_dtos.insert(
                id.clone(),
                FileDto {
                    id: id.clone(),
                    file_name: file.name.clone(),
                    size: meta.len(),
                    file_type: mime_guess::from_path(&file.path)
                        .first_or_octet_stream()
                        .to_string(),
                    sha256: None,
                    preview: None,
                    metadata: FileMetadata::from_fs_metadata(&meta),
                },
            );
            staged.push((id, file, meta.len()));
        }

        let prepare = PrepareUploadRequestDto {
            info: RegisterDto {
                alias: self.inner.alias.clone(),
                version: PROTOCOL_VERSION_V2.to_string(),
                device_model: self.inner.device_model.clone(),
                device_type: self.inner.device_type.to_protocol(),
                token: self.inner.identity.fingerprint.clone(),
                port: self.port(),
                protocol: ProtocolType::Https,
                has_web_interface: false,
            },
            files: file_dtos,
        };

        let result = tokio::time::timeout(
            PREPARE_UPLOAD_TIMEOUT,
            client.prepare_upload(
                channel.protocol,
                &channel.host,
                channel.port,
                None,
                prepare,
                None,
                CancellationToken::new(),
            ),
        )
        .await
        .map_err(|_| NearbyPrepareError::Failed(anyhow!("receiver did not answer in time")))?
        .map_err(|err| match &err {
            localsend::http::client::ClientError::StatusCode(status) if status.status == 403 => {
                NearbyPrepareError::Declined
            }
            _ => NearbyPrepareError::Failed(anyhow!(err)),
        })?;

        let response = match result.status_code {
            200 => result.response.ok_or_else(|| {
                NearbyPrepareError::Failed(anyhow!("receiver accepted but sent no session"))
            })?,
            204 => {
                // Receiver accepted the session but wants none of the files.
                return Ok(NearbySendSession {
                    inner: self.inner.clone(),
                    client,
                    channel,
                    session_id: String::new(),
                    staged,
                    tokens: HashMap::new(),
                    total,
                    receiver_alias: device.device.alias.clone(),
                    receiver_device_type: DeviceType::from_protocol(
                        device.device.device_type.as_ref(),
                    ),
                });
            }
            403 => return Err(NearbyPrepareError::Declined),
            status => {
                return Err(NearbyPrepareError::Failed(anyhow!(
                    "prepare-upload failed with status {status}"
                )));
            }
        };

        let session_id = response.session_id;
        // Let a peer-initiated cancel abort the upload of this session.
        self.inner
            .send_sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), CancellationToken::new());

        Ok(NearbySendSession {
            inner: self.inner.clone(),
            client,
            channel,
            session_id,
            staged,
            tokens: response.files,
            total,
            receiver_alias: device.device.alias.clone(),
            receiver_device_type: DeviceType::from_protocol(device.device.device_type.as_ref()),
        })
    }

    /// Cancels an incoming session (receiver-side abort). In-flight files
    /// finish writing but the session is torn down and reported as cancelled.
    pub async fn cancel_receive(&self, session_id: &str) -> bool {
        {
            let mut sessions = self.inner.sessions.lock().await;
            if let Some(session) = sessions.get_mut(session_id) {
                session.cancelled = true;
            }
        }
        self.inner.server.cancel_v2_session(session_id).await
    }

    /// Stops the server and discovery, waiting for the sockets to be released.
    pub async fn stop(&self) {
        if let Some(stop) = self.inner.server_stop.lock().await.take() {
            let _ = stop.send(());
        }
        if let Some(stop) = self.inner.discovery_stop.lock().await.take() {
            let _ = stop.send(());
        }
        self.inner.server.wait_stopped().await;
        self.inner.discovery.wait_stopped().await;
        if let Some(pump) = self.inner.pump.lock().await.take() {
            pump.abort();
        }
    }
}

impl RuntimeInner {
    /// Registers the cancellation token the application controls for the
    /// session, replacing the placeholder created in [`NearbyRuntime::prepare_send`].
    fn arm_send_session(&self, session_id: &str, cancel: &CancellationToken) {
        self.send_sessions
            .lock()
            .unwrap()
            .insert(session_id.to_string(), cancel.clone());
    }

    async fn emit(&self, event: NearbyEvent) {
        if self.event_tx.send(event).await.is_err() {
            tracing::debug!("Nearby event receiver is gone");
        }
    }

    /// Emits the device list, but only when it actually changed: peers
    /// re-register on every announcement, and the store reports each
    /// confirmation as an update.
    async fn emit_devices_changed(&self) {
        let mut devices = self.devices();
        for device in &mut devices {
            device.addresses.sort();
        }
        devices.sort_by(|a, b| a.id.cmp(&b.id));
        let mut last = self.last_devices.lock().await;
        if last.as_ref() != Some(&devices) {
            *last = Some(devices.clone());
            self.emit(NearbyEvent::DevicesChanged(devices)).await;
        }
    }

    async fn handle_discovery_event(&self, event: DiscoveryEvent) {
        match event {
            DiscoveryEvent::Discovered { .. } | DiscoveryEvent::Updated { .. } => {
                self.emit_devices_changed().await;
            }
            DiscoveryEvent::MulticastFailed => {
                tracing::warn!("Nearby multicast sockets failed; discovery degraded");
            }
        }
    }

    fn devices(&self) -> Vec<NearbyDevice> {
        self.discovery
            .devices()
            .iter()
            .map(stateful_to_nearby)
            .collect()
    }

    async fn handle_server_event(self: &Arc<Self>, event: ServerEventV2) {
        match event {
            ServerEventV2::Register { ip, info } => {
                // A peer answered our announcement (or scanned its subnet):
                // feed it into the discovery store so it shows up as a device.
                if info.fingerprint.is_empty() || info.fingerprint == self.identity.fingerprint {
                    return;
                }
                let device = DiscoveredDevice {
                    alias: info.alias,
                    version: info.version,
                    device_model: info.device_model,
                    device_type: info.device_type,
                    fingerprint: info.fingerprint,
                    channel: localsend::discovery::DeviceChannel::Http(
                        localsend::discovery::HttpChannel {
                            host: ip.to_string(),
                            port: info.port,
                            protocol: info.protocol,
                        },
                    ),
                    download: info.download,
                };
                if self.discovery.add_device(device).await {
                    self.emit_devices_changed().await;
                }
            }
            ServerEventV2::PrepareUpload {
                session_id,
                ip,
                info,
                files,
                decision_tx,
                ..
            } => {
                self.handle_prepare_upload(session_id, ip.to_string(), info, files, decision_tx)
                    .await;
            }
            ServerEventV2::FileUpload {
                session_id,
                file,
                target_tx,
                ..
            } => {
                self.handle_file_upload(session_id, file, target_tx).await;
            }
            ServerEventV2::SessionEnd { session_id, reason } => {
                self.handle_session_end(session_id, reason).await;
            }
            ServerEventV2::PrepareUploadAborted { session_id } => {
                self.sessions.lock().await.remove(&session_id);
                self.emit(NearbyEvent::ReceiveRequestAborted { session_id })
                    .await;
            }
            ServerEventV2::CancelReceived { session_id, .. } => {
                if let Some(token) = self.send_sessions.lock().unwrap().get(&session_id) {
                    token.cancel();
                }
                self.emit(NearbyEvent::SendCancelledByPeer { session_id })
                    .await;
            }
            ServerEventV2::ListenerFailed { error } => {
                self.emit(NearbyEvent::ListenerFailed(error)).await;
            }
        }
    }

    async fn handle_prepare_upload(
        self: &Arc<Self>,
        session_id: String,
        ip: String,
        info: localsend::http::dto_v2::RegisterDtoV2,
        files: HashMap<String, FileDto>,
        decision_tx: oneshot::Sender<PrepareUploadDecisionV2>,
    ) {
        let incoming: Vec<IncomingFile> = files
            .values()
            .map(|file| IncomingFile {
                id: file.id.clone(),
                name: file.file_name.clone(),
                size: file.size,
            })
            .collect();
        let total_size = incoming.iter().map(|file| file.size).sum();
        let (app_decision_tx, app_decision_rx) = oneshot::channel();

        let request = ReceiveRequest {
            session_id: session_id.clone(),
            sender_alias: info.alias.clone(),
            sender_device_type: DeviceType::from_protocol(info.device_type.as_ref()),
            sender_fingerprint: info.fingerprint.clone(),
            sender_ip: ip,
            files: incoming,
            total_size,
            decision_tx: app_decision_tx,
        };

        // Track the session so later FileUpload events can be matched and the
        // session can be cancelled while pending.
        self.sessions.lock().await.insert(
            session_id.clone(),
            ReceiveSession {
                files,
                total: total_size,
                output_dir: PathBuf::new(),
                transferred_base: 0,
                saved: Vec::new(),
                failed: Vec::new(),
                cancelled: false,
            },
        );

        self.emit(NearbyEvent::ReceiveRequest(request)).await;
        tracing::info!("Nearby receive request {session_id} from {}", info.alias);

        // Answer the protocol side once the application decides, in a task so
        // this handler returns immediately. Dropping the decision channel
        // (application went away) declines.
        let inner = Arc::clone(self);
        tokio::spawn(async move {
            match app_decision_rx.await {
                Ok(NearbyIncomingDecision::Accept { output_dir }) => {
                    let accepted: HashSet<String> = {
                        let mut sessions = inner.sessions.lock().await;
                        match sessions.get_mut(&session_id) {
                            Some(session) => {
                                session.output_dir = output_dir;
                                session.files.keys().cloned().collect()
                            }
                            None => return,
                        }
                    };
                    let _ = decision_tx.send(PrepareUploadDecisionV2::Accept(accepted));
                }
                Ok(NearbyIncomingDecision::Decline) | Err(_) => {
                    inner.sessions.lock().await.remove(&session_id);
                    let _ = decision_tx.send(PrepareUploadDecisionV2::Decline);
                }
            }
        });
    }

    async fn handle_file_upload(
        self: &Arc<Self>,
        session_id: String,
        file: FileDto,
        target_tx: oneshot::Sender<FileUploadTarget>,
    ) {
        let (output_dir, total, cancelled) = {
            let sessions = self.sessions.lock().await;
            match sessions.get(&session_id) {
                Some(session) => (session.output_dir.clone(), session.total, session.cancelled),
                None => {
                    tracing::warn!("Upload for unknown session {session_id}");
                    return;
                }
            }
        };
        if cancelled || output_dir.as_os_str().is_empty() {
            // Session was cancelled or not accepted; dropping the target
            // answers the upload with a 500.
            return;
        }

        let safe_name = filename::sanitize_path(&file.file_name, Rules::current());
        let path = unique_child_path(&output_dir, &safe_name);
        // Nested names (folder sends) need their parent directories.
        if let Some(parent) = path.parent() {
            if let Err(err) = tokio::fs::create_dir_all(parent).await {
                tracing::warn!(
                    "Could not create receive directory {}: {err}",
                    parent.display()
                );
                return;
            }
        }

        // The server writes the file itself (with checksum verification and
        // timestamp application) and reports per-file progress, which we
        // bridge into cumulative session progress.
        let (progress_tx, mut progress_rx) = mpsc::channel::<u64>(8);
        let (result_tx, result_rx) = oneshot::channel();
        if target_tx
            .send(FileUploadTarget::Path {
                path: path.clone(),
                result_tx,
                progress_tx: Some(progress_tx),
            })
            .is_err()
        {
            return;
        }

        {
            let event_tx = self.event_tx.clone();
            let inner = Arc::clone(self);
            let session_id_progress = session_id.clone();
            let file_name = file.file_name.clone();
            tokio::spawn(async move {
                while let Some(written) = progress_rx.recv().await {
                    let base = {
                        let sessions = inner.sessions.lock().await;
                        sessions
                            .get(&session_id_progress)
                            .map(|session| session.transferred_base)
                            .unwrap_or(0)
                    };
                    let _ = event_tx
                        .send(NearbyEvent::ReceiveProgress {
                            session_id: session_id_progress.clone(),
                            transferred: base + written,
                            total,
                            current_file: Some(file_name.clone()),
                        })
                        .await;
                }
            });
        }

        // Record the outcome and roll the byte base forward for the next file.
        {
            let inner = Arc::clone(self);
            tokio::spawn(async move {
                let outcome = result_rx.await;
                let mut sessions = inner.sessions.lock().await;
                let Some(session) = sessions.get_mut(&session_id) else {
                    return;
                };
                match outcome {
                    Ok(Ok(())) => {
                        session.saved.push(path);
                        session.transferred_base += file.size;
                    }
                    Ok(Err(message)) => {
                        session
                            .failed
                            .push(format!("{}: {message}", file.file_name));
                        drop(sessions);
                        let _ = tokio::fs::remove_file(&path).await;
                    }
                    Err(_) => {
                        session
                            .failed
                            .push(format!("{}: transfer interrupted", file.file_name));
                        drop(sessions);
                        let _ = tokio::fs::remove_file(&path).await;
                    }
                }
            });
        }
    }

    async fn handle_session_end(&self, session_id: String, reason: SessionEndReasonV2) {
        tracing::info!("Nearby session {session_id} ended: {reason:?}");
        let session = self.sessions.lock().await.remove(&session_id);
        let Some(session) = session else {
            return;
        };
        let outcome = if session.cancelled || matches!(reason, SessionEndReasonV2::Cancelled) {
            ReceiveOutcome::Cancelled
        } else if session.failed.is_empty() {
            ReceiveOutcome::Completed {
                saved: session.saved,
            }
        } else {
            ReceiveOutcome::Failed {
                message: session.failed.join(", "),
                saved: session.saved,
            }
        };
        self.emit(NearbyEvent::ReceiveFinished {
            session_id,
            outcome,
        })
        .await;
    }
}

/// Maps a discovered LocalSend device onto the UI-facing shape.
fn stateful_to_nearby(device: &localsend::discovery::StatefulDevice) -> NearbyDevice {
    let mut addresses: Vec<String> = device
        .get_ranked_channels()
        .into_iter()
        .filter_map(|channel| channel.http())
        .map(|http| format!("{}:{}", http.host, http.port))
        .collect();
    addresses.dedup();
    NearbyDevice {
        id: device.device.fingerprint.clone(),
        name: device.device.alias.clone(),
        device_type: DeviceType::from_protocol(device.device.device_type.as_ref()),
        addresses,
    }
}

/// Picks a collision-free path for `name` inside `dir`.
fn unique_child_path(dir: &std::path::Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = std::path::Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 2..1000 {
        let candidate = match extension {
            Some(extension) => dir.join(format!("{stem} ({index}).{extension}")),
            None => dir.join(format!("{stem} ({index})")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{}-{name}", uuid::Uuid::new_v4()))
}
