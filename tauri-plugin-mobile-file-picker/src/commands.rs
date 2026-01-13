use tauri::{AppHandle, command, Runtime};

use crate::models::*;
use crate::Result;
use crate::MobileFilePickerExt;

/// Pick a file using the native file picker
#[command]
pub(crate) fn pick_file<R: Runtime>(
    app: AppHandle<R>,
    options: Option<FilePickerOptions>,
) -> Result<Vec<FileInfo>> {
    app.mobile_file_picker().pick_file(options.unwrap_or_default())
}

/// Pick a directory using the native directory picker
#[command]
pub(crate) fn pick_directory<R: Runtime>(
    app: AppHandle<R>,
    options: Option<DirectoryPickerOptions>,
) -> Result<DirectoryInfo> {
    app.mobile_file_picker().pick_directory(options.unwrap_or_default())
}

/// Legacy ping command for testing
#[command]
pub(crate) fn ping<R: Runtime>(
    app: AppHandle<R>,
    payload: PingRequest,
) -> Result<PingResponse> {
    app.mobile_file_picker().ping(payload)
}
