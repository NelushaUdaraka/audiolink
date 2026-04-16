# AudioLink 🎧

[![GitHub release](https://img.shields.io/github/v/release/NelushaUdaraka/audiolink)](https://github.com/NelushaUdaraka/audiolink/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/NelushaUdaraka/audiolink/release.yml)](https://github.com/NelushaUdaraka/audiolink/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AudioLink is a high-performance, low-latency audio streaming utility for your local network. Built with Electron, it lets you stream system audio or microphone input from one Windows device to one or many others with minimal delay.

## ⬇️ Download

Grab the latest Windows installer from the [Releases](https://github.com/NelushaUdaraka/audiolink/releases/latest) page.

## ✨ Key Features

- **🚀 Ultra-Low Latency**: Powered by WebRTC DataChannels and the Web Audio API for near-instantaneous streaming.
- **📡 Three Streaming Modes**: Server (1-to-1), Broadcast (1-to-many), and Client modes.
- **🔊 Volume Boost**: Integrated `GainNode` allows audio amplification up to **300%** to fix quiet sources.
- **📉 Dynamic Bitrate**: Selectable audio quality from **64 kbps** (efficiency) up to **512 kbps** (high quality).
- **🔍 Auto-Discovery**: Automatically finds active servers on the local network via UDP — no IP addresses to memorize.
- **🔒 PIN Protection**: Optional PIN lock on Server and Broadcast modes to restrict who can connect.
- **🚫 Client Blacklisting**: Ban specific devices from reconnecting by MAC address.
- **⏱️ Latency Monitoring**: Real-time RTT and Jitter Buffer stats for smooth playback diagnostics.
- **⌨️ Global Hotkeys**: System-wide shortcuts for mute, volume up/down, and disconnect.
- **🔄 Auto-Update**: Automatically checks for and installs new releases from GitHub.
- **💾 Smart Persistence**: Remembers your last connected IP, port, audio device, and settings across reboots.
- **🎨 Appearance Controls**: Adjustable window opacity and dark/light theme toggle.
- **📱 Compact UI**: Modern, translucent interface designed to sit neatly on your desktop.
- **🛠️ Professional Installer**: Easy deployment via an NSIS-based Windows Setup wizard with per-user install support.

## 📝 Usage

### Server Mode (1-to-1)
1. Click **Server** on the main menu.
2. Select your **Audio Source** (system audio or microphone).
3. Choose your desired **Audio Quality** and optionally set a **PIN**.
4. Click **Start Streaming**.
5. Clients on the same network will discover you automatically, or connect manually using the displayed IP.

### Broadcast Mode (1-to-many)
1. Click **Broadcast** on the main menu.
2. Select your **Audio Source** and set the maximum number of simultaneous clients (1–10).
3. Optionally set a **PIN** to restrict access.
4. Click **Start Broadcasting**.
5. All clients that connect will receive the same audio stream simultaneously.

### Client Mode
1. Click **Client** on the main menu.
2. The app automatically scans for active servers via UDP discovery.
3. Click a **Discovered Server** to connect instantly.
4. If discovery is blocked by a firewall, switch to the **Manual IP** tab and enter the server's IP and port.
5. Adjust the **Volume** slider as needed (supports up to 300% boost).

### Settings
- **Theme**: Switch between dark and light mode.
- **Opacity**: Adjust window transparency (20%–100%).
- **Close to tray**: Keep AudioLink running in the system tray when the window is closed.
- **Global Hotkeys**: Bind system-wide shortcuts for mute, volume up/down, and disconnect.
- **Auto-Update**: Toggle automatic update checks (enabled by default).
- **Export / Import**: Back up and restore all settings as a JSON file.

## 🚀 Development

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [npm](https://www.npmjs.com/)

### Setup

```bash
git clone https://github.com/NelushaUdaraka/audiolink.git
cd audiolink
npm install
npm run dev
```

### Build

```bash
# Compile only
npm run build

# Create Windows installer (dist/AudioLink-Setup-x.x.x.exe)
npm run make
```

### Release

Push a version tag to trigger the GitHub Actions release workflow:

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Runtime | [Electron](https://www.electronjs.org/) |
| Build | [electron-vite](https://evite.netlify.app/) + [Vite](https://vitejs.dev/) |
| Language | [TypeScript](https://www.typescriptlang.org/) |
| Streaming | [WebRTC](https://webrtc.org/) + [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) |
| Signaling | WebSocket (`ws`) |
| Discovery | Node.js `dgram` (UDP) |
| Auto-Update | [electron-updater](https://www.electron.build/auto-update) |
| Installer | [electron-builder](https://www.electron.build/) NSIS |

## 🛡️ License

MIT — see [LICENSE](LICENSE) for details.
