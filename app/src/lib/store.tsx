import {
  createContext,
  createSignal,
  useContext,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { createStore } from "solid-js/store";
import type {
  NearbyDevice,
  IncomingRequest,
  TransferProgress,
} from "~/bindings";

export interface SendState {
  path: string;
  ticketType: string;
  ticket: string;
  ticketQrCode: string;
  isSending: boolean;
  isTextMode: boolean;
  textContent: string;
  showReshareModal: boolean;
  isFolder: boolean;
}

export interface ReceiveState {
  ticket: string;
  outputDir: string;
  isReceiving: boolean;
}

export interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

export interface NearbySendState {
  files: SelectedFile[];
  nearbyDevices: NearbyDevice[];
  discoveryState: "idle" | "scanning" | "error";
  selectedDevice: NearbyDevice | null;
  transferState:
    | "idle"
    | "selected"
    | "picked"
    | "waiting"
    | "transferring"
    | "done"
    | "error";
  transferProgress: TransferProgress | null;
  error: string | null;
}

export interface NearbyReceiveState {
  incomingRequest: IncomingRequest | null;
  transferState: "idle" | "review" | "receiving" | "done" | "error";
  transferProgress: TransferProgress | null;
  error: string | null;
}

interface GlobalStoreValue {
  send: SendState;
  receive: ReceiveState;
  nearbySend: NearbySendState;
  nearbyReceive: NearbyReceiveState;
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
    setShowReshareModal: (show: boolean) => void;
    setIsFolder: (isFolder: boolean) => void;
    prepareReshare: (path: string) => void;
    reset: () => void;
  };
  receive: {
    state: Accessor<ReceiveState>;
    setTicket: (ticket: string) => void;
    setOutputDir: (outputDir: string) => void;
    setIsReceiving: (isReceiving: boolean) => void;
  };
  nearbySend: {
    state: Accessor<NearbySendState>;
    setFiles: (files: SelectedFile[]) => void;
    setNearbyDevices: (devices: NearbyDevice[]) => void;
    setDiscoveryState: (state: "idle" | "scanning" | "error") => void;
    setSelectedDevice: (device: NearbyDevice | null) => void;
    setTransferState: (state: NearbySendState["transferState"]) => void;
    setTransferProgress: (progress: TransferProgress | null) => void;
    setError: (error: string | null) => void;
    reset: () => void;
  };
  nearbyReceive: {
    state: Accessor<NearbyReceiveState>;
    setIncomingRequest: (request: IncomingRequest | null) => void;
    setTransferState: (state: NearbyReceiveState["transferState"]) => void;
    setTransferProgress: (progress: TransferProgress | null) => void;
    setError: (error: string | null) => void;
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
  showReshareModal: false,
  isFolder: false,
};

const defaultReceiveState: ReceiveState = {
  ticket: "",
  outputDir: "",
  isReceiving: false,
};

const defaultNearbySendState: NearbySendState = {
  files: [],
  nearbyDevices: [],
  discoveryState: "idle",
  selectedDevice: null,
  transferState: "idle",
  transferProgress: null,
  error: null,
};

const defaultNearbyReceiveState: NearbyReceiveState = {
  incomingRequest: null,
  transferState: "idle",
  transferProgress: null,
  error: null,
};

const GlobalStoreContext = createContext<GlobalStore>();

export const GlobalStoreProvider: ParentComponent = (props) => {
  const [sendState, setSendState] = createStore<SendState>({
    ...defaultSendState,
  });
  const [receiveState, setReceiveState] = createStore<ReceiveState>({
    ...defaultReceiveState,
  });
  const [nearbySendState, setNearbySendState] = createStore<NearbySendState>({
    ...defaultNearbySendState,
  });
  const [nearbyReceiveState, setNearbyReceiveState] =
    createStore<NearbyReceiveState>({
      ...defaultNearbyReceiveState,
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
      setShowReshareModal: (show) => setSendState("showReshareModal", show),
      setIsFolder: (isFolder) => setSendState("isFolder", isFolder),
      prepareReshare: (path: string) => {
        setSendState("path", path);
        setSendState("ticket", "");
        setSendState("ticketQrCode", "");
        setSendState("isTextMode", false);
        setSendState("textContent", "");
        setSendState("isFolder", false);
      },
      reset: () => setSendState(defaultSendState),
    },
    receive: {
      state: () => receiveState,
      setTicket: (ticket) => setReceiveState("ticket", ticket),
      setOutputDir: (outputDir) => setReceiveState("outputDir", outputDir),
      setIsReceiving: (isReceiving) =>
        setReceiveState("isReceiving", isReceiving),
    },
    nearbySend: {
      state: () => nearbySendState,
      setFiles: (files) => setNearbySendState("files", files),
      setNearbyDevices: (devices) =>
        setNearbySendState("nearbyDevices", devices),
      setDiscoveryState: (discoveryState) =>
        setNearbySendState("discoveryState", discoveryState),
      setSelectedDevice: (device) =>
        setNearbySendState("selectedDevice", device),
      setTransferState: (transferState) =>
        setNearbySendState("transferState", transferState),
      setTransferProgress: (progress) =>
        setNearbySendState("transferProgress", progress),
      setError: (error) => setNearbySendState("error", error),
      reset: () => setNearbySendState(defaultNearbySendState),
    },
    nearbyReceive: {
      state: () => nearbyReceiveState,
      setIncomingRequest: (request) =>
        setNearbyReceiveState("incomingRequest", request),
      setTransferState: (transferState) =>
        setNearbyReceiveState("transferState", transferState),
      setTransferProgress: (progress) =>
        setNearbyReceiveState("transferProgress", progress),
      setError: (error) => setNearbyReceiveState("error", error),
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
