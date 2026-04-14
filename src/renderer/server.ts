import { api, $, showToast, setStatus } from './utils';
import type { SignalingMessage } from '../types';

let serverStream: MediaStream | null = null;
let serverPeerConnection: RTCPeerConnection | null = null;
let serverAudioContext: AudioContext | null = null;
let serverAnalyser: AnalyserNode | null = null;
let serverAnimFrame: number | null = null;
let isServerRunning = false;
let serverStateCallback: (() => void) | null = null;
let serverClientIp: string | null = null;
let serverClientMac: string | null = null;
let serverClientDeviceName: string | null = null;
let serverClientId: string | null = null;
let blacklistChangedCallback: (() => void) | null = null;

export function setBlacklistChangedCallback(cb: () => void): void { blacklistChangedCallback = cb; }

// ─── Device enumeration ───────────────────────────────────────────────────────
export async function refreshDevices(): Promise<void> {
  const select = $<HTMLSelectElement>('audio-device-select');
  const previousValue = select.value;
  select.innerHTML = '';

  const systemOpt = document.createElement('option');
  systemOpt.value = '__system_audio__';
  systemOpt.textContent = '🔊 System Audio (Loopback)';
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
    console.error('Error enumerating devices:', err);
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
  if (serverAudioContext) serverAudioContext.close();
  if (serverAnimFrame !== null) cancelAnimationFrame(serverAnimFrame);

  serverAudioContext = new AudioContext();
  const source = serverAudioContext.createMediaStreamSource(stream);
  serverAnalyser = serverAudioContext.createAnalyser();
  serverAnalyser.fftSize = 256;
  serverAnalyser.smoothingTimeConstant = 0.5;
  source.connect(serverAnalyser);

  const dataArray = new Uint8Array(serverAnalyser.frequencyBinCount);
  const bar = $<HTMLDivElement>('server-level-bar');

  const tick = (): void => {
    if (!serverAnalyser) return;
    serverAnalyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    bar.style.width = `${Math.min(100, (avg / 128) * 100)}%`;
    serverAnimFrame = requestAnimationFrame(tick);
  };
  tick();
}

// ─── Peer connection ──────────────────────────────────────────────────────────
async function setupPeerConnection(clientId: string): Promise<void> {
  cleanupPeerConnection();

  serverPeerConnection = new RTCPeerConnection({ iceServers: [] });

  serverStream?.getAudioTracks().forEach((track) => {
    serverPeerConnection!.addTrack(track, serverStream!);
  });

  serverPeerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      api.sendToClient(clientId, { type: 'ice-candidate', candidate: event.candidate.toJSON() });
    }
  };

  serverPeerConnection.onconnectionstatechange = () => {
    const state = serverPeerConnection?.connectionState;
    if (state === 'connected') {
      setStatus('server-status-badge', 'streaming', 'Streaming');
      const bitrate = parseInt($<HTMLSelectElement>('audio-bitrate-select').value, 10);
      const sender = serverPeerConnection?.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender) {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = bitrate;
        sender.setParameters(params).catch(() => {});
      }
    } else if (state === 'disconnected' || state === 'failed') {
      setStatus('server-status-badge', 'waiting', 'Waiting for client...');
    }
  };

  const bitrateSelect = $<HTMLSelectElement>('audio-bitrate-select');
  const maxBitrate = Math.min(parseInt(bitrateSelect?.value ?? '128000', 10), 510000);
  const maxBitrateKbps = Math.ceil(maxBitrate / 1000);
  const offer = await serverPeerConnection.createOffer();
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

  await serverPeerConnection.setLocalDescription({ type: 'offer', sdp });
  api.sendToClient(clientId, { type: 'offer', sdp });
}

function cleanupPeerConnection(): void {
  if (serverPeerConnection) { serverPeerConnection.close(); serverPeerConnection = null; }
}

