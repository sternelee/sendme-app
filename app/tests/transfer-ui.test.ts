import { describe, expect, it } from "vitest";
import type { CloudTicket, IncomingRequest } from "~/bindings";
import {
  buildIncomingReminders,
  buildReceiveProgressCards,
  getTransferListClass,
  pickPrimarySendSelection,
  shouldShowShareWorkspace,
} from "~/lib/transfer-ui";

describe("transfer ui helpers", () => {
  it("shows share workspace only for send and text modes", () => {
    expect(shouldShowShareWorkspace("send")).toBe(true);
    expect(shouldShowShareWorkspace("text")).toBe(true);
    expect(shouldShowShareWorkspace("receive")).toBe(false);
  });

  it("prioritizes nearby requests before cloud tickets and limits visible reminders", () => {
    const nearbyRequest: IncomingRequest = {
      id: "nearby-1",
      senderName: "Alice's iPhone",
      senderDeviceType: "ios",
      files: [{ name: "photo.jpg", size: 2_048 }],
      totalSize: 2_048,
    };

    const cloudTickets: CloudTicket[] = [
      {
        id: "cloud-1",
        ticket: "blob:cloud-1",
        filename: "budget.xlsx",
        fileSize: 8_192,
        senderName: "Work Mac",
        status: "pending",
      },
      {
        id: "cloud-2",
        ticket: "blob:cloud-2",
        filename: "report.pdf",
        fileSize: 4_096,
        senderName: "Home PC",
        status: "pending",
      },
      {
        id: "cloud-3",
        ticket: "blob:cloud-3",
        filename: "archive.zip",
        fileSize: 16_384,
        senderName: "Archive Box",
        status: "pending",
      },
    ];

    const result = buildIncomingReminders({
      nearbyRequest,
      cloudTickets,
      maxVisible: 3,
    });

    expect(result.visible.map((item) => item.id)).toEqual([
      "nearby-1",
      "cloud-1",
      "cloud-2",
    ]);
    expect(result.visible[0]).toMatchObject({
      kind: "nearby",
      title: "Alice's iPhone",
      fileLabel: "photo.jpg",
    });
    expect(result.hiddenCount).toBe(1);
  });

  it("keeps only the first selected file and reports overflow count", () => {
    const result = pickPrimarySendSelection([
      { path: "/tmp/one.png", name: "one.png", size: 100 },
      { path: "/tmp/two.png", name: "two.png", size: 200 },
      { path: "/tmp/three.png", name: "three.png", size: 300 },
    ]);

    expect(result.primary).toEqual({
      path: "/tmp/one.png",
      name: "one.png",
      size: 100,
    });
    expect(result.overflowCount).toBe(2);
  });

  it("returns a scrollable max-height class for transfer lists", () => {
    expect(getTransferListClass()).toContain("overflow-y-auto");
    expect(getTransferListClass()).toContain("max-h-");
  });
});

it("builds visible receive progress cards sorted by recent activity", () => {
  const now = 10_000;
  const result = buildReceiveProgressCards(
    {
      older: {
        transfer_id: "older",
        name: "older.bin",
        progress: { type: "downloading", offset: 50, total: 100, speed: 10 },
        lastTime: now - 2_000,
      },
      latest: {
        transfer_id: "latest",
        name: "latest.bin",
        progress: { type: "downloading", offset: 20, total: 40, speed: 20 },
        lastTime: now,
      },
      done: {
        transfer_id: "done",
        name: "done.bin",
        progress: { type: "completed", offset: 40, total: 40, speed: 0 },
        lastTime: now - 500,
        completedAt: now - 500,
      },
    },
    { now, retainCompletedMs: 2_000 },
  );

  expect(result.map((item) => item.id)).toEqual(["latest", "done", "older"]);
  expect(result[0]).toMatchObject({
    title: "latest.bin",
    transferred: 20,
    total: 40,
    speed: 20,
    eta: 1,
    isCompleted: false,
  });
  expect(result[1]).toMatchObject({
    id: "done",
    isCompleted: true,
  });
});

it("includes pending receive cards until progress starts", () => {
  const now = 10_000;
  const result = buildReceiveProgressCards(
    {
      active: {
        transfer_id: "active",
        name: "active.bin",
        progress: { type: "downloading", offset: 25, total: 100, speed: 25 },
        lastTime: now - 100,
      },
    },
    {
      now,
      pending: [
        {
          id: "pending-cloud",
          title: "shared.mov",
          total: 400,
          lastTime: now,
        },
      ],
    },
  );

  expect(result.map((item) => item.id)).toEqual(["pending-cloud", "active"]);
  expect(result[0]).toMatchObject({
    title: "shared.mov",
    transferred: 0,
    total: 400,
    speed: 0,
    eta: 0,
    isPending: true,
    isCompleted: false,
  });
});

it("hides pending receive cards once matching progress arrives", () => {
  const now = 10_000;
  const result = buildReceiveProgressCards(
    {
      pending: {
        transfer_id: "pending-cloud",
        name: "shared.mov",
        progress: { type: "downloading", offset: 50, total: 400, speed: 40 },
        lastTime: now,
      },
    },
    {
      now,
      pending: [
        {
          id: "pending-cloud",
          title: "shared.mov",
          total: 400,
          lastTime: now - 500,
        },
      ],
    },
  );

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: "pending-cloud",
    transferred: 50,
    total: 400,
    isPending: false,
  });
});

it("drops completed receive cards after the retention window", () => {
  const now = 10_000;
  const result = buildReceiveProgressCards(
    {
      stale: {
        transfer_id: "stale",
        name: "stale.bin",
        progress: { type: "completed", offset: 40, total: 40, speed: 0 },
        lastTime: now - 5_000,
        completedAt: now - 5_000,
      },
    },
    { now, retainCompletedMs: 2_000 },
  );

  expect(result).toEqual([]);
});
