import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { ElectronAPI, SignalingMessage, SignalingServerResult, StopServerResult } from '../types';

const electronAPI: ElectronAPI = {
  // Window controls
  minimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  maximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('window-close'),

  // Network
  getLocalIP: (): Promise<string> => ipcRenderer.invoke('get-local-ip'),

  // Signaling server (server mode)
  startSignalingServer: (port?: number, pin?: string, maxClients?: number): Promise<SignalingServerResult> =>
    ipcRenderer.invoke('start-signaling-server', port, pin, maxClients),
  stopSignalingServer: (): Promise<StopServerResult> =>
    ipcRenderer.invoke('stop-signaling-server'),

  // Auto-Discovery
  startDiscovery: (): Promise<void> => ipcRenderer.invoke('start-discovery'),
  stopDiscovery: (): Promise<void> => ipcRenderer.invoke('stop-discovery'),
  onServerDiscovered: (callback: (server: any) => void): void => {
    ipcRenderer.on('server-discovered', (_event: IpcRendererEvent, server: any) => callback(server));
  },

  // Signaling message relay
  sendToClient: (clientId: string, message: SignalingMessage): void =>
    ipcRenderer.send('send-to-client', clientId, message),
  disconnectClient: (clientId: string): void =>
    ipcRenderer.send('disconnect-client', clientId),
  blacklistClient: (clientId: string): Promise<string[]> =>
    ipcRenderer.invoke('blacklist-client', clientId),
  removeFromBlacklist: (ip: string): Promise<string[]> =>
    ipcRenderer.invoke('remove-from-blacklist', ip),
  getBlacklist: (): Promise<string[]> =>
    ipcRenderer.invoke('get-blacklist'),
  onSignalingMessage: (callback: (clientId: string, message: SignalingMessage) => void): void => {
    ipcRenderer.on('signaling-message', (_event: IpcRendererEvent, clientId: string, message: SignalingMessage) =>
      callback(clientId, message)
    );
  },
  onClientConnected: (callback: (clientId: string, clientIp: string, clientMac: string | null, deviceName: string | null) => void): void => {
    ipcRenderer.on('client-connected', (_event: IpcRendererEvent, clientId: string, clientIp: string, clientMac: string | null, deviceName: string | null) =>
      callback(clientId, clientIp, clientMac, deviceName)
    );
  },
  onClientDisconnected: (callback: (clientId: string) => void): void => {
    ipcRenderer.on('client-disconnected', (_event: IpcRendererEvent, clientId: string) => callback(clientId));
  },

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Partial<import('../types').AppSettings>) =>
    ipcRenderer.invoke('save-settings', settings),

  // Cleanup
  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Tray
  setMinimizeToTray: (enabled: boolean): Promise<void> => ipcRenderer.invoke('set-minimize-to-tray', enabled),
  setWindowOpacity: (opacity: number): Promise<void> => ipcRenderer.invoke('set-window-opacity', opacity),

  // Global hotkeys
  registerHotkeys: (hotkeys) => ipcRenderer.invoke('register-hotkeys', hotkeys),
  onHotkeyTriggered: (callback) => {
    ipcRenderer.on('hotkey-triggered', (_e, action) => callback(action));
  },

  // Settings export / import
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings'),

  // Auto-updates
  onUpdateChecking: (callback: () => void): void => {
    ipcRenderer.on('update-checking', () => callback());
  },
  onUpdateNotAvailable: (callback: () => void): void => {
    ipcRenderer.on('update-not-available', () => callback());
  },
  onUpdateAvailable: (callback: (version: string) => void): void => {
    ipcRenderer.on('update-available', (_e, version: string) => callback(version));
  },
  onUpdateProgress: (callback: (percent: number) => void): void => {
    ipcRenderer.on('update-progress', (_e, percent: number) => callback(percent));
  },
  onUpdateDownloaded: (callback: (version: string) => void): void => {
    ipcRenderer.on('update-downloaded', (_e, version: string) => callback(version));
  },
  onUpdateError: (callback: (message: string) => void): void => {
    ipcRenderer.on('update-error', (_e, message: string) => callback(message));
  },
  installUpdate: (): Promise<void> => ipcRenderer.invoke('install-update'),
  setAutoUpdate: (enabled: boolean): Promise<void> => ipcRenderer.invoke('set-auto-update', enabled),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
