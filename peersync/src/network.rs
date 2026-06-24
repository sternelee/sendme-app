use anyhow::{Context, Result};
use iroh::endpoint::presets::N0;
use iroh::protocol::Router;
use iroh::Endpoint;
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::BlobsProtocol;
use iroh_docs::api::protocol::AddrInfoOptions;
use iroh_docs::api::protocol::ShareMode;
use iroh_docs::api::Doc;
use iroh_docs::protocol::Docs;
use iroh_docs::{AuthorId, NamespaceId};
use iroh_gossip::net::Gossip;
use sendme_lib::types::RelayModeOption;

use crate::state::{iroh_data_dir, State};

/// Iroh network handle for peersync.
pub struct Network {
    pub endpoint: Endpoint,
    pub blobs: iroh_blobs::api::Store,
    pub docs: Docs,
    pub router: Router,
}

impl Network {
    /// Start the network stack with persistent storage.
    pub async fn start(
        config_dir: Option<&std::path::Path>,
        data_dir: Option<&std::path::Path>,
        state: &State,
    ) -> Result<Self> {
        let data_dir = iroh_data_dir(config_dir, data_dir)?;
        let blobs_dir = data_dir.join("blobs");
        let docs_dir = data_dir.join("docs");

        std::fs::create_dir_all(&blobs_dir).context("creating blobs dir")?;
        std::fs::create_dir_all(&docs_dir).context("creating docs dir")?;

        let secret_key = get_or_create_secret(state)?;
        let relay_mode: iroh::RelayMode = RelayModeOption::Default.into();

        let endpoint = Endpoint::builder(N0)
            .secret_key(secret_key)
            .relay_mode(relay_mode)
            .bind()
            .await
            .context("binding iroh endpoint")?;

        let blobs: iroh_blobs::api::Store = FsStore::load(&blobs_dir)
            .await
            .context("loading blobs store")?
            .into();
        let gossip = Gossip::builder().spawn(endpoint.clone());
        let docs = Docs::persistent(docs_dir)
            .spawn(endpoint.clone(), blobs.clone(), gossip.clone())
            .await
            .context("spawning docs protocol")?;

        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&blobs, None))
            .accept(iroh_gossip::ALPN, gossip)
            .accept(iroh_docs::ALPN, docs.clone())
            .spawn();

        Ok(Self {
            endpoint,
            blobs,
            docs,
            router,
        })
    }

    /// Create a new sync doc and return its namespace id.
    pub async fn create_doc(&self) -> Result<NamespaceId> {
        let doc = self.docs.create().await.context("creating doc")?;
        Ok(doc.id())
    }

    /// Import a doc ticket and return the namespace id.
    pub async fn import_ticket(&self, ticket: &str) -> Result<NamespaceId> {
        let ticket = ticket.parse().context("parsing doc ticket")?;
        let doc = self
            .docs
            .import(ticket)
            .await
            .context("importing doc ticket")?;
        Ok(doc.id())
    }

    /// Open a doc by namespace id.
    pub async fn open_doc(&self, namespace: NamespaceId) -> Result<Doc> {
        let doc = self
            .docs
            .open(namespace)
            .await
            .context("opening doc")?
            .context("doc not found")?;
        Ok(doc)
    }

    /// Share a doc ticket with write permission.
    pub async fn share_doc(&self, namespace: NamespaceId) -> Result<String> {
        let doc = self.open_doc(namespace).await?;
        let ticket = doc
            .share(ShareMode::Write, AddrInfoOptions::RelayAndAddresses)
            .await
            .context("sharing doc")?;
        Ok(ticket.to_string())
    }

    /// Get or create the default author.
    pub async fn default_author(&self) -> Result<AuthorId> {
        self.docs
            .author_default()
            .await
            .context("getting default author")
    }

    /// Shutdown the network stack.
    pub async fn shutdown(self) -> Result<()> {
        let _ = self.router.shutdown().await;
        Ok(())
    }
}

fn get_or_create_secret(state: &State) -> Result<iroh::SecretKey> {
    if let Some(secret) = &state.secret_key {
        let bytes = hex::decode(secret).context("decoding secret key hex")?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("secret key must be 32 bytes"))?;
        Ok(iroh::SecretKey::from_bytes(&bytes))
    } else {
        Ok(iroh::SecretKey::generate())
    }
}
