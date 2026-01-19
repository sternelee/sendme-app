// Tauri command wrappers for type-safe invocations
import { invoke } from "@tauri-apps/api/core";

export interface SendFileRequest {
  path: string;
  ticket_type: string;
  /** Optional filename from file picker. Used for display and preserving original filename. */
  filename?: string;
}

export interface ReceiveFileRequest {
  ticket: string;
  output_dir?: string;
}

export interface TransferInfo {
  id: string;
  transfer_type: string;
  path: string;
  status: string;
  created_at: number;
}

export interface ProgressUpdate {
  event_type: string;
  data: any;
}

/**
 * Send a file or directory and return the ticket
 */
export async function send_file(request: SendFileRequest): Promise<string> {
  return await invoke("send_file", { request });
}

/**
 * Receive a file or directory using a ticket
 */
export async function receive_file(
  request: ReceiveFileRequest,
): Promise<string> {
  return await invoke("receive_file", { request });
}

/**
 * Cancel an active transfer
 */
export async function cancel_transfer(id: string): Promise<boolean> {
  return await invoke("cancel_transfer", { id });
}

/**
 * Get all transfers
 */
export async function get_transfers(): Promise<TransferInfo[]> {
  return await invoke("get_transfers");
}

/**
 * Get the status of a specific transfer
 */
export async function get_transfer_status(id: string): Promise<string> {
  return await invoke("get_transfer_status", { id });
}

/**
 * Clear all transfers and clean up temporary directories
 */
export async function clear_transfers(): Promise<void> {
  return await invoke("clear_transfers");
}

/**
 * Get the local hostname
 */
export function get_hostname(): Promise<string> {
  return invoke("get_hostname");
}

/**
 * Get the device model (mobile-specific, returns hostname on desktop)
 */
export async function get_device_model(): Promise<string> {
  return await invoke("get_device_model");
}

/**
 * Get the default download folder path (mobile only)
 *
 * On Android, returns the public Downloads directory.
 * On iOS, returns the Documents directory.
 * On desktop platforms, returns an error.
 */
export async function get_default_download_folder(): Promise<string> {
  return await invoke("get_default_download_folder");
}

/**
 * Open a received file using the platform's default application
 *
 * On Android: Uses FileProvider + Intent to open the file
 * On Desktop: Uses the opener plugin to open the file directly
 *
 * @param transferId - The ID of the completed transfer
 * @param filename - Optional filename to open (for multi-file transfers)
 */
export async function open_received_file(
  transferId: string,
  filename?: string,
): Promise<void> {
  return await invoke("open_received_file", { transferId, filename });
}

/**
 * List all received files in the cache directory
 *
 * Returns an array of file paths for files that have been received.
 */
export async function list_received_files(): Promise<string[]> {
  return await invoke("list_received_files");
}

/**
 * Scan a barcode/QR code using the device camera
 *
 * Opens the camera scanner and returns the scanned text content.
 * Only available on mobile platforms (Android/iOS).
 *
 * @returns The scanned text content (typically a sendme ticket)
 */
export async function scan_barcode(): Promise<string> {
  return await invoke("scan_barcode");
}

/**
 * File information returned by the mobile file picker
 */
export interface FileInfo {
  uri: string;
  path: string;
  name: string;
  size: number;
  mime_type: string;
}

/**
 * Directory information returned by the mobile directory picker
 */
export interface DirectoryInfo {
  uri: string;
  path: string;
  name: string;
}

/**
 * Pick a file using the native mobile file picker
 *
 * Opens the platform's native file picker to select one or more files.
 * Returns information about the selected files including URI, path, name, size, and MIME type.
 *
 * Only available on mobile platforms (Android/iOS).
 *
 * @param options - Optional picker options
 * @param options.allowedTypes - List of allowed MIME types (e.g., ["image/*", "application/pdf"])
 * @param options.allowMultiple - Allow multiple file selection (default: false)
 * @returns Array of selected file information
 */
export async function pick_file(options?: {
  allowedTypes?: string[];
  allowMultiple?: boolean;
}): Promise<FileInfo[]> {
  return await invoke("pick_file", {
    allowedTypes: options?.allowedTypes,
    allowMultiple: options?.allowMultiple,
  });
}

/**
 * Pick a directory using the native mobile directory picker
 *
 * Opens the platform's native directory picker to select a directory.
 * Returns information about the selected directory including URI, path, and name.
 *
 * Only available on mobile platforms (Android/iOS).
 *
 * @param options - Optional picker options
 * @param options.startDirectory - Optional start directory URI
 * @returns Selected directory information
 */
export async function pick_directory(options?: {
  startDirectory?: string;
}): Promise<DirectoryInfo> {
  return await invoke("pick_directory", {
    startDirectory: options?.startDirectory,
  });
}
