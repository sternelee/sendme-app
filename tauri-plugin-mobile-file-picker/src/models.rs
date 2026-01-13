use serde::{Deserialize, Serialize};

/// File picker options
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilePickerOptions {
    /// List of allowed MIME types (e.g., ["image/png", "image/jpeg"])
    /// On iOS, these are UTType strings (e.g., ["public.image"])
    pub allowed_types: Option<Vec<String>>,
    /// Allow multiple file selection
    #[serde(default)]
    pub allow_multiple: bool,
}

/// File information returned by the picker
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    /// URI of the file (content:// URI on Android, file:// or ph:// on iOS)
    pub uri: String,
    /// File system path (may be null on iOS for security-scoped resources)
    pub path: String,
    /// File name
    pub name: String,
    /// File size in bytes
    pub size: i64,
    /// MIME type
    pub mime_type: String,
}

/// Directory picker options
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPickerOptions {
    /// Optional start directory URI
    pub start_directory: Option<String>,
}

/// Directory information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryInfo {
    /// URI of the directory
    pub uri: String,
    /// Directory path
    pub path: String,
    /// Directory name
    pub name: String,
}

// Legacy ping models for testing
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
  pub value: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
  pub value: Option<String>,
}
