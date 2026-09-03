// @vitest-environment jsdom
//
// Regression test for the "stuck at 100%" bug: when the backend reported a
// nearby receive as done, the event listener removed the incoming request,
// which flipped the <Show when={nearbyReceiveCard()}> in ReceivePanel to
// null. A prop getter (onCancel) in the old code called the Show's stale
// callback accessor during the same update batch, throwing
// "Attempting to access a stale value from <Show>" and killing the listener
// before it could reset the transfer state — the UI stayed at 100% forever.

import { describe, expect, it, vi } from "vitest";
import { render } from "@solidjs/testing-library";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-barcode-scanner", () => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  scan: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("~/bindings", () => ({
  receive_file: vi.fn(),
  cancel_transfer: vi.fn(),
  pick_directory: vi.fn(),
}));
vi.mock("solid-sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

import { ReceivePanel } from "~/components/ReceivePanel";
import { GlobalStoreProvider, useGlobalStore } from "~/lib/store";
import type { IncomingRequest } from "~/bindings";

const request: IncomingRequest = {
  id: "req-1",
  senderName: "Pixel Phone",
  senderDeviceType: "phone",
  files: [{ name: "photo.jpg", size: 2048 }],
  totalSize: 2048,
};

function Harness() {
  const globalStore = useGlobalStore();
  (globalThis as Record<string, unknown>).__store = globalStore;
  return <ReceivePanel isMobile={false} pendingReceiveCards={[]} />;
}

describe("nearby receive completion", () => {
  it("clears the receiving card without throwing when the request is removed", async () => {
    render(() => (
      <GlobalStoreProvider>
        <Harness />
      </GlobalStoreProvider>
    ));
    const globalStore = (globalThis as Record<string, unknown>)
      .__store as ReturnType<typeof useGlobalStore>;

    // Simulate an accepted, in-progress nearby receive at 100%.
    globalStore.nearbyReceive.addIncomingRequest(request);
    globalStore.nearbyReceive.setActiveRequestId(request.id);
    globalStore.nearbyReceive.setTransferState("receiving");
    globalStore.nearbyReceive.setTransferProgress({
      transferred: 2048,
      total: 2048,
      speed: 0,
      eta: 0,
    });

    // What the nearby_receive_state "done" listener does, in order.
    expect(() => {
      globalStore.nearbyReceive.removeIncomingRequest(request.id);
      globalStore.nearbyReceive.setTransferProgress(null);
      globalStore.nearbyReceive.setTransferState(
        globalStore.nearbyReceive.state().incomingRequests.length > 0
          ? "review"
          : "idle",
      );
    }).not.toThrow();

    expect(globalStore.nearbyReceive.state().transferState).toBe("idle");
    expect(globalStore.nearbyReceive.state().incomingRequests).toHaveLength(0);
  });
});
