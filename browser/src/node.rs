//! Sendme node implementation for WebAssembly
//!
//! This module provides a SendmeNode that wraps iroh-blobs functionality
//! for use in WebAssembly/browser environments.

use anyhow::Result;
use bytes::Bytes;
use iroh::{discovery::static_provider::StaticProvider, protocol::Router, Endpoint, EndpointId};
use iroh_blobs::{
    api::{blobs::BlobStatus, downloader::Downloader, Store},
    ticket::BlobTicket,
    BlobFormat, Hash,
};

/// Sendme node for browser/WebAssembly environments
///
/// Uses in-memory storage and WebAssembly-compatible networking.
#[derive(Clone)]
pub struct SendmeNode {
    discovery: StaticProvider,
    router: Router,
    pub blobs: Store,
    downloader: Downloader,
}

impl SendmeNode {
    /// Spawn a new sendme node
    pub async fn spawn() -> Result<Self> {
        let discovery = StaticProvider::default();
        let endpoint = Endpoint::bind().await?;
        endpoint.discovery().add(discovery.clone());

        // Use in-memory store for WebAssembly
        let store = iroh_blobs::store::mem::MemStore::default();
        let downloader = Downloader::new(&store, &endpoint);

        let blobs = iroh_blobs::BlobsProtocol::new(&store, None);
        let router = Router::builder(endpoint)
            .accept(iroh_blobs::ALPN, blobs)
            .spawn();

        Ok(Self {
            blobs: store.as_ref().clone(),
            router,
            downloader,
            discovery,
        })
    }

    /// Get the endpoint ID as a string
    pub fn endpoint_id(&self) -> String {
        self.router.endpoint().id().to_string()
    }

    /// Get the endpoint
    pub fn endpoint(&self) -> &Endpoint {
        self.router.endpoint()
    }

    /// Get the current relay URLs
    pub fn relay_urls(&self) -> Vec<String> {
        self.router
            .endpoint()
            .addr()
            .relay_urls()
            .map(|url| url.to_string())
            .collect()
    }

    /// Get local addresses
    pub fn local_addrs(&self) -> Vec<String> {
        self.router
            .endpoint()
            .addr()
            .ip_addrs()
            .map(|addr| addr.to_string())
            .collect()
    }

    /// Import data and create a ticket for sharing
    ///
    /// This creates a proper BlobTicket with endpoint addressing information
    /// that can be shared with others for P2P file transfer.
    pub async fn import_and_create_ticket(&self, _name: String, data: Bytes) -> Result<String> {
        let tag = self.blobs.add_bytes(data).await?;
        tracing::info!(?tag, "imported!");

        // Wait for endpoint to be online
        self.endpoint().online().await;
        let addr = self.endpoint().addr();
        tracing::info!("Creating ticket with addr: {:?}", addr);

        // Create a BlobTicket with the raw blob hash
        let ticket = BlobTicket::new(addr, tag.hash, tag.format);

        Ok(ticket.to_string())
    }

    /// Get data by ticket string
    ///
    /// The ticket string contains both the peer's addressing information
    /// and the hash of the data to fetch.
    ///
    /// First checks local store, then attempts P2P fetch from remote peer.
    pub async fn get(&self, ticket_str: String) -> Result<Bytes> {
        // Parse the ticket
        let ticket: BlobTicket = ticket_str.parse()?;
        let hash = ticket.hash();

        // Check if we have it locally
        let status = self.blobs.status(hash).await?;
        let has_local = matches!(status, BlobStatus::Complete { .. });

        if has_local {
            tracing::info!("Blob found locally, fetching from store");
            return self.blobs.get_bytes(hash).await;
        }

        // Download from remote peer
        tracing::info!("Blob not local, attempting remote fetch");
        self.discovery.add_endpoint_info(ticket.addr().clone());
        self.downloader
            .download(ticket.hash_and_format(), [ticket.addr().id])
            .await?;

        tracing::info!("Download complete, getting bytes from store");
        let bytes = self.blobs.get_bytes(hash).await?;

        Ok(bytes)
    }

    /// Check if a blob exists and is complete
    pub async fn has_blob(&self, hash: String) -> Result<bool> {
        let hash: Hash = hash.parse()?;
        let status = self.blobs.status(hash).await?;
        let is_complete = matches!(status, BlobStatus::Complete { .. });
        Ok(is_complete)
    }

    /// Wait for the endpoint to be ready with addresses
    pub async fn wait_for_ready(&self, duration_ms: u64) -> Result<bool> {
        let endpoint = self.router.endpoint();
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(duration_ms);

        loop {
            let addr = endpoint.addr();
            if addr.relay_urls().next().is_some() || addr.ip_addrs().next().is_some() {
                return Ok(true);
            }

            if start.elapsed() > timeout {
                return Ok(false);
            }

            // Sleep using JavaScript setTimeout (WASM-compatible)
            sleep_ms(100).await?;
        }
    }
}

