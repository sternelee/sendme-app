//! Debug receiver: runs the nearby runtime, logs every event, auto-accepts
//! incoming transfers into a temp directory.
//!
//! Usage: cargo run -p sendme-lib --example nearby_sink

use sendme_lib::nearby::{
    NearbyEvent, NearbyIdentity, NearbyIncomingDecision, NearbyRuntime, NearbyRuntimeConfig,
};
use tokio::sync::mpsc;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sendme_lib=debug,localsend=debug".parse().unwrap()),
        )
        .init();

    let out_dir = std::env::temp_dir().join("sendme-nearby-sink");
    tokio::fs::create_dir_all(&out_dir).await?;
    println!("Receiving into {}", out_dir.display());

    let identity_dir = std::env::temp_dir().join("sendme-nearby-sink-identity");
    tokio::fs::create_dir_all(&identity_dir).await?;
    let identity = NearbyIdentity::load_or_create(&identity_dir)?;

    let (event_tx, mut event_rx) = mpsc::channel(64);
    let runtime = NearbyRuntime::start(NearbyRuntimeConfig {
        alias: "SendmeSink".to_string(),
        device_type: sendme_lib::DeviceType::Desktop,
        device_model: Some("debug".to_string()),
        identity,
        port: 53317,
        event_tx,
    })
    .await?;
    println!("Listening on port {}; devices:", runtime.port());

    runtime.announce().await;

    while let Some(event) = event_rx.recv().await {
        match event {
            NearbyEvent::DevicesChanged(devices) => {
                for device in devices {
                    println!(
                        "  device: {} ({}) {:?} {}",
                        device.name,
                        device.id,
                        device.device_type,
                        device.addresses.join(", ")
                    );
                }
            }
            NearbyEvent::ReceiveRequest(request) => {
                println!(
                    "REQUEST {} from {} ({}):",
                    request.session_id, request.sender_alias, request.sender_ip
                );
                for file in &request.files {
                    println!("    {} ({} bytes)", file.name, file.size);
                }
                request
                    .decision_tx
                    .send(NearbyIncomingDecision::Accept {
                        output_dir: out_dir.clone(),
                    })
                    .expect("accept");
                println!("  -> accepted");
            }
            NearbyEvent::ReceiveProgress {
                session_id,
                transferred,
                total,
                current_file,
            } => {
                println!(
                    "  progress {session_id}: {transferred}/{total} ({:?})",
                    current_file
                );
            }
            NearbyEvent::ReceiveFinished { session_id, outcome } => {
                println!("FINISHED {session_id}: {outcome:?}");
            }
            other => println!("event: {other:?}"),
        }
    }
    Ok(())
}
