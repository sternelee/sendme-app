import { createEffect, onCleanup } from "solid-js";
import { Router, Route } from "@solidjs/router";
import { AuthProvider, useAuth } from "./lib/auth";
import { GlobalStoreProvider } from "./lib/store";
import {
  connectCloudWebSocket,
  disconnectCloudWebSocket,
} from "./lib/cloud-ws";
import Home from "./routes/index";
import "./styles.css";

function PresenceConnector() {
  const auth = useAuth();

  createEffect(() => {
    if (!auth.isLoaded()) {
      return;
    }

    if (auth.isSignedIn()) {
      connectCloudWebSocket().catch((e) =>
        console.error("[PresenceConnector] WebSocket connect failed:", e),
      );
    } else {
      disconnectCloudWebSocket().catch((e) =>
        console.error("[PresenceConnector] WebSocket disconnect failed:", e),
      );
    }
  });

  onCleanup(() => {
    disconnectCloudWebSocket().catch(() => {});
  });

  return null;
}

export default function App() {
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
