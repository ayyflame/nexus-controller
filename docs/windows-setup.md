# Developer Setup on Windows 11 (build from source)

> **Just want to install and test NEXUS?** Use the installer instead: [`install-windows.md`](install-windows.md). This page is only for building from source.

This guide covers plan items 6–10: setup, environment check, build and launch, then the USB tests (NEXUS supports USB only; Bluetooth is out of scope). **Do not install ViGEmBus or any other virtual controller driver yet.** That happens only after physical input is verified and you approve the install.

## 1. Install prerequisites (one time)

1. **Visual Studio 2022 Build Tools**: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   In the installer, select the **Desktop development with C++** workload. It includes the MSVC v143 x64 compiler and a Windows 11 SDK.
2. **Rust**: https://rustup.rs → run `rustup-init.exe` and accept the defaults (`stable-x86_64-pc-windows-msvc`).
3. **Node.js 22 LTS**: https://nodejs.org (includes npm).
4. **Git**: https://git-scm.com/download/win (only needed if you clone from GitHub).
5. WebView2 is preinstalled on Windows 11.

Close and reopen your terminal afterwards so the new `PATH` takes effect.

## 2. Get the project

**From GitHub** (once the private repository exists):

```powershell
git clone https://github.com/ayyflame/nexus-controller.git
cd nexus-controller
```

**From the ZIP:** extract `nexus-controller-milestone1.zip` to a short path such as `C:\dev\` (long paths can break Rust builds), then:

```powershell
cd C:\dev\nexus-controller
```

**From the git bundle** (keeps history):

```powershell
git clone nexus-controller.bundle nexus-controller
```

## 3. Check the environment

From the repository root, in a normal (non-admin) PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1
```

Every line should say `[ OK ]`. The script is read-only. It also prints whether a DualSense is currently present and whether ViGEmBus is already installed (useful to know; do not change it).

## 4. Run the automated tests on Windows

```powershell
cargo test --workspace
```

Expected: all tests pass. **This is the first time the code compiles natively on Windows**, so report any compile error verbatim.

## 5. Build and launch

```powershell
cd apps\desktop
npm install
npm run tauri dev
```

The first build takes several minutes. The NEXUS window opens. With no controller attached, the dashboard should say **No controller**, not "Unsupported OS".

## 6. Hardware tests

Follow `tests/hardware-verification.md`, sections *Discovery and connection* and *Input parsing*, over **USB**. Rows that mention Bluetooth are out of scope.


Then go to **Settings → HID Devices (Sony) → Copy diagnostics report** while the controller is connected and you are moving a stick and pressing a button. Save the result as `diagnostics-usb.json`.

The report contains:

- What Windows reported for each Sony HID collection: paths, instance-ID chain, report lengths.
- How NEXUS classified each one: model, connection, physical/virtual.
- The last 40 raw input reports (hex) and the engine log.

Serial numbers and MAC addresses are masked, and your user folder path is not included.

## 7. Send back

1. Output of `check-env.ps1`.
2. `cargo test` summary, or any errors.
3. The two diagnostics JSON files.
4. The filled-in checklist, especially anything marked wrong.

With these, hardware-specific problems can be fixed and turned into regression tests built from your real reports (`tests/fixtures/`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Controller never appears; HID Devices list is empty | Another app hides it (HidHide, DS4Windows with "Hide DS4 controller", Steam with exclusive mode). Close them and press **Scan now**. |
| "Could not open controller: access denied" | Another app holds the controller exclusively. |
| `link.exe` or `cl.exe` not found | The Build Tools C++ workload is missing. Re-run the VS installer. |
