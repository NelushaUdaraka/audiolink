import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { mainWindow } from '../window';
import { loadSettings, saveSettings } from '../settings';

// URL is stored in settings so no rebuild is needed to change the server.
// To switch to GitHub later: remove updateServerUrl from settings and add a
// "publish": { "provider": "github", "owner": "...", "repo": "..." } block
// to package.json — the else branch below picks it up automatically.
export function registerUpdateSettingsIpc(): void {
  ipcMain.handle('get-update-server-url', () => loadSettings().updateServerUrl || '');
  ipcMain.handle('set-update-server-url', (_e, url: string) => saveSettings({ updateServerUrl: url }));
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  const settings = loadSettings();
  const updateUrl = settings.updateServerUrl?.trim();

  if (updateUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl } as Parameters<typeof autoUpdater.setFeedURL>[0]);
  }

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
