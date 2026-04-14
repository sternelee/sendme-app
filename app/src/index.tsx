import { render } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import App from "./app";
import "./styles.css";

// Mobile debugging with vconsole (detect via userAgent)
if (/android|ios/i.test(navigator.userAgent)) {
  import("vconsole").then(({ default: VConsole }) => {
    new VConsole();
  });
}

const appRoot = document.getElementById("app");
if (!(appRoot instanceof HTMLElement)) {
  throw new Error("App root not found");
}

const bootFallback = document.getElementById("boot-fallback");
render(() => <App />, appRoot);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    bootFallback?.classList.add("is-hidden");
    window.setTimeout(() => bootFallback?.remove(), 220);
  });
});

function notifyAppReady(attempt = 0) {
  void invoke("app_ready").catch((error) => {
    if (attempt >= 24) {
      console.error("Failed to finalize startup window transition:", error);
      return;
    }

    window.setTimeout(() => notifyAppReady(attempt + 1), 120 + attempt * 40);
  });
}

window.setTimeout(() => {
  requestAnimationFrame(() => notifyAppReady());
}, 80);
