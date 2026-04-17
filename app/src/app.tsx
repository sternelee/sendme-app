import { createEffect } from "solid-js";
import { Router, Route } from "@solidjs/router";
import { AuthProvider, useAuth } from "./lib/auth";
import { GlobalStoreProvider } from "./lib/store";
import { usePresenceWS } from "./lib/ws-client";
import Home from "./routes/index";
import "./styles.css";

function PresenceConnector() {
  const auth = useAuth();
  const wsClient = usePresenceWS();

  createEffect(() => {
    if (auth.isSignedIn()) {
      wsClient.connect().catch((e) =>
        console.error("[PresenceConnector] WS connect failed:", e),
      );
    } else {
      wsClient.disconnect();
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
