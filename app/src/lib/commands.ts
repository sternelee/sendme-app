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
