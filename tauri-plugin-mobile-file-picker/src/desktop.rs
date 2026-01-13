use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::Error;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<MobileFilePicker<R>> {
  Ok(MobileFilePicker(app.clone()))
}

/// Access to the mobile-file-picker APIs.
pub struct MobileFilePicker<R: Runtime>(AppHandle<R>);

impl<R: Runtime> MobileFilePicker<R> {
  pub fn pick_file(&self, _options: FilePickerOptions) -> crate::Result<Vec<FileInfo>> {
    Err(Error::Io(std::io::Error::new(
      std::io::ErrorKind::Unsupported,
      "File picker is only available on mobile platforms. Use tauri-plugin-dialog on desktop.",
    )))
  }

  pub fn pick_directory(&self, _options: DirectoryPickerOptions) -> crate::Result<DirectoryInfo> {
    Err(Error::Io(std::io::Error::new(
      std::io::ErrorKind::Unsupported,
      "Directory picker is only available on mobile platforms. Use tauri-plugin-dialog on desktop.",
    )))
  }

  pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
    Ok(PingResponse {
      value: payload.value,
    })
  }
}
