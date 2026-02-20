import { createSignal, Show } from "solid-js";
import toast from "solid-toast";
import { Motion, Presence } from "solid-motionone";
import {
  TbOutlineMessage,
  TbOutlineCheck,
  TbOutlineCopy,
  TbOutlineSparkles,
  TbOutlineDownload,
  TbOutlineShieldLock,
} from "solid-icons/tb";

// Mock sendText function for browser (WASM doesn't support text transfer yet)
async function mockSendText(_text: string): Promise<string> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  // Return a mock ticket
  return "mock:text:ticket:" + Math.random().toString(36).substring(7);
}

// Mock receiveText function for browser (WASM doesn't support text transfer yet)
async function mockReceiveText(_ticket: string): Promise<{ text: string; filename: string }> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  // Return mock data
  return {
    text: "This is a sample received text. Text transfer is not yet implemented in the browser WASM.",
    filename: "received.txt"
  };
}

export default function TextTab() {
  // Send state
  const [sendTextContent, setSendTextContent] = createSignal("");
  const [textSendTicket, setTextSendTicket] = createSignal("");
  const [isSendingText, setIsSendingText] = createSignal(false);

  // Receive state
  const [receiveTextTicket, setReceiveTextTicket] = createSignal("");
  const [receivedText, setReceivedText] = createSignal("");
  const [receivedTextFilename, setReceivedTextFilename] = createSignal("");
  const [isReceivingText, setIsReceivingText] = createSignal(false);

  // Active tab
  const [activeTextTab, setActiveTextTab] = createSignal<"send" | "receive">("send");

  async function handleSendText() {
    if (!sendTextContent()) return;

    setIsSendingText(true);
    try {
      const result = await mockSendText(sendTextContent());
      setTextSendTicket(result);
      toast.success("Text ticket ready!");
    } catch (error) {
      console.error("Send text failed:", error);
      toast.error("Failed to send text: " + (error as Error).message);
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
      toast.success("Text received!");
    } catch (error) {
      console.error("Receive text failed:", error);
      toast.error("Failed to receive text: " + (error as Error).message);
    } finally {
      setIsReceivingText(false);
    }
  }

  function copyReceivedText() {
    navigator.clipboard.writeText(receivedText());
    toast.success("Copied to clipboard!");
  }

  function copyTicket() {
    navigator.clipboard.writeText(textSendTicket());
    toast.success("Copied to clipboard!");
  }

  return (
    <div class="space-y-6">
      {/* Text Tab Switcher */}
      <div class="flex gap-1 p-1 bg-gray-100 dark:bg-white/5 rounded-lg mb-6">
        <button
          onClick={() => setActiveTextTab("send")}
          class={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
            activeTextTab() === "send"
              ? "bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white"
          }`}
        >
          Send Text
        </button>
        <button
          onClick={() => setActiveTextTab("receive")}
          class={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
            activeTextTab() === "receive"
              ? "bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white"
          }`}
        >
          Receive Text
        </button>
      </div>

      {/* Send Text Section */}
      <Show when={activeTextTab() === "send"}>
        <div class="space-y-4">
          <div class="text-center space-y-1">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              Send Text
            </h3>
            <p class="text-sm text-gray-500 dark:text-white/40">
              Enter text to send via P2P
            </p>
          </div>

          <textarea
            value={sendTextContent()}
            onInput={(e) => setSendTextContent(e.currentTarget.value)}
            placeholder="Enter text to send..."
            class="w-full h-32 resize-none rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-4 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/20 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10 transition-all font-mono text-sm"
          />

          <Motion.button
            hover={{ scale: 1.02 }}
            press={{ scale: 0.98 }}
            onClick={handleSendText}
            disabled={!sendTextContent() || isSendingText()}
            class="w-full py-3 px-6 bg-gradient-to-r from-purple-500 to-indigo-600 disabled:grayscale text-white rounded-xl font-semibold transition-all shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Show when={isSendingText()} fallback={<><TbOutlineSparkles size={18} /> Generate Ticket</>}>
              <div class="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              Sending...
            </Show>
          </Motion.button>

          {/* Ticket Display */}
          <Presence>
            <Show when={textSendTicket()}>
              <Motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                class="rounded-2xl border border-green-500/20 bg-green-500/5 p-4 space-y-3"
              >
                <div class="flex items-center gap-2 text-green-400">
                  <TbOutlineCheck size={18} />
                  <span class="font-medium">Text Ticket Ready</span>
                </div>
                <div class="flex gap-2">
                  <div class="flex-1 bg-gray-100 dark:bg-white/5 rounded-lg px-3 py-2 font-mono text-xs text-gray-900 dark:text-white break-all">
                    {textSendTicket()}
                  </div>
                  <button
                    onClick={copyTicket}
                    class="p-2 bg-gray-100 dark:bg-white/5 rounded-lg text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    <TbOutlineCopy size={16} />
                  </button>
                </div>
              </Motion.div>
            </Show>
          </Presence>
        </div>
      </Show>

      {/* Receive Text Section */}
      <Show when={activeTextTab() === "receive"}>
        <div class="space-y-4">
          <div class="text-center space-y-1">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              Receive Text
            </h3>
            <p class="text-sm text-gray-500 dark:text-white/40">
              Enter a text ticket to receive
            </p>
          </div>

          <div class="relative">
            <div class="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-400 dark:text-white/20">
              <TbOutlineShieldLock size={18} />
            </div>
            <input
              type="text"
              value={receiveTextTicket()}
              onInput={(e) => setReceiveTextTicket(e.currentTarget.value)}
              placeholder="Paste text ticket..."
              class="w-full h-12 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 pl-12 pr-4 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/20 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10 transition-all font-mono text-sm"
            />
          </div>

          <Motion.button
            hover={{ scale: 1.02 }}
            press={{ scale: 0.98 }}
            onClick={handleReceiveText}
            disabled={!receiveTextTicket() || isReceivingText()}
            class="w-full py-3 px-6 bg-gradient-to-r from-indigo-500 to-purple-600 disabled:grayscale text-white rounded-xl font-semibold transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Show when={isReceivingText()} fallback={<><TbOutlineDownload size={18} /> Receive Text</>}>
              <div class="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              Receiving...
            </Show>
          </Motion.button>

          {/* Received Text Display */}
          <Presence>
            <Show when={receivedText()}>
              <Motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                class="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4 space-y-3"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 text-purple-400">
                    <TbOutlineCheck size={18} />
                    <span class="font-medium">Received: {receivedTextFilename()}</span>
                  </div>
                  <button
                    onClick={copyReceivedText}
                    class="p-2 text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    <TbOutlineCopy size={16} />
                  </button>
                </div>
                <div class="bg-gray-100 dark:bg-white/5 rounded-lg p-3 max-h-32 overflow-y-auto">
                  <pre class="font-mono text-sm text-gray-900 dark:text-white whitespace-pre-wrap break-words">
                    {receivedText()}
                  </pre>
                </div>
              </Motion.div>
            </Show>
          </Presence>
        </div>
      </Show>
    </div>
  );
}