async function handleSignalingMessage(message: SignalingMessage): Promise<void> {
  if (!serverPeerConnection) return;
  try {
    if (message.type === 'answer') {
      await serverPeerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: message.sdp })
      );
    } else if (message.type === 'ice-candidate') {
      await serverPeerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
  } catch (err) {
    console.error('Error handling signaling message:', err);
  }
}

// ─── Client list ──────────────────────────────────────────────────────────────
function renderServerClients(): void {
  const list = document.getElementById('server-clients-list');
  if (!list) return;
  list.innerHTML = '';
  if (!serverClientIp || !serverClientId) {
    const empty = document.createElement('div');
    empty.className = 'clients-empty';
    empty.textContent = 'No client connected';
    list.appendChild(empty);
    return;
  }
  const card = document.createElement('div');
  card.className = 'client-card';
  const displayName = serverClientDeviceName ?? serverClientIp;
  const metaText = serverClientMac
    ? `${serverClientIp} · ${serverClientMac}`
    : serverClientIp;
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
  const capturedId = serverClientId;
  card.querySelector<HTMLButtonElement>('.client-card-btn--ban')!
    .addEventListener('click', async () => {
      if (capturedId) {
        await api.blacklistClient(capturedId);
        blacklistChangedCallback?.();
      }
    });
  card.querySelector<HTMLButtonElement>('.client-card-btn--kick')!
    .addEventListener('click', () => {
      if (serverClientId) api.disconnectClient(serverClientId);
    });
  list.appendChild(card);
}


// ─── Public API ───────────────────────────────────────────────────────────────
export function getIsServerRunning(): boolean { return isServerRunning; }
export function setServerStateCallback(cb: () => void): void { serverStateCallback = cb; }

export async function initServer(): Promise<void> {
  const ip = await api.getLocalIP();
  $('server-ip').textContent = ip;
  await refreshDevices();

  const settings = await api.getSettings();
  if (settings.serverPin) $<HTMLInputElement>('server-pin-input').value = settings.serverPin;

  if (settings.inputDeviceId) {
    const select = $<HTMLSelectElement>('audio-device-select');
    if ([...select.options].some((o) => o.value === settings.inputDeviceId))
      select.value = settings.inputDeviceId;
  }

  if (settings.bitrate !== undefined) {
    const bitrateSelect = $<HTMLSelectElement>('audio-bitrate-select');
    if ([...bitrateSelect.options].some((o) => parseInt(o.value, 10) === settings.bitrate))
      bitrateSelect.value = String(settings.bitrate);
  }
}

function setPinControlsEnabled(enabled: boolean): void {
  $<HTMLInputElement>('server-pin-input').disabled = !enabled;
  $<HTMLButtonElement>('btn-generate-pin').disabled = !enabled;
  $<HTMLButtonElement>('btn-clear-pin').disabled = !enabled;
}

export async function startServer(): Promise<void> {
  const deviceId = $<HTMLSelectElement>('audio-device-select').value;
  if (!deviceId) { showToast('Select an audio source first', 'error'); return; }

  try {
    serverStream = await captureAudio(deviceId);
    setupLevelMeter(serverStream);

    const pin = $<HTMLInputElement>('server-pin-input').value.trim() || undefined;
    const result = await api.startSignalingServer(8765, pin, 1);
    if (!result.success) throw new Error(result.error || 'Failed to start signaling server');

    isServerRunning = true;
    serverStateCallback?.();
    setPinControlsEnabled(false);
    $<HTMLButtonElement>('btn-start-server').style.display = 'none';
    $<HTMLButtonElement>('btn-stop-server').style.display = 'flex';
    setStatus('server-status-badge', 'waiting', 'Waiting for client...');
    showToast('Server ready — share your IP with the client', 'success');

    api.onClientConnected(async (clientId, clientIp, clientMac, deviceName) => {
      serverClientId = clientId;
      serverClientIp = clientIp;
      serverClientMac = clientMac;
      serverClientDeviceName = deviceName;
      setStatus('server-status-badge', 'connected', 'Client connected');
      showToast('Client connected', 'success');
      renderServerClients();
      await setupPeerConnection(clientId);
    });

    api.onClientDisconnected((_clientId) => {
      serverClientId = null;
      serverClientIp = null;
      serverClientMac = null;
      serverClientDeviceName = null;
      renderServerClients();
      setStatus('server-status-badge', 'waiting', 'Waiting for client...');
      showToast('Client disconnected', 'error');
      cleanupPeerConnection();
    });

    api.onSignalingMessage(async (_clientId, message) => {
      await handleSignalingMessage(message);
    });
  } catch (err) {
    showToast(`Failed to start server: ${(err as Error).message}`, 'error');
    stopServer();
  }
}

