import { invoke } from "@tauri-apps/api/core";

// ============== Types ==============

/** Picker mode determines how files are accessed */
export type PickerMode = "import" | "open";

/** Copy destination preset */
export type CopyDestination = "cache" | "documents";

/** File picker options */
export interface FilePickerOptions {
  /** List of allowed MIME types (e.g., ["image/png", "image/jpeg"]) */
  allowedTypes?: string[];
  /** Allow multiple file selection */
  allowMultiple?: boolean;
  /** Picker mode: "import" copies the file, "open" provides access to original */
  mode?: PickerMode;
  /** Request long-term access (Android: persistable URI, iOS: bookmark) */
  requestLongTermAccess?: boolean;
  /** Allow virtual files on Android (e.g., Google Docs) */
  allowVirtualFiles?: boolean;
}

/** File information returned by the picker */
export interface FileInfo {
  /** URI of the file (content:// on Android, file:// on iOS) */
  uri: string;
  /** File system path (may be empty for some URIs) */
  path: string;
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Whether this is a virtual file (Android only, e.g., Google Docs) */
  isVirtual: boolean;
  /** Bookmark for long-term access (base64 encoded) */
  bookmark?: string;
  /** MIME types this virtual file can be converted to (Android only) */
  convertibleToMimeTypes?: string[];
}

/** Directory picker options */
export interface DirectoryPickerOptions {
  /** Optional start directory URI */
  startDirectory?: string;
  /** Request long-term access (Android: persistable URI, iOS: bookmark) */
  requestLongTermAccess?: boolean;
}

/** Directory information */
export interface DirectoryInfo {
  /** URI of the directory */
  uri: string;
  /** Directory path */
  path: string;
  /** Directory name */
  name: string;
  /** Bookmark for long-term access (base64 encoded) */
  bookmark?: string;
}

/** Options for reading content from a URI */
export interface ReadContentOptions {
  /** The URI to read from (content:// on Android, file:// on iOS) */
  uri: string;
  /** For virtual files on Android, specify the MIME type to convert to */
  convertVirtualAsType?: string;
}

/** Response from reading content */
export interface ReadContentResponse {
  /** The content as base64 encoded bytes */
  data: string;
  /** MIME type of the content */
  mimeType: string;
  /** Size of the content in bytes */
  size: number;
}

/** Options for copying files to local storage */
export interface CopyToLocalOptions {
  /** The URI to copy from (content:// on Android) */
  uri: string;
  /** Destination preset: "cache" or "documents" */
  destination?: CopyDestination;
  /** Custom filename (optional, uses original name if not specified) */
  filename?: string;
  /** For virtual files on Android, specify the MIME type to convert to */
  convertVirtualAsType?: string;
}

/** Response from copying to local storage */
export interface CopyToLocalResponse {
  /** Local file path after copying */
  path: string;
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
}

/** Options for writing content to a URI */
export interface WriteContentOptions {
  /** The URI to write to */
  uri: string;
  /** The content as base64 encoded bytes */
  data: string;
  /** MIME type of the content */
  mimeType?: string;
}

/** Options for releasing long-term access */
export interface ReleaseAccessOptions {
  /** URIs or bookmarks to release access for */
  uris: string[];
}

/** Response from releasing access */
export interface ReleaseAccessResponse {
  /** Number of URIs successfully released */
  releasedCount: number;
}

// ============== API Functions ==============

/**
 * Pick a file using the native file picker.
 *
 * @example
 * ```typescript
 * // Pick a single image
 * const files = await pickFile({ allowedTypes: ['image/*'] });
 *
 * // Pick multiple files with long-term access
 * const files = await pickFile({
 *   allowMultiple: true,
 *   mode: 'open',
 *   requestLongTermAccess: true
 * });
 * ```
 */
export async function pickFile(
  options?: FilePickerOptions,
): Promise<FileInfo[]> {
  return await invoke<FileInfo[]>("plugin:mobile-file-picker|pick_file", {
    options,
  });
}

