import { createSignal, createMemo, onMount, onCleanup, Show, For } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { toast } from "solid-sonner";
import { get_cloud_presence_state, type CloudFriend } from "~/bindings";
import { useAuth } from "~/lib/auth";
import { useFriends, type Friend } from "~/lib/friends";
import { i18n } from "~/lib/i18n";
import {
  Users,
  UserPlus,
  UserX,
  Mail,
  Send,
  Clock,
  Smartphone,
  Laptop,
  RefreshCw,
  Check,
  X,
} from "lucide-solid";

const t = i18n.t;

export default function FriendsPage() {
  const auth = useAuth();
  const friendsService = useFriends();

  const [email, setEmail] = createSignal("");
  const [isAdding, setIsAdding] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"accepted" | "pending">("accepted");
  const [friends, setFriends] = createSignal<Friend[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isRefreshing, setIsRefreshing] = createSignal(false);

  // Check if user is signed in
  const isLoggedIn = () => auth.isSignedIn();

  // Computed friends lists
  const acceptedFriends = createMemo(() =>
    friends().filter((f) => f.status === "accepted")
  );

  const pendingFriends = createMemo(() =>
    friends().filter((f) => f.status === "pending")
  );

  // Load friends from API
  async function loadFriends() {
    if (!isLoggedIn()) return;

    setIsLoading(true);
    try {
      const [accepted, pending] = await Promise.all([
        friendsService.getFriends("accepted"),
        friendsService.getFriends("pending"),
      ]);
      setFriends([...accepted, ...pending]);
    } catch (error) {
      console.error("Failed to load friends:", error);
      toast.error(t("friends.addFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  function normalizeCloudFriend(friend: CloudFriend): Friend {
    return {
      ...friend,
      createdAt: new Date(friend.createdAt),
      updatedAt: new Date(friend.updatedAt),
      acceptedAt: friend.acceptedAt ? new Date(friend.acceptedAt) : null,
      friendDevices: friend.friendDevices.map((device) => ({
        ...device,
        lastSeenAt: new Date(device.lastSeenAt),
      })),
    };
  }

  let unsubscribeFriends: (() => void) | null = null;
  let unsubscribeErrors: (() => void) | null = null;

  onMount(async () => {
    const unlistenFriends = await listen<CloudFriend[]>(
      "cloud_friends_updated",
      (event) => {
        setFriends(event.payload.map(normalizeCloudFriend));
      },
    );
    unsubscribeFriends = unlistenFriends;

    const unlistenErrors = await listen<string>("cloud_presence_error", (event) => {
      console.error("[FriendsPage] backend presence error:", event.payload);
      toast.error(event.payload);
    });
    unsubscribeErrors = unlistenErrors;

    try {
      const snapshot = await get_cloud_presence_state();
      if (snapshot.friends.length > 0 || snapshot.active) {
        setFriends(snapshot.friends.map(normalizeCloudFriend));
      } else {
        await loadFriends();
      }
    } catch (error) {
      console.error("[FriendsPage] failed to get backend presence snapshot:", error);
      await loadFriends();
    }

    if (!isLoggedIn()) {
      setFriends([]);
    }
  });

  onCleanup(() => {
    unsubscribeFriends?.();
    unsubscribeErrors?.();
  });

  function getPlatformIcon(platform: string) {
    switch (platform) {
      case "android":
      case "ios":
        return Smartphone;
      default:
        return Laptop;
    }
  }

  async function handleAddFriend() {
    const emailValue = email().trim();
    if (!emailValue) {
      toast.error(t("friends.enterEmail"));
      return;
    }

    if (!isLoggedIn()) {
      toast.error("Please sign in to add friends");
      return;
    }

    setIsAdding(true);
    try {
      const result = await friendsService.addFriend(emailValue);
      if (result.action === "accepted") {
        toast.success(t("friends.friendAdded"));
      } else {
        toast.success(t("friends.requestSent"));
      }
      setEmail("");
      await loadFriends();
    } catch (error) {
      console.error("Failed to add friend:", error);
      toast.error(t("friends.addFailed"));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleAcceptRequest(friend: Friend) {
    try {
      const result = await friendsService.addFriend(friend.friend.email);
      if (result.action === "accepted") {
        toast.success(t("friends.friendAdded"));
      }
      await loadFriends();
    } catch (error) {
      console.error("Failed to accept friend request:", error);
      toast.error(t("friends.addFailed"));
    }
  }

  async function handleDeclineRequest(friend: Friend) {
    try {
      await friendsService.removeFriend(friend.friend.id);
      setFriends((prev) => prev.filter((f) => f.id !== friend.id));
      toast.success(t("friends.declined"));
    } catch (error) {
      console.error("Failed to decline friend request:", error);
      toast.error(t("friends.declineFailed"));
    }
  }

  async function handleRemoveFriend(friend: Friend) {
    try {
      await friendsService.removeFriend(friend.friend.id);
      setFriends((prev) => prev.filter((f) => f.id !== friend.id));
      toast.success(t("friends.friendRemoved"));
    } catch (error) {
      console.error("Failed to remove friend:", error);
      toast.error(t("friends.removeFailed"));
    }
  }

  async function handleSendToFriend(friend: Friend) {
    // Navigate to send tab with friend's device selected
    // For now, just show a toast
    toast.success(`Selected ${friend.friend.name} for file transfer. Go to Send tab to select files.`);
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      const snapshot = await get_cloud_presence_state();
      if (snapshot.friends.length > 0 || snapshot.connected) {
        setFriends(snapshot.friends.map(normalizeCloudFriend));
      } else {
        await loadFriends();
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div class="space-y-4">
      <Show
        when={isLoggedIn()}
        fallback={
          <div class="text-center py-12">
            <Users size={48} class="mx-auto mb-4 opacity-40" />
            <p class="text-base-content/60 font-medium">
              {t("common.signInToSync")}
            </p>
            <button
              onClick={() => auth.signIn()}
              class="btn btn-primary mt-4"
            >
              {t("common.signIn")}
            </button>
          </div>
        }
      >
        {/* Header with refresh */}
        <div class="flex items-center justify-between">
          <h2 class="text-base-content/60 text-sm font-bold tracking-wider uppercase">
            {t("friends.title")}
          </h2>
          <button
            onClick={handleRefresh}
            class="btn btn-ghost btn-sm btn-circle"
            disabled={isRefreshing()}
            title="Refresh"
          >
            <RefreshCw size={16} class={isRefreshing() ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Add Friend Section */}
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body p-4">
            <h3 class="card-title text-lg flex items-center gap-2">
              <UserPlus size={20} />
              {t("friends.addFriend")}
            </h3>
            <div class="flex gap-2 mt-2">
              <div class="join flex-1">
                <span class="join-item btn btn-disabled">
                  <Mail size={16} />
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
            <Users size={16} class="mr-1" />
            {t("friends.friends")} ({acceptedFriends().length})
          </a>
          <a
            role="tab"
            class={`tab ${activeTab() === "pending" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("pending")}
          >
            <Clock size={16} class="mr-1" />
            {t("friends.pending")} ({pendingFriends().length})
          </a>
        </div>

        {/* Loading state */}
        <Show when={isLoading()}>
          <div class="flex justify-center py-8">
            <span class="loading loading-spinner loading-md text-primary"></span>
          </div>
        </Show>

        {/* Accepted Friends */}
        <Show when={activeTab() === "accepted" && !isLoading()}>
          <Show
            when={acceptedFriends().length > 0}
            fallback={
              <div class="text-center py-12 text-base-content/50">
                <Users size={48} class="mx-auto mb-3 opacity-50" />
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
                    friend.friendDevices && friend.friendDevices.some((d) => d.online);

                  return (
                    <div class="card bg-base-200 shadow-sm hover:shadow-md transition-shadow">
                      <div class="card-body p-4">
                        <div class="flex items-center gap-3">
                          {/* Avatar */}
                          <div class="avatar placeholder">
                            <div class="bg-primary text-primary-content rounded-full w-12 h-12 flex items-center justify-center">
                              <Show
                                when={friend.friend.image}
                                fallback={
                                  <span class="text-lg">
                                    {friend.friend.name?.charAt(0).toUpperCase() || "?"}
                                  </span>
                                }
                              >
                                <img
                                  src={friend.friend.image!}
                                  alt={friend.friend.name}
                                  class="w-full h-full object-cover rounded-full"
                                />
                              </Show>
                            </div>
                          </div>

                          {/* Info */}
                          <div class="flex-1 min-w-0">
                            <h4 class="font-semibold truncate">
                              {friend.friend.name || "Unknown"}
                            </h4>
                            <p class="text-xs text-base-content/60 truncate">
                              {friend.friend.email || ""}
                            </p>
                            <Show when={friend.friendDevices && friend.friendDevices.length > 0}>
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
                              </div>
                            </Show>
                          </div>

                          {/* Status & Actions */}
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

                            <Show when={hasOnlineDevice()}>
                              <button
                                onClick={() => handleSendToFriend(friend)}
                                class="btn btn-primary btn-sm"
                                title={t("friends.sendFile")}
                              >
                                <Send size={14} />
                              </button>
                            </Show>
                            <button
                              onClick={() => handleRemoveFriend(friend)}
                              class="btn btn-ghost btn-sm btn-circle text-error"
                              title={t("friends.remove")}
                            >
                              <UserX size={16} />
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
        <Show when={activeTab() === "pending" && !isLoading()}>
          <Show
            when={pendingFriends().length > 0}
            fallback={
              <div class="text-center py-12 text-base-content/50">
                <Clock size={48} class="mx-auto mb-3 opacity-50" />
                <p class="text-sm">{t("friends.noPending")}</p>
              </div>
            }
          >
            <div class="space-y-3">
              <For each={pendingFriends()}>
                {(friend) => {
                  const isIncoming = friend.friendUserId === auth.user()?.id;

                  return (
                    <div class="card bg-base-200 shadow-sm">
                      <div class="card-body p-4">
                        <div class="flex items-center gap-3">
                          {/* Avatar */}
                          <div class="avatar placeholder">
                            <div class={`rounded-full w-12 h-12 flex items-center justify-center ${
                              isIncoming
                                ? "bg-secondary text-secondary-content"
                                : "bg-warning text-warning-content"
                            }`}>
                              <Show
                                when={friend.friend.image}
                                fallback={
                                  <span class="text-lg">
                                    {friend.friend.name?.charAt(0).toUpperCase() || "?"}
                                  </span>
                                }
                              >
                                <img
                                  src={friend.friend.image!}
                                  alt={friend.friend.name}
                                  class="w-full h-full object-cover rounded-full"
                                />
                              </Show>
                            </div>
                          </div>

                          {/* Info */}
                          <div class="flex-1 min-w-0">
                            <h4 class="font-semibold truncate">
                              {friend.friend.name || "Unknown"}
                            </h4>
                            <p class="text-xs text-base-content/60 truncate">
                              {friend.friend.email || ""}
                            </p>
                            <div class={`badge badge-sm gap-1 mt-1 ${
                              isIncoming ? "badge-secondary" : "badge-warning"
                            }`}>
                              <Clock size={12} />
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
                                <Check size={16} /> {t("friends.accept")}
                              </button>
                              <button
                                onClick={() => handleDeclineRequest(friend)}
                                class="btn btn-ghost btn-sm text-error"
                                title={t("friends.decline")}
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </Show>
                          <Show when={!isIncoming}>
                            <button
                              onClick={() => handleRemoveFriend(friend)}
                              class="btn btn-ghost btn-sm text-error"
                              title={t("friends.remove")}
                            >
                              <UserX size={16} />
                            </button>
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
      </Show>
    </div>
  );
}
