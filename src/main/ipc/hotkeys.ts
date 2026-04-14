import { ipcMain, globalShortcut } from 'electron';
import { mainWindow } from '../window';
import type { HotkeySettings } from '../../types';

type HotkeyAction = 'mute' | 'volume-up' | 'volume-down' | 'disconnect';

export function registerHotkeysIpc(): void {
  ipcMain.handle('register-hotkeys', (_e, hotkeys: HotkeySettings) => {
    globalShortcut.unregisterAll();

    const pairs: [string | undefined, HotkeyAction][] = [
      [hotkeys.mute,       'mute'],
      [hotkeys.volumeUp,   'volume-up'],
      [hotkeys.volumeDown, 'volume-down'],
      [hotkeys.disconnect, 'disconnect'],
    ];

    for (const [acc, action] of pairs) {
      if (!acc) continue;
      try {
        globalShortcut.register(acc, () => {
          mainWindow?.webContents.send('hotkey-triggered', action);
        });
      } catch {
        console.warn(`[hotkeys] Could not register accelerator: ${acc}`);
      }
    }
  });
}
