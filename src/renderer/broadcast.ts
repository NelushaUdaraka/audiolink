import { api, $, showToast, setStatus } from './utils';
import type { SignalingMessage } from '../types';

let bcStream: MediaStream | null = null;
const peerConnections = new Map<string, RTCPeerConnection>();
const clientInfoMap = new Map<string, { ip: string; mac: string | null; deviceName: string | null }>();
let bcAudioContext: AudioContext | null = null;
let bcAnalyser: AnalyserNode | null = null;
let bcAnimFrame: number | null = null;
let isBroadcastRunning = false;
let broadcastStateCallback: (() => void) | null = null;
let bcBlacklistChangedCallback: (() => void) | null = null;
let maxClientsDisplay = 1;

export function setBcBlacklistChangedCallback(cb: () => void): void { bcBlacklistChangedCallback = cb; }

// ─── Device enumeration ───────────────────────────────────────────────────────
export async function refreshBroadcastDevices(): Promise<void> {
  const select = $<HTMLSelectElement>('bc-audio-device-select');
  const previousValue = select.value;
  select.innerHTML = '';

  const systemOpt = document.createElement('option');
  systemOpt.value = '__system_audio__';
  systemOpt.textContent = 'System Audio (Loopback)';
  select.appendChild(systemOpt);

  try {
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
      temp.getTracks().forEach((t) => t.stop());
    } catch { /* no mic — proceed with system audio only */ }

    const devices = await navigator.mediaDevices.enumerateDevices();
    devices
      .filter((d) => d.kind === 'audioinput')
      .forEach((device, i) => {
        const opt = document.createElement('option');
        opt.value = device.deviceId;
        opt.textContent = device.label || `Microphone ${i + 1}`;
        select.appendChild(opt);
      });

    if (previousValue && [...select.options].some((o) => o.value === previousValue))
      select.value = previousValue;
  } catch (err) {
    console.error('Error enumerating broadcast devices:', err);
  }
}

// ─── Audio capture ────────────────────────────────────────────────────────────
async function captureAudio(deviceId: string): Promise<MediaStream> {
  if (deviceId === '__system_audio__') {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1 },
    });
    stream.getVideoTracks().forEach((t) => t.stop());
    return stream;
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // @ts-ignore — latency is non-standard but valid
      latency: 0,
      channelCount: 2,
      sampleRate: 48000,
    },
  });
}

// ─── Level meter ─────────────────────────────────────────────────────────────
function setupLevelMeter(stream: MediaStream): void {
  if (bcAudioContext) bcAudioContext.close();
  if (bcAnimFrame !== null) cancelAnimationFrame(bcAnimFrame);

  bcAudioContext = new AudioContext();
  const source = bcAudioContext.createMediaStreamSource(stream);
  bcAnalyser = bcAudioContext.createAnalyser();
  bcAnalyser.fftSize = 256;
  bcAnalyser.smoothingTimeConstant = 0.5;
  source.connect(bcAnalyser);

  const dataArray = new Uint8Array(bcAnalyser.frequencyBinCount);
  const bar = $<HTMLDivElement>('bc-level-bar');

  const tick = (): void => {
    if (!bcAnalyser) return;
    bcAnalyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    bar.style.width = `${Math.min(100, (avg / 128) * 100)}%`;
    bcAnimFrame = requestAnimationFrame(tick);
  };
  tick();
}

