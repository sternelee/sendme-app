import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { Toaster } from "solid-toast";
import { AuthProvider } from "./lib/contexts/user-better-auth";
import { Title, Meta, MetaProvider } from "@solidjs/meta";
import PWAInstallPrompt from "./components/pwa/PWAInstallPrompt";
import PWAUpdateNotification from "./components/pwa/PWAUpdateNotification";
import "./app.css";

export default function App() {
  return (
    <AuthProvider>
      <MetaProvider>
        <Title>Sendmd - P2P File Transfer</Title>
        <Meta
          name="description"
          content="Secure, peer-to-peer file transfer powered by iroh. Send files of any size without cloud storage or limits."
        />
        <Meta
          name="keywords"
          content="P2P,file transfer,secure,iroh,decentralized,peer-to-peer"
        />
        <Meta name="theme-color" content="#a855f7" />
        <Meta property="og:type" content="website" />
        <Meta property="og:title" content="Sendmd - P2P File Transfer" />
        <Meta
          property="og:description"
          content="Secure, peer-to-peer file transfer powered by iroh. Send files of any size without cloud storage."
        />
        <Meta property="og:image" content="/og-image.png" />
        <Meta name="twitter:card" content="summary_large_image" />
        <Meta name="twitter:title" content="Sendmd - P2P File Transfer" />
        <Meta
          name="twitter:description"
          content="Secure, peer-to-peer file transfer powered by iroh. Send files of any size without cloud storage."
        />
        <Meta name="twitter:image" content="/twitter-image.png" />
        <Meta name="apple-mobile-web-app-capable" content="yes" />
        <Meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <Meta name="apple-mobile-web-app-title" content="Sendmd" />
        <Meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <Router
          root={(props) => (
            <>
              <Suspense fallback={<div>Loading...</div>}>
                {props.children}
              </Suspense>
              <Toaster position="bottom-center" />
              <PWAInstallPrompt />
              <PWAUpdateNotification />
            </>
          )}
        >
          <FileRoutes />
        </Router>
      </MetaProvider>
    </AuthProvider>
  );
}
