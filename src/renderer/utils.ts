import type { ElectronAPI, ConnectionStatus } from '../types';

export const api: ElectronAPI = window.electronAPI;

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, type: '' | 'error' | 'success' = ''): void {
  let toast = document.querySelector<HTMLDivElement>('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    // Announced politely by screen readers without stealing focus
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);
  }

  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }

  toast.textContent = message;
  // Remove 'show', force a synchronous reflow so the browser sees the change,
  // then immediately re-add 'show'. This restarts the CSS transition without
  // requestAnimationFrame (which pauses when the window is hidden/minimised).
  toast.className = `toast ${type}`;
  void toast.offsetWidth;
  toast.classList.add('show');

  toastTimeout = setTimeout(() => {
    toast!.classList.remove('show');
    toastTimeout = null;
  }, 3000);
}

// Safety net: if a toast is still visible when the window regains focus but
// its dismiss timer already fired (e.g. rAF race while backgrounded), close it.
window.addEventListener('focus', () => {
  const toast = document.querySelector<HTMLDivElement>('.toast.show');
  if (toast && !toastTimeout) {
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      toastTimeout = null;
    }, 1500);
  }
});

/** Mirrors a range input's position into --fill so CSS can paint the filled track. */
export function syncSliderFill(slider: HTMLInputElement): void {
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const pct = ((Number(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty('--fill', `${pct}%`);
}

export function showView(viewId: string): void {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $(viewId).classList.add('active');
}

export function setStatus(badgeId: string, status: ConnectionStatus, text: string): void {
  const badge = $(badgeId);
  badge.setAttribute('data-status', status);
  const statusText = badge.querySelector('.status-text');
  if (statusText) statusText.textContent = text;
}
