import type { CloudTicket, IncomingRequest } from "~/bindings";
import type { TransferMode } from "~/lib/types";

export interface SendSelectionItem {
  path: string;
  name: string;
  size: number;
}

export interface IncomingReminderItem {
  id: string;
  kind: "nearby" | "cloud";
  scheme: "airbridge" | "iroh";
  title: string;
  subtitle: string;
  fileLabel: string;
  fileCount: number;
  totalSize: number;
}

export function shouldShowShareWorkspace(mode: TransferMode): boolean {
  return mode !== "receive";
}

export function pickPrimarySendSelection(files: SendSelectionItem[]): {
  primary: SendSelectionItem | null;
  overflowCount: number;
} {
  const [primary, ...rest] = files;
  return {
    primary: primary ?? null,
    overflowCount: rest.length,
  };
}

export function getTransferListClass(): string {
  return "space-y-3 max-h-[28rem] overflow-y-auto pr-1";
}
export function buildIncomingReminders(options: {
  nearbyRequest?: IncomingRequest | null;
  nearbyRequests?: IncomingRequest[];
  cloudTickets: CloudTicket[];
  maxVisible?: number;
}): {
  visible: IncomingReminderItem[];
  hiddenCount: number;
  totalCount: number;
} {
  const maxVisible = options.maxVisible ?? 3;
  const reminders: IncomingReminderItem[] = [];
  const nearbyRequests =
    options.nearbyRequests ??
    (options.nearbyRequest ? [options.nearbyRequest] : []);

  for (const request of nearbyRequests) {
    const firstFile = request.files[0];
    reminders.push({
      id: request.id,
      kind: "nearby",
      scheme: "airbridge",
      title: request.senderName,
      subtitle: request.senderDeviceType || "AirBridge（本地网络）",
      fileLabel:
        firstFile?.name ??
        `${Math.max(request.files.length, 1)} file${request.files.length === 1 ? "" : "s"}`,
      fileCount: request.files.length,
      totalSize: request.totalSize,
    });
  }

  for (const ticket of options.cloudTickets) {
    if ((ticket.status ?? "pending") !== "pending") continue;
    reminders.push({
      id: ticket.id,
      kind: "cloud",
      scheme: "iroh",
      title: ticket.senderName?.trim() || "Cloud transfer",
      subtitle: "iroh（远程网络）",
      fileLabel: ticket.filename?.trim() || "Unnamed file",
      fileCount: 1,
      totalSize: ticket.fileSize ?? 0,
    });
  }

  return {
    visible: reminders.slice(0, maxVisible),
    hiddenCount: Math.max(reminders.length - maxVisible, 0),
    totalCount: reminders.length,
  };
}

export interface ReceiveProgressSnapshot {
  transfer_id: string;
  name?: string;
  progress?: {
    type?: string;
    offset?: number;
    total?: number;
    speed?: number;
  };
  lastTime?: number;
  completedAt?: number;
}

export interface PendingReceiveCard {
  id: string;
  title: string;
  total?: number | null;
  lastTime: number;
}

export interface ReceiveProgressCard {
  id: string;
  title: string;
  transferred: number;
  total: number;
  speed: number;
  eta: number;
  isPending: boolean;
  isCompleted: boolean;
}

export function buildReceiveProgressCards(
  progressById: Record<string, ReceiveProgressSnapshot>,
  options: {
    now: number;
    retainCompletedMs?: number;
    limit?: number;
    pending?: PendingReceiveCard[];
  },
): ReceiveProgressCard[] {
  const retainCompletedMs = options.retainCompletedMs ?? 2_000;
  const limit = options.limit ?? 3;
  const pendingById = new Map(
    (options.pending ?? []).map((item) => [item.id, item]),
  );

  const activeCards = Object.values(progressById)
    .filter((item) => {
      const isCompleted = item.progress?.type === "completed";
      if (!isCompleted) return true;
      const completedAt = item.completedAt ?? item.lastTime ?? 0;
      return options.now - completedAt <= retainCompletedMs;
    })
    .map((item) => {
      const pending = pendingById.get(item.transfer_id);
      const transferred = item.progress?.offset ?? 0;
      const total = item.progress?.total ?? pending?.total ?? 1;
      const speed = item.progress?.speed ?? 0;
      const eta =
        speed > 0 && total >= transferred
          ? Math.ceil((total - transferred) / speed)
          : 0;

      return {
        id: item.transfer_id,
        title: item.name?.trim() || pending?.title || item.transfer_id,
        transferred,
        total,
        speed,
        eta,
        isPending: false,
        isCompleted: item.progress?.type === "completed",
        lastTime: item.lastTime ?? 0,
      };
    });

  const activeCardIds = new Set(activeCards.map((item) => item.id));

  const pendingCards = (options.pending ?? [])
    .filter((item) => !activeCardIds.has(item.id))
    .map((item) => ({
      id: item.id,
      title: item.title,
      transferred: 0,
      total: item.total ?? 1,
      speed: 0,
      eta: 0,
      isPending: true,
      isCompleted: false,
      lastTime: item.lastTime,
    }));

  return [...pendingCards, ...activeCards]
    .sort((left, right) => right.lastTime - left.lastTime)
    .slice(0, limit)
    .map(({ lastTime: _lastTime, ...card }) => card);
}
