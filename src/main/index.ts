import { app, BrowserWindow, globalShortcut } from 'electron';
import path from 'node:path';
import { userDataPath } from './settings';
import { createWindow, setForceQuit } from './window';
import { registerWindowIpc } from './ipc/window';
import { registerSignalingIpc, getWss } from './ipc/signaling';
import { registerDiscoveryIpc } from './ipc/discovery';
import { initAutoUpdater, registerUpdateSettingsIpc } from './ipc/updater';
import { registerHotkeysIpc } from './ipc/hotkeys';

// ─── Redirect Chromium cache to writable app-local dir ───────────────────────
// Fixes "Unable to move the cache: Access is denied" on managed machines.
// Must be called BEFORE app is ready.
app.setPath('userData', userDataPath);
app.commandLine.appendSwitch('disk-cache-dir', path.join(userDataPath, 'cache'));

// ─── Register IPC handlers ───────────────────────────────────────────────────
// Handlers close over mainWindow via lazy reference — safe to register early.
registerWindowIpc();
registerSignalingIpc();
registerDiscoveryIpc();
registerUpdateSettingsIpc();
registerHotkeysIpc();

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Signal windows that a real quit is in progress so the close handler
// does not intercept and hide the window into the tray.
app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  setForceQuit(true);
});

app.on('window-all-closed', () => {
  const wss = getWss();
  if (wss) wss.close();
  if (process.platform !== 'darwin') app.quit();
});
