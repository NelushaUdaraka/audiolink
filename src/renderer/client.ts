import { api, $, showToast, setStatus } from './utils';

let clientWebSocket: WebSocket | null = null;
let clientPeerConnection: RTCPeerConnection | null = null;
let clientAudioContext: AudioContext | null = null;
let clientAnalyser: AnalyserNode | null = null;
let clientAnimFrame: number | null = null;
let clientGainNode: GainNode | null = null;
let statsInterval: ReturnType<typeof setInterval> | null = null;
let isClientConnected = false;
let clientStateCallback: (() => void) | null = null;

// ─── Discovery ────────────────────────────────────────────────────────────────
const discoveredServersList = $<HTMLDivElement>('discovered-servers-list');
const knownServers = new Set<string>();
let discoveryTimeout: ReturnType<typeof setTimeout> | null = null;
const DISCOVERY_TIMEOUT_MS = 10000;

export function startDiscoverySession(): void {
  knownServers.clear();
  discoveredServersList.innerHTML = '<div class="empty-state">Searching local network...</div>';

  const scannerDot = document.getElementById('scanner-dot') as HTMLElement | null;
  if (scannerDot) scannerDot.style.display = 'block';

  api.startDiscovery();

  if (discoveryTimeout) clearTimeout(discoveryTimeout);
  discoveryTimeout = setTimeout(() => {
    api.stopDiscovery();
    if (knownServers.size === 0) {
      discoveredServersList.innerHTML = '<div class="empty-state">No servers found on local network.</div>';
    }
    if (scannerDot) scannerDot.style.display = 'none';

    if (!discoveredServersList.querySelector('.rescan-btn')) {
      const rescanBtn = document.createElement('button');
      rescanBtn.className = 'rescan-btn';
      rescanBtn.textContent = 'Scan Again';
      rescanBtn.onclick = startDiscoverySession;
      discoveredServersList.appendChild(rescanBtn);
    }
  }, DISCOVERY_TIMEOUT_MS);
}

api.onServerDiscovered((server) => {
  const serverId = `${server.ip}:${server.port}`;
  if (knownServers.has(serverId)) return;
  knownServers.add(serverId);

  const emptyState = discoveredServersList.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const btn = document.createElement('button');
  btn.className = 'discovered-server-item';
  btn.innerHTML = `
    <div class="server-item-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="6" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="10" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="14" cy="12" r="1.5" fill="currentColor"/>
      </svg>
    </div>
    <div class="server-item-info">
      <div class="server-item-name">${server.name}</div>
      <div class="server-item-ip">${server.ip}:${server.port}</div>
    </div>
    <div class="server-item-action">Connect</div>
  `;
  btn.addEventListener('click', () => {
    $<HTMLInputElement>('server-ip-input').value = server.ip;
    $<HTMLInputElement>('server-port-input').value = String(server.port);
    connectClient();
  });
  discoveredServersList.appendChild(btn);
});

// ─── Level meter ─────────────────────────────────────────────────────────────
function setupLevelMeter(stream: MediaStream): void {
  if (clientAudioContext) clientAudioContext.close();
  if (clientAnimFrame !== null) cancelAnimationFrame(clientAnimFrame);

  // 'interactive' latency hint tells the browser to use the smallest
  // output buffer it can, minimising playback buffering on the receiver.
  clientAudioContext = new AudioContext({ latencyHint: 'interactive' });
  const source = clientAudioContext.createMediaStreamSource(stream);

  clientAnalyser = clientAudioContext.createAnalyser();
  clientAnalyser.fftSize = 256;
  clientAnalyser.smoothingTimeConstant = 0.5;

  const volumeSlider = $<HTMLInputElement>('volume-slider');
  clientGainNode = clientAudioContext.createGain();
  clientGainNode.gain.value = parseInt(volumeSlider.value, 10) / 100;

  source.connect(clientGainNode);
  clientGainNode.connect(clientAudioContext.destination);
  source.connect(clientAnalyser);

  const dataArray = new Uint8Array(clientAnalyser.frequencyBinCount);
  const bar = $<HTMLDivElement>('client-level-bar');

  const tick = (): void => {
    if (!clientAnalyser) return;
    clientAnalyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    bar.style.width = `${Math.min(100, (avg / 128) * 100)}%`;
    clientAnimFrame = requestAnimationFrame(tick);
  };
  tick();
}

