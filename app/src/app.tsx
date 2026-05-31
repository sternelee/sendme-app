import { createEffect, onCleanup, onMount } from "solid-js";
import { Router, Route } from "@solidjs/router";
import { AuthProvider, useAuth } from "./lib/auth";
import { GlobalStoreProvider } from "./lib/store";
import {
  connectCloudWebSocket,
  disconnectCloudWebSocket,
} from "./lib/cloud-ws";
import { debugError, debugInfo, startUiFreezeWatchdog } from "./lib/debug-log";
import { triggerHaptic } from "./lib/haptics";
import Home from "./routes/index";
import "./styles.css";

const CLOUD_WS_CONNECT_DEBOUNCE_MS = 5000;

function PresenceConnector() {
  const auth = useAuth();
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPendingConnect = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };

  createEffect(() => {
    if (!auth.isLoaded()) {
      return;
    }

    clearPendingConnect();

    if (auth.isSignedIn()) {
      if (!auth.isCloudReady()) {
        debugInfo(
          "PresenceConnector",
          "Auth signed-in but cloud not ready yet; delaying websocket connect",
        );
        return;
      }

      debugInfo(
        "PresenceConnector",
        `Scheduling WebSocket connect in ${CLOUD_WS_CONNECT_DEBOUNCE_MS}ms after auth state became signed-in`,
      );
      connectTimer = setTimeout(() => {
        connectTimer = null;
        connectCloudWebSocket().catch((e) =>
          debugError("PresenceConnector", "WebSocket connect failed", e),
        );
      }, CLOUD_WS_CONNECT_DEBOUNCE_MS);
      return;
    }

    disconnectCloudWebSocket().catch((e) =>
      debugError("PresenceConnector", "WebSocket disconnect failed", e),
    );
  });

  onCleanup(() => {
    clearPendingConnect();
    disconnectCloudWebSocket().catch(() => {});
  });

  return null;
}

export default function App() {
  onMount(() => {
    const stopWatchdog = startUiFreezeWatchdog();
    onCleanup(stopWatchdog);
  });

  return (
    <AuthProvider>
      <GlobalStoreProvider>
        <PresenceConnector />
        <Router root={(props) => <>{props.children}</>}>
          <Route path="/" component={Home} />
        </Router>
      </GlobalStoreProvider>
    </AuthProvider>
  );
}
