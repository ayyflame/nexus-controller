## NEXUS for Windows 11 (x64) — hardware validation build

This pre-release is for testing NEXUS on a real Windows 11 PC with a DualSense controller. No developer tools are needed.

**Download:** `NEXUS_<version>_x64-setup.exe` (recommended), or the `.msi` if you prefer Windows Installer.

### What this build does
- Detects a DualSense over USB or Bluetooth, and reconnects automatically.
- Shows live input, connection events, raw HID reports and the engine log.
- **Settings → HID Devices → Copy diagnostics report** creates a report you can share. Serial numbers and MAC addresses are masked.

### What it does not do
- It does **not** create virtual Xbox 360 / DualShock 4 controllers yet.
- It does **not** install or bundle any driver (including ViGEmBus).
- It needs no administrator rights. The `.exe` installs for the current user only.

### Install
See [docs/install-windows.md](https://github.com/ayyflame/nexus-controller/blob/main/docs/install-windows.md).

The installer is not code-signed yet, so Windows SmartScreen will warn you. Choose **More info → Run anyway**. `SHA256SUMS.txt` lists the file checksums.
