use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

const PLUGIN_IDENTIFIER: &str = "io.sendme.app";

pub struct AndroidBridge<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForegroundServiceRequest<'a> {
    payload_json: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileRequest<'a> {
    file_path: &'a str,
}

#[derive(Deserialize)]
struct StringResponse {
    value: String,
}

impl<R: Runtime> AndroidBridge<R> {
    fn upsert_background_service(&self, payload_json: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin(
                "upsertForegroundService",
                ForegroundServiceRequest { payload_json },
            )
            .map_err(|e| e.to_string())
    }

    fn stop_background_service(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("stopForegroundService", ())
            .map_err(|e| e.to_string())
    }

    fn get_device_model(&self) -> Result<String, String> {
        self.0
            .run_mobile_plugin::<StringResponse>("getDeviceModel", ())
            .map(|response| response.value)
            .map_err(|e| e.to_string())
    }

    fn get_default_download_folder(&self) -> Result<String, String> {
        self.0
            .run_mobile_plugin::<StringResponse>("getDefaultDownloadFolder", ())
            .map(|response| response.value)
            .map_err(|e| e.to_string())
    }

    fn open_file_with_intent(&self, file_path: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin("openFile", OpenFileRequest { file_path })
            .map_err(|e| e.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sendme_android")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SendmePlugin")?;
            app.manage(AndroidBridge(handle));
            Ok(())
        })
        .build()
}

pub fn upsert_background_service<R: Runtime>(
    app: &AppHandle<R>,
    payload_json: &str,
) -> Result<(), String> {
    app.state::<AndroidBridge<R>>()
        .inner()
        .upsert_background_service(payload_json)
}

pub fn stop_background_service<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.state::<AndroidBridge<R>>()
        .inner()
        .stop_background_service()
}

pub fn get_device_model<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    app.state::<AndroidBridge<R>>().inner().get_device_model()
}

pub fn get_default_download_folder<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    app.state::<AndroidBridge<R>>()
        .inner()
        .get_default_download_folder()
}

pub fn open_file_with_intent<R: Runtime>(
    app: &AppHandle<R>,
    file_path: &str,
) -> Result<(), String> {
    if !Path::new(file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }

    app.state::<AndroidBridge<R>>()
        .inner()
        .open_file_with_intent(file_path)
}

/// Find received files in the directory.
pub fn find_received_files(base_dir: &str) -> Vec<String> {
    let path = Path::new(base_dir);
    let mut files = Vec::new();

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.filter_map(Result::ok) {
            let file_path = entry.path();
            if file_path.is_file() {
                if let Some(name) = file_path.file_name() {
                    let name_str = name.to_string_lossy();
                    if !name_str.starts_with('.') && !name_str.starts_with(".sendme-") {
                        files.push(file_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_received_files() {
        let temp = std::env::temp_dir();
        let _ = find_received_files(temp.to_str().unwrap_or("/tmp"));
    }
}
