# Clerk Auth Redesign — Approach A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-store Rust-mediated token pipeline with Clerk JS as the single token source, matching the browser app's clean pattern.

**Architecture:** `cloud-api.ts` is initialized with a `getToken` callback from the auth context; all outgoing requests use `clerk.session.getToken()` directly. Rust no longer stores, refreshes, or distributes auth tokens. Two HTTP calls that previously required Rust-side auth (`register_cloud_device`, mark-ticket-as-received in `accept_cloud_ticket`) move to JS.

**Tech Stack:** SolidJS, TypeScript, Tauri v2, `@clerk/clerk-js`, `tauri-plugin-clerk`, Rust/Tokio

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `app/src/lib/cloud-api.ts` | Modify | Add `initCloudApi(getToken)`, replace IPC-based `getAuthorizationHeaderValue` / `refreshAuthorizationHeaderValue` with Clerk-direct calls, remove `syncCachedAuthorizationHeader` |
| `app/src/lib/auth.tsx` | Modify | Call `initCloudApi` after Clerk init, simplify `getToken()`, remove Rust store sync, remove durable token recovery block |
| `app/src/lib/cloud-ws.ts` | Modify | Replace `invoke("register_cloud_device")` with a JS HTTP call via `requestCloudApi`; existing `getAuthorizationHeaderValue` calls continue to work because the implementation now calls `_getToken()` |
| `app/src/routes/index.tsx` | Modify | After `accept_cloud_ticket` succeeds, perform the mark-as-received HTTP call from JS |
| `app/src/bindings.ts` | Modify | Remove `register_cloud_device` binding (no longer a Tauri command) |
| `app/src-tauri/src/lib.rs` | Modify | Delete `register_cloud_device` command; remove 4 auth-header Tauri commands + all helper functions; simplify `accept_cloud_ticket` to drop `current_cloud_authorization_header` call |

---

## Task 1: Wire `initCloudApi` into `cloud-api.ts`

**Files:**
- Modify: `app/src/lib/cloud-api.ts`

Add a module-level `_getToken` variable and an `initCloudApi` initialiser so all outgoing API calls can obtain a fresh Clerk JS token without any Rust IPC.

- [ ] **Step 1: Add the module-level getToken variable**

In `cloud-api.ts`, after the existing `import` block, add:

```typescript
// ---------------------------------------------------------------------------
// Token provider — injected by AuthProvider via initCloudApi()
// ---------------------------------------------------------------------------
let _getToken: () => Promise<string | null> = () => Promise.resolve(null);

/**
 * Called once from AuthProvider after the Clerk instance is ready.
 * After this point every outgoing cloud request obtains its token directly
 * from Clerk JS, with no Rust IPC hop.
 */
export function initCloudApi(getToken: () => Promise<string | null>): void {
  _getToken = getToken;
}
```

- [ ] **Step 2: Replace `getAuthorizationHeaderValue` implementation**

Find the existing `getAuthorizationHeaderValue` function (lines 135-159 in the original file).
Replace the entire function body so it calls `_getToken` instead of `invoke`:

```typescript
export async function getAuthorizationHeaderValue(): Promise<string | null> {
  const token = await _getToken();
  if (!token) return null;
  return `Bearer ${token}`;
}
```

- [ ] **Step 3: Replace `refreshAuthorizationHeaderValue` implementation**

Find `refreshAuthorizationHeaderValue` (lines 166-192). Replace with:

```typescript
/**
 * Clerk JS refreshes tokens automatically; calling getToken() again is sufficient.
 */
export async function refreshAuthorizationHeaderValue(): Promise<string | null> {
  return getAuthorizationHeaderValue();
}
```

- [ ] **Step 4: Remove `syncCachedAuthorizationHeader` and its dead imports**

Delete the `syncCachedAuthorizationHeader` function entirely (lines 112-133).

Remove these now-unused imports at the top of the file:
```typescript
import { invoke } from "@tauri-apps/api/core";
import {
  buildAuthorizationHeader,
  createCachedAuthSession,
  hasUsableCachedAuthSession,
  loadCachedAuthSession,
  saveCachedAuthSession,
} from "./auth-session";
```

Also delete `getCachedAuthorizationHeader` (lines 105-110) if it is only called inside `syncCachedAuthorizationHeader` (it is).

Also remove `getAuthorizationHeaders` (lines 194-197) which is exported but unused externally:
```typescript
// Delete this function:
export async function getAuthorizationHeaders(): Promise<HeadersInit> { ... }
```

