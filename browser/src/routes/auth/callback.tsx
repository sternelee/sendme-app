import { onMount } from "solid-js";

export default function AuthCallbackPage() {
  onMount(() => {
    if (typeof window !== "undefined") {
      const search = window.location.search;
      window.location.replace(`sendme://auth/callback${search}`);
    }
  });
  return null;
}
