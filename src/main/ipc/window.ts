import { ipcMain, dialog } from 'electron';
import os from 'node:os';
import fs from 'node:fs';
import { mainWindow, setMinimizeToTray } from '../window';
import { loadSettings, saveSettings } from '../settings';
import type { AppSettings, BlacklistEntry } from '../../types';

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

  ipcMain.handle('export-settings', async () => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Settings',
      defaultPath: 'audiolink-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { success: false };
    try {
      fs.writeFileSync(filePath, JSON.stringify(loadSettings(), null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('import-settings', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import Settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { success: false };
    try {
      const raw = fs.readFileSync(filePaths[0], 'utf-8');
      const imported = JSON.parse(raw) as Partial<AppSettings>;
      saveSettings(imported);
      return { success: true, settings: loadSettings() };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('get-blacklist', (): BlacklistEntry[] => loadSettings().blacklistedMacs ?? []);

  ipcMain.handle('remove-from-blacklist', (_e, mac: string): BlacklistEntry[] => {
    const current = loadSettings().blacklistedMacs ?? [];
    saveSettings({ blacklistedMacs: current.filter((e) => e.mac !== mac) });
    return loadSettings().blacklistedMacs ?? [];
  });

  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window-close', () => mainWindow?.close());
}
