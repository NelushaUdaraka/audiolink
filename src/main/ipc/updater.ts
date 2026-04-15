import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { mainWindow } from '../window';
import { loadSettings, saveSettings } from '../settings';

export function registerUpdateSettingsIpc(): void {
  ipcMain.handle('set-auto-update', (_e, enabled: boolean) => saveSettings({ autoUpdate: enabled }));
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  const settings = loadSettings();
  if (settings.autoUpdate === false) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-checking');
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info.version);
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
    mainWindow?.webContents.send('update-error', err.message);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Update check failed:', err.message);
    });
  }, 5000);

  ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());
}
