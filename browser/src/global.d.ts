/// <reference types="@solidjs/start/env" />
declare module App {
  interface RequestEventLocals {
    /**
     * Declare your getRequestEvent().locals here
     */
  }
}

declare module "*/sendme_browser.js" {
  export interface SendmeNodeWasm {
    wait_for_ready(timeout: number): Promise<boolean>;
    import_and_create_ticket(
      filename: string,
      data: Uint8Array,
    ): Promise<string>;
    get(ticket: string): Promise<[string, Uint8Array]>;
    endpoint_id(): string;
  }

  export interface SendmeNodeWasmStatic {
    spawn(): Promise<SendmeNodeWasm>;
  }

  export const SendmeNodeWasm: SendmeNodeWasmStatic;

  export default function (): Promise<void>;
}
