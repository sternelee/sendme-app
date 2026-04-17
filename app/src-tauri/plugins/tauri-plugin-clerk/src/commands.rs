use crate::ClerkExt;
use clerk_fapi_rs::models::{ClientClient, ClientEnvironment};
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
        "origin" | "authorization" | "x-no-origin" | "x-tauri-fetch" | "x-mobile" | "credentials"
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
    let method = method.to_uppercase();
    let req_method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err(format!("Unsupported method: {method}")),
    };

    // Use the ClerkFapiClient's request builder so that ClerkHttpClient can
    // inject dev-browser tokens, Authorization, and _is_native params.
    let clerk = app.clerk().clone();
    let fapi_client = clerk.get_fapi_client();
    let mut req_builder = fapi_client.request(req_method, &url);

    // Forward safe headers from JS (skip browser/native-specific ones)
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            if !should_skip_header(&k.to_lowercase()) {
                if let Ok(name) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
                    if let Ok(value) = reqwest::header::HeaderValue::from_str(&v) {
                        req_builder = req_builder.header(name, value);
                    }
                }
            }
        }
    }

    if let Some(b) = body {
        req_builder = req_builder.json(&b);
    }

    let req = req_builder
        .build()
        .map_err(|e| format!("Failed to build request: {e}"))?;

    let resp = clerk
        .execute_request(req)
        .await
        .map_err(|e| format!("Clerk proxy request failed: {e}"))?;
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

    // Read as text first, then try JSON parse — Clerk responses may not always be valid JSON
    let resp_text = resp.text().await.map_err(|e| e.to_string())?;
    let body: Value = serde_json::from_str(&resp_text).unwrap_or_else(|_| Value::String(resp_text));

    Ok(ClerkProxyResponse {
        status,
        headers: resp_headers,
        body,
    })
}
