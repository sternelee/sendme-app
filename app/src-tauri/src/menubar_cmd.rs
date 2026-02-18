//! Menubar panel Tauri commands

use tauri::Emitter;

/// Initialize the menubar (placeholder for future panel functionality)
#[tauri::command]
pub fn init_menubar(_app_handle: tauri::AppHandle) {
    // Future: Initialize NSPanel
}

/// Show the main window
#[tauri::command]
pub fn show_menubar_panel(app_handle: tauri::AppHandle) {
    let _ = app_handle.emit("show-main-window", ());
}

/// Hide the main window
#[tauri::command]
pub fn hide_menubar_panel(app_handle: tauri::AppHandle) {
    let _ = app_handle.emit("hide-main-window", ());
}
