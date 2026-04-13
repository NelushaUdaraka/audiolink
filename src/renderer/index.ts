import './styles/base.css';
import './styles/components.css';
import './styles/views.css';
import iconUrl from '../../build/icon.png';
import { api, $, showView, showToast } from './utils';
import { initServer, getIsServerRunning, setServerStateCallback } from './server';
import { getIsClientConnected, setClientStateCallback, startDiscoverySession } from './client';

// ─── Titlebar icon ────────────────────────────────────────────────────────────
($('titlebar-icon') as HTMLImageElement).src = iconUrl;

// ─── Window controls ──────────────────────────────────────────────────────────
$('btn-minimize').addEventListener('click', () => api.minimize());
$('btn-maximize').addEventListener('click', () => api.maximize());
$('btn-close').addEventListener('click', () => api.close());

// ─── Theme ────────────────────────────────────────────────────────────────────
type Theme = 'dark' | 'light';

function applyTheme(theme: Theme): void {
  document.body.classList.toggle('theme-light', theme === 'light');
  $('theme-dark-btn').classList.toggle('theme-seg-btn--active', theme === 'dark');
  $('theme-light-btn').classList.toggle('theme-seg-btn--active', theme === 'light');
  localStorage.setItem('theme', theme);
}

// Apply instantly from localStorage to avoid flash
applyTheme((localStorage.getItem('theme') as Theme | null) ?? 'dark');

// Sync authoritative value from settings on first load
api.getSettings().then((settings) => {
  if (settings.theme) applyTheme(settings.theme);
  // Default to true when the key has never been saved
  $<HTMLInputElement>('minimize-to-tray-toggle').checked = settings.minimizeToTray !== false;
});

async function setTheme(theme: Theme): Promise<void> {
  applyTheme(theme);
  await api.saveSettings({ theme });
}

$('btn-theme').addEventListener('click', () => {
  const next: Theme = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  setTheme(next);
});

$('theme-dark-btn').addEventListener('click', () => setTheme('dark'));
$('theme-light-btn').addEventListener('click', () => setTheme('light'));

// ─── Minimize-to-tray toggle ──────────────────────────────────────────────────
$<HTMLInputElement>('minimize-to-tray-toggle').addEventListener('change', async (e) => {
  const enabled = (e.target as HTMLInputElement).checked;
  await api.saveSettings({ minimizeToTray: enabled });
  await api.setMinimizeToTray(enabled);
});

// ─── Settings view ────────────────────────────────────────────────────────────
let previousView = 'view-mode-select';

$('btn-settings').addEventListener('click', () => {
  const active = document.querySelector<HTMLElement>('.view.active');
  if (active && active.id !== 'view-settings') previousView = active.id;
  showView('view-settings');
});

$('btn-back-settings').addEventListener('click', () => {
  showView(previousView);
});

api.getUpdateServerUrl().then((url) => {
  if (url) $<HTMLInputElement>('update-server-url').value = url;
});

$('btn-save-update-url').addEventListener('click', async () => {
  const url = $<HTMLInputElement>('update-server-url').value.trim();
  await api.setUpdateServerUrl(url);
  showToast(url ? 'Update server saved' : 'Update server cleared', 'success');
});

// ─── Home indicators ──────────────────────────────────────────────────────────
function updateHomeIndicators(): void {
  const show = (id: string, visible: boolean) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? 'flex' : 'none';
  };
  show('server-mode-badge', getIsServerRunning());
  show('client-mode-badge', getIsClientConnected());
}

setServerStateCallback(updateHomeIndicators);
setClientStateCallback(updateHomeIndicators);

// ─── Home navigation ──────────────────────────────────────────────────────────
function goHome(): void {
  updateHomeIndicators();
  showView('view-mode-select');
}

$('btn-home').addEventListener('click', goHome);

// ─── Mode selection ───────────────────────────────────────────────────────────
$('btn-server-mode').addEventListener('click', () => {
  showView('view-server');
  // Skip re-init if server is already running (user navigated away and back)
  if (!getIsServerRunning()) initServer();
});

$('btn-client-mode').addEventListener('click', async () => {
  showView('view-client');
  if (!getIsClientConnected()) {
    const settings = await api.getSettings();
    if (settings.lastIp) {
      $<HTMLInputElement>('server-ip-input').value = settings.lastIp;
      $<HTMLInputElement>('server-port-input').value = String(settings.lastPort || 8765);
    }
    startDiscoverySession();
  }
});

// ─── Back navigation — does NOT stop the stream ───────────────────────────────
$('btn-back-server').addEventListener('click', goHome);

$('btn-back-client').addEventListener('click', () => {
  api.stopDiscovery(); // stop UDP scan only; WebRTC connection stays alive
  goHome();
});

// ─── Update bar ───────────────────────────────────────────────────────────────
function showUpdateBar(text: string, showInstallBtn = false): void {
  document.body.classList.add('has-update');
  $('update-text').textContent = text;
  $<HTMLButtonElement>('btn-install-update').style.display = showInstallBtn ? 'block' : 'none';
}

api.onUpdateChecking(() => console.log('[updater] checking for updates'));
api.onUpdateNotAvailable(() => { console.log('[updater] up to date'); document.body.classList.remove('has-update'); });
api.onUpdateAvailable((version) => showUpdateBar(`Downloading update v${version}...`));
api.onUpdateProgress((percent) => { $('update-text').textContent = `Downloading update... ${percent}%`; });
api.onUpdateDownloaded((version) => showUpdateBar(`v${version} ready — restart to install`, true));
api.onUpdateError(() => {
  document.body.classList.remove('has-update');
});

$('btn-install-update').addEventListener('click', () => api.installUpdate());
