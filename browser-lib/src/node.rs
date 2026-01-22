//! Sendme node implementation for WebAssembly
//!
//! This module provides a SendmeNode that wraps iroh-blobs functionality
//! for use in WebAssembly/browser environments.

use anyhow::Result;
use bytes::Bytes;
use futures_lite::StreamExt;
use iroh::{discovery::static_provider::StaticProvider, protocol::Router, Endpoint};
use iroh_blobs::{
    api::{blobs::BlobStatus, Store},
    format::collection::Collection,
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
}

impl SendmeNode {
    /// Spawn a new sendme node
    pub async fn spawn() -> Result<Self> {
        let discovery = StaticProvider::default();
        let endpoint = Endpoint::bind().await?;
        endpoint.discovery().add(discovery.clone());

        // Use in-memory store for WebAssembly
        let store = iroh_blobs::store::mem::MemStore::default();

        let blobs = iroh_blobs::BlobsProtocol::new(&store, None);
        let router = Router::builder(endpoint)
            .accept(iroh_blobs::ALPN, blobs)
            .spawn();

        Ok(Self {
            blobs: store.as_ref().clone(),
            router,
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
    /// This creates a proper BlobTicket with HashSeq format (Collection)
    /// that can be shared with others for P2P file transfer.
    /// The Collection format preserves the filename and is compatible with CLI/App.
    pub async fn import_and_create_ticket(&self, name: String, data: Bytes) -> Result<String> {
        // 1. Add the raw blob data to the store
        let tag = self.blobs.add_bytes(data).await?;
        let blob_hash = tag.hash;
        tracing::info!(?tag, "blob imported with hash: {}", blob_hash);

        // 2. Create a Collection with the filename using FromIterator
        let collection: Collection = std::iter::once((name, blob_hash)).collect();
        tracing::info!("Collection created with 1 file");

        // 3. Store the Collection
        let collection_tag = collection.store(&self.blobs).await?;
        let collection_hash = collection_tag.hash();
        tracing::info!("Collection stored with hash: {}", collection_hash);

        // 4. Wait for endpoint to be online
        self.endpoint().online().await;
        let addr = self.endpoint().addr();
        tracing::info!("Creating ticket with addr: {:?}", addr);

        // 5. Create a BlobTicket with HashSeq format (compatible with CLI/App)
        let ticket = BlobTicket::new(addr, collection_hash, BlobFormat::HashSeq);

        Ok(ticket.to_string())
    }

    /// Import multiple files as a collection and create a ticket
    ///
    /// This creates a Collection containing all provided files and returns
    /// a BlobTicket that can be shared with others for P2P file transfer.
    /// Preserves directory structure through file paths.
    pub async fn import_collection_and_create_ticket(
        &self,
        files: Vec<(String, Bytes)>,
    ) -> Result<String> {
        // 1. Import all blobs and collect their hashes
        let mut collection_entries = Vec::new();
        for (name, data) in files {
            let tag = self.blobs.add_bytes(data).await?;
            tracing::info!("Imported file: {} with hash: {}", name, tag.hash);
            collection_entries.push((name, tag.hash));
        }

        // 2. Create a Collection from all files
        let collection: Collection = collection_entries.into_iter().collect();
        tracing::info!("Collection created with {} files", collection.iter().count());

        // 3. Store the Collection
        let collection_tag = collection.store(&self.blobs).await?;
        let collection_hash = collection_tag.hash();
        tracing::info!("Collection stored with hash: {}", collection_hash);

        // 4. Wait for endpoint to be online
        self.endpoint().online().await;
        let addr = self.endpoint().addr();
        tracing::info!("Creating ticket with addr: {:?}", addr);

        // 5. Create a BlobTicket with HashSeq format (compatible with CLI/App)
        let ticket = BlobTicket::new(addr, collection_hash, BlobFormat::HashSeq);

        Ok(ticket.to_string())
    }

    /// Get data by ticket string
    ///
    /// The ticket string contains both the peer's addressing information
    /// and the hash of the data to fetch.
    ///
    /// First checks local store, then attempts P2P fetch from remote peer.
    /// Returns a tuple of (filename, data).
    pub async fn get(&self, ticket_str: String) -> Result<(String, Bytes)> {
        // Parse the ticket
        let ticket: BlobTicket = ticket_str.parse()?;
        let hash_and_format = ticket.hash_and_format();
        let collection_hash = hash_and_format.hash;

        tracing::info!(
            "Getting data for hash: {}, format: {:?}",
            collection_hash,
            hash_and_format.format
        );

        // Check if we have the collection locally
        let status = self.blobs.status(collection_hash).await?;
        let has_local = matches!(status, BlobStatus::Complete { .. });

        if !has_local {
            // Download from remote peer using direct connection
            tracing::info!("Collection not local, attempting remote fetch");
            self.discovery.add_endpoint_info(ticket.addr().clone());

            // Connect to the peer
            let endpoint = self.router.endpoint();
            let connection = endpoint
                .connect(ticket.addr().clone(), iroh_blobs::ALPN)
                .await?;

            tracing::info!("Connected to peer, starting download");

            // Get the local blob state
            let local = self.blobs.remote().local(hash_and_format).await?;

            // Execute get to download missing blobs
            let get = self.blobs.remote().execute_get(connection, local.missing());
            let mut stream = get.stream();

            // Consume the stream to download all data
            while let Some(item) = stream.next().await {
                match item {
                    iroh_blobs::api::remote::GetProgressItem::Progress(offset) => {
                        tracing::debug!("Downloaded {} bytes", offset);
                    }
                    iroh_blobs::api::remote::GetProgressItem::Done(_stats) => {
                        tracing::info!("Download complete");
                        break;
                    }
                    iroh_blobs::api::remote::GetProgressItem::Error(cause) => {
                        return Err(anyhow::anyhow!("Download failed: {:?}", cause));
                    }
                }
            }
        } else {
            tracing::info!("Collection found locally");
        }

        // Load the Collection to get filename and blob hash
        let collection = Collection::load(collection_hash, &self.blobs).await?;
        tracing::info!("Collection loaded with {} files", collection.iter().count());

        // Get the first (and should be only) file from the collection
        let (filename, blob_hash) = collection
            .iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("Collection is empty"))?;

        tracing::info!("Fetching blob: {} ({})", filename, blob_hash);

        // Get the actual file data
        let bytes = self.blobs.get_bytes(*blob_hash).await?;

        Ok((filename.to_string(), bytes))
    }

    /// Get all files from a collection by ticket string
    ///
    /// Returns all files in the collection as a vector of (filename, data) tuples.
    /// Useful for downloading folders/multiple files.
    pub async fn get_collection(&self, ticket_str: String) -> Result<Vec<(String, Bytes)>> {
        // Parse the ticket
        let ticket: BlobTicket = ticket_str.parse()?;
        let hash_and_format = ticket.hash_and_format();
        let collection_hash = hash_and_format.hash;

        // Check if we have the collection locally
        let status = self.blobs.status(collection_hash).await?;
        let has_local = matches!(status, BlobStatus::Complete { .. });

        if !has_local {
            // Download from remote peer using direct connection
            tracing::info!("Collection not local, attempting remote fetch");
            self.discovery.add_endpoint_info(ticket.addr().clone());

            // Connect to the peer
            let endpoint = self.router.endpoint();
            let connection = endpoint
                .connect(ticket.addr().clone(), iroh_blobs::ALPN)
                .await?;

            tracing::info!("Connected to peer, starting download");

            // Get the local blob state
            let local = self.blobs.remote().local(hash_and_format).await?;

            // Execute get to download missing blobs
            let get = self.blobs.remote().execute_get(connection, local.missing());
            let mut stream = get.stream();

            // Consume the stream to download all data
            while let Some(item) = stream.next().await {
                match item {
                    iroh_blobs::api::remote::GetProgressItem::Progress(offset) => {
                        tracing::debug!("Downloaded {} bytes", offset);
                    }
                    iroh_blobs::api::remote::GetProgressItem::Done(_stats) => {
                        tracing::info!("Download complete");
                        break;
                    }
                    iroh_blobs::api::remote::GetProgressItem::Error(cause) => {
                        return Err(anyhow::anyhow!("Download failed: {:?}", cause));
                    }
                }
            }
        } else {
            tracing::info!("Collection found locally");
        }

        // Load the Collection
        let collection = Collection::load(collection_hash, &self.blobs).await?;
        tracing::info!("Collection loaded with {} files", collection.iter().count());

        // Get all files from the collection
        let mut result = Vec::new();
        for (filename, blob_hash) in collection.iter() {
            tracing::info!("Fetching blob: {} ({})", filename, blob_hash);
            let bytes = self.blobs.get_bytes(*blob_hash).await?;
            result.push((filename.to_string(), bytes));
        }

        Ok(result)
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

        // Use a counter-based approach instead of wall-clock time for WASM compatibility
        let max_iterations = (duration_ms / 100) as usize; // Check every 100ms

        for _ in 0..max_iterations {
            let addr = endpoint.addr();
            if addr.relay_urls().next().is_some() || addr.ip_addrs().next().is_some() {
                return Ok(true);
            }

            // Sleep using JavaScript setTimeout (WASM-compatible)
            sleep_ms(100).await?;
        }

        // One final check
        let addr = endpoint.addr();
        Ok(addr.relay_urls().next().is_some() || addr.ip_addrs().next().is_some())
    }
}

/// WASM-compatible sleep using JavaScript setTimeout
async fn sleep_ms(ms: i32) -> Result<()> {
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
