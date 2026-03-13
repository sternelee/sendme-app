/// <reference types="@solidjs/start/env" />
import type { AuthObject } from "@clerk/backend";

declare module "@solidjs/start/server" {
  export interface RequestEventLocals {
    auth: AuthObject;
  }
}

declare namespace App {
  interface RequestEventLocals {
    /**
     * Clerk auth object from middleware
     */
    auth: AuthObject;
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
