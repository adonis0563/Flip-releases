# Flip — Official Releases (Android & Windows)

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Android%20%7C%20Windows-black?style=for-the-badge&logo=windows&logoColor=white" alt="Platforms" />
  <img src="https://img.shields.io/badge/Version-v1.0.0-black?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/Cloud%20Upload-Zero%20(100%25%20Local)-success?style=for-the-badge" alt="Zero Cloud" />
  <img src="https://img.shields.io/badge/License-Proprietary%20Freeware-blue?style=for-the-badge" alt="License" />
</p>

**Flip** is a high-speed, direct peer-to-peer file, folder, and clipboard text sharing application for **Android** and **Windows 10/11**.

It transfers files of any size, entire directory trees, and clipboard text directly between nearby devices—**Phone-to-Phone**, **Phone-to-PC**, and **PC-to-PC**—with **zero internet connection, zero cloud servers, zero account creation, and zero tracking**.

---

## 📥 Downloads (Latest: v1.0.0)

Download the official binaries directly from the [**GitHub Releases**](https://github.com/adonis0563/flip-releases/releases/latest) page:

| Platform | Package | Format | Compatibility |
| :--- | :--- | :--- | :--- |
| **Android** | [**`Flip.apk`**](https://github.com/adonis0563/flip-releases/releases/latest) | `.apk` (~77.5 MB) | Android 10+ (API 29–36) |
| **Windows (Installer)** | [**`Flip-Setup-1.0.0.exe`**](https://github.com/adonis0563/flip-releases/releases/latest) | Setup Wizard (~69.2 MB) | Windows 10 / 11 (x64, Self-contained) |
| **Windows (Portable)** | [**`Flip.exe`**](https://github.com/adonis0563/flip-releases/releases/latest) | Standalone `.exe` (~74.7 MB) | Windows 10 / 11 (x64, No install needed) |
| **Launch Promo Video** | [**`Flip-Promo-Ad.mp4`**](https://github.com/adonis0563/flip-releases/releases/latest) | 1080p Video (~14.7 MB) | 20s Product Overview with Soundtrack |

---

## ✨ Features at a Glance

- **Seamless Cross-Platform Sharing**: Direct bidirectional transfers between Android phones and Windows PCs, Android-to-Android, and Windows-to-Windows.
- **Proximity Pairing (BLE & Dynamic QR)**:
  - **Bluetooth Low Energy (BLE)**: Nearby devices discover each other automatically without high battery drain (`0xFD01` / `0xFD02`).
  - **Dynamic QR Codes**: Pair instantly across Wi-Fi or Hotspots by scanning the sender's screen with the built-in camera or webcam scanner.
- **Hardware-Speed Streaming Engine**:
  - Streams large files directly to disk in `64 KB` chunks. No RAM buffering limits; transfers move at full local Wi-Fi speeds (typically `30–60+ MB/s`).
- **Recursive Folder & Batch Transfers**:
  - Select and send complete folders with nested subdirectories (`X-Relative-Path`).
  - **1-Tap Batch Approval**: When receiving a folder or batch of files, Flip shows a single confirmation prompt (`POST /batch-request`) rather than interrupting you for every file.
- **Safe Resumption (`.partial` & `.offset`)**:
  - If a connection drops, Flip preserves confirmed byte checkpoints on disk. Resuming reconnects and streams only the remaining bytes without duplicate files or corruption.
- **Instant Shared Clipboard**:
  - Send text notes, links, or addresses directly to the peer's clipboard with one click.
- **Device-Organized History**:
  - Separate **Files** and **Text** history tabs organized by connected device (newest transactions first) with instant file opening and copy shortcuts.
- **Clean Monochrome Interface**:
  - Minimalist Light and Dark theme options, live transfer speed counter in the header, and local storage usage indicators.

---

## 🚀 Quick Setup Guide

### 1. Connect Devices to the Same Local Network
- Both devices can be on the same **home/office Wi-Fi**, **or**
- Turn on your phone's **Mobile Hotspot** (or Windows Mobile Hotspot) and connect the other device to it. *No active internet or cellular data is required.*

### 2. Pair & Connect
- Open Flip on both devices.
- Tap **Send** on one device and **Receive** on the other.
- Tap the discovered device card under **Nearby Devices** (via Bluetooth), **or** use the built-in QR scanner to scan the pairing code.

### 3. Share
- Select **Files**, **Folders**, or type/paste text to send. Both devices can send and receive back and forth simultaneously.

> [!IMPORTANT]
> **Windows Firewall Note**: When launching Flip on Windows for the first time, Windows Defender Firewall will ask for permission to allow `Flip.exe` on networks. Be sure to check **both Private and Public networks** so peer-to-peer transfers work over home routers as well as mobile hotspots.

---

## 🛡️ Privacy Guarantee

- **100% Local**: All data streams point-to-point over your local network socket.
- **Zero Cloud**: Nothing is ever uploaded to an external server.
- **Zero Accounts**: No signups, email addresses, phone numbers, or passwords.
- **Zero Analytics**: No telemetry, tracking SDKs, or background advertisements.

---

## 💬 Support & Feedback

- **Email**: [flipdevelopmentsupport@gmail.com](mailto:flipdevelopmentsupport@gmail.com)
- **Bug Reports & Feature Requests**: [GitHub Issues](https://github.com/adonis0563/flip-releases/issues)
- **Tip the Developer**: [Support Continued Development](https://paystack.shop/pay/7fx0g78vu-)

---

## 📄 License

Flip is proprietary software distributed as free-to-use software under the [FLIP PROPRIETARY FREEWARE LICENCE](LICENSE).
Copyright © 2026 Adinoyi Raji. All rights reserved.
