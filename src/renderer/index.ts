import './styles/base.css';
import './styles/components.css';
import './styles/views.css';
import iconUrl from '../../build/icon.png';
import { api, $, showView, showToast } from './utils';
import type { BlacklistEntry } from '../types';
import { initServer, getIsServerRunning, setServerStateCallback, setBlacklistChangedCallback } from './server';
import { initBroadcast, getIsBroadcastRunning, setBroadcastStateCallback, setBcBlacklistChangedCallback } from './broadcast';
import { getIsClientConnected, setClientStateCallback, startDiscoverySession, applyClientTab, toggleMute, adjustVolume, disconnectClient } from './client';

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
api.getSettings().then(async (settings) => {
  if (settings.theme) applyTheme(settings.theme);
  // Default to true when the key has never been saved
  $<HTMLInputElement>('minimize-to-tray-toggle').checked = settings.minimizeToTray !== false;

  if (settings.windowOpacity !== undefined) {
    const pct = Math.round(settings.windowOpacity * 100);
    $<HTMLInputElement>('opacity-slider').value = String(pct);
    $<HTMLSpanElement>('opacity-value').textContent = `${pct}%`;
  }

  if (settings.hotkeys) {
    const hk = settings.hotkeys;
    if (hk.mute)       $<HTMLInputElement>('hk-mute').value        = hk.mute;
    if (hk.volumeUp)   $<HTMLInputElement>('hk-volume-up').value   = hk.volumeUp;
    if (hk.volumeDown) $<HTMLInputElement>('hk-volume-down').value = hk.volumeDown;
    if (hk.disconnect) $<HTMLInputElement>('hk-disconnect').value  = hk.disconnect;
    await api.registerHotkeys(hk);
  }
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

// ─── Window opacity ───────────────────────────────────────────────────────────
$<HTMLInputElement>('opacity-slider').addEventListener('input', () => {
  const pct = parseInt($<HTMLInputElement>('opacity-slider').value, 10);
  $<HTMLSpanElement>('opacity-value').textContent = `${pct}%`;
  api.setWindowOpacity(pct / 100);
});

$<HTMLInputElement>('opacity-slider').addEventListener('change', () => {
  const pct = parseInt($<HTMLInputElement>('opacity-slider').value, 10);
  api.saveSettings({ windowOpacity: pct / 100 });
});

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
  refreshBlacklist();
});

$('btn-back-settings').addEventListener('click', () => {
  showView(previousView);
});

// ─── Auto-update toggle ───────────────────────────────────────────────────────
api.getSettings().then((settings) => {
  $<HTMLInputElement>('auto-update-toggle').checked = settings.autoUpdate !== false;
});

$<HTMLInputElement>('auto-update-toggle').addEventListener('change', async (e) => {
  const enabled = (e.target as HTMLInputElement).checked;
  await api.setAutoUpdate(enabled);
  await api.saveSettings({ autoUpdate: enabled });
});

// ─── Home indicators ──────────────────────────────────────────────────────────
function updateHomeIndicators(): void {
  const show = (id: string, visible: boolean) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? 'flex' : 'none';
  };
  show('server-mode-badge', getIsServerRunning());
  show('broadcast-mode-badge', getIsBroadcastRunning());
  show('client-mode-badge', getIsClientConnected());
}

setServerStateCallback(updateHomeIndicators);
setBroadcastStateCallback(updateHomeIndicators);
setClientStateCallback(updateHomeIndicators);

// ─── Blacklist management ─────────────────────────────────────────────────────
function renderBlacklist(entries: BlacklistEntry[]): void {
  const list = document.getElementById('settings-blacklist-list');
  if (!list) return;
  list.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'clients-empty';
    empty.textContent = 'No blacklisted clients';
    list.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'blacklist-card';
    const displayName = entry.deviceName ?? entry.mac;
    card.innerHTML = `
      <div class="blacklist-card-header">
        <span class="blacklist-card-name">${displayName}</span>
        <button class="blacklist-card-unban">Unban</button>
      </div>
      <div class="blacklist-card-meta">${entry.mac} · ${entry.ip}</div>
    `;
    card.querySelector<HTMLButtonElement>('.blacklist-card-unban')!
      .addEventListener('click', async () => {
        const updated = await api.removeFromBlacklist(entry.mac);
        renderBlacklist(updated);
      });
    list.appendChild(card);
  });
}

async function refreshBlacklist(): Promise<void> {
  const entries = await api.getBlacklist();
  renderBlacklist(entries);
}

setBlacklistChangedCallback(refreshBlacklist);
setBcBlacklistChangedCallback(refreshBlacklist);

// ─── Home navigation ──────────────────────────────────────────────────────────
function goHome(): void {
  updateHomeIndicators();
  showView('view-mode-select');
}

$('btn-home').addEventListener('click', goHome);

// ─── Mode selection ───────────────────────────────────────────────────────────
$('btn-server-mode').addEventListener('click', () => {
  showView('view-server');
  if (!getIsServerRunning()) initServer();
});

$('btn-broadcast-mode').addEventListener('click', () => {
  showView('view-broadcast');
  if (!getIsBroadcastRunning()) initBroadcast();
});

