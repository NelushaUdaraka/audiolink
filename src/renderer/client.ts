import { api, $, showToast, setStatus, syncSliderFill } from './utils';

let clientWebSocket: WebSocket | null = null;
let clientPeerConnection: RTCPeerConnection | null = null;
let clientAudioContext: AudioContext | null = null;
let clientAnalyser: AnalyserNode | null = null;
let clientAnimFrame: number | null = null;
let clientGainNode: GainNode | null = null;
let isMuted = false;
let statsInterval: ReturnType<typeof setInterval> | null = null;
const LATENCY_HISTORY_MAX = 60;
const latencyHistory: number[] = [];
let connectionStartTime: number | null = null;
let lastBytesReceived = 0;
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

  const selectedSink = $<HTMLSelectElement>('output-device-select').value;
  if (selectedSink && (clientAudioContext as any).setSinkId) {
    (clientAudioContext as any).setSinkId(selectedSink).catch(() => { /* ignore on context creation */ });
  }

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

// ─── Output device selector ───────────────────────────────────────────────────
async function refreshOutputDevices(): Promise<void> {
  const select = $<HTMLSelectElement>('output-device-select');
  const previousValue = select.value;
  select.innerHTML = '';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Default';
  select.appendChild(defaultOpt);

  try {
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
      temp.getTracks().forEach((t) => t.stop());
    } catch { /* no mic permission — labels may be generic */ }

    const devices = await navigator.mediaDevices.enumerateDevices();
    devices
      .filter((d) => d.kind === 'audiooutput')
      .forEach((device, i) => {
        const opt = document.createElement('option');
        opt.value = device.deviceId;
        opt.textContent = device.label || `Speaker ${i + 1}`;
        select.appendChild(opt);
      });

    if ([...select.options].some((o) => o.value === previousValue))
      select.value = previousValue;
  } catch (err) {
    console.error('Error enumerating output devices:', err);
  }
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
    connectionStartTime = Date.now();
    lastBytesReceived = 0;

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
  let answerSdp = answer.sdp || '';

  // Mirror the offer's transport budget and codec params in the answer so the
  // receiver side doesn't cap the negotiated bitrate below what the server selected.
  answerSdp = answerSdp.replace(/(m=audio[^\r\n]*\r\n)/, '$1b=AS:510\r\n');
  const answerOpusPt = (answerSdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i) ?? [])[1] ?? '111';
  answerSdp = answerSdp.replace(
    new RegExp(`a=fmtp:${answerOpusPt} [^\r\n]*`),
    `a=fmtp:${answerOpusPt} stereo=1;maxaveragebitrate=510000`
  );
  answerSdp = answerSdp.replace(new RegExp(`a=rtcp-fb:${answerOpusPt} transport-cc\r\n`, 'g'), '');

  await clientPeerConnection.setLocalDescription({ type: 'answer', sdp: answerSdp });

  if (clientWebSocket?.readyState === WebSocket.OPEN) {
    clientWebSocket.send(JSON.stringify({ type: 'answer', sdp: answerSdp }));
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

        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          if (report.jitterBufferDelay !== undefined && report.jitterBufferEmittedCount)
            jitter = (report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000;

          // Packet loss
          const totalPackets = (report.packetsReceived ?? 0) + (report.packetsLost ?? 0);
          const lossPercent = totalPackets > 0 ? (report.packetsLost / totalPackets) * 100 : 0;
          $<HTMLSpanElement>('packet-loss-text').textContent = `${lossPercent.toFixed(1)}%`;

          // Bandwidth kbps — bytes delta over 1 s interval
          const bytesDelta = (report.bytesReceived ?? 0) - lastBytesReceived;
          lastBytesReceived = report.bytesReceived ?? 0;
          const kbps = Math.round((bytesDelta * 8) / 1000);
          $<HTMLSpanElement>('bandwidth-text').textContent = `${kbps} kbps`;
        }
      });

      // Latency badge + history
      const totalLatency = Math.round(rtt + jitter);
      const badge = $<HTMLButtonElement>('latency-badge');
      const text = $<HTMLSpanElement>('latency-text');
      if (totalLatency > 0) {
        badge.style.display = 'inline-flex';
        text.textContent = `${totalLatency} ms`;
        badge.classList.remove('latency-badge--warn', 'latency-badge--danger');
        if (totalLatency >= 150) badge.classList.add('latency-badge--danger');
        else if (totalLatency >= 80) badge.classList.add('latency-badge--warn');

        latencyHistory.push(totalLatency);
        if (latencyHistory.length > LATENCY_HISTORY_MAX) latencyHistory.shift();
        if ($<HTMLDivElement>('latency-chart-overlay').style.display !== 'none') renderLatencyChart();
      }

      // Uptime
      if (connectionStartTime !== null) {
        const elapsed = Math.floor((Date.now() - connectionStartTime) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        const uptimeStr = h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        $<HTMLSpanElement>('uptime-text').textContent = uptimeStr;
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
      if (message.type === 'auth-challenge') {
        $<HTMLDivElement>('pin-modal-overlay').style.display = 'flex';
        $<HTMLInputElement>('pin-input').value = '';
        $<HTMLInputElement>('pin-input').focus();
      } else if (message.type === 'auth-error') {
        showToast('Incorrect PIN — access denied', 'error');
        cleanupClient();
      } else if (message.type === 'offer') {
        await setupPeerConnection(message.sdp);
      } else if (message.type === 'ice-candidate' && clientPeerConnection) {
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
  connectionStartTime = null;
  lastBytesReceived = 0;
  latencyHistory.length = 0;
  $<HTMLDivElement>('latency-chart-overlay').style.display = 'none';
  $<HTMLSpanElement>('bandwidth-text').textContent = '0 kbps';
  $<HTMLSpanElement>('uptime-text').textContent = '00:00';
  $<HTMLSpanElement>('packet-loss-text').textContent = '0.0%';
  $<HTMLDivElement>('pin-modal-overlay').style.display = 'none';
  $<HTMLInputElement>('pin-input').value = '';
  setStatus('client-status-badge', 'idle', 'Disconnected');
}

// ─── Latency chart ────────────────────────────────────────────────────────────
function renderLatencyChart(): void {
  const canvas = $<HTMLCanvasElement>('latency-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || latencyHistory.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PAD = { top: 8, right: 14, bottom: 22, left: 44 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top  - PAD.bottom;

  // Scale: round max up to nearest nice value
  const rawMax = Math.max(...latencyHistory);
  const niceMax = Math.ceil(Math.max(rawMax, 40) / 20) * 20;
  const range = niceMax;

  // Colors come from the theme tokens so the chart always matches the UI
  const css      = getComputedStyle(document.body);
  const token    = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const accent   = token('--chart-line', '#818cf8');
  const gridCol  = token('--chart-grid', 'rgba(255,255,255,0.07)');
  const labelCol = token('--chart-label', '#8690a6');

  // Chart background
  ctx.fillStyle = token('--chart-bg', 'rgba(0,0,0,0.18)');
  ctx.beginPath();
  ctx.roundRect(PAD.left, PAD.top, chartW, chartH, 6);
  ctx.fill();

  // Grid lines + Y labels (5 lines: 0, 25%, 50%, 75%, 100%)
  ctx.font = '500 10.5px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const val = (niceMax * i) / gridCount;
    const y   = PAD.top + chartH - (chartH * i) / gridCount;
    ctx.strokeStyle = gridCol;
    ctx.lineWidth   = 1;
    ctx.setLineDash(i === 0 ? [] : [3, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = labelCol;
    ctx.fillText(i === gridCount ? `${Math.round(val)} ms` : `${Math.round(val)}`, PAD.left - 8, y);
  }

  // Newest sample is pinned to the right edge ("now"); history scrolls left
  const xOf = (i: number) =>
    PAD.left + ((i + LATENCY_HISTORY_MAX - latencyHistory.length) / (LATENCY_HISTORY_MAX - 1)) * chartW;
  const yOf = (v: number) => PAD.top  + chartH - (v / range) * chartH;

  // X-axis labels: fixed ticks every 10 s
  ctx.textBaseline = 'top';
  for (let age = 0; age < LATENCY_HISTORY_MAX; age += 10) {
    const x = PAD.left + ((LATENCY_HISTORY_MAX - 1 - age) / (LATENCY_HISTORY_MAX - 1)) * chartW;
    ctx.textAlign = age === 0 ? 'right' : 'center';
    ctx.fillStyle = labelCol;
    ctx.fillText(age === 0 ? 'now' : `-${age}s`, age === 0 ? x + 4 : x, PAD.top + chartH + 6);
  }

  // Clip drawing to chart area
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, chartW, chartH);
  ctx.clip();

  // Gradient fill under curve
  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
  grad.addColorStop(0, token('--chart-fill-top', 'rgba(129,140,248,0.32)'));
  grad.addColorStop(1, token('--chart-fill-bottom', 'rgba(129,140,248,0)'));

  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(latencyHistory[0]));
  for (let i = 1; i < latencyHistory.length; i++) {
    const cpx = (xOf(i - 1) + xOf(i)) / 2;
    ctx.bezierCurveTo(cpx, yOf(latencyHistory[i - 1]), cpx, yOf(latencyHistory[i]), xOf(i), yOf(latencyHistory[i]));
  }
  ctx.lineTo(xOf(latencyHistory.length - 1), PAD.top + chartH);
  ctx.lineTo(xOf(0), PAD.top + chartH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Stroke line
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(latencyHistory[0]));
  for (let i = 1; i < latencyHistory.length; i++) {
    const cpx = (xOf(i - 1) + xOf(i)) / 2;
    ctx.bezierCurveTo(cpx, yOf(latencyHistory[i - 1]), cpx, yOf(latencyHistory[i]), xOf(i), yOf(latencyHistory[i]));
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  ctx.restore();

  // Dot at latest point (drawn outside clip region so it isn't cut)
  const lx = xOf(latencyHistory.length - 1);
  const ly = Math.max(PAD.top + 4, Math.min(PAD.top + chartH - 4, yOf(latencyHistory[latencyHistory.length - 1])));
  ctx.beginPath();
  ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.lineWidth   = 2;
  ctx.strokeStyle = token('--surface', '#1b1b30');
  ctx.stroke();

  // Stats pills
  const avg = Math.round(latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length);
  const peak = Math.max(...latencyHistory);
  const current = latencyHistory[latencyHistory.length - 1];
  $('lc-current').textContent = `${current} ms`;
  $('lc-avg').textContent     = `avg ${avg} ms`;
  $('lc-max').textContent     = `max ${peak} ms`;
}

function openLatencyChart(): void {
  if (latencyHistory.length === 0) return;
  const overlay = $<HTMLDivElement>('latency-chart-overlay');
  overlay.style.display = 'flex';
  // Allow layout to settle before drawing
  requestAnimationFrame(() => renderLatencyChart());
}

function closeLatencyChart(): void {
  $<HTMLDivElement>('latency-chart-overlay').style.display = 'none';
}

// ─── Mute ─────────────────────────────────────────────────────────────────────
function applyMuteState(muted: boolean): void {
  isMuted = muted;
  if (clientGainNode) {
    clientGainNode.gain.value = muted ? 0 : parseInt($<HTMLInputElement>('volume-slider').value, 10) / 100;
  }
  const muteBtn = $('btn-mute');
  muteBtn.classList.toggle('btn-icon-sm--muted', muted);
  muteBtn.setAttribute('aria-pressed', String(muted));
  ($('icon-unmuted') as HTMLElement).style.display = muted ? 'none' : '';
  ($('icon-muted') as HTMLElement).style.display = muted ? '' : 'none';
}

export function toggleMute(): void {
  applyMuteState(!isMuted);
}

export function adjustVolume(delta: number): void {
  const slider = $<HTMLInputElement>('volume-slider');
  const next = Math.max(0, Math.min(300, parseInt(slider.value, 10) + delta));
  slider.value = String(next);
  syncSliderFill(slider);
  $<HTMLSpanElement>('volume-value').textContent = `${next}%`;
  if (isMuted) applyMuteState(false);
  if (clientGainNode) clientGainNode.gain.value = next / 100;
  api.saveSettings({ volume: next });
}

// ─── Event listeners (registered once at module load) ─────────────────────────
const volumeSlider = $<HTMLInputElement>('volume-slider');
const volumeValue = $<HTMLSpanElement>('volume-value');

volumeSlider.addEventListener('input', () => {
  const val = parseInt(volumeSlider.value, 10);
  volumeValue.textContent = `${val}%`;
  if (isMuted) applyMuteState(false);  // dragging slider auto-unmutes
  if (clientGainNode) clientGainNode.gain.value = val / 100;
});

volumeSlider.addEventListener('change', () => {
  api.saveSettings({ volume: parseInt(volumeSlider.value, 10) });
});

$('btn-mute').addEventListener('click', toggleMute);

$('btn-connect').addEventListener('click', connectClient);
$('btn-disconnect').addEventListener('click', disconnectClient);

$('output-device-select').addEventListener('change', () => {
  const deviceId = $<HTMLSelectElement>('output-device-select').value;
  if (clientAudioContext && (clientAudioContext as any).setSinkId) {
    (clientAudioContext as any).setSinkId(deviceId).catch(() =>
      showToast('Could not switch output device', 'error')
    );
  }
  api.saveSettings({ outputDeviceId: deviceId });
});

$('btn-refresh-output-devices').addEventListener('click', refreshOutputDevices);

export function applyClientTab(tab: 'auto' | 'manual'): void {
  const isAuto = tab === 'auto';
  $('tab-auto-connect').classList.toggle('tab-btn--active', isAuto);
  $('tab-manual-connect').classList.toggle('tab-btn--active', !isAuto);
  $('tab-auto-connect').setAttribute('aria-pressed', String(isAuto));
  $('tab-manual-connect').setAttribute('aria-pressed', String(!isAuto));
  $('discovered-servers-card').style.display = isAuto ? 'block' : 'none';
  $('manual-connect-card').style.display     = isAuto ? 'none'  : 'block';
  const title = document.getElementById('connection-card-title');
  if (title) title.textContent = isAuto ? 'Available Servers' : 'Connect to Server';
  const dot = document.getElementById('scanner-dot');
  if (dot) dot.style.display = isAuto ? 'block' : 'none';
}

$('tab-auto-connect').addEventListener('click', () => {
  applyClientTab('auto');
  api.saveSettings({ clientTab: 'auto' });
});

$('tab-manual-connect').addEventListener('click', () => {
  applyClientTab('manual');
  api.saveSettings({ clientTab: 'manual' });
});

const submitPin = (): void => {
  const pin = $<HTMLInputElement>('pin-input').value.trim();
  if (!pin) return;
  $<HTMLDivElement>('pin-modal-overlay').style.display = 'none';
  if (clientWebSocket?.readyState === WebSocket.OPEN) {
    clientWebSocket.send(JSON.stringify({ type: 'auth-response', pin }));
  }
};

$('btn-submit-pin').addEventListener('click', submitPin);
$<HTMLInputElement>('pin-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPin();
});

// Escape route out of the PIN prompt: abandon this connection attempt
$('btn-cancel-pin').addEventListener('click', disconnectClient);

$('latency-badge').addEventListener('click', openLatencyChart);
$('btn-close-latency-chart').addEventListener('click', closeLatencyChart);
$('latency-chart-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeLatencyChart();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($<HTMLDivElement>('pin-modal-overlay').style.display !== 'none') disconnectClient();
  else if ($<HTMLDivElement>('latency-chart-overlay').style.display !== 'none') closeLatencyChart();
});

window.addEventListener('resize', () => {
  if ($<HTMLDivElement>('latency-chart-overlay').style.display !== 'none') {
    requestAnimationFrame(() => renderLatencyChart());
  }
});

// ─── Init: restore persisted settings ────────────────────────────────────────
(async () => {
  const settings = await api.getSettings();

  if (settings.volume !== undefined) {
    volumeSlider.value = String(settings.volume);
    volumeValue.textContent = `${settings.volume}%`;
    syncSliderFill(volumeSlider);
  }

  // Pre-set saved device ID so refreshOutputDevices can restore it if still present
  if (settings.outputDeviceId) {
    $<HTMLSelectElement>('output-device-select').value = settings.outputDeviceId;
  }

  await refreshOutputDevices();
})();
