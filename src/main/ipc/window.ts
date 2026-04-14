import { ipcMain } from 'electron';
import os from 'node:os';
import { mainWindow, setMinimizeToTray } from '../window';
import { loadSettings, saveSettings } from '../settings';
import type { AppSettings } from '../../types';

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

export function registerWindowIpc(): void {
  ipcMain.handle('get-local-ip', (): string => getLocalIP());
  ipcMain.handle('get-settings', (): AppSettings => loadSettings());
  ipcMain.handle('save-settings', (_e, partial: Partial<AppSettings>) => saveSettings(partial));

  ipcMain.handle('set-minimize-to-tray', (_e, enabled: boolean) => setMinimizeToTray(enabled));
  ipcMain.handle('set-window-opacity', (_e, opacity: number) => {
    mainWindow?.setOpacity(Math.max(0.2, Math.min(1, opacity)));
  });

  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window-close', () => mainWindow?.close());
}
