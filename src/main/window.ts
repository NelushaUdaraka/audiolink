import { BrowserWindow, Tray, Menu, nativeImage, app, desktopCapturer, session } from 'electron';
import path from 'node:path';
import { loadSettings } from './settings';

export let mainWindow: BrowserWindow | null = null;

let tray: Tray | null = null;
let forceQuit = false;

export function setForceQuit(value: boolean): void {
  forceQuit = value;
}

function buildTray(): void {
  if (tray) return;
  const icon = nativeImage
    .createFromPath(path.join(__dirname, '../../build/icon.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('AudioLink');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show AudioLink', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: 'separator' },
      { label: 'Quit AudioLink', click: () => app.quit() },
    ])
  );
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

export function setMinimizeToTray(enabled: boolean): void {
  if (!enabled) destroyTray();
}

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 620,
    minWidth: 400,
    minHeight: 620,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a14',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setResizable(true);
  mainWindow.center();

  const savedSettings = loadSettings();
  if (savedSettings.windowOpacity !== undefined) {
    mainWindow.setOpacity(Math.max(0.2, Math.min(1, savedSettings.windowOpacity)));
  }

  // Intercept close: hide to tray unless a real quit is in progress or the
  // user has disabled the "close to tray" setting.
  mainWindow.on('close', (e) => {
    if (forceQuit) return;
    const settings = loadSettings();
    if (settings.minimizeToTray !== false) {
      e.preventDefault();
      mainWindow?.hide();
      buildTray();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    });
  });
}
