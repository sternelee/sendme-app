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
  name?: string;
  progress?: {
    type?: string;
    offset?: number;
    total?: number;
    speed?: number;
  };
}

export interface ProgressUpdate {
  event_type: string;
  data: ProgressData;
}

export type Theme =
  | "light"
  | "dark"
  | "system"
  | "sunset"
  | "black"
  | "synthwave"
  | "abyss"
  | "luxury";
export type Tab = "transfer" | "history" | "settings" | "peersync";
export type TransferMode = "send" | "receive" | "text";
export type TransferRoutingPolicy = "auto" | "local_only" | "remote_only";
export type TransportScheme = "airbridge" | "iroh";

export const ticketTypes = [
  { value: "id", label: "ID Only" },
  { value: "relay", label: "Relay" },
  { value: "addresses", label: "Addresses" },
  { value: "relay_and_addresses", label: "Relay + Addresses" },
];