- [ ] **Step 5: Build the frontend to verify no TS errors from this file**

```bash
cd app && pnpm run build 2>&1 | head -60
```

Expected: compile errors only from files not yet updated (auth.tsx, cloud-ws.ts) but **not** from `cloud-api.ts` itself.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/cloud-api.ts
git commit -m "app: wire initCloudApi — token now comes from Clerk JS not Rust"
```

---

## Task 2: Simplify `auth.tsx` — remove Rust store sync, simplify `getToken`

**Files:**
- Modify: `app/src/lib/auth.tsx`

- [ ] **Step 1: Remove `syncCloudAuthorizationHeader` and its callers**

Delete the entire `syncCloudAuthorizationHeader` function (lines 158-168):
```typescript
// DELETE this function entirely:
async function syncCloudAuthorizationHeader(
  session: CachedAuthSession | null,
): Promise<void> { ... }
```

Also remove the two lines in `applySession` that call it:
```typescript
// DELETE:
await syncCloudAuthorizationHeader(usableSession);
```

And the line in `runBackgroundRecovery`:
```typescript
// DELETE:
await syncCloudAuthorizationHeader(session());
```

- [ ] **Step 2: Remove stale import from cloud-api**

At the top of `auth.tsx`, the import from `./cloud-api` currently includes:
```typescript
import {
  extractBearerToken,
  getAuthorizationHeaderValue,
  getCloudApiOrigin,
  refreshAuthorizationHeaderValue,
} from "./cloud-api";
```

Replace with:
```typescript
import { getCloudApiOrigin, initCloudApi } from "./cloud-api";
```

(`extractBearerToken`, `getAuthorizationHeaderValue`, `refreshAuthorizationHeaderValue` are no longer used in `auth.tsx`.)

- [ ] **Step 3: Remove the durable token recovery block**

In `runBackgroundRecovery`, delete the block that calls `getAuthorizationHeaderValue()` and `refreshAuthorizationHeaderValue()` (lines 402-445 in the original file):

```typescript
// DELETE everything from:
try {
  const restoreUser = user() ?? persistedUser;

  let durableHeader = await getAuthorizationHeaderValue();
  // ... through ...
  } else if (!session()) {
    debugWarn("auth", "No durable session could be restored on startup");
    clearAuthState();
  }
} catch (error) {
  debugError("auth", "Background startup recovery failed", error);
} finally {
  if (!disposed) {
    setIsCloudReady(true);
  }
}
```

Replace that entire try/catch/finally with just:
```typescript
if (!disposed) {
  setIsCloudReady(true);
}
```

`isCloudReady` is now set immediately after Clerk initialization completes, no durable-header round-trip needed.

- [ ] **Step 4: Simplify `getToken()` to use Clerk JS directly**

Find the `getToken` function (lines 607-620):
```typescript
const getToken = async (): Promise<string | null> => {
  try {
    const durableHeader = await getAuthorizationHeaderValue();
    const durableToken = extractBearerToken(durableHeader);
    if (durableToken) {
      return durableToken;
    }
  } catch (error) {
    debugError("auth", "Failed to get token from Rust store", error);
  }

  const cached = loadCachedAuthSession();
  return hasUsableCachedAuthSession(cached) ? cached.token : null;
};
```

Replace entirely with:
```typescript
const getToken = async (): Promise<string | null> => {
  const clerk = clerkInstance();
  if (clerk?.session) {
    try {
      return await clerk.session.getToken();
    } catch (error) {
      debugError("auth", "clerk.session.getToken() failed", error);
    }
  }
  return null;
};
```

- [ ] **Step 5: Call `initCloudApi` after Clerk is initialized**

Inside `runBackgroundRecovery`, right after `setClerkInstance(clerk)` succeeds (around the existing `syncUserFromClerk(clerk)` line), add:

```typescript
setClerkInstance(clerk);
syncUserFromClerk(clerk);
// Wire cloud-api token source to Clerk JS immediately
initCloudApi(getToken);
```

- [ ] **Step 6: Remove `clear_cloud_authorization_header` invoke from `signOut`**

In `signOut` (around line 598), delete:
```typescript
// DELETE:
try {
  await invoke("clear_cloud_authorization_header");
} catch (error) {
  debugError("auth", "Failed to clear cloud auth header", error);
}
```

Also remove the `invoke` import from `@tauri-apps/api/core` if it is no longer used in `auth.tsx`. (Check: it's still used for `open_system_browser` and `set_cloud_authorization_header`... actually `set_cloud_authorization_header` is going away too. Verify after this step.)

After this change, `auth.tsx` should still have `invoke` for:
- `open_system_browser` (in `openClerkUrl`)
- `set_clerk_dev_browser_token` (in `syncClerkDevBrowserToken`)

So `invoke` import stays.

- [ ] **Step 7: Remove now-unused imports from auth-session in auth.tsx**

The import from `./auth-session` currently includes items that may now be unused. Verify and trim. After all changes, `auth.tsx` uses:
- `clearCachedAuthState` ✅ (in `clearAuthState`)
- `createCachedAuthSession` ✅ (in `extractSessionFromPayload`, `handleDeepLinkCallback`)
- `extractAuthCallbackData` ✅ (in `handleDeepLinkCallback`)
- `hasUsableCachedAuthSession` ✅ (in `applySession`, `initialSession`)
- `loadCachedAuthSession` ✅ (startup `cachedSession`)
- `loadCachedDevBrowserToken` ✅ 
- `loadCachedUser` ✅
- `saveCachedAuthSession` ✅ (in `applySession`)
- `saveCachedDevBrowserToken` ✅
- `saveCachedUser` ✅
- `UserInfo` ✅
- `CachedAuthSession` ✅
- `buildAuthorizationHeader` — now unused (was only in `syncCloudAuthorizationHeader`). **DELETE this import.**

- [ ] **Step 8: Build and check**

```bash
cd app && pnpm run build 2>&1 | head -80
```

Expected: errors should now be limited to cloud-ws.ts (using removed functions) and lib.rs (not built by pnpm). No errors in `auth.tsx` or `cloud-api.ts`.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/auth.tsx
git commit -m "app: simplify auth — getToken uses Clerk JS, remove Rust store sync"
```