// ─── Peer connection ──────────────────────────────────────────────────────────
async function setupPeerConnection(offerSdp: string): Promise<void> {
  clientPeerConnection?.close();

  clientPeerConnection = new RTCPeerConnection({
    iceServers: [],  // LAN only
  });

  clientPeerConnection.ontrack = (event) => {
    const audioEl = $<HTMLAudioElement>('audio-output');
    audioEl.srcObject = event.streams[0];
    audioEl.volume = 0;
    setupLevelMeter(event.streams[0]);
    setStatus('client-status-badge', 'streaming', 'Receiving Audio');
    showToast('Receiving audio', 'success');

    // Hint the browser to keep the jitter buffer as tight as possible.
    // playoutDelayHint=0 tells Chrome to target minimal playout delay.
    if (event.receiver.track.kind === 'audio') {
      (event.receiver as any).playoutDelayHint = 0;
    }
  };

  clientPeerConnection.onicecandidate = (event) => {
    if (event.candidate && clientWebSocket?.readyState === WebSocket.OPEN) {
      clientWebSocket.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate.toJSON() }));
    }
  };

  clientPeerConnection.onconnectionstatechange = () => {
    const state = clientPeerConnection?.connectionState;
    if (state === 'disconnected' || state === 'failed')
      setStatus('client-status-badge', 'error', 'Disconnected');
  };

  await clientPeerConnection.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: offerSdp })
  );
  const answer = await clientPeerConnection.createAnswer();
  await clientPeerConnection.setLocalDescription(answer);

  if (clientWebSocket?.readyState === WebSocket.OPEN) {
    clientWebSocket.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
  }

  // Latency polling
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(async () => {
    if (!clientPeerConnection || clientPeerConnection.connectionState !== 'connected') return;
    try {
      const stats = await clientPeerConnection.getStats();
      let rtt = 0, jitter = 0;
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime !== undefined)
          rtt = report.currentRoundTripTime * 1000;
        if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.jitterBufferDelay !== undefined && report.jitterBufferEmittedCount)
          jitter = (report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000;
      });
      const totalLatency = Math.round(rtt + jitter);
      const badge = $<HTMLDivElement>('latency-badge');
      const text = $<HTMLSpanElement>('latency-text');
      if (totalLatency > 0) {
        badge.style.display = 'inline-flex';
        text.textContent = `${totalLatency} ms`;
        badge.classList.remove('latency-badge--warn', 'latency-badge--danger');
        if (totalLatency >= 150) badge.classList.add('latency-badge--danger');
        else if (totalLatency >= 80) badge.classList.add('latency-badge--warn');
      }
    } catch { /* ignore stats errors */ }
  }, 1000);
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function getIsClientConnected(): boolean { return isClientConnected; }
export function setClientStateCallback(cb: () => void): void { clientStateCallback = cb; }

export function connectClient(): void {
  const ip = $<HTMLInputElement>('server-ip-input').value.trim();
  const port = $<HTMLInputElement>('server-port-input').value.trim() || '8765';

  if (!ip) { showToast('Enter the server IP first', 'error'); return; }

  setStatus('client-status-badge', 'waiting', 'Connecting...');
  clientWebSocket = new WebSocket(`ws://${ip}:${port}`);

  clientWebSocket.onopen = async () => {
    isClientConnected = true;
    clientStateCallback?.();
    setStatus('client-status-badge', 'connected', 'Connected');
    showToast('Connected', 'success');
    $<HTMLButtonElement>('btn-connect').style.display = 'none';
    $<HTMLButtonElement>('btn-disconnect').style.display = 'flex';
    await api.saveSettings({ lastIp: ip, lastPort: parseInt(port, 10) });
  };

  clientWebSocket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data as string);
      if (message.type === 'offer') await setupPeerConnection(message.sdp);
      else if (message.type === 'ice-candidate' && clientPeerConnection) {
        await clientPeerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    } catch (err) {
      console.error('Error parsing message:', err);
    }
  };

  clientWebSocket.onclose = () => {
    if (isClientConnected) showToast('Disconnected from server', 'error');
    cleanupClient();
  };

  clientWebSocket.onerror = () => {
    showToast('Connection failed — check IP and port', 'error');
    cleanupClient();
  };
}

export function disconnectClient(): void {
  clientWebSocket?.close();
  cleanupClient();
}

function cleanupClient(): void {
  isClientConnected = false;
  clientStateCallback?.();

  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  clientPeerConnection?.close();
  clientPeerConnection = null;
  clientWebSocket = null;

  if (clientAudioContext) { clientAudioContext.close(); clientAudioContext = null; }
  if (clientAnimFrame !== null) cancelAnimationFrame(clientAnimFrame);

  const audioEl = document.getElementById('audio-output') as HTMLAudioElement | null;
  if (audioEl) audioEl.srcObject = null;

  $<HTMLButtonElement>('btn-connect').style.display = 'flex';
  $<HTMLButtonElement>('btn-disconnect').style.display = 'none';
  $<HTMLDivElement>('client-level-bar').style.width = '0%';
  const latencyBadge = document.getElementById('latency-badge');
  if (latencyBadge) latencyBadge.style.display = 'none';
  setStatus('client-status-badge', 'idle', 'Disconnected');
}

// ─── Event listeners (registered once at module load) ─────────────────────────
const volumeSlider = $<HTMLInputElement>('volume-slider');
const volumeValue = $<HTMLSpanElement>('volume-value');

volumeSlider.addEventListener('input', () => {
  const val = parseInt(volumeSlider.value, 10);
  volumeValue.textContent = `${val}%`;
  if (clientGainNode) clientGainNode.gain.value = val / 100;
});

$('btn-connect').addEventListener('click', connectClient);
$('btn-disconnect').addEventListener('click', disconnectClient);

$('tab-auto-connect').addEventListener('click', () => {
  $('tab-auto-connect').classList.add('tab-btn--active');
  $('tab-manual-connect').classList.remove('tab-btn--active');
  $('discovered-servers-card').style.display = 'block';
  $('manual-connect-card').style.display = 'none';
  const title = document.getElementById('connection-card-title');
  if (title) title.textContent = 'Available Servers';
  const dot = document.getElementById('scanner-dot');
  if (dot) dot.style.display = 'block';
});

$('tab-manual-connect').addEventListener('click', () => {
  $('tab-manual-connect').classList.add('tab-btn--active');
  $('tab-auto-connect').classList.remove('tab-btn--active');
  $('discovered-servers-card').style.display = 'none';
  $('manual-connect-card').style.display = 'block';
  const title = document.getElementById('connection-card-title');
  if (title) title.textContent = 'Connect to Server';
  const dot = document.getElementById('scanner-dot');
  if (dot) dot.style.display = 'none';
});