$('btn-client-mode').addEventListener('click', async () => {
  showView('view-client');
  if (!getIsClientConnected()) {
    const settings = await api.getSettings();
    if (settings.lastIp) {
      $<HTMLInputElement>('server-ip-input').value = settings.lastIp;
      $<HTMLInputElement>('server-port-input').value = String(settings.lastPort || 8765);
    }
    const tab = settings.clientTab ?? 'auto';
    applyClientTab(tab);
    if (tab === 'auto') startDiscoverySession();
  }
});

// ─── Back navigation — does NOT stop the stream ───────────────────────────────
$('btn-back-server').addEventListener('click', goHome);
$('btn-back-broadcast').addEventListener('click', goHome);

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

// ─── Settings Export / Import ─────────────────────────────────────────────────
$('btn-export-settings').addEventListener('click', async () => {
  const result = await api.exportSettings();
  if (result.success) showToast('Settings exported', 'success');
  else if (result.error) showToast(`Export failed: ${result.error}`, 'error');
});

$('btn-import-settings').addEventListener('click', async () => {
  const result = await api.importSettings();
  if (!result.success) {
    if (result.error) showToast(`Import failed: ${result.error}`, 'error');
    return;
  }
  const s = result.settings!;
  if (s.theme) applyTheme(s.theme);
  $<HTMLInputElement>('minimize-to-tray-toggle').checked = s.minimizeToTray !== false;
  if (s.windowOpacity !== undefined) {
    const pct = Math.round(s.windowOpacity * 100);
    $<HTMLInputElement>('opacity-slider').value = String(pct);
    $<HTMLSpanElement>('opacity-value').textContent = `${pct}%`;
    api.setWindowOpacity(s.windowOpacity);
  }
  if (s.hotkeys) {
    $<HTMLInputElement>('hk-mute').value        = s.hotkeys.mute       ?? '';
    $<HTMLInputElement>('hk-volume-up').value   = s.hotkeys.volumeUp   ?? '';
    $<HTMLInputElement>('hk-volume-down').value = s.hotkeys.volumeDown ?? '';
    $<HTMLInputElement>('hk-disconnect').value  = s.hotkeys.disconnect ?? '';
    api.registerHotkeys(s.hotkeys);
  }
  if (s.autoUpdate !== undefined) {
    $<HTMLInputElement>('auto-update-toggle').checked = s.autoUpdate;
    await api.setAutoUpdate(s.autoUpdate);
  }
  showToast('Settings imported', 'success');
});

// ─── Global Hotkeys ───────────────────────────────────────────────────────────
function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey)  mods.push('Control');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey)  mods.push('Meta');
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;

  const keyMap: Record<string, string> = {
    ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
    'ArrowLeft': 'Left', 'ArrowRight': 'Right',
    'Escape': 'Escape', 'Enter': 'Return',
    'Backspace': 'Backspace', 'Delete': 'Delete',
    'AudioVolumeMute': 'VolumeMute',
    'AudioVolumeUp': 'VolumeUp', 'AudioVolumeDown': 'VolumeDown',
    'MediaPlayPause': 'MediaPlayPause', 'MediaStop': 'MediaStop',
    'MediaTrackNext': 'MediaNextTrack', 'MediaTrackPrevious': 'MediaPreviousTrack',
  };
  const mapped = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : null);
  if (!mapped) return null;

  const isMedia = e.key.startsWith('Audio') || e.key.startsWith('Media');
  if (!isMedia && mods.length === 0) return null;

  return [...mods, mapped].join('+');
}

async function saveAndRegisterHotkeys(): Promise<void> {
  const hotkeys = {
    mute:       $<HTMLInputElement>('hk-mute').value        || undefined,
    volumeUp:   $<HTMLInputElement>('hk-volume-up').value   || undefined,
    volumeDown: $<HTMLInputElement>('hk-volume-down').value || undefined,
    disconnect: $<HTMLInputElement>('hk-disconnect').value  || undefined,
  };
  await api.saveSettings({ hotkeys });
  await api.registerHotkeys(hotkeys);
}

function wireHotkeyInput(input: HTMLInputElement): void {
  let previous = input.value;
  input.addEventListener('focus', () => {
    previous = input.value;
    input.value = 'Press keys…';
  });
  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    const acc = keyEventToAccelerator(e);
    if (!acc) return;
    input.value = acc;
    input.blur();
    saveAndRegisterHotkeys();
  });
  input.addEventListener('blur', () => {
    if (input.value === 'Press keys…') input.value = previous;
  });
}

(['hk-mute', 'hk-volume-up', 'hk-volume-down', 'hk-disconnect'] as const).forEach((id) => {
  wireHotkeyInput($<HTMLInputElement>(id));
});

document.querySelectorAll<HTMLButtonElement>('.hk-clear').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target!);
    if (target) (target as HTMLInputElement).value = '';
    saveAndRegisterHotkeys();
  });
});

api.onHotkeyTriggered((action) => {
  if (action === 'mute')        toggleMute();
  if (action === 'volume-up')   adjustVolume(10);
  if (action === 'volume-down') adjustVolume(-10);
  if (action === 'disconnect')  disconnectClient();
});
