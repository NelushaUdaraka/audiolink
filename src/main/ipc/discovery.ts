import { ipcMain } from 'electron';
import os from 'node:os';
import { mainWindow } from '../window';

// NOTE: discoverySocket is shared between server broadcast mode and client
// listen mode since the app is always in one mode at a time.
let discoverySocket: import('dgram').Socket | null = null;
let broadcastInterval: ReturnType<typeof setInterval> | null = null;
const DISCOVERY_PORT = 41234;

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

export function startUdpBroadcast(signalingPort: number): void {
  stopUdpBroadcast();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dgram = require('dgram');
  const server = dgram.createSocket('udp4');
  server.bind(() => {
    server.setBroadcast(true);
    broadcastInterval = setInterval(() => {
      const msg = JSON.stringify({
        name: `${os.hostname()} - AudioLink`,
        ip: getLocalIP(),
        port: signalingPort,
      });
      server.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255');
    }, 2000);
  });
  discoverySocket = server;
}

export function stopUdpBroadcast(): void {
  if (broadcastInterval) { clearInterval(broadcastInterval); broadcastInterval = null; }
  if (discoverySocket) { discoverySocket.close(); discoverySocket = null; }
}

export function registerDiscoveryIpc(): void {
  ipcMain.handle('start-discovery', () => {
    if (discoverySocket) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dgram = require('dgram');
    discoverySocket = dgram.createSocket('udp4');
    discoverySocket?.on('message', (msg: Buffer) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data?.name && data?.ip && data?.port) {
          mainWindow?.webContents.send('server-discovered', data);
        }
      } catch { /* ignore malformed packets */ }
    });
    discoverySocket?.bind(DISCOVERY_PORT, () => {
      console.log('Listening for discovered servers on port', DISCOVERY_PORT);
    });
  });

  ipcMain.handle('stop-discovery', () => {
    if (discoverySocket) { discoverySocket.close(); discoverySocket = null; }
  });
}
