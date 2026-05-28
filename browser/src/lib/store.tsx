import {
  createContext,
  useContext,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { createStore } from "solid-js/store";

export interface SendState {
  file: File | null;
  files: File[];
  isFolder: boolean;
  ticket: string;
  isSending: boolean;
  isDragging: boolean;
  isDeviceModalOpen: boolean;
}

export interface ReceiveState {
  ticket: string;
  isReceiving: boolean;
  receivedFile: { filename: string; data: Uint8Array } | null;
  error: string;
}

export interface TextState {
  sendTextContent: string;
  textSendTicket: string;
  isSendingText: boolean;
  receiveTextTicket: string;
  receivedText: string;
  receivedTextFilename: string;
  isReceivingText: boolean;
  activeTextTab: "send" | "receive";
}

export type HistoryType = "sent" | "received";

export interface HistoryEntry {
  id: string;
  filename: string;
  ticket: string;
  fileSize: number;
  isFolder: boolean;
  timestamp: number;
  type: HistoryType;
}

export interface HistoryState {
  entries: HistoryEntry[];
}

const HISTORY_MAX_ENTRIES = 50;
const HISTORY_STORAGE_KEY = "sendme_history";

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw) as HistoryEntry[];
    // Migrate old entries without type field
    return entries.map((e) => ({
      ...e,
      type: e.type || ("sent" as HistoryType),
    }));
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}
interface GlobalStoreValue {
  send: SendState;
  receive: ReceiveState;
  text: TextState;
  history: HistoryState;
}

interface GlobalStore {
  send: {
    state: Accessor<SendState>;
    setFile: (file: File | null) => void;
    setFiles: (files: File[]) => void;
    setIsFolder: (isFolder: boolean) => void;
    setTicket: (ticket: string) => void;
    setIsSending: (isSending: boolean) => void;
    setIsDragging: (isDragging: boolean) => void;
    setIsDeviceModalOpen: (isOpen: boolean) => void;
    reset: () => void;
  };
  receive: {
    state: Accessor<ReceiveState>;
    setTicket: (ticket: string) => void;
    setIsReceiving: (isReceiving: boolean) => void;
    setReceivedFile: (file: { filename: string; data: Uint8Array } | null) => void;
    setError: (error: string) => void;
    reset: () => void;
  };
  text: {
    state: Accessor<TextState>;
    setSendTextContent: (content: string) => void;
    setTextSendTicket: (ticket: string) => void;
    setIsSendingText: (isSending: boolean) => void;
    setReceiveTextTicket: (ticket: string) => void;
    setReceivedText: (text: string) => void;
    setReceivedTextFilename: (filename: string) => void;
    setIsReceivingText: (isReceiving: boolean) => void;
    setActiveTextTab: (tab: "send" | "receive") => void;
    reset: () => void;
  };
  history: {
    state: Accessor<HistoryState>;
    addEntry: (entry: Omit<HistoryEntry, "id" | "timestamp">) => void;
    removeEntry: (id: string) => void;
    clear: () => void;
  };
}

const defaultSendState: SendState = {
  file: null,
  files: [],
  isFolder: false,
  ticket: "",
  isSending: false,
  isDragging: false,
  isDeviceModalOpen: false,
};

const defaultReceiveState: ReceiveState = {
  ticket: "",
  isReceiving: false,
  receivedFile: null,
  error: "",
};

const defaultTextState: TextState = {
  sendTextContent: "",
  textSendTicket: "",
  isSendingText: false,
  receiveTextTicket: "",
  receivedText: "",
  receivedTextFilename: "",
  isReceivingText: false,
  activeTextTab: "send",
};

const GlobalStoreContext = createContext<GlobalStore>();


export const GlobalStoreProvider: ParentComponent = (props) => {
  const [sendState, setSendState] = createStore<SendState>({
    ...defaultSendState,
  });
  const [receiveState, setReceiveState] = createStore<ReceiveState>({
    ...defaultReceiveState,
  });
  const [textState, setTextState] = createStore<TextState>({
    ...defaultTextState,
  });
  const [historyState, setHistoryState] = createStore<HistoryState>({
    entries: loadHistory(),
  });

  const store: GlobalStore = {
    send: {
      state: () => sendState,
      setFile: (file) => setSendState("file", file),
      setFiles: (files) => setSendState("files", files),
      setIsFolder: (isFolder) => setSendState("isFolder", isFolder),
      setTicket: (ticket) => setSendState("ticket", ticket),
      setIsSending: (isSending) => setSendState("isSending", isSending),
      setIsDragging: (isDragging) => setSendState("isDragging", isDragging),
      setIsDeviceModalOpen: (isOpen) =>
        setSendState("isDeviceModalOpen", isOpen),
      reset: () => setSendState(defaultSendState),
    },
    receive: {
      state: () => receiveState,
      setTicket: (ticket) => setReceiveState("ticket", ticket),
      setIsReceiving: (isReceiving) =>
        setReceiveState("isReceiving", isReceiving),
      setReceivedFile: (file) => setReceiveState("receivedFile", file),
      setError: (error) => setReceiveState("error", error),
      reset: () => setReceiveState(defaultReceiveState),
    },
    text: {
      state: () => textState,
      setSendTextContent: (content) =>
        setTextState("sendTextContent", content),
      setTextSendTicket: (ticket) => setTextState("textSendTicket", ticket),
      setIsSendingText: (isSending) =>
        setTextState("isSendingText", isSending),
      setReceiveTextTicket: (ticket) =>
        setTextState("receiveTextTicket", ticket),
      setReceivedText: (text) => setTextState("receivedText", text),
      setReceivedTextFilename: (filename) =>
        setTextState("receivedTextFilename", filename),
      setIsReceivingText: (isReceiving) =>
        setTextState("isReceivingText", isReceiving),
      setActiveTextTab: (tab) => setTextState("activeTextTab", tab),
      reset: () => setTextState(defaultTextState),
    },
    history: {
      state: () => historyState,
      addEntry: (entry) => {
        const newEntry: HistoryEntry = {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        };
        const updated = [newEntry, ...historyState.entries].slice(
          0,
          HISTORY_MAX_ENTRIES,
        );
        setHistoryState("entries", updated);
        saveHistory(updated);
      },
      removeEntry: (id) => {
        const updated = historyState.entries.filter((e) => e.id !== id);
        setHistoryState("entries", updated);
        saveHistory(updated);
      },
      clear: () => {
        setHistoryState("entries", []);
        saveHistory([]);
      },
    },
  };

  return (
    <GlobalStoreContext.Provider value={store}>
      {props.children}
    </GlobalStoreContext.Provider>
  );
};

export function useGlobalStore() {
  const context = useContext(GlobalStoreContext);
  if (!context) {
    throw new Error(
      "useGlobalStore must be used within GlobalStoreProvider",
    );
  }
  return context;
}
