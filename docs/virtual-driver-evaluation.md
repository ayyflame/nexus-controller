# Virtual Controller Driver Evaluation

Status: **experimental ViGEmBus backend approved for Milestone 2 (2026-11-15). Production driver selection remains open.** Nothing is installed or bundled. The engine still ships with `UnavailableBackend`.

## Approved conditions (Milestone 1 review)

- Experimental ViGEmBus backend, supporting **both** Xbox 360 and DualShock 4 output.
- Never installed silently; **explicit user approval** is required before any driver installation.
- **Not bundled** in the production installer.
- Implemented only behind the replaceable `VirtualControllerBackend` interface.
- Its retired status and security/compatibility risks are documented (below) and surfaced in the app.
- Work starts **only after** physical DualSense input is verified on real Windows 11 hardware.

Research date: 2026-11-15. Sources were checked where the session's network allowed. `docs.nefarius.at` and `docs.lizardbyte.dev` were not reachable from the build environment, so some points rely on the projects' GitHub pages and READMEs. They are marked *(verify)*.

## Requirements recap

- Xbox 360 (XInput) **and** DualShock 4 output.
- Windows 11 x64.
- Signed driver; no test-signing mode.
- Redistributable in a commercial product, or installable by the user from the vendor.
- Usable from Rust.
- No custom kernel driver written by us.

## Candidates

### 1. ViGEmBus 1.22.0 (Nefarius Software Solutions)

| Criterion | Finding |
|---|---|
| Maintained | **No.** Retired: repository archived 2023-11-02. 1.22.0 ("It's dead, Jim") is the final release; it removed the updater and kept the driver version unchanged. No further security fixes are expected. |
| Xbox 360 output | Yes (XUSB-compatible; games see a real XInput pad). |
| DualShock 4 output | Yes. |
| Paid license | No. BSD-3-Clause. |
| Redistribution | BSD-3 permits redistribution with notice. Historically, applications (DS4Windows, Parsec and others) direct users to the official signed installer rather than repackaging the driver. We should do the same: never repackage the `.sys`. *(Verify the end-of-life statement for any added terms.)* |
| Signing | Official binaries are production-signed (earlier releases WHQL / attestation-signed). Self-built binaries are unsigned and would need our own EV certificate plus Microsoft attestation, which is not viable. |
| Windows 11 | Supported from 1.17 onwards (x64 and ARM64 in 1.19+). |
| Rust API | Yes. `vigem-client` 0.1.4 (MIT, pure Rust, talks to the bus via IOCTLs, no C dependency). `vigem` and `vigem-rust` crates also exist. |
| Install / removal | Official MSI/EXE installer, requires admin once. Removed via *Apps & features*. In-place upgrade from older versions is reported to require running setup twice. |
| Risks | No future fixes for Windows changes or vulnerabilities. Some anti-cheat systems flag or block ViGEm devices. The installed base is large, so it is often already present. |

### 2. LizardByte libvirtualhid (+ its Windows UMDF driver)

| Criterion | Finding |
|---|---|
| Maintained | **Yes.** Actively developed (2026 commits; third-party driver DB lists a driver dated 2026-09). |
| Xbox 360 output | Yes on Windows, via a broker-owned XUSB "software-device personality". The project itself warns that the XUSB contract is undocumented and must be regression-tested on each Windows release. |
| DualShock 4 output | Listed as a profile in the cross-platform API (DS4, DualSense, Xbox One/Series, Switch Pro, generic). The Windows driver page does not specifically confirm DS4 *(verify)*. On Windows, non-Xbox profiles are presented as virtual HID devices. |
| Paid license | **Yes on Windows.** The core library is MIT, but the Windows UMDF driver, the broker and the package are under the *LizardByte Source-Available License 1.0*. Creating driver-backed devices on Windows needs a per-machine license (yearly or lifetime), validated online every 24 h (lifetime licenses can work offline after activation). |
| Redistribution | Not stated for third parties *(verify with LizardByte)*. The licensing model implies a commercial agreement would be needed. |
| Signing | Production-signed MSI (AMD64 only; ARM64 not yet available). |
| Windows 11 | Targets Windows 11 21H2+ (Windows 10 2004+ best effort). |
| Rust API | **None.** C++ API (`lvh::Runtime`); the broker IPC protocol is not documented. Rust would need a C++ shim via FFI. |
| Install / removal | MSI installs a user-mode UMDF2 driver, a broker service and `virtualhid_control.exe`. No kernel-mode driver. Admin needed to install. |
| Risks | Recurring per-user cost; online license validation; XUSB path relies on undocumented behaviour; C++ FFI and build complexity; young project. |

