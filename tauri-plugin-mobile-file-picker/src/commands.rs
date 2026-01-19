use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::MobileFilePickerExt;
use crate::Result;

/// Pick a file using the native file picker
#[command]
pub(crate) fn pick_file<R: Runtime>(
    app: AppHandle<R>,
    options: Option<FilePickerOptions>,
) -> Result<Vec<FileInfo>> {
    app.mobile_file_picker()
        .pick_file(options.unwrap_or_default())
}

/// Pick a directory using the native directory picker
#[command]
pub(crate) fn pick_directory<R: Runtime>(
    app: AppHandle<R>,
    options: Option<DirectoryPickerOptions>,
) -> Result<DirectoryInfo> {
    app.mobile_file_picker()
        .pick_directory(options.unwrap_or_default())
}

/// Read content from a URI (supports content:// URIs on Android)
#[command]
pub(crate) fn read_content<R: Runtime>(
    app: AppHandle<R>,
    options: ReadContentOptions,
) -> Result<ReadContentResponse> {
    app.mobile_file_picker().read_content(options)
}

/// Copy a file from a URI to local storage
#[command]
pub(crate) fn copy_to_local<R: Runtime>(
    app: AppHandle<R>,
    options: CopyToLocalOptions,
) -> Result<CopyToLocalResponse> {
    app.mobile_file_picker().copy_to_local(options)
}

/// Write content to a URI
#[command]
pub(crate) fn write_content<R: Runtime>(
    app: AppHandle<R>,
    options: WriteContentOptions,
) -> Result<()> {
    app.mobile_file_picker().write_content(options)
}

/// Release long-term access permissions (Android: persistable URI, iOS: security-scoped)
#[command]
pub(crate) fn release_access<R: Runtime>(
    app: AppHandle<R>,
    options: ReleaseAccessOptions,
) -> Result<ReleaseAccessResponse> {
    app.mobile_file_picker().release_access(options)
}

/// Legacy ping command for testing
#[command]
pub(crate) fn ping<R: Runtime>(app: AppHandle<R>, payload: PingRequest) -> Result<PingResponse> {
    app.mobile_file_picker().ping(payload)
}
