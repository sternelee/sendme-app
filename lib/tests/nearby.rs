//! End-to-end test of the nearby runtime: two in-process runtimes connect
//! over loopback HTTPS and transfer a file using the LocalSend protocol.

use std::time::Duration;

use sendme_lib::nearby::{
    NearbyEvent, NearbyIdentity, NearbyIncomingDecision, NearbyRuntime, NearbyRuntimeConfig,
    NearbySendEvent, ReceiveOutcome,
};
use sendme_lib::OutgoingFile;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

async fn start_runtime(
    dir: &std::path::Path,
    alias: &str,
) -> (NearbyRuntime, mpsc::Receiver<NearbyEvent>) {
    let identity = NearbyIdentity::load_or_create(dir).expect("identity");
    let (event_tx, event_rx) = mpsc::channel(64);
    let runtime = NearbyRuntime::start(NearbyRuntimeConfig {
        alias: alias.to_string(),
        device_type: sendme_lib::DeviceType::Desktop,
        device_model: Some("test".to_string()),
        identity,
        port: 0, // OS-assigned: two runtimes share this machine
        event_tx,
    })
    .await
    .expect("runtime start");
    (runtime, event_rx)
}

#[tokio::test(flavor = "multi_thread")]
async fn nearby_send_receive_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let receive_dir = dir.path().join("received");
    std::fs::create_dir_all(&receive_dir).unwrap();

    let (runtime_a, mut events_a) = start_runtime(&dir.path().join("a"), "ReceiverA").await;
    let (runtime_b, _events_b) = start_runtime(&dir.path().join("b"), "SenderB").await;

    // B discovers A via a direct register probe (deterministic, no multicast).
    let found = runtime_b
        .discover(
            "127.0.0.1",
            runtime_a.port(),
            localsend::model::discovery::ProtocolType::Https,
        )
        .await
        .expect("probe A");
    assert!(found, "A should answer the probe");
    let device_a = runtime_b
        .devices()
        .into_iter()
        .find(|device| device.name == "ReceiverA")
        .expect("A in B's device list");

    // The file to send.
    let payload = b"hello nearby world".to_vec();
    let source = dir.path().join("hello.txt");
    std::fs::write(&source, &payload).unwrap();

    // A waits for the request, accepts it, and waits for completion.
    let receive_dir_clone = receive_dir.clone();
    let receiver = tokio::spawn(async move {
        let mut saved_files = Vec::new();
        while let Some(event) = events_a.recv().await {
            match event {
                NearbyEvent::ReceiveRequest(request) => {
                    assert_eq!(request.sender_alias, "SenderB");
                    assert_eq!(request.files.len(), 1);
                    assert_eq!(request.files[0].name, "hello.txt");
                    request
                        .decision_tx
                        .send(NearbyIncomingDecision::Accept {
                            output_dir: receive_dir_clone.clone(),
                        })
                        .expect("decision");
                }
                NearbyEvent::ReceiveFinished { outcome, .. } => match outcome {
                    ReceiveOutcome::Completed { saved } => {
                        saved_files = saved;
                        break;
                    }
                    other => panic!("receive failed: {other:?}"),
                },
                _ => {}
            }
        }
        saved_files
    });

    // B sends.
    let session = runtime_b
        .prepare_send(
            &device_a.id,
            vec![OutgoingFile {
                path: source.clone(),
                name: "hello.txt".to_string(),
            }],
        )
        .await
        .expect("prepare_send");
    assert_eq!(session.receiver_alias(), "ReceiverA");
    assert_eq!(session.total(), payload.len() as u64);

    let (send_event_tx, mut send_events) = mpsc::channel(32);
    let upload = tokio::spawn(session.upload(send_event_tx, CancellationToken::new()));

    let mut saw_progress = false;
    let mut saw_done = false;
    while let Some(event) = send_events.recv().await {
        match event {
            NearbySendEvent::Progress { transferred, total } => {
                saw_progress = true;
                assert!(transferred <= total);
            }
            NearbySendEvent::Done => {
                saw_done = true;
                break;
            }
            other => panic!("unexpected send event: {other:?}"),
        }
    }
    upload.await.expect("upload task").expect("upload");

    let saved = tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .expect("receiver timed out")
        .expect("receiver task");

    assert!(saw_progress, "expected upload progress events");
    assert!(saw_done, "expected the Done event");
    assert_eq!(saved.len(), 1);
    assert_eq!(std::fs::read(&saved[0]).unwrap(), payload);
    assert_eq!(saved[0].parent().unwrap(), receive_dir);

    runtime_a.stop().await;
    runtime_b.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn nearby_decline_is_reported() {
    let dir = tempfile::tempdir().unwrap();

    let (runtime_a, mut events_a) = start_runtime(&dir.path().join("a"), "Decliner").await;
    let (runtime_b, _events_b) = start_runtime(&dir.path().join("b"), "SenderB").await;

    runtime_b
        .discover(
            "127.0.0.1",
            runtime_a.port(),
            localsend::model::discovery::ProtocolType::Https,
        )
        .await
        .expect("probe A");
    let device_a = runtime_b
        .devices()
        .into_iter()
        .find(|device| device.name == "Decliner")
        .expect("A in B's device list");

    // A declines every request.
    let answerer = tokio::spawn(async move {
        while let Some(event) = events_a.recv().await {
            if let NearbyEvent::ReceiveRequest(request) = event {
                request
                    .decision_tx
                    .send(NearbyIncomingDecision::Decline)
                    .expect("decision");
                break;
            }
        }
    });

    let source = dir.path().join("nope.txt");
    std::fs::write(&source, b"nope").unwrap();
    let result = runtime_b
        .prepare_send(
            &device_a.id,
            vec![OutgoingFile {
                path: source,
                name: "nope.txt".to_string(),
            }],
        )
        .await;

    assert!(matches!(
        result,
        Err(sendme_lib::NearbyPrepareError::Declined)
    ));

    answerer.await.expect("answerer");
    runtime_a.stop().await;
    runtime_b.stop().await;
}
