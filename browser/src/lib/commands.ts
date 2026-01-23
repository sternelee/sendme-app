/**
 * WASM integration layer for PiSend browser functionality
 * Wraps the WASM module for file sending and receiving
 */

let wasmModule: any = null;
let nodeInstance: any = null;

/**
 * Initialize the WASM module
 */
export async function initWasm(): Promise<void> {
  if (wasmModule) return;

  try {
    wasmModule = await import("../wasm/pisend_browser.js");
    await wasmModule.default();
  } catch (error) {
    console.error("Failed to initialize WASM:", error);
    throw error;
  }
}

/**
 * Initialize or get the PiSend node instance
 */
async function getNode(): Promise<any> {
  if (!wasmModule) {
    await initWasm();
  }

  if (!nodeInstance) {
    nodeInstance = await wasmModule!.SendmeNodeWasm.spawn();
  }

  return nodeInstance;
}

/**
 * Send a file and return the ticket
 */
export async function sendFile(file: File): Promise<string> {
  const node = await getNode();

  // Wait for endpoint to be ready
  const ready = await node.wait_for_ready(5000);
  if (!ready) {
    throw new Error("Endpoint not ready");
  }

  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Import and create ticket
  const ticket = await node.import_and_create_ticket(file.name, uint8Array);

  return ticket;
}

/**
 * Send multiple files (from folder selection) and return the ticket
 */
export async function sendFiles(files: File[]): Promise<string> {
  const node = await getNode();

  // Wait for endpoint to be ready
  const ready = await node.wait_for_ready(5000);
  if (!ready) {
    throw new Error("Endpoint not ready");
  }

  // Convert FileList to array of { name, data } objects
  const fileData = await Promise.all(
    files.map(async (file) => {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      return { name: file.webkitRelativePath || file.name, data: uint8Array };
    })
  );

  // Import collection and create ticket
  const ticket = await node.import_collection_and_create_ticket(fileData);

  return ticket;
}

/**
 * Receive a file from a ticket
 */
export async function receiveFile(
  ticket: string,
): Promise<{ filename: string; data: Uint8Array }> {
  const node = await getNode();

  // Get data from ticket
  const result = await node.get(ticket);

  // result is [filename, Uint8Array]
  return {
    filename: result[0],
    data: result[1],
  };
}

/**
 * Get the endpoint ID
 */
export async function getEndpointId(): Promise<string> {
  const node = await getNode();
  return (await node.wait_for_ready(5000)) ? node.endpoint_id() : "";
}

/**
 * Download data as a file
 */
export function downloadFile(data: Uint8Array, filename: string): void {
  const blob = new Blob([data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
