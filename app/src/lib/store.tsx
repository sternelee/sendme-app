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
  CloudTicket,
} from "~/bindings";

export interface SendState {
  files: SelectedFile[];
  path: string;
  fileSize: number;
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

export interface PendingRequestState {
  requestId: string;
  state: "pending" | "accepting" | "declining";
}

export interface NearbyReceiveState {
  incomingRequests: IncomingRequest[];
  activeRequestId: string | null;
  pendingRequestStates: Record<string, "pending" | "accepting" | "declining">;
  transferState: "idle" | "review" | "receiving" | "done" | "error";
  transferProgress: TransferProgress | null;
  error: string | null;
}

export interface CloudReceiveState {
  tickets: CloudTicket[];
  currentTicket: CloudTicket | null;
  transferState: "idle" | "review" | "receiving" | "done" | "error";
  transferProgress: TransferProgress | null;
  error: string | null;
}

interface GlobalStoreValue {
  send: SendState;
  receive: ReceiveState;
  nearbySend: NearbySendState;
  nearbyReceive: NearbyReceiveState;
  cloudReceive: CloudReceiveState;
}

interface GlobalStore {
  send: {
    state: Accessor<SendState>;
    addFiles: (files: SelectedFile[]) => void;
    removeFile: (index: number) => void;
    clearFiles: () => void;
    setPath: (path: string) => void;
    setFileSize: (size: number) => void;
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
    addIncomingRequest: (request: IncomingRequest) => void;
    removeIncomingRequest: (requestId: string) => void;
    setActiveRequestId: (requestId: string | null) => void;
    setPendingRequestState: (requestId: string, state: "pending" | "accepting" | "declining") => void;
    setTransferState: (state: NearbyReceiveState["transferState"]) => void;
    setTransferProgress: (progress: TransferProgress | null) => void;
    setError: (error: string | null) => void;
    reset: () => void;
  };
  cloudReceive: {
    state: Accessor<CloudReceiveState>;
    setTickets: (tickets: CloudTicket[]) => void;
    setCurrentTicket: (ticket: CloudTicket | null) => void;
    setTransferState: (state: CloudReceiveState["transferState"]) => void;
    setTransferProgress: (progress: TransferProgress | null) => void;
    setError: (error: string | null) => void;
    reset: () => void;
  };
}

const defaultSendState: SendState = {
  files: [],
  path: "",
  fileSize: 0,
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
  incomingRequests: [],
  activeRequestId: null,
  pendingRequestStates: {},
  transferState: "idle",
  transferProgress: null,
  error: null,
};

const defaultCloudReceiveState: CloudReceiveState = {
  tickets: [],
  currentTicket: null,
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
  const [cloudReceiveState, setCloudReceiveState] =
    createStore<CloudReceiveState>({
      ...defaultCloudReceiveState,
    });

  const store: GlobalStore = {
    send: {
      state: () => sendState,
      addFiles: (files) => {
        setSendState("files", (prev) => [...prev, ...files]);
      },
      removeFile: (index) => {
        setSendState("files", (prev) => prev.filter((_, i) => i !== index));
      },
      clearFiles: () => {
        setSendState("files", []);
      },
      setPath: (path) => {
        setSendState("path", path);
      },
      setFileSize: (size) => setSendState("fileSize", size),
      setTicketType: (ticketType) => setSendState("ticketType", ticketType),
      setTicket: (ticket) => setSendState("ticket", ticket),
      setTicketQrCode: (qrCode) => setSendState("ticketQrCode", qrCode),
      setIsSending: (isSending) => setSendState("isSending", isSending),
      setIsTextMode: (isTextMode) => setSendState("isTextMode", isTextMode),
      setTextContent: (textContent) => setSendState("textContent", textContent),
      setShowReshareModal: (show) => setSendState("showReshareModal", show),
      setIsFolder: (isFolder) => setSendState("isFolder", isFolder),
      prepareReshare: (path: string) => {
        setSendState("files", [{ path, name: path.split(/[\\/]/).pop() || path, size: 0 }]);
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
      addIncomingRequest: (request) => {
        setNearbyReceiveState("incomingRequests", (prev) => [...prev, request]);
        setNearbyReceiveState("pendingRequestStates", (prev) => ({
          ...prev,
          [request.id]: "pending" as const,
        }));
      },
      removeIncomingRequest: (requestId) => {
        setNearbyReceiveState("incomingRequests", (prev) =>
          prev.filter((r) => r.id !== requestId),
        );
        setNearbyReceiveState("pendingRequestStates", (prev) => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
        const current = nearbyReceiveState.activeRequestId;
        if (current === requestId) {
          setNearbyReceiveState("activeRequestId", null);
        }
      },
      setActiveRequestId: (requestId) =>
        setNearbyReceiveState("activeRequestId", requestId),
      setPendingRequestState: (requestId, state) =>
        setNearbyReceiveState("pendingRequestStates", (prev) => ({
          ...prev,
          [requestId]: state,
        })),
      setTransferState: (transferState) =>
        setNearbyReceiveState("transferState", transferState),
      setTransferProgress: (progress) =>
        setNearbyReceiveState("transferProgress", progress),
      setError: (error) => setNearbyReceiveState("error", error),
      reset: () => setNearbyReceiveState(defaultNearbyReceiveState),
    },
    cloudReceive: {
      state: () => cloudReceiveState,
      setTickets: (tickets) => setCloudReceiveState("tickets", tickets),
      setCurrentTicket: (ticket) =>
        setCloudReceiveState("currentTicket", ticket),
      setTransferState: (transferState) =>
        setCloudReceiveState("transferState", transferState),
      setTransferProgress: (progress) =>
        setCloudReceiveState("transferProgress", progress),
      setError: (error) => setCloudReceiveState("error", error),
      reset: () => setCloudReceiveState(defaultCloudReceiveState),
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
