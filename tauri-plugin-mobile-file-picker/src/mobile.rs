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
        self.0
            .run_mobile_plugin("pickFile", options)
            .map_err(Into::into)
    }

    /// Pick a directory using the native directory picker
    pub fn pick_directory(&self, options: DirectoryPickerOptions) -> crate::Result<DirectoryInfo> {
        self.0
            .run_mobile_plugin("pick_directory", options)
            .map_err(Into::into)
    }

    /// Read content from a URI (supports content:// URIs on Android)
    pub fn read_content(&self, options: ReadContentOptions) -> crate::Result<ReadContentResponse> {
        self.0
            .run_mobile_plugin("readContent", options)
            .map_err(Into::into)
    }

    /// Copy a file from a URI to local storage
    pub fn copy_to_local(&self, options: CopyToLocalOptions) -> crate::Result<CopyToLocalResponse> {
        self.0
            .run_mobile_plugin("copyToLocal", options)
            .map_err(Into::into)
    }

    /// Write content to a URI
    pub fn write_content(&self, options: WriteContentOptions) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("writeContent", options)
            .map_err(Into::into)
    }

    /// Release long-term access permissions
    /// On Android: releases persistable URI permissions
    /// On iOS: releases security-scoped access
    pub fn release_access(
        &self,
        options: ReleaseAccessOptions,
    ) -> crate::Result<ReleaseAccessResponse> {
        #[cfg(target_os = "android")]
        {
            self.0
                .run_mobile_plugin("releaseLongTermAccess", options)
                .map_err(Into::into)
        }
        #[cfg(target_os = "ios")]
        {
            self.0
                .run_mobile_plugin("releaseSecureAccess", options)
                .map_err(Into::into)
        }
    }

    /// Legacy ping method for testing
    pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
        self.0
            .run_mobile_plugin("ping", payload)
            .map_err(Into::into)
    }
}
