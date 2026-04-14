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

export interface DiscoveredServer {
  ip: string;
  port: number;
  name: string;
}

export interface AppSettings {
  lastIp: string;
  lastPort: number;
  updateServerUrl?: string;
  theme?: 'dark' | 'light';
  minimizeToTray?: boolean;
  serverPin?: string;
  volume?: number;          // client volume 0–300
  outputDeviceId?: string;  // client audio output device ID
  inputDeviceId?: string;   // server audio input device ID
  bitrate?: number;         // server bitrate in bps
  windowOpacity?: number;   // window opacity 0.2–1.0
  clientTab?: 'auto' | 'manual';  // last active client connection tab
}

export interface ElectronAPI {
  // Window controls
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;

  // Network
  getLocalIP: () => Promise<string>;

  // Signaling server (server mode)
  startSignalingServer: (port?: number, pin?: string) => Promise<SignalingServerResult>;
  stopSignalingServer: () => Promise<StopServerResult>;

  // Auto-Discovery Client
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  onServerDiscovered: (callback: (server: DiscoveredServer) => void) => void;

  // Signaling message relay
  sendToClient: (message: SignalingMessage) => void;
  onSignalingMessage: (callback: (message: SignalingMessage) => void) => void;
  onClientConnected: (callback: () => void) => void;
  onClientDisconnected: (callback: () => void) => void;

  // Settings persistence
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<void>;

  // Cleanup listeners
  removeAllListeners: (channel: string) => void;

  // Tray
  setMinimizeToTray: (enabled: boolean) => Promise<void>;
  setWindowOpacity: (opacity: number) => Promise<void>;

  // Auto-updates
  onUpdateChecking: (callback: () => void) => void;
  onUpdateNotAvailable: (callback: () => void) => void;
  onUpdateAvailable: (callback: (version: string) => void) => void;
  onUpdateProgress: (callback: (percent: number) => void) => void;
  onUpdateDownloaded: (callback: (version: string) => void) => void;
  onUpdateError: (callback: (message: string) => void) => void;
  installUpdate: () => Promise<void>;
  getUpdateServerUrl: () => Promise<string>;
  setUpdateServerUrl: (url: string) => Promise<void>;
}

// ─── Extend Window with electronAPI ──────────────────────────────────────

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
