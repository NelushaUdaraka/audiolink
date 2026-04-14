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
  startSignalingServer: (port?: number, pin?: string): Promise<SignalingServerResult> =>
    ipcRenderer.invoke('start-signaling-server', port, pin),
  stopSignalingServer: (): Promise<StopServerResult> =>
    ipcRenderer.invoke('stop-signaling-server'),

  // Auto-Discovery
  startDiscovery: (): Promise<void> => ipcRenderer.invoke('start-discovery'),
  stopDiscovery: (): Promise<void> => ipcRenderer.invoke('stop-discovery'),
  onServerDiscovered: (callback: (server: any) => void): void => {
    ipcRenderer.on('server-discovered', (_event: IpcRendererEvent, server: any) => callback(server));
  },

  // Signaling message relay
  sendToClient: (message: SignalingMessage): void =>
    ipcRenderer.send('send-to-client', message),
  onSignalingMessage: (callback: (message: SignalingMessage) => void): void => {
    ipcRenderer.on('signaling-message', (_event: IpcRendererEvent, message: SignalingMessage) =>
      callback(message)
    );
  },
  onClientConnected: (callback: () => void): void => {
    ipcRenderer.on('client-connected', () => callback());
  },
  onClientDisconnected: (callback: () => void): void => {
    ipcRenderer.on('client-disconnected', () => callback());
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
  getUpdateServerUrl: (): Promise<string> => ipcRenderer.invoke('get-update-server-url'),
  setUpdateServerUrl: (url: string): Promise<void> => ipcRenderer.invoke('set-update-server-url', url),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
