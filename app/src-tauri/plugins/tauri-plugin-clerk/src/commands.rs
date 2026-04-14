use crate::ClerkExt;
use clerk_fapi_rs::models::{ClientClient, ClientEnvironment};
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Runtime};

/// Need to keep in sync with ClerkInitResponse in
/// guest-js/sync.ts
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClerkInitResponse {
    environment: ClientEnvironment,
    client: ClientClient,
    publishable_key: String,
}

/// Authorization header to be injected in clerk-js __unstable__onBeforeRequest
#[tauri::command]
pub(crate) async fn get_client_authorization_header<R: Runtime>(
    app: AppHandle<R>,
) -> Option<String> {
    app.clerk().get_client_authorization_header()
}

/// Authorization header read in __unstable__onAfterResponse
#[tauri::command]
pub(crate) async fn set_client_authorization_header<R: Runtime>(
    app: AppHandle<R>,
    header: Option<String>,
) -> () {
    app.clerk().set_client_authorization_header(header)
}

#[tauri::command]
pub(crate) async fn initialize<R: Runtime>(app: AppHandle<R>) -> Result<ClerkInitResponse, String> {
    app.ensure_clerk_initialized().await?;
    let client = app.clerk().client().map_err(|e| e.to_string())?;
    let environment = app.clerk().environment().map_err(|e| e.to_string())?;
    let publishable_key = app.clerk_store().publishable_key;

    Ok(ClerkInitResponse {
        environment,
        client,
        publishable_key,
    })
}

/// Response from proxying a Clerk API request
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClerkProxyResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

/// Headers that should never be forwarded from JS to Clerk
fn should_skip_header(name: &str) -> bool {
    matches!(
        name,
        "origin"
            | "authorization"
            | "x-no-origin"
            | "x-tauri-fetch"
            | "x-mobile"
            | "credentials"
    )
}

/// Proxy Clerk API requests through the Rust backend to avoid Origin header
/// conflicts on Android. The native HTTP client (reqwest) does not auto-add
/// Origin, so Clerk receives only Authorization — no conflict.
#[tauri::command]
pub(crate) async fn clerk_proxy<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    method: String,
    body: Option<Value>,
    headers: Option<Vec<(String, String)>>,
) -> Result<ClerkProxyResponse, String> {
    let client = reqwest::Client::new();

    let method = method.to_uppercase();
    let mut req_builder = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported method: {method}")),
    };

    // Forward safe headers from JS (skip browser/native-specific ones)
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            if !should_skip_header(&k.to_lowercase()) {
                req_builder = req_builder.header(&k, &v);
            }
        }
    }

    // Set Authorization from Rust-side stored state (single source of truth)
    if let Some(auth) = app.clerk().get_client_authorization_header() {
        req_builder = req_builder.header("Authorization", auth);
    }

    if let Some(b) = body {
        req_builder = req_builder.json(&b);
    }

    let resp = req_builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();

    let resp_headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|vs| (k.as_str().to_string(), vs.to_string()))
        })
        .collect();

    // Save Authorization header if present (like __internal_onAfterResponse)
    if let Some(auth_val) = resp.headers().get("authorization") {
        if let Ok(auth_str) = auth_val.to_str() {
            app.clerk()
                .set_client_authorization_header(Some(auth_str.to_string()));
        }
    }

    // Read as text first, then try JSON parse — Clerk responses may not always be valid JSON
    let resp_text = resp.text().await.map_err(|e| e.to_string())?;
    let body: Value = serde_json::from_str(&resp_text)
        .unwrap_or_else(|_| Value::String(resp_text));

    Ok(ClerkProxyResponse {
        status,
        headers: resp_headers,
        body,
    })
}
