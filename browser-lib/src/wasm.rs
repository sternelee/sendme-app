//! WebAssembly bindings for sendmd
//!
//! This module exports SendmeNode functions to JavaScript via wasm-bindgen.

use crate::SendmeNode;
use js_sys::{Array, Uint8Array};
use tracing::level_filters::LevelFilter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};
use wasm_bindgen_futures::future_to_promise;

/// Initialize the WebAssembly module
#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();

    tracing_subscriber::fmt()
        .with_max_level(LevelFilter::INFO)
        .with_writer(
            // Avoid trace events in the browser from showing their JS backtrace
            tracing_subscriber_wasm::MakeConsoleWriter::default()
                .map_trace_level_to(tracing::Level::DEBUG),
        )
        // Required for browser compatibility
        .without_time()
        .with_ansi(false)
        .init();

    tracing::info!("Sendmd WASM module initialized");
}

/// SendmeNode wrapper for JavaScript
#[wasm_bindgen]
pub struct SendmeNodeWasm(SendmeNode);

#[wasm_bindgen]
impl SendmeNodeWasm {
    /// Create a new sendmd node
    pub async fn spawn() -> Result<SendmeNodeWasm, JsError> {
        let node = SendmeNode::spawn()
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(SendmeNodeWasm(node))
    }

    /// Get the endpoint ID
    pub fn endpoint_id(&self) -> String {
        self.0.endpoint_id()
    }

    /// Get the current relay URLs as a JS array
    pub fn relay_urls(&self) -> Array {
        let urls = self.0.relay_urls();
        let result = Array::new_with_length(urls.len() as u32);
        for (i, url) in urls.into_iter().enumerate() {
            result.set(i as u32, JsValue::from(url));
        }
        result
    }

    /// Get local addresses as a JS array
    pub fn local_addrs(&self) -> Array {
        let addrs = self.0.local_addrs();
        let result = Array::new_with_length(addrs.len() as u32);
        for (i, addr) in addrs.into_iter().enumerate() {
            result.set(i as u32, JsValue::from(addr));
        }
        result
    }

    /// Import data and create a ticket for sharing
    ///
    /// Returns a BlobTicket string that contains:
    /// - Node addressing information (relays, direct addresses)
    /// - The collection hash
    /// - Format information
    ///
    /// This ticket can be shared with others for P2P file transfer.
    pub fn import_and_create_ticket(
        &self,
        name: String,
        data: Uint8Array,
    ) -> Result<js_sys::Promise, JsError> {
        let node = self.0.clone();
        let data = uint8array_to_bytes(&data);

        let promise = future_to_promise(async move {
            let ticket = node
                .import_and_create_ticket(name, data)
                .await
                .map_err(|e: anyhow::Error| JsError::new(&e.to_string()))?;
            Ok(JsValue::from(ticket))
        });

        Ok(promise)
    }

    /// Import multiple files as a collection and create a ticket
    ///
    /// Takes an array of file objects, each with { name: string, data: Uint8Array }
    /// Returns a BlobTicket string for sharing the entire collection.
    pub fn import_collection_and_create_ticket(
        &self,
        files: Array,
    ) -> Result<js_sys::Promise, JsError> {
        let node = self.0.clone();

        let promise = future_to_promise(async move {
            // Convert JS array of file objects to Vec<(String, Bytes)>
            let mut file_list = Vec::new();
            for i in 0..files.length() {
                let file_obj = files.get(i);
                if let Ok(name) = js_sys::Reflect::get(&file_obj, &JsValue::from("name")) {
                    if let Ok(data) = js_sys::Reflect::get(&file_obj, &JsValue::from("data")) {
                        let name_str = name.as_string().unwrap_or_default();
                        let uint8_array = Uint8Array::from(data);
                        let bytes = uint8array_to_bytes(&uint8_array);
                        file_list.push((name_str, bytes));
                    }
                }
            }

            let ticket = node
                .import_collection_and_create_ticket(file_list)
                .await
                .map_err(|e: anyhow::Error| JsError::new(&e.to_string()))?;
            Ok(JsValue::from(ticket))
        });

        Ok(promise)
    }