### 3. Other options considered

| Option | Verdict |
|---|---|
| **Our own UMDF2 + Virtual HID Framework (VHF) driver** | User-mode (not a kernel driver), Microsoft-documented, can present DS4-compatible HID. **Cannot present a true Xbox 360 XInput device** (XUSB is not HID). Needs an EV certificate and attestation signing. A large project; reasonable as a long-term DS4/HID path only. |
| **Windows.Gaming.Input / GameInput injection** | No public API for injecting virtual gamepads system-wide. Not viable. |
| **vJoy** | DirectInput-only generic joystick; neither XInput nor DS4. Not viable. |
| **ScpToolkit / ScpVBus** | Abandoned long ago and superseded by ViGEm. Not viable. |
| **HidHide** (Nefarius) | Not an output driver, but relevant: it hides the *physical* DualSense from games so they don't see two controllers. Also retired *(verify)*. Needed with any output option; see Milestone 2. |
| **reWASD / DSX / Steam Input** | Commercial products or closed platforms, not embeddable. |

## Comparison

| | ViGEmBus 1.22 | libvirtualhid | Own VHF driver |
|---|---|---|---|
| Maintained | ✗ retired | ✓ | (us) |
| Xbox 360 | ✓ | ✓ (undocumented XUSB) | ✗ |
| DualShock 4 | ✓ | ? (HID profile) | ✓ |
| Free | ✓ BSD-3 | ✗ per-machine license | ✓ (+ signing costs) |
| Signed binaries available | ✓ | ✓ | ✗ (we would sign) |
| Rust API | ✓ pure Rust | ✗ C++ only | (we would write) |
| Kernel-mode | ✓ (bus driver) | ✗ user-mode | ✗ user-mode |

## Recommendation (for approval)

**No candidate meets every requirement.** The only one that provides both output modes for free today, with a Rust API, is ViGEmBus, and it is unmaintained. The proposed approach:

1. **Implement a `ViGEmBackend`** behind the existing `VirtualControllerBackend` interface, using `vigem-client` (pure Rust, MIT).
   - **Do not bundle** the driver. Detect whether ViGEmBus is present and show its status.
   - If it is missing, explain and link the user to the official signed release; never install silently.
   - Treat ViGEmBus as a **documented-risk dependency**, not a long-term foundation.
2. **Keep the backend replaceable** (already in place) and track libvirtualhid. Evaluate a commercial or licensed `LibVirtualHidBackend` (via a small C++ shim) once licensing, DS4 support on Windows and the IPC story are confirmed directly with LizardByte.
3. **Before release**, test anti-cheat interaction for target games with each backend, and decide on physical-device hiding (HidHide or an alternative).

**Explicit approval is requested** to proceed with step 1 in Milestone 2, given that ViGEmBus is retired. If the risk is not acceptable, the alternative is to start a LizardByte licensing conversation and accept a C++ FFI layer and per-machine license cost.

## Long-term update (2026-11-20): what could replace ViGEmBus

NEXUS's virtual output still uses **ViGEmBus 1.22.0**, unchanged. This section records what exists now, so the decision can be made with evidence when it is needed. Sources are listed at the end. Points that come only from third-party pages are marked *(secondary)*.

### Why this is hard

Games read an Xbox 360 controller through XInput, which talks to Microsoft's `xusb22` driver for a **USB** device. A virtual Xbox 360 pad therefore has to appear as a USB device. That needs either a kernel bus driver (ViGEmBus) or a virtual USB host (USB/IP). Windows' built-in Virtual HID Framework (VHF) creates HID devices only. An Xbox 360 pad is not HID, so VHF-based drivers can't produce one: the libvirtualhid docs state their Windows driver rejects the Xbox 360 profile for exactly this reason.

