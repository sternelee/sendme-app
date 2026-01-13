use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile_file_picker);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<MobileFilePicker<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin("com.mobile.file.picker", "MobileFilePickerPlugin")?;
  #[cfg(target_os = "ios")]
  let handle = api.register_ios_plugin(init_plugin_mobile_file_picker)?;
  Ok(MobileFilePicker(handle))
}

/// Access to the mobile-file-picker APIs.
pub struct MobileFilePicker<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MobileFilePicker<R> {
  /// Pick a file using the native file picker
  pub fn pick_file(&self, options: FilePickerOptions) -> crate::Result<Vec<FileInfo>> {
    self
      .0
      .run_mobile_plugin("pick_file", options)
      .map_err(Into::into)
  }

  /// Pick a directory using the native directory picker
  pub fn pick_directory(&self, options: DirectoryPickerOptions) -> crate::Result<DirectoryInfo> {
    self
      .0
      .run_mobile_plugin("pick_directory", options)
      .map_err(Into::into)
  }

  /// Legacy ping method for testing
  pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
    self
      .0
      .run_mobile_plugin("ping", payload)
      .map_err(Into::into)
  }
}
