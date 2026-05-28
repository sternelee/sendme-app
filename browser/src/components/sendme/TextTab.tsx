import { Show } from "solid-js";
import toast from "solid-toast";
import { i18n } from "@sendme/shared";
import { useGlobalStore } from "../../lib/store";
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

async function mockReceiveText(
  _ticket: string,
): Promise<{ text: string; filename: string }> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return {
    text: "This is a sample received text. Text transfer is not yet implemented in the browser WASM.",
    filename: "received.txt",
  };
}

export default function TextTab() {
  const globalStore = useGlobalStore();

  const sendTextContent = () => globalStore.text.state().sendTextContent;
  const textSendTicket = () => globalStore.text.state().textSendTicket;
  const isSendingText = () => globalStore.text.state().isSendingText;
  const receiveTextTicket = () => globalStore.text.state().receiveTextTicket;
  const receivedText = () => globalStore.text.state().receivedText;
  const receivedTextFilename = () =>
    globalStore.text.state().receivedTextFilename;
  const isReceivingText = () => globalStore.text.state().isReceivingText;
  const activeTextTab = () => globalStore.text.state().activeTextTab;

  async function handleSendText() {
    if (!sendTextContent()) return;

    globalStore.text.setIsSendingText(true);
    try {
      const result = await mockSendText(sendTextContent());
      globalStore.text.setTextSendTicket(result);
      toast.success(t("text.textShared"));
    } catch (error) {
      console.error("Send text failed:", error);
      toast.error(t("text.sendFailed") + ": " + (error as Error).message);
    } finally {
      globalStore.text.setIsSendingText(false);
    }
  }

  async function handleReceiveText() {
    if (!receiveTextTicket()) return;

    globalStore.text.setIsReceivingText(true);
    try {
      const result = await mockReceiveText(receiveTextTicket());
      globalStore.text.setReceivedText(result.text);
      globalStore.text.setReceivedTextFilename(result.filename);
      toast.success(t("text.receiveSuccess") || "Text received!");
    } catch (error) {
      console.error("Receive text failed:", error);
      toast.error(t("text.receiveFailed") + ": " + (error as Error).message);
    } finally {
      globalStore.text.setIsReceivingText(false);
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

  const tabs = [
    {
      key: "send" as const,
      label: t("text.shareText") || "Share Text",
      icon: TbOutlineSparkles,
    },
    {
      key: "receive" as const,
      label: t("text.receiveText") || "Receive Text",
      icon: TbOutlineDownload,
    },
  ];

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="text-center">
        <h2 class="text-2xl font-bold">{t("text.title")}</h2>
        <p class="text-base-content/60 text-sm mt-1">{t("text.subtitle")}</p>
      </div>

      {/* Tab Switcher — pill style matching HistoryTab filters */}
      <div class="flex gap-1 p-1 bg-base-200/60 rounded-xl w-fit mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTextTab() === tab.key
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/50 hover:text-base-content"
              }`}
              onClick={() => globalStore.text.setActiveTextTab(tab.key)}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Send Text */}
      <Show when={activeTextTab() === "send"}>
        <div class="surface-card p-5 space-y-4">
          <p class="section-label">{t("text.shareText") || "Share Text"}</p>
          <textarea
            value={sendTextContent()}
            onInput={(e) =>
              globalStore.text.setSendTextContent(e.currentTarget.value)
            }
            placeholder={t("text.placeholder")}
            class="textarea textarea-bordered w-full h-40 font-mono text-sm rounded-2xl resize-none"
          />

          <button
            onClick={handleSendText}
            disabled={!sendTextContent() || isSendingText()}
            class={`btn btn-primary btn-block rounded-xl ${isSendingText() ? "loading" : ""}`}
          >
            <Show when={!isSendingText()}>
              <TbOutlineSparkles size={18} />{" "}
              {t("text.generateTicket") || "Generate Ticket"}
            </Show>
          </button>

          <Show when={textSendTicket()}>
            <div class="pt-2">
              <div class="flex items-center justify-between mb-2">
                <p class="text-sm font-medium text-success flex items-center gap-1">
                  <TbOutlineCheck size={16} />
                  {t("text.copiedTicket") || "Ticket ready"}
                </p>
                <button
                  onClick={copyTicket}
                  class="btn btn-ghost btn-sm rounded-xl"
                >
                  <TbOutlineCopy size={16} />
                  {t("common.copy") || "Copy"}
                </button>
              </div>
              <div class="mockup-code text-xs break-all">
                <pre class="whitespace-pre-wrap">
                  <code>{textSendTicket()}</code>
                </pre>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* Receive Text */}
      <Show when={activeTextTab() === "receive"}>
        <div class="surface-card p-5 space-y-4">
          <p class="section-label">{t("text.receiveText") || "Receive Text"}</p>
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <label class="text-sm font-medium">
                {t("text.pasteText") || "Paste ticket"}
              </label>
              <button
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    globalStore.text.setReceiveTextTicket(text);
                    toast.success(t("receive.pasteTicket") + "!");
                  } catch {
                    toast.error(
                      t("receive.clipboardError") ||
                        "Failed to read clipboard.",
                    );
                  }
                }}
                class="btn btn-ghost btn-xs rounded-lg"
                disabled={isReceivingText()}
                title={t("receive.pasteFromClipboard") || "Paste from clipboard"}
              >
                <TbOutlineCopy size={14} />
                {t("common.paste") || "Paste"}
              </button>
            </div>
            <label class="input input-bordered flex w-full items-center gap-2 rounded-2xl">
              <TbOutlineShieldLock size={18} class="opacity-50" />
              <input
                type="text"
                value={receiveTextTicket()}
                onInput={(e) =>
                  globalStore.text.setReceiveTextTicket(e.currentTarget.value)
                }
                placeholder={
                  t("text.ticketPlaceholder") || "Paste ticket here..."
                }
                class="grow font-mono text-sm"
                disabled={isReceivingText()}
              />
            </label>
          </div>

          <button
            onClick={handleReceiveText}
            disabled={!receiveTextTicket() || isReceivingText()}
            class={`btn btn-secondary btn-block rounded-xl ${isReceivingText() ? "loading" : ""}`}
          >
            <Show when={!isReceivingText()}>
              <TbOutlineDownload size={18} /> {t("text.receive") || "Receive"}
            </Show>
          </button>

          <Show when={receivedText()}>
            <div class="pt-2 border-t border-base-300 space-y-3">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium flex items-center gap-1">
                  <TbOutlineMessage size={16} />
                  {t("text.received") || "Received"}: {receivedTextFilename()}
                </p>
                <button
                  onClick={copyReceivedText}
                  class="btn btn-ghost btn-sm rounded-xl"
                >
                  <TbOutlineCopy size={16} />
                  {t("common.copy") || "Copy"}
                </button>
              </div>
              <div class="bg-base-200/60 rounded-2xl p-4">
                <pre class="font-mono text-sm whitespace-pre-wrap break-words">
                  {receivedText()}
                </pre>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