### Candidates

| | ViGEmBus 1.22.0 (current) | VIIPER + usbip-win2 | LizardByte libvirtualhid (Windows driver) | Steam Input |
|---|---|---|---|---|
| Maintained | **No**: archived Nov 2023; no fixes for Windows changes | Yes (active project) | Yes | Yes |
| Xbox 360 on Windows | Yes | Yes (listed device: Xbox 360) | **No**: Xbox 360 profile rejected on Windows; offers Xbox One/Series HID-style profiles instead | Only for games launched through Steam |
| How it works | Kernel bus driver; `vigem-client` crate talks to it directly | A user-space VIIPER server emulates the USB device; usbip-win2 (a kernel USB/IP driver) attaches it to Windows | UMDF (user-mode) driver on VHF | Valve hooks the game's controller APIs; no driver |
| Licence | BSD-3-Clause | VIIPER: GPL-3.0; client libraries (incl. a Rust client) MIT. usbip-win2: BSD-2-Clause (nefarius fork) *(secondary; check the LICENSE files)* | MIT library; **Windows driver source-available (LB-SAL 1.0) and needs a paid licence for gamepads** | Proprietary (Steam) |
| Install | User installs the signed setup once | User installs usbip-win2 (driver) and runs the VIIPER server; NEXUS would talk to it over a local socket | Signed MSI; licence key | Steam installed and running |
| Distribution | NEXUS doesn't bundle it (correct) | Talking to a separate GPL program over a socket with the MIT client keeps NEXUS MIT; bundling VIIPER itself would need GPL compliance for that part | Paid | n/a |
| Anti-cheat | Some anti-cheat flags ViGEm devices | Unknown; also a virtual device | Unknown | Widely accepted |
| Risk | Unfixable crashes or Windows breakage, and nothing to fall back to | Two moving parts (server + driver); not yet tested with NEXUS | No Xbox 360 output; paid | Not a general solution |

Reports that DS4Windows moved to VIIPER as its only backend come from third-party pages *(secondary)*. They show the approach is viable but are not evidence for NEXUS.

### Recommendation

1. **Keep ViGEmBus 1.22.0 as the supported output for the first public release.** It works on Windows 11 today, its binaries are signed, users install it themselves, and the whole NEXUS stack is built and tested against it (`xinput-loopback.yml`, Output Check). Keep calling it *experimental* and keep it user-installed.
2. **Make VIIPER the next backend to evaluate**, as its own milestone, not now. NEXUS already isolates the driver behind `VirtualControllerBackend`, so a `ViiperBackend` would sit next to `ViGEmBackend` without engine changes. The evaluation must cover:
   - the CI XInput loopback against `xusb22`;
   - Output Check on real PCs;
   - the latency of the extra user-space hop, measured with the Performance page's driver-call timing;
   - install and uninstall of usbip-win2 by the user;
   - whether its driver is production-signed;
   - anti-cheat behaviour in the games NEXUS users play.
3. **Don't adopt libvirtualhid** for this purpose: no Xbox 360 output on Windows, plus a paid, source-available driver.
4. **Trigger for switching:** a Windows update that breaks ViGEmBus, a security advisory against it, or VIIPER passing the evaluation above with latency equal or better.

### Sources (checked 2026-11-20)

- ViGEmBus repository (archived): https://github.com/nefarius/ViGEmBus
- VIIPER: https://github.com/Alia5/VIIPER and docs https://alia5.github.io/VIIPER/stable ; Rust client https://docs.rs/crate/viiper-client/0.3.0
- usbip-win2: https://github.com/vadimgrn/usbip-win2 , https://github.com/nefarius/usbip-win2
- libvirtualhid Windows driver: https://docs.lizardbyte.dev/projects/libvirtualhid/latest/md_docs_2windows-driver.html and https://github.com/lizardByte/libvirtualhid
- Discussion of VIIPER as a ViGEmBus alternative in another project: https://github.com/Brunovncs/OpenController/issues/1
