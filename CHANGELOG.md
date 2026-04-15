# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.1] - 2026-04-15

### Fixed
- Auto-update release type corrected to publish immediately instead of draft

## [0.12.0] - 2026-04-15

### Added
- Auto-update enable/disable toggle in Settings
- GitHub Releases-based auto-update (replaces local update server)

### Changed
- Publish config migrated from generic HTTP server to GitHub Releases provider

## [0.11.3] - 2026-04-15

### Added
- Auto-update support via GitHub Releases using electron-updater
- Global hotkey registration for mute/unmute
- WebRTC audio streaming architecture with IPC-based signaling
- UDP-based auto-discovery of servers on the local network
- Dynamic bitrate selection from 64 kbps to 512 kbps
- Volume boost up to 300% via GainNode
- Real-time RTT and jitter buffer latency monitoring
- NSIS-based Windows installer with per-user install support
- Compact translucent UI with Server, Client, and Broadcast modes

[Unreleased]: https://github.com/NelushaUdaraka/audiolink/compare/v0.12.1...HEAD
[0.12.1]: https://github.com/NelushaUdaraka/audiolink/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/NelushaUdaraka/audiolink/compare/v0.11.3...v0.12.0
[0.11.3]: https://github.com/NelushaUdaraka/audiolink/releases/tag/v0.11.3