/**
 * Pick a directory using the native directory picker.
 *
 * @example
 * ```typescript
 * const dir = await pickDirectory({ requestLongTermAccess: true });
 * console.log('Selected:', dir.name, dir.uri);
 * ```
 */
export async function pickDirectory(
  options?: DirectoryPickerOptions,
): Promise<DirectoryInfo> {
  return await invoke<DirectoryInfo>(
    "plugin:mobile-file-picker|pick_directory",
    {
      options,
    },
  );
}

/**
 * Read content from a URI.
 * Supports content:// URIs on Android and file:// URIs on iOS.
 *
 * For virtual files on Android (e.g., Google Docs), specify the
 * `convertVirtualAsType` option to get the content in a specific format.
 *
 * @example
 * ```typescript
 * const result = await readContent({ uri: fileInfo.uri });
 * const bytes = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
 *
 * // For Google Docs, convert to PDF
 * const pdfResult = await readContent({
 *   uri: fileInfo.uri,
 *   convertVirtualAsType: 'application/pdf'
 * });
 * ```
 */
export async function readContent(
  options: ReadContentOptions,
): Promise<ReadContentResponse> {
  return await invoke<ReadContentResponse>(
    "plugin:mobile-file-picker|read_content",
    {
      options,
    },
  );
}

/**
 * Copy a file from a content URI to local storage.
 * This is useful when you need a local file path for native operations.
 *
 * @example
 * ```typescript
 * // Copy to cache directory
 * const local = await copyToLocal({ uri: fileInfo.uri });
 * console.log('Local path:', local.path);
 *
 * // Copy to documents with custom name
 * const local = await copyToLocal({
 *   uri: fileInfo.uri,
 *   destination: 'documents',
 *   filename: 'my-file.pdf'
 * });
 * ```
 */
export async function copyToLocal(
  options: CopyToLocalOptions,
): Promise<CopyToLocalResponse> {
  return await invoke<CopyToLocalResponse>(
    "plugin:mobile-file-picker|copy_to_local",
    {
      options,
    },
  );
}

/**
 * Write content to a URI.
 * The data should be base64 encoded.
 *
 * @example
 * ```typescript
 * const content = btoa('Hello, World!');
 * await writeContent({
 *   uri: fileInfo.uri,
 *   data: content,
 *   mimeType: 'text/plain'
 * });
 * ```
 */
export async function writeContent(
  options: WriteContentOptions,
): Promise<void> {
  return await invoke<void>("plugin:mobile-file-picker|write_content", {
    options,
  });
}

/**
 * Release long-term access permissions.
 *
 * On Android, this releases persistable URI permissions.
 * On iOS, this stops accessing security-scoped resources.
 *
 * @example
 * ```typescript
 * await releaseAccess({ uris: [fileInfo.uri] });
 * ```
 */
export async function releaseAccess(
  options: ReleaseAccessOptions,
): Promise<ReleaseAccessResponse> {
  return await invoke<ReleaseAccessResponse>(
    "plugin:mobile-file-picker|release_access",
    {
      options,
    },
  );
}

/**
 * Legacy ping method for testing
 */
export async function ping(value: string): Promise<string | null> {
  const response = await invoke<{ value?: string }>(
    "plugin:mobile-file-picker|ping",
    {
      payload: { value },
    },
  );
  return response.value ?? null;
}

// ============== Utility Functions ==============

/**
 * Decode base64 content to a Uint8Array.
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode a Uint8Array to base64.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Check if a file is virtual (Android only).
 * Virtual files are cloud-based documents like Google Docs that don't
 * have a direct file representation.
 */
export function isVirtualFile(file: FileInfo): boolean {
  return file.isVirtual ?? false;
}

/**
 * Check if a file has long-term access (bookmark).
 */
export function hasLongTermAccess(file: FileInfo | DirectoryInfo): boolean {
  return !!file.bookmark;
}
