import { createSignal, createEffect, onCleanup } from "solid-js";
import QRCodeLib from "qrcode";

interface QRCodeProps {
  value: string;
  size?: number;
  class?: string;
}

export default function QRCode(props: QRCodeProps) {
  const [dataUrl, setDataUrl] = createSignal<string>("");

  createEffect(() => {
    const value = props.value;
    if (!value) return;

    let cancelled = false;
    QRCodeLib.toDataURL(value, {
      width: props.size ?? 256,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        // ignore generation errors
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  return (
    <img
      src={dataUrl()}
      alt="QR Code"
      width={props.size ?? 256}
      height={props.size ?? 256}
      class={props.class}
    />
  );
}
