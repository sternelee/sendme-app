import { Show, For, createSignal, createEffect, createMemo } from "solid-js";
import toast from "solid-toast";
import { useAuth } from "../../lib/contexts/user-clerk";
import { useAuth as useClerkAuth } from "clerk-solidjs";
import { useWebSocket, type EnrichedFriend } from "../../lib/composables/useWebSocket";
import { i18n } from "../../lib/i18n";
import {
  TbOutlineUserPlus,
  TbOutlineUserX,
  TbOutlineUsers,
  TbOutlineCheck,
  TbOutlineX,
  TbOutlineMail,
  TbOutlineSend,
  TbOutlineClock,
  TbOutlineDeviceDesktop,
  TbOutlineDeviceMobile,
} from "solid-icons/tb";

const t = i18n.t;

interface FriendsTabProps {
  onSendToFriend?: (friend: EnrichedFriend) => void;
  showSendButton?: boolean;
  ticket?: string;
}

function getPlatformIcon(platform: string) {
  switch (platform) {
    case "android":
    case "ios":
      return TbOutlineDeviceMobile;
    case "windows":
    case "mac":
    case "linux":
      return TbOutlineDeviceDesktop;
    case "web":
      return TbOutlineDeviceDesktop;
    default:
      return TbOutlineDeviceDesktop;
  }
}

/**
 * Inline toast with Accept / Decline action buttons for incoming friend requests
 */
function FriendRequestToast(props: {
  name: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div class="flex flex-col gap-2 min-w-[280px]">
      <p class="font-medium text-sm">{t("friends.incomingRequestTitle", { name: props.name })}</p>
      <div class="flex gap-2">
        <button
          onClick={props.onAccept}
          class="btn btn-success btn-xs flex-1"
        >
          <TbOutlineCheck size={14} /> {t("friends.accept")}
        </button>
        <button
          onClick={props.onDecline}
          class="btn btn-ghost btn-xs flex-1"
        >
          <TbOutlineX size={14} /> {t("friends.decline")}
        </button>
      </div>
    </div>
  );
}

