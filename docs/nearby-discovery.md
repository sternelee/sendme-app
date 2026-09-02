# Nearby Device Discovery — LocalSend Protocol

Nearby sharing now speaks the **LocalSend protocol v2.2** (HTTPS), making
sendme interoperable with official LocalSend clients on the same LAN. The
previous custom mDNS + iroh handshake (`_sendme._udp`, ALPN
`sendme/transfer/v1`) was removed in favor of the vendored `localsend` crate.

## Architecture

```
app/src-tauri (commands/events, UI contract)
      │
lib/src/nearby/            sendme-facing wrapper
  ├── types.rs             DeviceType / NearbyDevice (serde contract)
  ├── identity.rs          Persistent certificate identity (fingerprint)
  └── runtime.rs           NearbyRuntime: discovery + receive + two-phase send
      │
localsend/                 vendored from localsend/packages/core
  ├── discovery/           UDP multicast 224.0.0.167:53317 announce/register
  ├── http/server/v2.rs    HTTPS server, /api/localsend/v2/*
  └── http/client/v2.rs    register + prepare-upload + upload
```

## Protocol behavior

- **Discovery**: UDP multicast announcements on `224.0.0.167:53317`. A new
  device announces itself; existing devices answer by POSTing
  `/api/localsend/v2/register` to the announcer's HTTPS server.
- **Identity**: each install generates a self-signed certificate persisted at
  `app_data_dir/nearby/localsend-identity.json`; its SHA-256 fingerprint is
  the stable device ID (`NearbyDevice.id`).
- **Send**: two-phase — `POST /prepare-upload` (metadata, receiver may accept
  or decline) then one `POST /upload?sessionId&fileId&token` per file with
  SHA-256 checksum verification on write.
- **Receive**: the server streams accepted files to disk directly, verifies
  checksums, and applies mtimes.

## Platform notes

- **Port**: the HTTPS server prefers LocalSend's canonical `53317` and falls
  back to an OS-assigned port when occupied. The actual port is announced in
  discovery messages.
- **Android**: multicast works when the app holds the Wi-Fi multicast lock;
  the existing `CHANGE_WIFI_MULTICAST_STATE` permission still applies.
- **iOS**: without the `com.apple.developer.networking.multicast` entitlement
  (unavailable to personal teams), the device cannot *receive* UDP multicast,
  so it does not see multicast announcements. HTTPS server and outbound
  register/probe still work: transfers function once the peer is known (e.g.
  after the peer announces and a registration arrives via broadcast on some
  networks). This is a platform limitation, not a code bug.
- **v1 HTTP fallback**: the vendored client and server negotiate
  `protocol: http` for peers that announce HTTP, matching official clients.

## Historical note: the old mDNS approach

The old `_sendme._udp` mDNS design suffered instance-name conflicts when
several devices ran simultaneously (each platform's mDNS daemon resolved the
clash differently, so device lists disagreed). LocalSend's multicast +
register design has no such uniqueness requirement: announcements carry a
random message ID and registrations go straight to the announcer's server.

## Related code

- `localsend/` — vendored protocol crate (see its README/licenses)
- `lib/src/nearby/` — sendme wrapper (runtime, identity, types)
- `app/src-tauri/src/lib.rs` — Tauri commands and event mapping
- `lib/tests/nearby.rs` — in-process end-to-end roundtrip and decline tests
