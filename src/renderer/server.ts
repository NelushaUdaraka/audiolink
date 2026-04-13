import { api, $, showToast, setStatus } from './utils';
import type { SignalingMessage } from '../types';

let serverStream: MediaStream | null = null;
let serverPeerConnection: RTCPeerConnection | null = null;
let serverAudioContext: AudioContext | null = null;
let serverAnalyser: AnalyserNode | null = null;
let serverAnimFrame: number | null = null;
let isServerRunning = false;
let serverStateCallback: (() => void) | null = null;

// ─── Device enumeration ───────────────────────────────────────────────────────
export async function refreshDevices(): Promise<void> {
  const select = $<HTMLSelectElement>('audio-device-select');
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
async function setupPeerConnection(): Promise<void> {
  cleanupPeerConnection();

  serverPeerConnection = new RTCPeerConnection({
    iceServers: [],  // LAN only — no STUN needed, avoids external lookup delay
  });

  serverStream?.getAudioTracks().forEach((track) => {
    serverPeerConnection!.addTrack(track, serverStream!);
  });

  serverPeerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      api.sendToClient({ type: 'ice-candidate', candidate: event.candidate.toJSON() });
    }
  };

  serverPeerConnection.onconnectionstatechange = () => {
    const state = serverPeerConnection?.connectionState;
    if (state === 'connected') setStatus('server-status-badge', 'streaming', 'Streaming');
    else if (state === 'disconnected' || state === 'failed')
      setStatus('server-status-badge', 'waiting', 'Waiting for client...');
  };

  const bitrateSelect = $<HTMLSelectElement>('audio-bitrate-select');
  const maxBitrate = bitrateSelect?.value ?? '128000';
  const offer = await serverPeerConnection.createOffer();
  let sdp = offer.sdp || '';

  // Force 5ms Opus frames (browser default is 20ms) — reduces packetization latency.
  // a=ptime is per-media-section; replace existing or insert after m=audio line.
  if (/a=ptime:\d+/.test(sdp)) {
    sdp = sdp.replace(/a=ptime:\d+/, 'a=ptime:5');
  } else {
    sdp = sdp.replace(/(m=audio[^\r\n]*[\r\n]+)/, '$1a=ptime:5\r\n');
  }

  // minptime=2  → accept frames as small as 2.5 ms
  // useinbandfec=0 → disable FEC (adds redundant data that inflates jitter buffer)
  // cbr=1        → constant bitrate gives the receiver a steady packet rhythm,
  //                letting the adaptive jitter buffer stay small
  sdp = sdp.replace(
    /a=fmtp:(\d+) (.*)/,
    `a=fmtp:$1 $2;minptime=2;useinbandfec=0;stereo=1;cbr=1;maxaveragebitrate=${maxBitrate}`
  );

  await serverPeerConnection.setLocalDescription({ type: 'offer', sdp });
  api.sendToClient({ type: 'offer', sdp });
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

// ─── Public API ───────────────────────────────────────────────────────────────
export function getIsServerRunning(): boolean { return isServerRunning; }
export function setServerStateCallback(cb: () => void): void { serverStateCallback = cb; }

export async function initServer(): Promise<void> {
  const ip = await api.getLocalIP();
  $('server-ip').textContent = ip;
  await refreshDevices();
}

export async function startServer(): Promise<void> {
  const deviceId = $<HTMLSelectElement>('audio-device-select').value;
  if (!deviceId) { showToast('Select an audio source first', 'error'); return; }

  try {
    serverStream = await captureAudio(deviceId);
    setupLevelMeter(serverStream);

    const result = await api.startSignalingServer(8765);
    if (!result.success) throw new Error(result.error || 'Failed to start signaling server');

    isServerRunning = true;
    serverStateCallback?.();
    $<HTMLButtonElement>('btn-start-server').style.display = 'none';
    $<HTMLButtonElement>('btn-stop-server').style.display = 'flex';
    setStatus('server-status-badge', 'waiting', 'Waiting for client...');
    showToast('Server ready — share your IP with the client', 'success');

    api.onClientConnected(async () => {
      setStatus('server-status-badge', 'connected', 'Client connected');
      showToast('Client connected', 'success');
      await setupPeerConnection();
    });

    api.onClientDisconnected(() => {
      setStatus('server-status-badge', 'waiting', 'Waiting for client...');
      showToast('Client disconnected', 'error');
      cleanupPeerConnection();
    });

    api.onSignalingMessage(async (message) => {
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
  cleanupPeerConnection();

  serverStream?.getTracks().forEach((t) => t.stop());
  serverStream = null;

  if (serverAudioContext) { serverAudioContext.close(); serverAudioContext = null; }
  if (serverAnimFrame !== null) cancelAnimationFrame(serverAnimFrame);

  await api.stopSignalingServer();

  $<HTMLButtonElement>('btn-start-server').style.display = 'flex';
  $<HTMLButtonElement>('btn-stop-server').style.display = 'none';
  $<HTMLDivElement>('server-level-bar').style.width = '0%';
  setStatus('server-status-badge', 'idle', 'Idle');
}

// ─── Event listeners (registered once at module load) ─────────────────────────
$('btn-refresh-devices').addEventListener('click', refreshDevices);
$('btn-start-server').addEventListener('click', startServer);
$('btn-stop-server').addEventListener('click', stopServer);

$<HTMLSelectElement>('audio-device-select').addEventListener('change', async (e) => {
  if (!isServerRunning) return;
  const deviceId = (e.target as HTMLSelectElement).value;
  if (!deviceId) return;
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
  } catch (err) {
    showToast('Could not switch audio source', 'error');
  }
});

$<HTMLSelectElement>('audio-bitrate-select').addEventListener('change', async (e) => {
  if (!isServerRunning || !serverPeerConnection) return;
  const maxBitrate = parseInt((e.target as HTMLSelectElement).value, 10);
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
