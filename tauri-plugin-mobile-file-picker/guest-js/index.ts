import { invoke } from '@tauri-apps/api/core';

// Types
export interface FilePickerOptions {
  /** List of allowed MIME types (e.g., ["image/png", "image/jpeg"]) */
  allowedTypes?: string[];
  /** Allow multiple file selection */
  allowMultiple?: boolean;
}

export interface FileInfo {
  /** URI of the file */
  uri: string;
  /** File system path */
  path: string;
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
}

export interface DirectoryPickerOptions {
  /** Optional start directory URI */
  startDirectory?: string;
}

export interface DirectoryInfo {
  /** URI of the directory */
  uri: string;
  /** Directory path */
  path: string;
  /** Directory name */
  name: string;
}

interface PingResponse {
  value?: string;
}

// API
/**
 * Pick a file using the native file picker
 */
export async function pickFile(
  options?: FilePickerOptions
): Promise<FileInfo[]> {
  return await invoke<FileInfo[]>(
    'plugin:mobile-file-picker|pick_file',
    { options }
  );
}

/**
 * Pick a directory using the native directory picker
 */
export async function pickDirectory(
  options?: DirectoryPickerOptions
): Promise<DirectoryInfo> {
  return await invoke<DirectoryInfo>(
    'plugin:mobile-file-picker|pick_directory',
    { options }
  );
}

/**
 * Legacy ping method for testing
 */
export async function ping(value: string): Promise<string | null> {
  const response = await invoke<PingResponse>(
    'plugin:mobile-file-picker|ping',
    { payload: { value } }
  );
  return response.value ?? null;
}
