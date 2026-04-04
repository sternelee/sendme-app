import { createSignal, Show } from "solid-js";
import toast from "solid-toast";
import { i18n } from "../../lib/i18n";
import {
  TbOutlineMessage,
  TbOutlineCheck,
  TbOutlineCopy,
  TbOutlineSparkles,
  TbOutlineDownload,
  TbOutlineShieldLock,
} from "solid-icons/tb";

const t = i18n.t;

async function mockSendText(_text: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return "mock:text:ticket:" + Math.random().toString(36).substring(7);
}

async function mockReceiveText(_ticket: string): Promise<{ text: string; filename: string }> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return {
    text: "This is a sample received text. Text transfer is not yet implemented in the browser WASM.",
    filename: "received.txt",
  };
}

export default function TextTab() {
  const [sendTextContent, setSendTextContent] = createSignal("");
  const [textSendTicket, setTextSendTicket] = createSignal("");
  const [isSendingText, setIsSendingText] = createSignal(false);

  const [receiveTextTicket, setReceiveTextTicket] = createSignal("");
  const [receivedText, setReceivedText] = createSignal("");
  const [receivedTextFilename, setReceivedTextFilename] = createSignal("");
  const [isReceivingText, setIsReceivingText] = createSignal(false);

  const [activeTextTab, setActiveTextTab] = createSignal<"send" | "receive">("send");

  async function handleSendText() {
    if (!sendTextContent()) return;

    setIsSendingText(true);
    try {
      const result = await mockSendText(sendTextContent());
      setTextSendTicket(result);
      toast.success(t("text.textShared"));
    } catch (error) {
      console.error("Send text failed:", error);
      toast.error(t("text.sendFailed") + ": " + (error as Error).message);
    } finally {
      setIsSendingText(false);
    }
  }

  async function handleReceiveText() {
    if (!receiveTextTicket()) return;

    setIsReceivingText(true);
    try {
      const result = await mockReceiveText(receiveTextTicket());
      setReceivedText(result.text);
      setReceivedTextFilename(result.filename);
      toast.success(t("text.receiveSuccess") || "Text received!");
    } catch (error) {
      console.error("Receive text failed:", error);
      toast.error(t("text.receiveFailed") + ": " + (error as Error).message);
    } finally {
      setIsReceivingText(false);
    }
  }

  function copyReceivedText() {
    navigator.clipboard.writeText(receivedText());
    toast.success(t("common.copied"));
  }

  function copyTicket() {
    navigator.clipboard.writeText(textSendTicket());
    toast.success(t("common.copied"));
  }

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="text-center">
        <h2 class="text-2xl font-bold">{t("text.title")}</h2>
        <p class="text-base-content/60 text-sm mt-1">
          {t("text.subtitle")}
        </p>
      </div>

      {/* Tab Switcher */}
      <div class="tabs tabs-boxed bg-base-300">
        <button
          class={`tab gap-2 ${activeTextTab() === "send" ? "tab-active" : ""}`}
          onClick={() => setActiveTextTab("send")}
        >
          <TbOutlineSparkles size={16} /> {t("text.shareText")}
        </button>
        <button
          class={`tab gap-2 ${activeTextTab() === "receive" ? "tab-active" : ""}`}
          onClick={() => setActiveTextTab("receive")}
        >
          <TbOutlineDownload size={16} /> {t("text.receiveText")}
        </button>
      </div>

      {/* Send Text */}
      <Show when={activeTextTab() === "send"}>
        <div class="space-y-4">
          <textarea
            value={sendTextContent()}
            onInput={(e) => setSendTextContent(e.currentTarget.value)}
            placeholder={t("text.placeholder")}
            class="textarea textarea-bordered w-full h-32 font-mono text-sm"
          />

          <button
            onClick={handleSendText}
            disabled={!sendTextContent() || isSendingText()}
            class={`btn btn-primary btn-block ${isSendingText() ? "loading" : ""}`}
          >
            <Show when={!isSendingText()}>
              <TbOutlineSparkles size={18} /> {t("text.generateTicket") || "Generate Ticket"}
            </Show>
          </button>

          <Show when={textSendTicket()}>
            <div class="alert alert-success">
              <TbOutlineCheck size={18} />
              <div class="flex-1">
                <p class="font-bold">{t("text.copiedTicket")}</p>
                <p class="text-xs font-mono break-all">{textSendTicket()}</p>
              </div>
              <button onClick={copyTicket} class="btn btn-ghost btn-sm">
                <TbOutlineCopy size={16} />
              </button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Receive Text */}
      <Show when={activeTextTab() === "receive"}>
        <div class="space-y-4">
          <div class="form-control">
            <label class="input input-bordered flex items-center gap-2">
              <TbOutlineShieldLock size={18} class="opacity-50" />
              <input
                type="text"
                value={receiveTextTicket()}
                onInput={(e) => setReceiveTextTicket(e.currentTarget.value)}
                placeholder={t("text.pasteText")}
                class="grow font-mono text-sm"
                disabled={isReceivingText()}
              />
            </label>
          </div>

          <button
            onClick={handleReceiveText}
            disabled={!receiveTextTicket() || isReceivingText()}
            class={`btn btn-secondary btn-block ${isReceivingText() ? "loading" : ""}`}
          >
            <Show when={!isReceivingText()}>
              <TbOutlineDownload size={18} /> {t("text.receive")}
            </Show>
          </button>

          <Show when={receivedText()}>
            <div class="alert alert-secondary">
              <TbOutlineMessage size={18} />
              <div class="flex-1">
                <p class="font-bold">{t("text.received")}: {receivedTextFilename()}</p>
                <pre class="font-mono text-sm whitespace-pre-wrap break-words mt-2">
                  {receivedText()}
                </pre>
              </div>
              <button onClick={copyReceivedText} class="btn btn-ghost btn-sm">
                <TbOutlineCopy size={16} />
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
