// ═══════════════════════════════════════════════════════════════════════════
// AudioLink — Shared Type Definitions
// ═══════════════════════════════════════════════════════════════════════════

// ─── Signaling Message Types ─────────────────────────────────────────────

export interface SignalingOffer {
  type: 'offer';
  sdp: string;
}

export interface SignalingAnswer {
  type: 'answer';
  sdp: string;
}

export interface SignalingIceCandidate {
  type: 'ice-candidate';
  candidate: RTCIceCandidateInit;
}

export interface SignalingAuthChallenge {
  type: 'auth-challenge';
}

export interface SignalingAuthResponse {
  type: 'auth-response';
  pin: string;
}

export interface SignalingAuthError {
  type: 'auth-error';
}

export type SignalingMessage =
  | SignalingOffer
  | SignalingAnswer
  | SignalingIceCandidate
  | SignalingAuthChallenge
  | SignalingAuthResponse
  | SignalingAuthError;

// ─── Hotkey Settings ─────────────────────────────────────────────────────────

export interface HotkeySettings {
  mute?: string;
  volumeUp?: string;
  volumeDown?: string;
  disconnect?: string;
}

// ─── IPC response types ──────────────────────────────────────────────────

export interface SignalingServerResult {
  success: boolean;
  port?: number;
  error?: string;
}

export interface StopServerResult {
  success: boolean;
}

// ─── Status types ────────────────────────────────────────────────────────

export type ConnectionStatus = 'idle' | 'waiting' | 'connected' | 'streaming' | 'error';

export interface BlacklistEntry {
  mac: string;
  ip: string;
  deviceName: string | null;
}

export interface DiscoveredServer {
  ip: string;
  port: number;
  name: string;
}

export interface AppSettings {
  lastIp: string;
  lastPort: number;
  autoUpdate?: boolean;
  theme?: 'dark' | 'light';
  minimizeToTray?: boolean;
  volume?: number;          // client volume 0–300
  outputDeviceId?: string;  // client audio output device ID
  windowOpacity?: number;   // window opacity 0.2–1.0
  clientTab?: 'auto' | 'manual';  // last active client connection tab
  hotkeys?: HotkeySettings;
  // Server-mode settings
  serverPin?: string;
  inputDeviceId?: string;
  bitrate?: number;
  // Broadcast-mode settings (independent from server)
  broadcastPin?: string;
  broadcastInputDeviceId?: string;
  broadcastBitrate?: number;
  maxClients?: number;            // max simultaneous broadcast clients (1–10)
  blacklistedMacs?: BlacklistEntry[];  // devices blocked from connecting
}

export interface ElectronAPI {
  // Window controls
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;

  // Network
  getLocalIP: () => Promise<string>;

  // Signaling server (server mode)
  startSignalingServer: (port?: number, pin?: string, maxClients?: number) => Promise<SignalingServerResult>;
  stopSignalingServer: () => Promise<StopServerResult>;

  // Auto-Discovery Client
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  onServerDiscovered: (callback: (server: DiscoveredServer) => void) => void;

  // Signaling message relay
  sendToClient: (clientId: string, message: SignalingMessage) => void;
  disconnectClient: (clientId: string) => void;
  blacklistClient: (clientId: string) => Promise<BlacklistEntry[]>;
  removeFromBlacklist: (mac: string) => Promise<BlacklistEntry[]>;
  getBlacklist: () => Promise<BlacklistEntry[]>;
  onSignalingMessage: (callback: (clientId: string, message: SignalingMessage) => void) => void;
  onClientConnected: (callback: (clientId: string, clientIp: string, clientMac: string | null, deviceName: string | null) => void) => void;
  onClientDisconnected: (callback: (clientId: string) => void) => void;

  // Settings persistence
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<void>;

  // Cleanup listeners
  removeAllListeners: (channel: string) => void;

  // Tray
  setMinimizeToTray: (enabled: boolean) => Promise<void>;
  setWindowOpacity: (opacity: number) => Promise<void>;

  // Global hotkeys
  registerHotkeys: (hotkeys: HotkeySettings) => Promise<void>;
  onHotkeyTriggered: (callback: (action: 'mute' | 'volume-up' | 'volume-down' | 'disconnect') => void) => void;

  // Settings export / import
  exportSettings: () => Promise<{ success: boolean; error?: string }>;
  importSettings: () => Promise<{ success: boolean; settings?: AppSettings; error?: string }>;

  // Auto-updates
  onUpdateChecking: (callback: () => void) => void;
  onUpdateNotAvailable: (callback: () => void) => void;
  onUpdateAvailable: (callback: (version: string) => void) => void;
  onUpdateProgress: (callback: (percent: number) => void) => void;
  onUpdateDownloaded: (callback: (version: string) => void) => void;
  onUpdateError: (callback: (message: string) => void) => void;
  installUpdate: () => Promise<void>;
  setAutoUpdate: (enabled: boolean) => Promise<void>;
}

// ─── Extend Window with electronAPI ──────────────────────────────────────

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
