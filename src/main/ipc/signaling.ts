import { ipcMain } from 'electron';
import { WebSocketServer, WebSocket } from 'ws';
import { mainWindow } from '../window';
import { startUdpBroadcast, stopUdpBroadcast } from './discovery';
import type { SignalingMessage, SignalingServerResult, StopServerResult } from '../../types';

let wss: WebSocketServer | null = null;
let clientSocket: WebSocket | null = null;
let activePin = '';

export function getWss(): WebSocketServer | null {
  return wss;
}

export function registerSignalingIpc(): void {
  ipcMain.handle(
    'start-signaling-server',
    (_e, port?: number, pin?: string): Promise<SignalingServerResult> =>
      new Promise((resolve, reject) => {
        try {
          activePin = pin ?? '';
          if (wss) { wss.close(); wss = null; clientSocket = null; }

          const signalingPort = port || 8765;
          wss = new WebSocketServer({ port: signalingPort });

          wss.on('listening', () => {
            console.log(`Signaling server listening on port ${signalingPort}`);
            startUdpBroadcast(signalingPort);
            resolve({ success: true, port: signalingPort });
          });

          wss.on('connection', (ws: WebSocket) => {
            console.log('Client connected to signaling server');
            clientSocket = ws;

            let authed = activePin === '';

            if (!authed) {
              ws.send(JSON.stringify({ type: 'auth-challenge' }));
            } else {
              mainWindow?.webContents.send('client-connected');
            }

            ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
              try {
                const msg: SignalingMessage = JSON.parse(data.toString());

                if (!authed) {
                  if (msg.type === 'auth-response') {
                    if (msg.pin === activePin) {
                      authed = true;
                      mainWindow?.webContents.send('client-connected');
                    } else {
                      ws.send(JSON.stringify({ type: 'auth-error' }));
                      ws.close();
                      clientSocket = null;
                    }
                  }
                  return;
                }

                mainWindow?.webContents.send('signaling-message', msg);
              } catch (err) {
                console.error('Error parsing signaling message:', err);
              }
            });

            ws.on('close', () => {
              console.log('Client disconnected');
              clientSocket = null;
              mainWindow?.webContents.send('client-disconnected');
            });

            ws.on('error', (err: Error) => {
              console.error('Client WebSocket error:', err);
              clientSocket = null;
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
        if (clientSocket) { clientSocket.close(); clientSocket = null; }
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

  ipcMain.on('send-to-client', (_e, message: SignalingMessage) => {
    if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(JSON.stringify(message));
    }
  });
}