---

## Task 3: Move `register_cloud_device` HTTP call to JS in `cloud-ws.ts`

**Files:**
- Modify: `app/src/lib/cloud-ws.ts`

The Rust `register_cloud_device` command makes an HTTP call using `current_cloud_authorization_header` (the broken path). Moving this call to JS lets it use `_getToken()` (Clerk JS) via `requestCloudApi`.

- [ ] **Step 1: Add imports for `requestCloudApi` and `getCloudApiUrl`**

At the top of `cloud-ws.ts`, in the `cloud-api` import:
```typescript
import {
  getCloudWebSocketUrl,
  getAuthorizationHeaderValue,
  refreshAuthorizationHeaderValue,
  extractBearerToken,
  getPersistentDeviceId,
  getCloudApiOrigin,
  describeAuthorizationHeader,
  createAuthTraceId,
  requestCloudApi,    // ADD
  getCloudApiUrl,     // ADD
} from "./cloud-api";
```

Also add invoke for get_nearby_profile:
```typescript
import { invoke } from "@tauri-apps/api/core";
```

(It's already imported.)

- [ ] **Step 2: Add `registerCloudDevice` helper function**

Add this function near the top of `cloud-ws.ts` (after the import block, before module-level state variables):

```typescript
interface NearbyProfile {
  name: string;
  device_type: string;
}

async function registerCloudDevice(
  deviceId: string,
  apiOrigin: string,
  traceId: string,
): Promise<void> {
  const profile = await invoke<NearbyProfile>("get_nearby_profile");
  const url = new URL("/api/devices", `${apiOrigin.replace(/\/+$/, "")}/`).toString();
  const response = await requestCloudApi(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        name: profile.name,
        hostname: profile.name,
      }),
    },
    {
      label: "cloud-devices",
      traceId,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown error");
    throw new Error(`Failed to register cloud device (${response.status}): ${body}`);
  }
}
```

- [ ] **Step 3: Replace the `invoke("register_cloud_device")` call**

In `connectCloudWebSocket`, find the registration loop (lines 136-179):
```typescript
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    ...
    await invoke("register_cloud_device", { deviceId, apiOrigin, traceId });
    ...
  } catch (e) {
    ...
    if (!shouldRetryWithRefresh) break;
    authHeader = await refreshAuthorizationHeaderValue();
    ...
  }
}
```

Replace `await invoke("register_cloud_device", { deviceId, apiOrigin, traceId });` with:
```typescript
await registerCloudDevice(deviceId, apiOrigin, traceId);
```

The retry loop logic stays. `requestCloudApi` already handles 401 retry internally (via `retryOnUnauthorized: true` default), so the outer loop can simplify — but to keep the diff minimal, leave the outer loop structure as-is. The inner `authHeader = await refreshAuthorizationHeaderValue()` lines are harmless (they now call `_getToken()` again).

- [ ] **Step 4: Build frontend to confirm no errors in cloud-ws.ts**

```bash
cd app && pnpm run build 2>&1 | grep "cloud-ws"
```

Expected: no errors from `cloud-ws.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/cloud-ws.ts
git commit -m "app: register_cloud_device HTTP call moved to JS, uses Clerk JS token"
```

---

## Task 4: Move mark-as-received HTTP call to JS in `routes/index.tsx`

**Files:**
- Modify: `app/src/routes/index.tsx`

The Rust `accept_cloud_ticket` command currently marks the ticket as received via a best-effort HTTP POST. We remove that call from Rust and do it in JS after the command returns.

- [ ] **Step 1: Add imports**

Near the top of `index.tsx`, add to the cloud-api import:
```typescript
import { requestCloudApi, getCloudApiOrigin } from "~/lib/cloud-api";
```

(Check if these are already imported; add only what's missing.)

- [ ] **Step 2: Update `handleAcceptCloudTicket`**

Find `handleAcceptCloudTicket` (around line 383):
```typescript
async function handleAcceptCloudTicket() {
  const ticket = globalStore.cloudReceive.state().currentTicket;
  if (!ticket) return;

  try {
    globalStore.cloudReceive.setTransferState("receiving");
    await accept_cloud_ticket(ticket.id, receiveOutputDir() || undefined);
    globalStore.cloudReceive.setCurrentTicket(null);
    globalStore.cloudReceive.setTransferState("idle");
    setTransferView("receive");
    setActiveTab("transfer");
    toast.success(t("nearby.transferComplete"));
  } catch (e) {
    globalStore.cloudReceive.setError(String(e));
    globalStore.cloudReceive.setTransferState("idle");
    toast.error(`Failed to receive file: ${e}`);
  }
}
```

Replace with:
```typescript
async function handleAcceptCloudTicket() {
  const ticket = globalStore.cloudReceive.state().currentTicket;
  if (!ticket) return;

  try {
    globalStore.cloudReceive.setTransferState("receiving");
    await accept_cloud_ticket(ticket.id, receiveOutputDir() || undefined);

    // Best-effort: mark ticket as received on the cloud server.
    // This is fire-and-forget; failure doesn't affect the local transfer.
    const markUrl = new URL(
      `/api/tickets/${ticket.id}/receive`,
      `${getCloudApiOrigin()}/`,
    ).toString();
    requestCloudApi(markUrl, { method: "POST" }).catch((e) => {
      console.warn("[cloud] Failed to mark ticket as received:", e);
    });

    globalStore.cloudReceive.setCurrentTicket(null);
    globalStore.cloudReceive.setTransferState("idle");
    setTransferView("receive");
    setActiveTab("transfer");
    toast.success(t("nearby.transferComplete"));
  } catch (e) {
    globalStore.cloudReceive.setError(String(e));
    globalStore.cloudReceive.setTransferState("idle");
    toast.error(`Failed to receive file: ${e}`);
  }
}
```

- [ ] **Step 3: Build frontend to verify**

```bash
cd app && pnpm run build 2>&1 | head -60
```

Expected: no errors from `index.tsx` or any previously-updated file.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/index.tsx
git commit -m "app: mark cloud ticket received from JS after accept_cloud_ticket"
```

---

## Task 5: Remove `register_cloud_device` from `bindings.ts`

**Files:**
- Modify: `app/src/bindings.ts`

`register_cloud_device` will no longer be a Tauri command after Task 6.

- [ ] **Step 1: Delete the `register_cloud_device` binding**

Find and delete lines 251-261 in `bindings.ts`:
```typescript
export async function register_cloud_device(
  deviceId: string,
  apiOrigin: string,
  traceId?: string | null,
): Promise<void> {
  return await invoke("register_cloud_device", {
    deviceId,
    apiOrigin,
    traceId: traceId ?? null,
  });
}
```

- [ ] **Step 2: Verify no remaining references**

```bash
cd app && rtk grep "register_cloud_device" src/ --include="*.ts" --include="*.tsx"
```

Expected: 0 matches (we moved the call in cloud-ws.ts to the local `registerCloudDevice` function in Task 3).

- [ ] **Step 3: Commit**

```bash
git add app/src/bindings.ts
git commit -m "app: remove register_cloud_device Tauri binding (call is now pure JS)"
```

---

## Task 6: Remove Rust auth-header commands and helpers from `lib.rs`

**Files:**
- Modify: `app/src-tauri/src/lib.rs`

Remove all the store-based token infrastructure that is now dead code.

### Step group A: Remove the four Tauri commands

- [ ] **Step 1: Delete `get_cloud_authorization_header` command**

Find and delete (lines ~2013-2016):
```rust
#[tauri::command]
async fn get_cloud_authorization_header(app: AppHandle) -> Result<Option<String>, String> {
    resolve_cloud_authorization_header(&app, false).await
}
```

- [ ] **Step 2: Delete `refresh_cloud_authorization_header` command**

Find and delete (lines ~2018-2021):
```rust
#[tauri::command]
async fn refresh_cloud_authorization_header(app: AppHandle) -> Result<Option<String>, String> {
    resolve_cloud_authorization_header(&app, true).await
}
```

- [ ] **Step 3: Delete `set_cloud_authorization_header` command**

Find and delete (lines ~2023-2030):
```rust
#[tauri::command]
fn set_cloud_authorization_header(app: AppHandle, header: Option<String>) -> Result<(), String> {
    log_info!(...);
    persist_cloud_authorization_header(&app, header)
}
```

- [ ] **Step 4: Delete `clear_cloud_authorization_header` command**

Find and delete (lines ~2048-2052):
```rust
#[tauri::command]
fn clear_cloud_authorization_header(app: AppHandle) -> Result<(), String> {
    log_info!("[cloud-auth] clear_cloud_authorization_header");
    persist_cloud_authorization_header(&app, None)
}
```

### Step group B: Remove helper functions and constants

- [ ] **Step 5: Delete constants and helper functions**

Delete the following in `lib.rs` (all are now dead code):

```rust
// DELETE:
const CLOUD_AUTH_STORE_NAME: &str = "sendme-auth-store";
const CLOUD_AUTH_HEADER_KEY: &str = "cloud_authorization_header";

fn normalize_cloud_authorization_header(header: Option<String>) -> Option<String> { ... }
fn load_cloud_authorization_header(app: &AppHandle) -> Result<Option<String>, String> { ... }
fn persist_cloud_authorization_header(app: &AppHandle, header: Option<String>) -> Result<(), String> { ... }
fn cloud_authorization_header_from_active_session(app: &AppHandle) -> Option<String> { ... }
async fn resolve_cloud_authorization_header(app: &AppHandle, force_refresh: bool) -> Result<Option<String>, String> { ... }
async fn current_cloud_authorization_header(app: &AppHandle) -> Result<String, String> { ... }
```

After deleting those, also delete (now unused):
```rust
fn is_jwt_expired(jwt: &str) -> bool { ... }
fn describe_auth_header(header: Option<&str>) -> String { ... }
fn extract_bearer_token(header: &str) -> Option<&str> { ... }
```

But **first** verify each of these is unused after the above deletions by checking with:
```bash
cd app/src-tauri && cargo check 2>&1 | grep "unused\|not found"
```

If `cargo check` says something is still used, do NOT delete it.

### Step group C: Remove `register_cloud_device` command

- [ ] **Step 6: Delete `register_cloud_device` command**

Find and delete the entire `register_cloud_device` async fn (lines ~717-780):
```rust
#[tauri::command]
async fn register_cloud_device(
    app: AppHandle,
    device_id: String,
    api_origin: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    // ... entire body ...
}
```

### Step group D: Simplify `accept_cloud_ticket`

- [ ] **Step 7: Remove `current_cloud_authorization_header` call from `accept_cloud_ticket`**

In `accept_cloud_ticket` (lines ~3419-3467), the current implementation:
1. Finds the ticket in `CloudPresenceState`
2. Calls `receive_file` to start the download
3. **Spawns** a task to mark the ticket as received via `current_cloud_authorization_header`

Delete only the spawned task (step 3), lines ~3451-3464:
```rust
// DELETE this entire block:
let mark_url = build_cloud_api_url(&api_origin, &format!("/api/tickets/{}/receive", ticket_id))?;
let authorization = current_cloud_authorization_header(&app).await.ok();
tokio::spawn(async move {
    if let Some(auth) = authorization {
        let client = reqwest::Client::new();
        let _ = client
            .post(&mark_url)
            .header(reqwest::header::AUTHORIZATION, auth)
            .send()
            .await;
    }
});
```

The function now just finds the ticket, calls `receive_file`, and returns `transfer_id`. The JS side (Task 4) handles the mark-as-received call.

After the deletion, `api_origin` is no longer needed in `accept_cloud_ticket`. Update the tuple destructuring:
```rust
// Before:
let (ticket_str, api_origin) = { ... };

// After:
let ticket_str = {
    let guard = cloud.read().await;
    guard
        .snapshot
        .tickets
        .iter()
        .find(|t| t.id == ticket_id)
        .ok_or_else(|| format!("Cloud ticket not found: {}", ticket_id))?
        .ticket
        .clone()
};
```

### Step group E: Update `invoke_handler`

- [ ] **Step 8: Remove removed commands from `invoke_handler![]`**

Find the `invoke_handler` block (line ~3367) and remove:
```rust
// DELETE these 6 lines:
register_cloud_device,
get_cloud_authorization_header,
refresh_cloud_authorization_header,
set_cloud_authorization_header,
clear_cloud_authorization_header,
```

Keep `set_clerk_dev_browser_token` (still used — JS still syncs dev browser token to Rust FAPI).

- [ ] **Step 9: Compile and fix any remaining errors**

```bash
cd app/src-tauri && cargo build 2>&1 | head -80
```

Fix any `unused import` or `unused variable` warnings that become errors under `RUSTFLAGS=-Dwarnings`.

Common fixes:
- `use url::Url;` might now be unused if `build_cloud_api_url` is still used. Check: `build_cloud_api_url` is used in... `accept_cloud_ticket` no longer uses it after Step 7. Check if any other caller exists.

```bash
rtk grep "build_cloud_api_url" app/src-tauri/src/lib.rs
```

If only used in deleted code, delete `build_cloud_api_url` too and its `use url::Url` import.

- [ ] **Step 10: Run clippy**

```bash
cd app/src-tauri && cargo clippy --locked --all-targets --all-features 2>&1 | head -60
```

Fix any new warnings.

- [ ] **Step 11: Commit Rust changes**

```bash
cd app
git add src-tauri/src/lib.rs
git commit -m "app: remove Rust auth token store — Clerk JS is now sole token source"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full Rust build**

```bash
cd app/src-tauri && cargo build 2>&1 | tail -20
```

Expected: `Finished` with zero errors.

- [ ] **Step 2: Full frontend build**

```bash
cd app && pnpm run build 2>&1 | tail -30
```

Expected: zero TypeScript errors from the changed files.

- [ ] **Step 3: Verify no dangling references to removed commands**

```bash
rtk grep "get_cloud_authorization_header\|refresh_cloud_authorization_header\|set_cloud_authorization_header\|clear_cloud_authorization_header\|register_cloud_device" app/src --include="*.ts" --include="*.tsx"
rtk grep "get_cloud_authorization_header\|refresh_cloud_authorization_header\|set_cloud_authorization_header\|clear_cloud_authorization_header\|register_cloud_device" app/src-tauri/src/lib.rs
```

Expected: 0 matches in both cases.

- [ ] **Step 4: Run Rust tests**

```bash
cd app/src-tauri && cargo test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "app: clerk auth redesign complete — Approach A verified"
```

---

## Key Invariants to Preserve

1. `set_clerk_dev_browser_token` Tauri command **stays** — JS still syncs dev browser JWT to Rust's FAPI client (needed for dev-mode Clerk to work in the native WebView).
2. `initClerk()` / Clerk FAPI initialization in Rust **stays** — the OAuth deep-link handler (`handle_clerk_auth_callback`) still uses it to validate the session.
3. `accept_cloud_ticket` Tauri command **stays** — it drives the `receive_file` p2p download; only its HTTP side-effect moves to JS.
4. `decline_cloud_ticket` Tauri command **stays** unchanged.
5. `CachedAuthSession` in localStorage **stays** — `sessionId` is still used as the `clerk.setActive` hint on cold start.

---

## Rollback Notes

If anything breaks after Task 6, the safest rollback point is after Task 5 (JS side clean, Rust side unchanged). The JS changes (Tasks 1-4) are backward-compatible with the old Rust commands because `getAuthorizationHeaderValue()` / `refreshAuthorizationHeaderValue()` keep the same public API — they just have a different implementation.
