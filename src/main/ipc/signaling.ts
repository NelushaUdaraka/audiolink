import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { mainWindow } from '../window';
import { startUdpBroadcast, stopUdpBroadcast } from './discovery';
import { loadSettings, saveSettings } from '../settings';
import { getMacAddress, getDeviceName } from './macLookup';
import type { SignalingMessage, SignalingServerResult, StopServerResult, BlacklistEntry } from '../../types';

let wss: WebSocketServer | null = null;
const clientSockets = new Map<string, WebSocket>();
const clientIps   = new Map<string, string>();
const clientMacs  = new Map<string, string | null>();
const clientNames = new Map<string, string | null>();
let activePin = '';
let activeMaxClients = 1;

export function getWss(): WebSocketServer | null {
  return wss;
}

function clearClient(clientId: string): void {
  clientSockets.delete(clientId);
  clientIps.delete(clientId);
  clientMacs.delete(clientId);
  clientNames.delete(clientId);
}

export function registerSignalingIpc(): void {
  ipcMain.handle(
    'start-signaling-server',
    (_e, port?: number, pin?: string, maxClients?: number): Promise<SignalingServerResult> =>
      new Promise((resolve, reject) => {
        try {
          activePin = pin ?? '';
          activeMaxClients = maxClients ?? 1;
          if (wss) {
            for (const ws of clientSockets.values()) ws.close();
            clientSockets.clear();
            clientIps.clear();
            clientMacs.clear();
            clientNames.clear();
            wss.close();
            wss = null;
          }

          const signalingPort = port || 8765;
          wss = new WebSocketServer({ port: signalingPort });

          wss.on('listening', () => {
            console.log(`Signaling server listening on port ${signalingPort}`);
            startUdpBroadcast(signalingPort);
            resolve({ success: true, port: signalingPort });
          });

          wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
            const rawIp = request.socket.remoteAddress ?? 'unknown';
            const clientIp = rawIp.replace(/^::ffff:/, '').replace('::1', '127.0.0.1');

            // Resolve MAC and hostname in parallel (bounded by 1.5 s timeouts each)
            const [clientMac, deviceName] = await Promise.all([
              getMacAddress(clientIp),
              getDeviceName(clientIp),
            ]);

            // MAC-based blacklist check
            const blacklist: BlacklistEntry[] = loadSettings().blacklistedMacs ?? [];
            if (clientMac && blacklist.some((e) => e.mac === clientMac)) {
              console.log(`Rejecting blacklisted device ${clientMac} from ${clientIp}`);
              ws.close(1008, 'You are banned from this server');
              return;
            }

            if (clientSockets.size >= activeMaxClients) {
              console.log(`Rejecting client — at capacity (${activeMaxClients})`);
              ws.close(1008, 'Server is at capacity');
              return;
            }

            const clientId = randomUUID();
            clientSockets.set(clientId, ws);
            clientIps.set(clientId, clientIp);
            clientMacs.set(clientId, clientMac);
            clientNames.set(clientId, deviceName);
            console.log(`Client ${clientId} connected: ${deviceName ?? clientIp} [${clientMac ?? 'no-mac'}]`);

            let authed = activePin === '';

            if (!authed) {
              ws.send(JSON.stringify({ type: 'auth-challenge' }));
            } else {
              mainWindow?.webContents.send('client-connected', clientId, clientIp, clientMac, deviceName);
            }

            ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
              try {
                const msg: SignalingMessage = JSON.parse(data.toString());

                if (!authed) {
                  if (msg.type === 'auth-response') {
                    if (msg.pin === activePin) {
                      authed = true;
                      mainWindow?.webContents.send('client-connected', clientId, clientIp, clientMac, deviceName);
                    } else {
                      ws.send(JSON.stringify({ type: 'auth-error' }));
                      ws.close();
                      clearClient(clientId);
                    }
                  }
                  return;
                }

                mainWindow?.webContents.send('signaling-message', clientId, msg);
              } catch (err) {
                console.error('Error parsing signaling message:', err);
              }
            });

            ws.on('close', () => {
              if (!clientSockets.has(clientId)) return;
              console.log(`Client ${clientId} disconnected`);
              clearClient(clientId);
              mainWindow?.webContents.send('client-disconnected', clientId);
            });

            ws.on('error', (err: Error) => {
              console.error(`Client ${clientId} WebSocket error:`, err);
              if (!clientSockets.has(clientId)) return;
              clearClient(clientId);
              mainWindow?.webContents.send('client-disconnected', clientId);
            });
          });

          wss.on('error', (err: Error) => {
            console.error('Signaling server error:', err);
            reject({ success: false, error: err.message });
          });
        } catch (err) {
          reject({ success: false, error: (err as Error).message });
        }
      })
  );

  ipcMain.handle('stop-signaling-server', (): Promise<StopServerResult> =>
    new Promise((resolve) => {
      stopUdpBroadcast();
      if (wss) {
        for (const ws of clientSockets.values()) ws.close();
        clientSockets.clear();
        clientIps.clear();
        clientMacs.clear();
        clientNames.clear();
        wss.close(() => {
          wss = null;
          console.log('Signaling server stopped');
          resolve({ success: true });
        });
      } else {
        resolve({ success: true });
      }
    })
  );

  ipcMain.on('send-to-client', (_e, clientId: string, message: SignalingMessage) => {
    const ws = clientSockets.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });

  ipcMain.on('disconnect-client', (_e, clientId: string) => {
    const ws = clientSockets.get(clientId);
    if (ws) ws.close(1000, 'Kicked by server');
  });

  ipcMain.handle('blacklist-client', (_e, clientId: string): BlacklistEntry[] => {
    const mac = clientMacs.get(clientId) ?? null;
    const ip  = clientIps.get(clientId)  ?? 'unknown';
    const name = clientNames.get(clientId) ?? null;

    if (mac) {
      const current: BlacklistEntry[] = loadSettings().blacklistedMacs ?? [];
      if (!current.some((e) => e.mac === mac)) {
        saveSettings({ blacklistedMacs: [...current, { mac, ip, deviceName: name }] });
      }
    }

    const ws = clientSockets.get(clientId);
    if (ws) ws.close(1008, 'You are banned from this server');

    return loadSettings().blacklistedMacs ?? [];
  });
}
