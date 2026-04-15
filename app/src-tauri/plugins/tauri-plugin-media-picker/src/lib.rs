#![cfg(target_os = "ios")]

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_media_picker);

/// A single media file returned by the picker.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaFile {
    pub uri: String,
    pub name: String,
    pub size: u64,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

/// Handle to the iOS media picker plugin.
pub struct MediaPicker<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MediaPicker<R> {
    /// Present the system photo picker and return selected files.
    /// Returns an empty Vec if the user cancels.
    pub async fn pick_media(
        &self,
    ) -> Result<Vec<MediaFile>, tauri::plugin::mobile::PluginInvokeError> {
        self.0
            .run_mobile_plugin_async("pickMedia", serde_json::json!({}))
            .await
    }
}

/// Extension trait for AppHandle / Manager to access the picker.
pub trait MediaPickerExt<R: Runtime> {
    fn media_picker(&self) -> &MediaPicker<R>;
}

impl<R: Runtime, T: Manager<R>> MediaPickerExt<R> for T {
    fn media_picker(&self) -> &MediaPicker<R> {
        self.state::<MediaPicker<R>>().inner()
    }
}

/// Initialise the plugin — call this in your Tauri builder.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("media-picker")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_media_picker)?;
            app.manage(MediaPicker(handle));
            Ok(())
        })
        .build()
}
