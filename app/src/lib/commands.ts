// Tauri command wrappers for type-safe invocations
import { invoke } from "@tauri-apps/api/core";

export interface SendFileRequest {
  path: string;
  ticket_type: string;
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

export interface NearbyDevice {
  node_id: string;
  name: string | null;
  display_name: string;
  addresses: string[];
  ip_addresses: string[];
  last_seen: number;
  available: boolean;
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
 * Start nearby device discovery, returns the local node ID
 */
export async function start_nearby_discovery(): Promise<string> {
  return await invoke("start_nearby_discovery");
}

/**
 * Get list of nearby devices
 */
export async function get_nearby_devices(): Promise<NearbyDevice[]> {
  return await invoke("get_nearby_devices");
}

/**
 * Stop nearby device discovery
 */
export async function stop_nearby_discovery(): Promise<void> {
  return await invoke("stop_nearby_discovery");
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
 * Check if device is connected to WiFi
 *
 * Returns true if connected to WiFi, false otherwise.
 * WiFi connection is required for nearby device discovery.
 */
export async function check_wifi_connection(): Promise<boolean> {
  return await invoke("check_wifi_connection");
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
  filename?: string
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
