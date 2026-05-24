export interface Transfer {
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

export interface ProgressData {
  transfer_id: string;
  [key: string]: any;
}

export interface ProgressUpdate {
  event_type: string;
  data: ProgressData & { transfer_id: string };
}

export type Theme = "light" | "dark" | "system";
export type Tab = "transfer" | "history" | "settings";
export type ShareSubTab = "nearby" | "devices" | "friends";
export type TransferMode = "send" | "receive" | "text";

export const ticketTypes = [
  { value: "id", label: "ID Only" },
  { value: "relay", label: "Relay" },
  { value: "addresses", label: "Addresses" },
  { value: "relay_and_addresses", label: "Relay + Addresses" },
];
