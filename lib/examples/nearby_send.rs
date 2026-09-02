//! Debug sender: sends a file to a nearby device using the LocalSend
//! protocol, like the official client does.
//!
//! Usage: cargo run -p sendme-lib --example nearby_send -- <host> <port> <fingerprint> <file>

use anyhow::Context;
use localsend::http::client::LsHttpClientV2;
use localsend::http::dto_v2::{PrepareUploadRequestDtoV2, RegisterDtoV2};
use localsend::model::discovery::{DeviceType, ProtocolType, PROTOCOL_VERSION_V2};
use localsend::model::transfer::FileDto;
use std::collections::HashMap;
use tokio_util::sync::CancellationToken;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "localsend=debug".parse().unwrap()),
        )
        .init();

    let mut args = std::env::args().skip(1);
    let host = args.next().unwrap_or_else(|| "127.0.0.1".to_string());
    let port: u16 = args.next().context("port")?.parse()?;
    let fingerprint = args.next().context("fingerprint")?;
    let file_path = args.next().context("file")?;

    let data = std::fs::read(&file_path)?;
    let name = std::path::Path::new(&file_path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let sha256 = localsend::crypto::hash::sha256_hex(&data);

    let cert = localsend::crypto::cert::generate_self_signed()?;
    let client = LsHttpClientV2::try_new(&cert.private_key_pem, &cert.certificate_pem, None, None)?;

    let mut files = HashMap::new();
    files.insert(
        "file-0".to_string(),
        FileDto {
            id: "file-0".to_string(),
            file_name: name.clone(),
            size: data.len() as u64,
            file_type: "application/octet-stream".to_string(),
            sha256: Some(sha256),
            preview: None,
            metadata: None,
        },
    );

    let prepared = client
        .prepare_upload(
            ProtocolType::Https,
            &host,
            port,
            None,
            PrepareUploadRequestDtoV2 {
                info: RegisterDtoV2 {
                    alias: "DebugSender".to_string(),
                    version: PROTOCOL_VERSION_V2.to_string(),
                    device_model: Some("debug".to_string()),
                    device_type: Some(DeviceType::Desktop),
                    fingerprint: cert.fingerprint.clone(),
                    port: 0,
                    protocol: ProtocolType::Https,
                    download: false,
                },
                files,
            },
            None,
            CancellationToken::new(),
        )
        .await?;
    println!("prepare_upload -> {}", prepared.status_code);

    let Some(response) = prepared.response else {
        println!("Nothing to transfer (204)");
        return Ok(());
    };
    println!("session_id: {}", response.session_id);
    let token = response.files.get("file-0").context("token")?.clone();

    if let Err(err) = client
        .upload(
            ProtocolType::Https,
            &host,
            port,
            None,
            &response.session_id,
            "file-0",
            &token,
            localsend::reqwest::Body::from(data),
            CancellationToken::new(),
        )
        .await
    {
        eprintln!("upload failed: {err:?}");
        return Err(err.into());
    }
    println!("upload done: {name}");
    Ok(())
}