export async function stopServer(): Promise<void> {
  isServerRunning = false;
  serverStateCallback?.();
  api.removeAllListeners('signaling-message');
  api.removeAllListeners('client-connected');
  api.removeAllListeners('client-disconnected');
  serverClientId = null;
  serverClientIp = null;
  serverClientMac = null;
  serverClientDeviceName = null;
  cleanupPeerConnection();

  serverStream?.getTracks().forEach((t) => t.stop());
  serverStream = null;

  if (serverAudioContext) { serverAudioContext.close(); serverAudioContext = null; }
  if (serverAnimFrame !== null) cancelAnimationFrame(serverAnimFrame);

  await api.stopSignalingServer();

  setPinControlsEnabled(true);
  $<HTMLButtonElement>('btn-start-server').style.display = 'flex';
  $<HTMLButtonElement>('btn-stop-server').style.display = 'none';
  $<HTMLDivElement>('server-level-bar').style.width = '0%';
  setStatus('server-status-badge', 'idle', 'Idle');
  renderServerClients();
}

// ─── Event listeners ──────────────────────────────────────────────────────────
$<HTMLInputElement>('server-pin-input').addEventListener('change', async () => {
  const pin = $<HTMLInputElement>('server-pin-input').value.replace(/\D/g, '').slice(0, 6);
  $<HTMLInputElement>('server-pin-input').value = pin;
  await api.saveSettings({ serverPin: pin });
});

$('btn-generate-pin').addEventListener('click', async () => {
  const pin = String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
  $<HTMLInputElement>('server-pin-input').value = pin;
  await api.saveSettings({ serverPin: pin });
});

$('btn-clear-pin').addEventListener('click', async () => {
  $<HTMLInputElement>('server-pin-input').value = '';
  await api.saveSettings({ serverPin: '' });
});

$('btn-refresh-devices').addEventListener('click', refreshDevices);
$('btn-start-server').addEventListener('click', startServer);
$('btn-stop-server').addEventListener('click', stopServer);

$<HTMLSelectElement>('audio-device-select').addEventListener('change', async (e) => {
  const deviceId = (e.target as HTMLSelectElement).value;
  if (!deviceId) return;

  await api.saveSettings({ inputDeviceId: deviceId });

  if (!isServerRunning) return;
  try {
    const newStream = await captureAudio(deviceId);
    serverStream?.getTracks().forEach((t) => t.stop());
    serverStream = newStream;
    setupLevelMeter(serverStream);

    if (serverPeerConnection) {
      const audioTrack = serverStream.getAudioTracks()[0];
      const sender = serverPeerConnection.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender && audioTrack) await sender.replaceTrack(audioTrack);
    }
    showToast('Audio source changed', 'success');
  } catch {
    showToast('Could not switch audio source', 'error');
  }
});

$<HTMLSelectElement>('audio-bitrate-select').addEventListener('change', async (e) => {
  const maxBitrate = parseInt((e.target as HTMLSelectElement).value, 10);
  await api.saveSettings({ bitrate: maxBitrate });

  if (!isServerRunning || !serverPeerConnection) return;
  try {
    const sender = serverPeerConnection.getSenders().find((s) => s.track?.kind === 'audio');
    if (sender) {
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrate;
      await sender.setParameters(params);
      showToast(`Bitrate set to ${maxBitrate / 1000} kbps`, 'success');
    }
  } catch {
    showToast('Could not update bitrate', 'error');
  }
});