export default function FriendsTab(props: FriendsTabProps) {
  const auth = useAuth();
  const { getToken, userId: clerkUserId } = useClerkAuth();
  const { friends, isConnected } = useWebSocket();
  const [email, setEmail] = createSignal("");
  const [isAdding, setIsAdding] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"accepted" | "pending">("accepted");
  const [notifiedIds, setNotifiedIds] = createSignal<Set<string>>(new Set());

  // Accepted / Pending splits
  const acceptedFriends = createMemo(() =>
    friends().filter((f) => f.status === "accepted")
  );
  const pendingFriends = createMemo(() =>
    friends().filter((f) => f.status === "pending")
  );

  // Separate incoming (I received) vs outgoing (I sent)
  const incomingRequests = createMemo(() =>
    pendingFriends().filter(
      (f) => f.friend.id === clerkUserId()
    )
  );
  const outgoingRequests = createMemo(() =>
    pendingFriends().filter(
      (f) => f.userId === clerkUserId()
    )
  );

  // --- Toast notification on new incoming request ---
  createEffect(() => {
    const incoming = incomingRequests();
    const seen = notifiedIds();
    const newRequests = incoming.filter(
      (f) => !seen.has(f.id)
    );

    if (newRequests.length > 0) {
      newRequests.forEach((req) => {
        const toastId = toast.custom(
          (t2) => (
            <FriendRequestToast
              name={req.friend.name}
              onAccept={async () => {
                toast.dismiss(t2.id);
                await handleAcceptRequest(req);
              }}
              onDecline={async () => {
                toast.dismiss(t2.id);
                await handleDeclineRequest(req);
              }}
            />
          ),
          { duration: 15_000 }
        );
      });
      setNotifiedIds((prev) => {
        const next = new Set(prev);
        newRequests.forEach((r) => next.add(r.id));
        return next;
      });
    }
  });

  /**
   * Accept an incoming friend request
   * (Re-POST their email to trigger auto-accept)
   */
  async function handleAcceptRequest(friendship: EnrichedFriend) {
    try {
      const token = await getToken();
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: friendship.friend.email }),
      });

      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to accept friend request");
      }
      toast.success(t("friends.friendAdded"));
    } catch (error) {
      console.error("Failed to accept friend request:", error);
      toast.error(t("friends.addFailed") + ": " + (error as Error).message);
    }
  }

  /**
   * Decline (delete) a pending friend request
   */
  async function handleDeclineRequest(friendship: EnrichedFriend) {
    try {
      const token = await getToken();
      const response = await fetch(`/api/friends/${friendship.friend.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || "Failed to decline");
      }
      toast.success(t("friends.declined"));
    } catch (error) {
      console.error("Failed to decline:", error);
      toast.error(t("friends.declineFailed") + ": " + (error as Error).message);
    }
  }

  /**
   * Add a friend by email
   */
  async function handleAddFriend() {
    const emailValue = email();
    if (!emailValue.trim()) {
      toast.error(t("friends.enterEmail"));
      return;
    }

    setIsAdding(true);
    try {
      const token = await getToken();
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: emailValue }),
      });

      const data = await response.json() as { error?: string; action?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to add friend");
      }

      if (data.action === "accepted") {
        toast.success(t("friends.friendAdded"));
      } else {
        toast.success(t("friends.requestSent"));
      }

      setEmail("");
    } catch (error) {
      console.error("Failed to add friend:", error);
      toast.error(t("friends.addFailed") + ": " + (error as Error).message);
    } finally {
      setIsAdding(false);
    }
  }

  /**
   * Remove a friend
   */
  async function handleRemoveFriend(friend: EnrichedFriend) {
    try {
      const token = await getToken();
      const response = await fetch(`/api/friends/${friend.friend.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || "Failed to remove friend");
      }

      toast.success(t("friends.friendRemoved"));
    } catch (error) {
      console.error("Failed to remove friend:", error);
      toast.error(t("friends.removeFailed") + ": " + (error as Error).message);
    }
  }

  /**
   * Send ticket to friend
   */
  async function handleSendToFriend(friend: EnrichedFriend) {
    if (props.onSendToFriend) {
      props.onSendToFriend(friend);
    }
  }

  function formatLastSeen(lastSeenAt: Date | string): string {
    const now = Date.now();
    const lastSeen = new Date(lastSeenAt).getTime();
    const diff = now - lastSeen;

    if (diff < 60000) return t("friends.justNow");
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ${t("friends.ago")}`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ${t("friends.ago")}`;
    return `${Math.floor(diff / 86400000)}d ${t("friends.ago")}`;
  }

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="text-center">
        <h2 class="text-2xl font-bold">{t("friends.title")}</h2>
        <p class="text-base-content/60 text-sm mt-1">{t("friends.subtitle")}</p>
      </div>

      {/* Add Friend Section */}
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body p-6">
          <h3 class="card-title text-lg">
            <TbOutlineUserPlus size={20} />
            {t("friends.addFriend")}
          </h3>
          <div class="flex gap-2 mt-2">
            <div class="join flex-1">
              <span class="join-item btn btn-disabled">
                <TbOutlineMail size={16} />
              </span>
              <input
                type="email"
                placeholder={t("friends.emailPlaceholder")}
                class="input input-bordered join-item flex-1"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddFriend();
                }}
              />
            </div>
            <button
              onClick={handleAddFriend}
              disabled={isAdding() || !email().trim()}
              class={`btn btn-primary ${isAdding() ? "loading" : ""}`}
            >
              {isAdding() ? t("friends.adding") : t("friends.add")}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" class="tabs tabs-bordered tabs-lg">
        <a
          role="tab"
          class={`tab ${activeTab() === "accepted" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("accepted")}
        >
          <TbOutlineUsers size={16} class="mr-1" />
          {t("friends.friends")} ({acceptedFriends().length})
        </a>
        <a
          role="tab"
          class={`tab ${activeTab() === "pending" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("pending")}
        >
          <TbOutlineClock size={16} class="mr-1" />
          {t("friends.pending")} ({pendingFriends().length})
        </a>
      </div>

      {/* Accepted Friends */}
      <Show when={activeTab() === "accepted"}>
        <Show
          when={acceptedFriends().length > 0}
          fallback={
            <div class="text-center py-12 text-base-content/50">
              <TbOutlineUsers size={48} class="mx-auto mb-3 opacity-50" />
              <p class="text-sm">{t("friends.noFriends")}</p>
              <p class="text-xs mt-1 text-base-content/40">
                {t("friends.addFirst")}
              </p>
            </div>
          }
        >
          <div class="space-y-3">
            <For each={acceptedFriends()}>
              {(friend) => {
                const hasOnlineDevice = () =>
                  friend.friendDevices.some((d) => d.online);

                return (
                  <div class="card bg-base-200 shadow-sm hover:shadow-md transition-shadow">
                    <div class="card-body p-4">
                      <div class="flex items-center gap-3">
                        {/* Avatar */}
                        <div class="avatar placeholder">
                          <div class="bg-primary text-primary-content rounded-full w-12 h-12">
                            <Show
                              when={friend.friend.image}
                              fallback={
                                <span class="text-lg">
                                  {friend.friend.name.charAt(0).toUpperCase()}
                                </span>
                              }
                            >
                              <img
                                src={friend.friend.image!}
                                alt={friend.friend.name}
                              />
                            </Show>
                          </div>
                        </div>

                        {/* Info */}
                        <div class="flex-1 min-w-0">
                          <h4 class="font-semibold truncate">
                            {friend.friend.name}
                          </h4>
                          <p class="text-xs text-base-content/60 truncate">
                            {friend.friend.email}
                          </p>
                          <Show when={friend.friendDevices.length > 0}>
                            <div class="flex items-center gap-1 mt-1 text-xs text-base-content/40">
                              <For each={friend.friendDevices.slice(0, 3)}>
                                {(device) => {
                                  const PlatformIcon = getPlatformIcon(device.platform);
                                  return (
                                    <span class="flex items-center gap-0.5">
                                      <PlatformIcon size={12} />
                                      <span class="text-[10px]">{device.name}</span>
                                    </span>
                                  );
                                }}
                              </For>
                              <Show when={friend.friendDevices.length > 3}>
                                <span class="text-[10px]">
                                  +{friend.friendDevices.length - 3}
                                </span>
                              </Show>
                            </div>
                          </Show>
                        </div>

                        {/* Status */}
                        <div class="flex items-center gap-2">
                          <div
                            class={`badge badge-sm ${
                              hasOnlineDevice() ? "badge-success gap-1" : "badge-ghost gap-1"
                            }`}
                          >
                            <div
                              class={`w-1.5 h-1.5 rounded-full ${
                                hasOnlineDevice() ? "bg-white" : "bg-base-content/40"
                              }`}
                            />
                            {hasOnlineDevice() ? t("friends.online") : t("friends.offline")}
                          </div>

                          {/* Actions */}
                          <Show when={props.showSendButton && props.ticket && hasOnlineDevice()}>
                            <button
                              onClick={() => handleSendToFriend(friend)}
                              class="btn btn-primary btn-sm"
                              title={t("friends.sendFile")}
                            >
                              <TbOutlineSend size={14} />
                            </button>
                          </Show>
                          <button
                            onClick={() => handleRemoveFriend(friend)}
                            class="btn btn-ghost btn-sm btn-circle text-error"
                            title={t("friends.remove")}
                          >
                            <TbOutlineUserX size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      {/* Pending Requests */}
      <Show when={activeTab() === "pending"}>
        <Show
          when={pendingFriends().length > 0}
          fallback={
            <div class="text-center py-12 text-base-content/50">
              <TbOutlineClock size={48} class="mx-auto mb-3 opacity-50" />
              <p class="text-sm">{t("friends.noPending")}</p>
            </div>
          }
        >
          <div class="space-y-3">
            <For each={pendingFriends()}>
              {(friend) => {
                const isIncoming = friend.friend.id === clerkUserId();

                return (
                  <div class="card bg-base-200 shadow-sm">
                    <div class="card-body p-4">
                      <div class="flex items-center gap-3">
                        {/* Avatar */}
                        <div class="avatar placeholder">
                          <div class={`rounded-full w-12 h-12 ${
                            isIncoming
                              ? "bg-secondary text-secondary-content"
                              : "bg-warning text-warning-content"
                          }`}>
                            <span class="text-lg">
                              {friend.friend.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        </div>

                        {/* Info */}
                        <div class="flex-1 min-w-0">
                          <h4 class="font-semibold truncate">
                            {friend.friend.name}
                          </h4>
                          <p class="text-xs text-base-content/60 truncate">
                            {friend.friend.email}
                          </p>
                          <div class={`badge badge-sm gap-1 mt-1 ${
                            isIncoming ? "badge-secondary" : "badge-warning"
                          }`}>
                            <TbOutlineClock size={12} />
                            {isIncoming
                              ? t("friends.incomingRequest")
                              : t("friends.outgoingRequest")}
                          </div>
                        </div>

                        {/* Actions */}
                        <Show when={isIncoming}>
                          <div class="flex gap-2">
                            <button
                              onClick={() => handleAcceptRequest(friend)}
                              class="btn btn-success btn-sm"
                              title={t("friends.accept")}
                            >
                              <TbOutlineCheck size={16} /> {t("friends.accept")}
                            </button>
                            <button
                              onClick={() => handleDeclineRequest(friend)}
                              class="btn btn-ghost btn-sm text-error"
                              title={t("friends.decline")}
                            >
                              <TbOutlineX size={16} />
                            </button>
                          </div>
                        </Show>
                        <Show when={!isIncoming}>
                          <div class="text-xs text-base-content/40">
                            {t("friends.waitingAcceptance")}
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
