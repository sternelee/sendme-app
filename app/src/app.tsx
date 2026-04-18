import { createEffect } from "solid-js";
import { Router, Route } from "@solidjs/router";
import { AuthProvider, useAuth } from "./lib/auth";
import { GlobalStoreProvider } from "./lib/store";
import { start_cloud_presence, stop_cloud_presence } from "./bindings";
import { getCloudApiOrigin, getPersistentDeviceId } from "./lib/cloud-api";
import Home from "./routes/index";
import "./styles.css";

function PresenceConnector() {
  const auth = useAuth();

  createEffect(() => {
    if (!auth.isLoaded()) {
      return;
    }

    if (auth.isSignedIn()) {
      start_cloud_presence({
        deviceId: getPersistentDeviceId(),
        apiOrigin: getCloudApiOrigin(),
      }).catch((e) =>
        console.error("[PresenceConnector] backend presence start failed:", e),
      );
    } else {
      stop_cloud_presence().catch((e) =>
        console.error("[PresenceConnector] backend presence stop failed:", e),
      );
    }
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
