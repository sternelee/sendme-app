use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::MobileFilePicker;
#[cfg(mobile)]
use mobile::MobileFilePicker;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the mobile-file-picker APIs.
pub trait MobileFilePickerExt<R: Runtime> {
  fn mobile_file_picker(&self) -> &MobileFilePicker<R>;
}

impl<R: Runtime, T: Manager<R>> crate::MobileFilePickerExt<R> for T {
  fn mobile_file_picker(&self) -> &MobileFilePicker<R> {
    self.state::<MobileFilePicker<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("mobile-file-picker")
    .invoke_handler(tauri::generate_handler![
      commands::pick_file,
      commands::pick_directory,
      commands::ping,
    ])
    .setup(|app, api| {
      #[cfg(mobile)]
      let mobile_file_picker = mobile::init(app, api)?;
      #[cfg(desktop)]
      let mobile_file_picker = desktop::init(app, api)?;
      app.manage(mobile_file_picker);
      Ok(())
    })
    .build()
}
