# AudioLink 🎧

AudioLink is a high-performance, low-latency audio streaming utility for your local network. Built with Electron, it allows you to stream system audio or microphone input from one Windows device (Server) to another (Client) with minimal delay.

## ✨ Key Features

- **🚀 Ultra-Low Latency**: Powered by WebRTC DataChannels and the Web Audio API for near-instantaneous streaming.
- **🔊 Volume Boost**: Integrated `GainNode` allows for audio amplification up to **300%** to fix quiet audio sources.
- **📉 Dynamic Bitrate**: Selectable audio quality from **64 kbps** (efficiency) up to **512 kbps** (lossless-like quality).
- **📡 Auto-Discovery**: Automatically find active servers on your local network using UDP broadcasting—no need to memorize IP addresses.
- **⏱️ Latency Monitoring**: Real-time stats showing Round Trip Time (RTT) and Jitter Buffer delay to ensure a smooth experience.
- **💾 Smart Persistence**: Remembers your last manually connected IP and port across reboots.
- **📱 Compact UI**: Modern, translucent, and compact interface designed to sit neatly on your desktop.
- **🛠️ Professional Installer**: Easy deployment via a professional NSIS-based Windows Setup wizard.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/audiolink.git
   cd audiolink
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run in development mode**:
   ```bash
   npm run dev
   ```

## 📦 Building the Application

### Production Build
To compile the frontend and main process code:
```bash
npm run build
```

### Create Windows Installer
To generate a professional NSIS installer (`.exe`) in the `dist/` directory:
```bash
npm run make
```

## 🛠️ Technology Stack

- **Core**: [Electron](https://www.electronjs.org/)
- **Build Engine**: [electron-vite](https://evite.netlify.app/)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Streaming**: [WebRTC](https://webrtc.org/) & [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- **Networking**: Node.js `dgram` for UDP Discovery

## 📝 Usage

### Server Mode
1. Click **Server** on the main menu.
2. Select your **Audio Source** (e.g., "System Audio" or a "Microphone").
3. Choose your desired **Audio Quality**.
4. Click **Start Streaming**.
5. Your IP address will be displayed for manual connection, but clients on the same network will find you automatically!

### Client Mode
1. Click **Client** on the main menu.
2. The app will automatically search for active servers.
3. Click on a **Discovered Server** to connect instantly.
4. (Advanced) If discovery is blocked by a firewall, switch to the **Manual IP** tab and enter the server's IP.
5. Adjust the **Volume** slider as needed (supports up to 300% boost).

## 🛡️ License

This project is licensed under the MIT License.
