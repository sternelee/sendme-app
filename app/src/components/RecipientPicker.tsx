import { Component, Show, createSignal } from "solid-js";
import { Radio, Smartphone, Users } from "lucide-solid";
import { i18n } from "@sendme/shared";
import { useGlobalStore } from "~/lib/store";
import NearbyPage from "~/routes/nearby";
import DevicesPage from "~/routes/devices";
import FriendsPage from "~/routes/friends";
import { RecipientGroup } from "~/lib/components/RecipientGroup";
import { useAuth } from "~/lib/auth";
import type { TransferRoutingPolicy } from "~/lib/types";

const t = i18n.t;

interface RecipientPickerProps {
  sendPath?: string;
  isFolder?: boolean;
  routingPolicy: TransferRoutingPolicy;
}

/**
 * Unified recipient list (AirDrop-style): one surface listing every possible
 * destination, grouped by proximity. The transport (AirBridge LAN vs iroh
 * remote) is shown as a badge on each group instead of a tab the user must
 * choose before seeing any target.
 *
 * The routing policy no longer switches tabs — it just filters which groups
 * are offered at all.
 */
export const RecipientPicker: Component<RecipientPickerProps> = (props) => {
  const globalStore = useGlobalStore();
  const auth = useAuth();

  // Cloud groups only make sense with an account. Without a session the
  // recipient list stays focused on what works right now: same-network
  // devices (plus the on-demand ticket, which needs no account).
  const isLoggedIn = () => auth.isLoaded() && auth.isSignedIn();

  const [nearbyOpen, setNearbyOpen] = createSignal(true);
  const [devicesOpen, setDevicesOpen] = createSignal(true);
  const [friendsOpen, setFriendsOpen] = createSignal(false);

  const isTextMode = () => globalStore.send.state().isTextMode;
  const textContent = () => globalStore.send.state().textContent;

  const showNearby = () => props.routingPolicy !== "remote_only";
  const showCloud = () =>
    props.routingPolicy !== "local_only" && isLoggedIn();

  // When a nearby transfer fails and auto fallback is allowed, reveal the
  // cloud device group so the user can retry over iroh without hunting for it.
  const handleFallbackToRemote = () => {
    setDevicesOpen(true);
  };

  return (
    <div class="space-y-3">
      <Show when={showNearby()}>
        <RecipientGroup
          icon={<Radio size={18} />}
          title={t("recipients.nearby.title")}
          badge={t("recipients.nearby.badge")}
          badgeClass="badge-success badge-outline"
          subtitle={t("recipients.nearby.subtitle")}
          open={nearbyOpen()}
          onToggle={() => setNearbyOpen(!nearbyOpen())}
        >
          <NearbyPage
            sendPath={props.sendPath}
            isFolder={props.isFolder}
            allowAutoFallback={props.routingPolicy === "auto"}
            onFallbackToRemote={handleFallbackToRemote}
          />
        </RecipientGroup>
      </Show>

      <Show when={showCloud()}>
        <RecipientGroup
          icon={<Smartphone size={18} />}
          title={t("recipients.devices.title")}
          badge={t("recipients.cloud.badge")}
          badgeClass="badge-primary badge-outline"
          subtitle={t("recipients.cloud.subtitle")}
          open={devicesOpen()}
          onToggle={() => setDevicesOpen(!devicesOpen())}
        >
          <DevicesPage
            sendPath={props.sendPath}
            isTextMode={isTextMode()}
            textContent={textContent()}
          />
        </RecipientGroup>

        <RecipientGroup
          icon={<Users size={18} />}
          title={t("recipients.friends.title")}
          badge={t("recipients.cloud.badge")}
          badgeClass="badge-primary badge-outline"
          subtitle={t("recipients.friends.subtitle")}
          open={friendsOpen()}
          onToggle={() => setFriendsOpen(!friendsOpen())}
        >
          <FriendsPage
            sendPath={props.sendPath}
            isTextMode={isTextMode()}
            textContent={textContent()}
          />
        </RecipientGroup>
      </Show>
    </div>
  );
};
