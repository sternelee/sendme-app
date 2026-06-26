//! System tray functionality for desktop platforms.
//!
//! The tray itself works on macOS, Linux, and Windows. The Dock
//! activation-policy tweaks (`set_activation_policy` + `ActivationPolicy::*`)
//! are macOS-only — they fall through as no-ops on other platforms via the
//! `#[cfg(target_os = "macos")]` gates below.

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Create the system tray icon with Show and Exit menu items
pub fn create_tray(app_handle: &AppHandle) -> tauri::Result<TrayIcon> {
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    let show_i = MenuItem::with_id(app_handle, "show", "Show", true, Some("CmdOrCtrl+Shift+S"))?;
    let hide_i = MenuItem::with_id(app_handle, "hide", "Hide", true, Some("CmdOrCtrl+W"))?;
    let exit_i = MenuItem::with_id(app_handle, "exit", "Exit", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app_handle, &[&show_i, &hide_i, &exit_i])?;

    TrayIconBuilder::with_id("tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Sendme - P2P File Transfer")
        .menu(&menu)
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    #[cfg(target_os = "macos")]
                    let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                #[cfg(target_os = "macos")]
                let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "exit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app_handle = tray.app_handle();

            if let TrayIconEvent::Click { button_state, .. } = event {
                if button_state == MouseButtonState::Up {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        #[cfg(target_os = "macos")]
                        let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app_handle)
}

/// Initialize the menubar panel (placeholder for future panel functionality)
pub fn init_menubar_panel(_app_handle: &AppHandle) {
    // Future: Convert to NSPanel and setup panel behavior
}
