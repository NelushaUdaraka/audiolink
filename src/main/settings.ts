import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { AppSettings } from '../types';

export const userDataPath = path.join(os.homedir(), '.audiolink');
const settingsPath = path.join(userDataPath, 'settings.json');

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
    }
  } catch { /* ignore */ }
  return { lastIp: '', lastPort: 8765 };
}

export function saveSettings(partial: Partial<AppSettings>): void {
  try {
    const current = loadSettings();
    const updated = { ...current, ...partial };
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}
