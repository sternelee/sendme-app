// Tauri command wrappers for type-safe invocations
import { invoke } from "@tauri-apps/api/core";

// Types
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
  ticket?: string;
  filename?: string;
  file_size?: number;
  completed_at?: number;
  duration_ms?: number;
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
 * Delete a transfer record
 */
export async function delete_transfer(id: string): Promise<boolean> {
  return await invoke("delete_transfer", { id });
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

export interface CloudDevice {
  id: string;
  deviceId?: string | null;
  name: string;
  platform: string;
  online: boolean;
  lastSeenAt?: string | null;
}

export interface CloudFriendUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface CloudFriendDevice {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  lastSeenAt: string;
}

export interface CloudFriend {
  id: string;
  userId: string;
  friendUserId: string;
  status: "pending" | "accepted" | string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string | null;
  friend: CloudFriendUser;
  friendDevices: CloudFriendDevice[];
}

export interface CloudTicket {
  id: string;
  ticket: string;
  filename?: string | null;
  fileSize?: number | null;
  senderName?: string | null;
  createdAt?: string | null;
  status?: string | null;
}

export interface CloudPresenceState {
  active: boolean;
  connected: boolean;
  deviceId?: string | null;
  lastError?: string | null;
  friends: CloudFriend[];
  devices: CloudDevice[];
  tickets: CloudTicket[];
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

/**
 * Get the size of a file in bytes (desktop only).
 * tauri-plugin-dialog's open() returns only paths, not metadata.
 */
export async function get_file_size(path: string): Promise<number> {
  return await invoke<number>("get_file_size", { path });
}

export async function set_cloud_connected(
  connected: boolean,
  deviceId?: string | null,
  apiOrigin?: string | null,
  error?: string | null,
): Promise<void> {
  return await invoke("set_cloud_connected", {
    connected,
    deviceId: deviceId ?? null,
    apiOrigin: apiOrigin ?? null,
    error: error ?? null,
  });
}

export async function update_cloud_state(messageJson: string): Promise<void> {
  return await invoke("update_cloud_state", { messageJson });
}

export async function stop_cloud_presence(): Promise<void> {
  return await invoke("stop_cloud_presence");
}

export async function get_cloud_presence_state(): Promise<CloudPresenceState> {
  return await invoke("get_cloud_presence_state");
}

// Text transfer types
export interface SendTextRequest {
  text: string;
  filename?: string;
  ticket_type: string;
}

export interface ReceiveTextRequest {
  ticket: string;
}

export interface TextResult {
  text: string;
  filename: string;
}

/**
 * Send text and return the ticket
 */
export async function send_text(request: SendTextRequest): Promise<string> {
  return await invoke("send_text", { request });
}

/**
 * Receive text using a ticket
 */
export async function receive_text(
  request: ReceiveTextRequest,
): Promise<TextResult> {
  return await invoke("receive_text", { request });
}

// Nearby discovery types
export interface NearbyDevice {
  id: string;
  name: string;
  deviceType: "phone" | "tablet" | "laptop" | "desktop" | "unknown";
  addresses: string[];
}

export interface IncomingRequest {
  id: string;
  senderName: string;
  senderDeviceType: string;
  files: Array<{ name: string; size: number }>;
  totalSize: number;
}

export interface TransferProgress {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
}

export interface NearbyTransferState {
  requestId?: string;
  transferId?: string;
  state: string;
  deviceName?: string;
  deviceType?: string;
  message?: string;
  progress?: TransferProgress;
}

export interface NearbySendItem {
  path: string;
  filename?: string;
}

export interface NearbyProfile {
  name: string;
  deviceType: string;
}

export async function start_nearby_discovery(): Promise<void> {
  return await invoke("start_nearby_discovery");
}

export async function get_nearby_devices(): Promise<NearbyDevice[]> {
  return await invoke("get_nearby_devices");
}

export async function get_nearby_profile(): Promise<NearbyProfile> {
  return await invoke("get_nearby_profile");
}

export async function stop_nearby_discovery(): Promise<void> {
  return await invoke("stop_nearby_discovery");
}

export async function send_to_device(
  fileItems: NearbySendItem[],
  deviceId: string,
): Promise<string> {
  return await invoke("send_to_device", { fileItems, deviceId });
}

export async function accept_incoming(
  requestId: string,
  outputDir?: string,
): Promise<void> {
  return await invoke("accept_incoming", { requestId, outputDir });
}

export async function decline_incoming(requestId: string): Promise<void> {
  return await invoke("decline_incoming", { requestId });
}

/**
 * Accept a cloud ticket and start receiving the file
 * @returns The transfer ID
 */
export async function accept_cloud_ticket(
  ticketId: string,
  outputDir?: string,
): Promise<string> {
  return await invoke("accept_cloud_ticket", { ticketId, outputDir });
}

/**
 * Decline a cloud ticket
 */
export async function decline_cloud_ticket(ticketId: string): Promise<void> {
  return await invoke("decline_cloud_ticket", { ticketId });
}

/**
 * Get whether the system right-click context menu integration is enabled.
 * Windows: checks HKCU registry. Linux: checks desktop file. macOS: checks local setting marker.
 */
export async function get_context_menu_enabled(): Promise<boolean> {
  return await invoke("get_context_menu_enabled");
}

/**
 * Enable or disable the "Send with Sendme" system right-click context menu entry.
 * Windows: writes/removes HKCU registry keys. Linux: creates/removes a .desktop file.
 * macOS: stores local setting and refreshes Launch Services/pbs registration.
 */
export async function set_context_menu_enabled(enabled: boolean): Promise<void> {
  return await invoke("set_context_menu_enabled", { enabled });
}

/**
 * Return macOS Finder Services diagnostics for debugging registration issues.
 */
export async function get_context_menu_diagnostics(): Promise<string> {
  return await invoke("get_context_menu_diagnostics");
}
