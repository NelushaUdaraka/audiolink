import { ipcMain } from 'electron';
import os from 'node:os';
import { mainWindow } from '../window';

// NOTE: discoverySocket is shared between server broadcast mode and client
// listen mode since the app is always in one mode at a time.
let discoverySocket: import('dgram').Socket | null = null;
let broadcastInterval: ReturnType<typeof setInterval> | null = null;
const DISCOVERY_PORT = 41234;
const MULTICAST_ADDR = '239.255.255.250';

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
  const server = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discoverySocket = server;
  server.bind(() => {
    // If stop was called before bind completed, this socket is already closed
    if (discoverySocket !== server) return;
    broadcastInterval = setInterval(() => {
      if (discoverySocket !== server) return;
      const msg = JSON.stringify({
        name: `${os.hostname()} - AudioLink`,
        ip: getLocalIP(),
        port: signalingPort,
      });
      try {
        server.send(msg, 0, msg.length, DISCOVERY_PORT, MULTICAST_ADDR);
      } catch { /* socket closed between check and send */ }
    }, 2000);
  });
}

export function stopUdpBroadcast(): void {
  if (broadcastInterval) { clearInterval(broadcastInterval); broadcastInterval = null; }
  if (discoverySocket) { 
    try { discoverySocket.close(); } catch (e) {}
    discoverySocket = null; 
  }
}

export function registerDiscoveryIpc(): void {
  ipcMain.handle('start-discovery', () => {
    if (discoverySocket) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dgram = require('dgram');
    discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    discoverySocket?.on('message', (msg: Buffer) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data?.name && data?.ip && data?.port) {
          mainWindow?.webContents.send('server-discovered', data);
        }
      } catch { /* ignore malformed packets */ }
    });
    discoverySocket?.bind(DISCOVERY_PORT, () => {
      try {
        discoverySocket?.addMembership(MULTICAST_ADDR);
        console.log('Desktop listening for Multicast on', MULTICAST_ADDR, 'port', DISCOVERY_PORT);
      } catch (err) {
        console.error('Multicast addMembership error on desktop:', err);
      }
    });
  });

  ipcMain.handle('stop-discovery', () => {
    if (discoverySocket) {
      try { discoverySocket.dropMembership(MULTICAST_ADDR); } catch { /* not a member */ }
      try { discoverySocket.close(); } catch { /* already closed */ }
      discoverySocket = null;
    }
  });
}