/// WASM-compatible sleep using JavaScript setTimeout
async fn sleep_ms(ms: i32) -> Result<()> {
    use wasm_bindgen::JsCast;
    use wasm_bindgen_futures::JsFuture;

    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        let window = web_sys::window().expect("no global `window` exists");
        window
            .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms)
            .expect("should register setTimeout handler");
    });

    JsFuture::from(promise)
        .await
        .map_err(|e| anyhow::anyhow!("Sleep error: {:?}", e))?;

    Ok(())
}

    /// Get the endpoint ID as a string
    pub fn endpoint_id(&self) -> String {
        self.endpoint_id.to_string()
    }

    /// Get the current relay URLs
    pub fn relay_urls(&self) -> Vec<String> {
        self.router
            .endpoint()
            .addr()
            .relay_urls()
            .map(|url| url.to_string())
            .collect()
    }

    /// Get local addresses
    pub fn local_addrs(&self) -> Vec<String> {
        self.router
            .endpoint()
            .addr()
            .ip_addrs()
            .map(|addr| addr.to_string())
            .collect()
    }

    /// Import data and create a ticket for sharing
    ///
    /// This creates a proper BlobTicket with endpoint addressing information
    /// that can be shared with others for P2P file transfer.
    pub async fn import_and_create_ticket(&self, _name: String, data: Bytes) -> Result<String> {
        // Add the data to the store
        let tag = self.store.add_bytes(data).await?;
        let hash = tag.hash;

        let addr = self.router.endpoint().addr();

        tracing::info!("Creating ticket with addr: {:?}", addr);

        // Create a BlobTicket with the raw blob hash
        let ticket = BlobTicket::new(addr, hash, BlobFormat::Raw);

        Ok(ticket.to_string())
    }

    /// Get data by ticket string
    ///
    /// The ticket string contains both the peer's addressing information
    /// and the hash of the data to fetch.
    ///
    /// First checks local store, then attempts P2P fetch from remote peer.
    pub async fn get(&self, ticket_str: String) -> Result<Bytes> {
        // Parse the ticket
        let ticket: BlobTicket = ticket_str.parse()?;
        let hash_and_format = ticket.hash_and_format();
        let hash = hash_and_format.hash;

        // Check if we have it locally
        let status = self.store.status(hash).await?;
        let has_local = matches!(status, iroh_blobs::api::blobs::BlobStatus::Complete { .. });

        if has_local {
            tracing::info!("Blob found locally, fetching from store");
            return self
                .store
                .get_bytes(hash)
                .await
                .map_err(|e| anyhow::anyhow!(e));
        }

        // Try to fetch from remote peer
        tracing::info!("Blob not local, attempting remote fetch");

        let endpoint = self.router.endpoint();
        let addr = ticket.addr().clone();

        // Connect to the peer
        let connection = endpoint
            .connect(addr, iroh_blobs::protocol::ALPN)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to connect to peer: {}", e))?;

        tracing::info!("Connected to peer, fetching blob");

        // Get hash sequence and sizes
        let (_hash_seq, _sizes) =
            get_hash_seq_and_sizes(&connection, &hash, 1024 * 1024 * 32, None)
                .await
                .map_err(|e| {
                    tracing::error!("Failed to get hash seq: {:?}", e);
                    map_get_error(e)
                })?;

        // Since we're using raw blobs (not collections), the data should already be in the store
        tracing::info!("Fetch complete, getting bytes from store");

        let bytes = self
            .store
            .get_bytes(hash)
            .await
            .map_err(|e| anyhow::anyhow!(e))?;

        Ok(bytes)
    }

    /// Check if a blob exists and is complete
    pub async fn has_blob(&self, hash: String) -> Result<bool> {
        let hash: Hash = hash.parse()?;
        let status = self.store.status(hash).await?;
        let is_complete = matches!(status, iroh_blobs::api::blobs::BlobStatus::Complete { .. });
        Ok(is_complete)
    }

    /// Wait for the endpoint to be ready with addresses
    pub async fn wait_for_ready(&self, duration_ms: u64) -> Result<bool> {
        let endpoint = self.router.endpoint();
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(duration_ms);

        loop {
            let addr = endpoint.addr();
            if addr.relay_urls().next().is_some() || addr.ip_addrs().next().is_some() {
                return Ok(true);
            }

            if start.elapsed() > timeout {
                return Ok(false);
            }

            // Sleep using JavaScript setTimeout (WASM-compatible)
            let promise = js_sys::Promise::new(&mut |resolve, _reject| {
                let window = web_sys::window().expect("no global `window` exists");
                let timeout_ms = 100;
                window
                    .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, timeout_ms)
                    .expect("should register setTimeout handler");
            });
            JsFuture::from(promise)
                .await
                .map_err(|e| anyhow::anyhow!("Sleep error: {:?}", e))?;
        }
    }
}

/// Map GetError to more readable error
fn map_get_error(e: GetError) -> anyhow::Error {
    match &e {
        GetError::InitialNext { .. } => {
            anyhow::anyhow!("Failed to establish initial connection")
        }
        GetError::ConnectedNext { .. } => {
            anyhow::anyhow!("Connection failed after established")
        }
        GetError::AtBlobHeaderNext { .. } => {
            anyhow::anyhow!("Failed to read blob header")
        }
        GetError::Decode { .. } => {
            anyhow::anyhow!("Failed to decode data")
        }
        GetError::IrpcSend { .. } => {
            anyhow::anyhow!("Failed to send data through connection")
        }
        GetError::AtClosingNext { .. } => {
            anyhow::anyhow!("Connection closed unexpectedly")
        }
        GetError::BadRequest { .. } => {
            anyhow::anyhow!("Peer rejected our request")
        }
        GetError::LocalFailure { .. } => {
            anyhow::anyhow!("Local storage error")
        }
    }
}
