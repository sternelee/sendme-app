/* tslint:disable */
/* eslint-disable */
/**
 * Initialize the WebAssembly module
 */
export function start(): void;
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */
type ReadableStreamType = "bytes";
export class IntoUnderlyingByteSource {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  pull(controller: ReadableByteStreamController): Promise<any>;
  start(controller: ReadableByteStreamController): void;
  cancel(): void;
  readonly autoAllocateChunkSize: number;
  readonly type: ReadableStreamType;
}
export class IntoUnderlyingSink {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  abort(reason: any): Promise<any>;
  close(): Promise<any>;
  write(chunk: any): Promise<any>;
}
export class IntoUnderlyingSource {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  pull(controller: ReadableStreamDefaultController): Promise<any>;
  cancel(): void;
}
/**
 * SendmeNode wrapper for JavaScript
 */
export class SendmeNodeWasm {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the current relay URLs as a JS array
   */
  relay_urls(): Array<any>;
  /**
   * Get the endpoint ID
   */
  endpoint_id(): string;
  /**
   * Get local addresses as a JS array
   */
  local_addrs(): Array<any>;
  /**
   * Get all files from a collection by ticket string
   *
   * Returns a JS array of objects, each with { filename: string, data: Uint8Array }
   */
  get_collection(ticket: string): Promise<any>;
  /**
   * Wait for the endpoint to be ready with addresses
   *
   * Returns true if the endpoint has relay URLs or direct addresses
   * within the specified duration.
   */
  wait_for_ready(duration_ms: number): Promise<any>;
  /**
   * Import data and create a ticket for sharing
   *
   * Returns a BlobTicket string that contains:
   * - Node addressing information (relays, direct addresses)
   * - The collection hash
   * - Format information
   *
   * This ticket can be shared with others for P2P file transfer.
   */
  import_and_create_ticket(name: string, data: Uint8Array): Promise<any>;
  /**
   * Import multiple files as a collection and create a ticket
   *
   * Takes an array of file objects, each with { name: string, data: Uint8Array }
   * Returns a BlobTicket string for sharing the entire collection.
   */
  import_collection_and_create_ticket(files: Array<any>): Promise<any>;
  /**
   * Get data by ticket string
   *
   * The ticket string contains both the peer's addressing information
   * and the hash of the data to fetch.
   *
   * First checks local store, then attempts P2P fetch from remote peer.
   * Returns a JS object with { filename: string, data: Uint8Array }
   */
  get(ticket: string): Promise<any>;
  /**
   * Create a new sendme node
   */
  static spawn(): Promise<SendmeNodeWasm>;
  /**
   * Check if a blob exists and is complete locally
   */
  has_blob(hash: string): Promise<any>;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_sendmenodewasm_free: (a: number, b: number) => void;
  readonly sendmenodewasm_endpoint_id: (a: number) => [number, number];
  readonly sendmenodewasm_get: (a: number, b: number, c: number) => [number, number, number];
  readonly sendmenodewasm_get_collection: (a: number, b: number, c: number) => [number, number, number];
  readonly sendmenodewasm_has_blob: (a: number, b: number, c: number) => [number, number, number];
  readonly sendmenodewasm_import_and_create_ticket: (a: number, b: number, c: number, d: any) => [number, number, number];
  readonly sendmenodewasm_import_collection_and_create_ticket: (a: number, b: any) => [number, number, number];
  readonly sendmenodewasm_local_addrs: (a: number) => any;
  readonly sendmenodewasm_relay_urls: (a: number) => any;
  readonly sendmenodewasm_spawn: () => any;
  readonly sendmenodewasm_wait_for_ready: (a: number, b: number) => [number, number, number];
  readonly start: () => void;
  readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
  readonly intounderlyingsink_abort: (a: number, b: any) => any;
  readonly intounderlyingsink_close: (a: number) => any;
  readonly intounderlyingsink_write: (a: number, b: any) => any;
  readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
  readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
  readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
  readonly intounderlyingbytesource_cancel: (a: number) => void;
  readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
  readonly intounderlyingbytesource_start: (a: number, b: any) => void;
  readonly intounderlyingbytesource_type: (a: number) => number;
  readonly intounderlyingsource_cancel: (a: number) => void;
  readonly intounderlyingsource_pull: (a: number, b: any) => any;
  readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h9411e5ba580a123e: (a: number, b: number) => void;
  readonly wasm_bindgen__closure__destroy__hbeadccfe5059a0d0: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h27f0ff5fc111899e: (a: number, b: number) => void;
  readonly wasm_bindgen__closure__destroy__h15938cb60f66e89c: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h487670b02c35e0d6: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h4eec8ae8923c35b0: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hc1e4661a74fedf28: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__haa6719961df58a36: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hc308c6417f199c81: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__ha571a5fd5bc742f5: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hc4e1880324a551e8: (a: number, b: number) => void;
  readonly wasm_bindgen__closure__destroy__h6bbf86f155e9d8fe: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__habddf6f2a8863c83: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_drop_slice: (a: number, b: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
