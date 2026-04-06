import {
  createContext,
  createSignal,
  useContext,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { createStore } from "solid-js/store";

export interface SendState {
  path: string;
  ticketType: string;
  ticket: string;
  ticketQrCode: string;
  isSending: boolean;
  isTextMode: boolean;
  textContent: string;
}

export interface ReceiveState {
  ticket: string;
  outputDir: string;
  isReceiving: boolean;
}

interface GlobalStoreValue {
  send: SendState;
  receive: ReceiveState;
}

interface GlobalStore {
  send: {
    state: Accessor<SendState>;
    setPath: (path: string) => void;
    setTicketType: (ticketType: string) => void;
    setTicket: (ticket: string) => void;
    setTicketQrCode: (qrCode: string) => void;
    setIsSending: (isSending: boolean) => void;
    setIsTextMode: (isTextMode: boolean) => void;
    setTextContent: (textContent: string) => void;
    reset: () => void;
  };
  receive: {
    state: Accessor<ReceiveState>;
    setTicket: (ticket: string) => void;
    setOutputDir: (outputDir: string) => void;
    setIsReceiving: (isReceiving: boolean) => void;
  };
}

const defaultSendState: SendState = {
  path: "",
  ticketType: "relay_and_addresses",
  ticket: "",
  ticketQrCode: "",
  isSending: false,
  isTextMode: false,
  textContent: "",
};

const defaultReceiveState: ReceiveState = {
  ticket: "",
  outputDir: "",
  isReceiving: false,
};

const GlobalStoreContext = createContext<GlobalStore>();

export const GlobalStoreProvider: ParentComponent = (props) => {
  const [sendState, setSendState] = createStore<SendState>({
    ...defaultSendState,
  });
  const [receiveState, setReceiveState] = createStore<ReceiveState>({
    ...defaultReceiveState,
  });

  const store: GlobalStore = {
    send: {
      state: () => sendState,
      setPath: (path) => setSendState("path", path),
      setTicketType: (ticketType) => setSendState("ticketType", ticketType),
      setTicket: (ticket) => setSendState("ticket", ticket),
      setTicketQrCode: (qrCode) => setSendState("ticketQrCode", qrCode),
      setIsSending: (isSending) => setSendState("isSending", isSending),
      setIsTextMode: (isTextMode) => setSendState("isTextMode", isTextMode),
      setTextContent: (textContent) => setSendState("textContent", textContent),
      reset: () => setSendState(defaultSendState),
    },
    receive: {
      state: () => receiveState,
      setTicket: (ticket) => setReceiveState("ticket", ticket),
      setOutputDir: (outputDir) => setReceiveState("outputDir", outputDir),
      setIsReceiving: (isReceiving) =>
        setReceiveState("isReceiving", isReceiving),
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
    throw new Error("useGlobalStore must be used within GlobalStoreProvider");
  }
  return context;
}