    /// Get data by ticket string
    ///
    /// The ticket string contains both the peer's addressing information
    /// and the hash of the data to fetch.
    ///
    /// First checks local store, then attempts P2P fetch from remote peer.
    /// Returns a JS object with { filename: string, data: Uint8Array }
    pub fn get(&self, ticket: String) -> Result<js_sys::Promise, JsError> {
        let node = self.0.clone();

        let promise = future_to_promise(async move {
            let (filename, data) = node
                .get(ticket)
                .await
                .map_err(|e: anyhow::Error| JsError::new(&e.to_string()))?;

            // Create a JS object with filename and data
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(&obj, &JsValue::from("filename"), &JsValue::from(filename))
                .map_err(|e| JsError::new(&format!("Failed to set filename: {:?}", e)))?;

            js_sys::Reflect::set(
                &obj,
                &JsValue::from("data"),
                &JsValue::from(bytes_to_uint8array(&data)),
            )
            .map_err(|e| JsError::new(&format!("Failed to set data: {:?}", e)))?;

            Ok(JsValue::from(obj))
        });

        Ok(promise)
    }

    /// Get all files from a collection by ticket string
    ///
    /// Returns a JS array of objects, each with { filename: string, data: Uint8Array }
    pub fn get_collection(&self, ticket: String) -> Result<js_sys::Promise, JsError> {
        let node = self.0.clone();

        let promise = future_to_promise(async move {
            let files = node
                .get_collection(ticket)
                .await
                .map_err(|e: anyhow::Error| JsError::new(&e.to_string()))?;

            // Create a JS array of file objects
            let result = Array::new_with_length(files.len() as u32);
            for (i, (filename, data)) in files.into_iter().enumerate() {
                let obj = js_sys::Object::new();
                js_sys::Reflect::set(&obj, &JsValue::from("filename"), &JsValue::from(filename))
                    .map_err(|e| JsError::new(&format!("Failed to set filename: {:?}", e)))?;

                js_sys::Reflect::set(
                    &obj,
                    &JsValue::from("data"),
                    &JsValue::from(bytes_to_uint8array(&data)),
                )
                .map_err(|e| JsError::new(&format!("Failed to set data: {:?}", e)))?;

                result.set(i as u32, JsValue::from(obj));
            }

            Ok(JsValue::from(result))
        });

        Ok(promise)
    }

    /// Check if a blob exists and is complete locally
    pub fn has_blob(&self, hash: String) -> Result<js_sys::Promise, JsError> {
        let node = self.0.clone();

        let promise = future_to_promise(async move {
            let exists = node
                .has_blob(hash)
                .await
                .map_err(|e: anyhow::Error| JsError::new(&e.to_string()))?;
            Ok(JsValue::from(exists))
        });

        Ok(promise)
    }

    /// Wait for the endpoint to be ready with addresses
    ///
    /// Returns true if the endpoint has relay URLs or direct addresses
    /// within the specified duration.
    pub fn wait_for_ready(&self, duration_ms: u32) -> Result<js_sys::Promise, JsError> {
        let node = self.0.clone();

        let promise = future_to_promise(async move {
            let ready = node
                .wait_for_ready(duration_ms as u64)
                .await
                .map_err(|e: anyhow::Error| JsError::new(&e.to_string()))?;
            Ok(JsValue::from(ready))
        });

        Ok(promise)
    }
}

/// Convert Uint8Array to Bytes
fn uint8array_to_bytes(data: &Uint8Array) -> bytes::Bytes {
    let mut buffer = vec![0u8; data.length() as usize];
    data.copy_to(&mut buffer[..]);
    bytes::Bytes::from(buffer)
}

/// Convert Bytes to Uint8Array
fn bytes_to_uint8array(bytes: &[u8]) -> Uint8Array {
    let array = Uint8Array::new_with_length(bytes.len() as u32);
    array.copy_from(bytes);
    array
}
