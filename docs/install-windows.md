# Installing NEXUS on Windows 11

For testers and users. **No developer tools are needed**: no Rust, Node.js, Visual Studio, Git or terminal.
(Developers who want to build from source should see [`windows-setup.md`](windows-setup.md).)

## Install

1. Get the installer, in one of these ways:
   - **Newest build (simplest):** [download `NEXUS-latest-x64-setup.exe`](https://github.com/ayyflame/nexus-controller/releases/download/latest-build/NEXUS-latest-x64-setup.exe), the same as the **Download NEXUS** button in the README. It's replaced by every new build of `main`; its checksum is on the [Latest build](https://github.com/ayyflame/nexus-controller/releases/tag/latest-build) page.
   - **A versioned release:** open the [Releases page](https://github.com/ayyflame/nexus-controller/releases) and click **`NEXUS_<version>_x64-setup.exe`** under the newest release.
   - **A specific build:** open the [Actions tab](https://github.com/ayyflame/nexus-controller/actions/workflows/windows-release.yml), click a green run, and under **Artifacts** click **NEXUS-windows-x64** (GitHub requires you to be signed in for this). This downloads a ZIP; right-click it, choose **Extract All…**, and open the extracted folder. Artifacts expire after 30 days.
2. Find the setup file in your downloads (or the extracted folder).
3. Double-click it.
4. Windows SmartScreen may show **"Windows protected your PC"**, because the installer is not code-signed yet. Click **More info**, then **Run anyway**.
5. Follow the setup wizard: **Next → Install → Finish**. No administrator password is needed, because NEXUS installs for your user account only.
6. Start **NEXUS** from the Start menu or the desktop shortcut.

NEXUS needs the Microsoft Edge WebView2 Runtime, which is already part of Windows 11. If it is somehow missing, the installer downloads it automatically.

**Alternative:** `NEXUS_0.1.0_x64_en-US.msi` is a standard Windows Installer package. It installs for all users, so Windows will ask for administrator approval.

## Test your DualSense

NEXUS supports the DualSense over **USB only**. Bluetooth is not supported.

1. Plug the controller in with a USB-C data cable. Within about a second, the dashboard shows **Connected · USB**. Move the sticks and press buttons; the diagram and values should follow.
2. Open **Settings → HID Devices (Sony) → Copy diagnostics report**. Paste it into a text file named `diagnostics-usb.txt`. Do this while the controller is connected.
3. Unplug the cable. The dashboard returns to **No controller**.
4. Plug the cable back in. NEXUS reconnects within about a second.
5. Send the file, plus anything that looked wrong. The checklist in [`tests/hardware-verification.md`](../tests/hardware-verification.md) lists what to look for.

If the controller never appears, close Steam, DS4Windows or similar tools, then click **Settings → Scan now**. Those apps can hide or lock the controller.

## Updates

NEXUS installed from a **published release** updates itself. It checks about 20 seconds after it starts and then every 6 hours. You can also use **Settings → Updates → Check for updates**.

- When a new version exists, a banner shows **Update available** with your version, the new version and the release notes. Click **Update now**, or **Remind me later** to hide it until NEXUS next starts. Nothing is installed without your OK.
- After the download, NEXUS checks the update's signature. Then click **Restart and install**: NEXUS closes, a small installer window runs without asking questions, and NEXUS reopens on the new version.
- Your profiles, macros, calibration and settings are kept. A backup copy is saved in `%APPDATA%\com.nexus.controllerengine\backups` first.
- No internet? NEXUS works normally and tries again later.
- Turn automatic checks off in **Settings → Updates**.
- Copies installed from the **.msi**, and builds downloaded from the Actions tab, don't update automatically. Install the newest `-setup.exe` from the Releases page once instead.

The installer is still not code-signed, so SmartScreen can still warn on a manual install. The update signature is a separate check and doesn't change that.

## Uninstall

**Windows Settings → Apps → Installed apps → NEXUS → Uninstall.**

Your profile database stays in `%APPDATA%\com.nexus.controllerengine`. Delete that folder for a completely clean removal.

## Games and the virtual controller

Games receive NEXUS's output through a virtual Xbox 360 controller. That needs the free ViGEmBus driver, which you install yourself; see the README's *Installation* section and [`game-output.md`](game-output.md).

## What NEXUS does not do

- It does not install, bundle or configure drivers (ViGEmBus and the optional HidHide are installed by you).
- It does not change Windows controller settings.