// ─── Client list ──────────────────────────────────────────────────────────────
function renderBcClients(): void {
  const list = document.getElementById('bc-clients-list');
  if (!list) return;
  list.innerHTML = '';
  if (clientInfoMap.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'clients-empty';
    empty.textContent = 'No clients connected';
    list.appendChild(empty);
    return;
  }
  clientInfoMap.forEach(({ ip, mac, deviceName }, clientId) => {
    const card = document.createElement('div');
    card.className = 'client-card';
    const displayName = deviceName ?? ip;
    const metaText = mac ? `${ip} · ${mac}` : ip;
    card.innerHTML = `
      <div class="client-card-header">
        <span class="client-card-name">${displayName}</span>
      </div>
      <div class="client-card-meta">${metaText}</div>
      <div class="client-card-actions">
        <button class="client-card-btn client-card-btn--ban">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M4.93 4.93l14.14 14.14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Ban
        </button>
        <button class="client-card-btn client-card-btn--kick">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
          Kick
        </button>
      </div>
    `;
    card.querySelector<HTMLButtonElement>('.client-card-btn--ban')!
      .addEventListener('click', async () => {
        await api.blacklistClient(clientId);
        bcBlacklistChangedCallback?.();
      });
    card.querySelector<HTMLButtonElement>('.client-card-btn--kick')!
      .addEventListener('click', () => api.disconnectClient(clientId));
    list.appendChild(card);
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function updateStatusBadge(): void {
  const total = peerConnections.size;
  const streaming = [...peerConnections.values()].filter(
    (pc) => pc.connectionState === 'connected'
  ).length;

  const countEl = document.getElementById('bc-client-count');
  if (countEl) countEl.textContent = `${total} / ${maxClientsDisplay}`;

  if (total === 0) {
    setStatus('bc-status-badge', 'waiting', 'Waiting for clients...');
  } else if (streaming > 0) {
    setStatus('bc-status-badge', 'streaming', `Streaming · ${streaming}/${total}`);
  } else {
    setStatus('bc-status-badge', 'connected', `${total} client${total !== 1 ? 's' : ''} connecting`);
  }
}

// ─── Peer connections ─────────────────────────────────────────────────────────
async function setupPeerConnection(clientId: string): Promise<void> {
  cleanupPeerConnection(clientId);

  const pc = new RTCPeerConnection({ iceServers: [] });
  peerConnections.set(clientId, pc);

  bcStream?.getAudioTracks().forEach((track) => {
    pc.addTrack(track, bcStream!);
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      api.sendToClient(clientId, { type: 'ice-candidate', candidate: event.candidate.toJSON() });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      const bitrate = parseInt($<HTMLSelectElement>('bc-audio-bitrate-select').value, 10);
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender) {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = bitrate;
        sender.setParameters(params).catch(() => {});
      }
    }
    updateStatusBadge();
  };

  const bitrateSelect = $<HTMLSelectElement>('bc-audio-bitrate-select');
  const maxBitrate = Math.min(parseInt(bitrateSelect?.value ?? '128000', 10), 510000);
  const maxBitrateKbps = Math.ceil(maxBitrate / 1000);
  const offer = await pc.createOffer();
  let sdp = offer.sdp || '';

  // ptime
  if (/a=ptime:\d+/.test(sdp)) {
    sdp = sdp.replace(/a=ptime:\d+/, 'a=ptime:5');
  } else {
    sdp = sdp.replace(/(m=audio[^\r\n]*[\r\n]+)/, '$1a=ptime:5\r\n');
  }

  // Declare transport budget
  sdp = sdp.replace(/(m=audio[^\r\n]*\r\n)/, `$1b=AS:${maxBitrateKbps}\r\n`);

  // Find the Opus payload type and REPLACE (not append) its fmtp line to avoid duplicate params
  const opusPt = (sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i) ?? [])[1] ?? '111';
  sdp = sdp.replace(
    new RegExp(`a=fmtp:${opusPt} [^\r\n]*`),
    `a=fmtp:${opusPt} minptime=2;useinbandfec=0;stereo=1;cbr=1;maxaveragebitrate=${maxBitrate}`
  );

  // Remove transport-cc RTCP feedback — prevents GCC from throttling the encoder on LAN
  sdp = sdp.replace(new RegExp(`a=rtcp-fb:${opusPt} transport-cc\r\n`, 'g'), '');

  await pc.setLocalDescription({ type: 'offer', sdp });
  api.sendToClient(clientId, { type: 'offer', sdp });
}

function cleanupPeerConnection(clientId: string): void {
  const pc = peerConnections.get(clientId);
  if (pc) {
    pc.close();
    peerConnections.delete(clientId);
  }
}

function cleanupAllPeerConnections(): void {
  for (const clientId of [...peerConnections.keys()]) {
    cleanupPeerConnection(clientId);
  }
}

async function handleSignalingMessage(clientId: string, message: SignalingMessage): Promise<void> {
  const pc = peerConnections.get(clientId);
  if (!pc) return;
  try {
    if (message.type === 'answer') {
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: message.sdp })
      );
    } else if (message.type === 'ice-candidate') {
      await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
  } catch (err) {
    console.error(`Broadcast signaling error for ${clientId}:`, err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function getIsBroadcastRunning(): boolean { return isBroadcastRunning; }
export function setBroadcastStateCallback(cb: () => void): void { broadcastStateCallback = cb; }

export async function initBroadcast(): Promise<void> {
  const ip = await api.getLocalIP();
  $('bc-server-ip').textContent = ip;
  await refreshBroadcastDevices();

  const settings = await api.getSettings();
  if (settings.broadcastPin) $<HTMLInputElement>('bc-pin-input').value = settings.broadcastPin;

  if (settings.broadcastInputDeviceId) {
    const select = $<HTMLSelectElement>('bc-audio-device-select');
    if ([...select.options].some((o) => o.value === settings.broadcastInputDeviceId))
      select.value = settings.broadcastInputDeviceId;
  }

  if (settings.broadcastBitrate !== undefined) {
    const bitrateSelect = $<HTMLSelectElement>('bc-audio-bitrate-select');
    if ([...bitrateSelect.options].some((o) => parseInt(o.value, 10) === settings.broadcastBitrate))
      bitrateSelect.value = String(settings.broadcastBitrate);
  }

  maxClientsDisplay = settings.maxClients ?? 4;
  $<HTMLInputElement>('bc-max-clients-input').value = String(maxClientsDisplay);
  const countEl = document.getElementById('bc-client-count');
  if (countEl) countEl.textContent = `0 / ${maxClientsDisplay}`;
}

function setPinControlsEnabled(enabled: boolean): void {
  $<HTMLInputElement>('bc-pin-input').disabled = !enabled;
  $<HTMLButtonElement>('bc-generate-pin').disabled = !enabled;
  $<HTMLButtonElement>('bc-clear-pin').disabled = !enabled;
  $<HTMLInputElement>('bc-max-clients-input').disabled = !enabled;
  $<HTMLButtonElement>('bc-max-clients-dec').disabled = !enabled;
  $<HTMLButtonElement>('bc-max-clients-inc').disabled = !enabled;
}

export async function startBroadcast(): Promise<void> {
  const deviceId = $<HTMLSelectElement>('bc-audio-device-select').value;
  if (!deviceId) { showToast('Select an audio source first', 'error'); return; }

  try {
    bcStream = await captureAudio(deviceId);
    setupLevelMeter(bcStream);

    const pin = $<HTMLInputElement>('bc-pin-input').value.trim() || undefined;
    const result = await api.startSignalingServer(8765, pin, maxClientsDisplay);
    if (!result.success) throw new Error(result.error || 'Failed to start broadcast server');

    isBroadcastRunning = true;
    broadcastStateCallback?.();
    setPinControlsEnabled(false);
    $<HTMLButtonElement>('btn-start-broadcast').style.display = 'none';
    $<HTMLButtonElement>('btn-stop-broadcast').style.display = 'flex';
    setStatus('bc-status-badge', 'waiting', 'Waiting for clients...');
    showToast(`Broadcast ready — up to ${maxClientsDisplay} clients`, 'success');

    api.onClientConnected(async (clientId, clientIp, clientMac, deviceName) => {
      clientInfoMap.set(clientId, { ip: clientIp, mac: clientMac, deviceName });
      updateStatusBadge();
      renderBcClients();
      showToast('Client connected', 'success');
      await setupPeerConnection(clientId);
    });

    api.onClientDisconnected((clientId) => {
      clientInfoMap.delete(clientId);
      cleanupPeerConnection(clientId);
      updateStatusBadge();
      renderBcClients();
      showToast('Client disconnected', 'error');
    });

    api.onSignalingMessage(async (clientId, message) => {
      await handleSignalingMessage(clientId, message);
    });
  } catch (err) {
    showToast(`Failed to start broadcast: ${(err as Error).message}`, 'error');
    stopBroadcast();
  }
}

export async function stopBroadcast(): Promise<void> {
  isBroadcastRunning = false;
  broadcastStateCallback?.();
  api.removeAllListeners('signaling-message');
  api.removeAllListeners('client-connected');
  api.removeAllListeners('client-disconnected');
  clientInfoMap.clear();
  cleanupAllPeerConnections();

  bcStream?.getTracks().forEach((t) => t.stop());
  bcStream = null;

  if (bcAudioContext) { bcAudioContext.close(); bcAudioContext = null; }
  if (bcAnimFrame !== null) cancelAnimationFrame(bcAnimFrame);

  await api.stopSignalingServer();

  setPinControlsEnabled(true);
  $<HTMLButtonElement>('btn-start-broadcast').style.display = 'flex';
  $<HTMLButtonElement>('btn-stop-broadcast').style.display = 'none';
  $<HTMLDivElement>('bc-level-bar').style.width = '0%';
  setStatus('bc-status-badge', 'idle', 'Idle');
  const countEl = document.getElementById('bc-client-count');
  if (countEl) countEl.textContent = `0 / ${maxClientsDisplay}`;
  renderBcClients();
}

// ─── Event listeners ──────────────────────────────────────────────────────────
$<HTMLInputElement>('bc-pin-input').addEventListener('change', async () => {
  const pin = $<HTMLInputElement>('bc-pin-input').value.replace(/\D/g, '').slice(0, 6);
  $<HTMLInputElement>('bc-pin-input').value = pin;
  await api.saveSettings({ broadcastPin: pin });
});

$('bc-generate-pin').addEventListener('click', async () => {
  const pin = String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
  $<HTMLInputElement>('bc-pin-input').value = pin;
  await api.saveSettings({ broadcastPin: pin });
});

$('bc-clear-pin').addEventListener('click', async () => {
  $<HTMLInputElement>('bc-pin-input').value = '';
  await api.saveSettings({ broadcastPin: '' });
});

$('bc-refresh-devices').addEventListener('click', refreshBroadcastDevices);
$('btn-start-broadcast').addEventListener('click', startBroadcast);
$('btn-stop-broadcast').addEventListener('click', stopBroadcast);

$<HTMLSelectElement>('bc-audio-device-select').addEventListener('change', async (e) => {
  const deviceId = (e.target as HTMLSelectElement).value;
  if (!deviceId) return;
  await api.saveSettings({ broadcastInputDeviceId: deviceId });
  if (!isBroadcastRunning) return;
  try {
    const newStream = await captureAudio(deviceId);
    bcStream?.getTracks().forEach((t) => t.stop());
    bcStream = newStream;
    setupLevelMeter(bcStream);
    const audioTrack = bcStream.getAudioTracks()[0];
    for (const pc of peerConnections.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender && audioTrack) {
        try { await sender.replaceTrack(audioTrack); } catch { /* pc may be closing */ }
      }
    }
    showToast('Audio source changed', 'success');
  } catch {
    showToast('Could not switch audio source', 'error');
  }
});

$<HTMLSelectElement>('bc-audio-bitrate-select').addEventListener('change', async (e) => {
  const maxBitrate = parseInt((e.target as HTMLSelectElement).value, 10);
  await api.saveSettings({ broadcastBitrate: maxBitrate });
  if (!isBroadcastRunning || peerConnections.size === 0) return;
  for (const pc of peerConnections.values()) {
    if (pc.connectionState === 'closed') continue;
    try {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender) {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = maxBitrate;
        await sender.setParameters(params);
      }
    } catch { /* skip closed pc */ }
  }
  showToast(`Bitrate set to ${maxBitrate / 1000} kbps`, 'success');
});

function applyMaxClients(value: number): void {
  const clamped = Math.max(1, Math.min(10, value));
  $<HTMLInputElement>('bc-max-clients-input').value = String(clamped);
  maxClientsDisplay = clamped;
  api.saveSettings({ maxClients: clamped });
  const countEl = document.getElementById('bc-client-count');
  if (countEl) countEl.textContent = `${peerConnections.size} / ${maxClientsDisplay}`;
}

$<HTMLInputElement>('bc-max-clients-input').addEventListener('change', (e) => {
  const raw = parseInt((e.target as HTMLInputElement).value, 10);
  applyMaxClients(isNaN(raw) ? 4 : raw);
});

$('bc-max-clients-dec').addEventListener('click', () => applyMaxClients(maxClientsDisplay - 1));
$('bc-max-clients-inc').addEventListener('click', () => applyMaxClients(maxClientsDisplay + 1));
