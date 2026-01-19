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
    /// Picker mode: "import" copies the file, "open" provides access to original
    #[serde(default)]
    pub mode: PickerMode,
    /// Request long-term access (Android: persistable URI, iOS: bookmark)
    #[serde(default)]
    pub request_long_term_access: bool,
}

/// Picker mode - determines how files are accessed
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PickerMode {
    /// Import mode - get a copy of the file (default)
    #[default]
    Import,
    /// Open mode - access the original file (requires security handling)
    Open,
}

/// File information returned by the picker
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    /// URI of the file (content:// URI on Android, file:// on iOS)
    pub uri: String,
    /// File system path (may be null on some platforms)
    pub path: String,
    /// File name
    pub name: String,
    /// File size in bytes
    pub size: i64,
    /// MIME type
    pub mime_type: String,
    /// Whether this is a virtual file (Android only, e.g., Google Docs)
    #[serde(default)]
    pub is_virtual: bool,
    /// Bookmark for long-term access (base64 encoded)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bookmark: Option<String>,
    /// MIME types this virtual file can be converted to (Android only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub convertible_to_mime_types: Option<Vec<String>>,
}

/// Directory picker options
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPickerOptions {
    /// Optional start directory URI
    pub start_directory: Option<String>,
    /// Request long-term access (Android: persistable URI, iOS: bookmark)
    #[serde(default)]
    pub request_long_term_access: bool,
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
    /// Bookmark for long-term access (base64 encoded)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bookmark: Option<String>,
}

/// Options for reading content from a URI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadContentOptions {
    /// The URI to read from (content:// on Android, file:// on iOS)
    pub uri: String,
    /// For virtual files on Android, specify the MIME type to convert to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub convert_virtual_as_type: Option<String>,
}

/// Response from reading content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadContentResponse {
    /// The content as base64 encoded bytes
    pub data: String,
    /// MIME type of the content
    pub mime_type: String,
    /// Size of the content in bytes
    pub size: i64,
}

/// Options for copying files to local storage
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyToLocalOptions {
    /// The URI to copy from (content:// on Android)
    pub uri: String,
    /// Destination preset: "cache" or "documents"
    #[serde(default)]
    pub destination: CopyDestination,
    /// Custom filename (optional, uses original name if not specified)
    pub filename: Option<String>,
    /// For virtual files on Android, specify the MIME type to convert to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub convert_virtual_as_type: Option<String>,
}

/// Destination for copied files
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CopyDestination {
    /// App's cache directory
    #[default]
    Cache,
    /// App's documents directory
    Documents,
}

/// Response from copying to local storage
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyToLocalResponse {
    /// Local file path after copying
    pub path: String,
    /// File name
    pub name: String,
    /// File size in bytes
    pub size: i64,
    /// MIME type
    pub mime_type: String,
}

/// Options for writing content to a URI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteContentOptions {
    /// The URI to write to
    pub uri: String,
    /// The content as base64 encoded bytes
    pub data: String,
    /// MIME type of the content
    pub mime_type: Option<String>,
}

/// Options for releasing long-term access
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAccessOptions {
    /// URIs or bookmarks to release access for
    pub uris: Vec<String>,
}

/// Response from releasing access
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAccessResponse {
    /// Number of URIs successfully released
    pub released_count: i32,
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
