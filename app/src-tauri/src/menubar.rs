//! Menubar panel functionality for macOS
//! This module handles the system tray icon

use tauri::{
    image::Image,
    tray::{MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter,
};

/// Create the system tray icon
pub fn create_tray(app_handle: &AppHandle) -> tauri::Result<TrayIcon> {
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::with_id("tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Sendme - P2P File Transfer")
        .on_tray_icon_event(|tray, event| {
            let app_handle = tray.app_handle();

            if let TrayIconEvent::Click { button_state, .. } = event {
                if button_state == MouseButtonState::Up {
                    // Emit event to show main window
                    let _ = app_handle.emit("show-main-window", ());
                }
            }
        })
        .build(app_handle)
}

/// Initialize the menubar panel (placeholder for future panel functionality)
pub fn init_menubar_panel(_app_handle: &AppHandle) {
    // Future: Convert to NSPanel and setup panel behavior
}
