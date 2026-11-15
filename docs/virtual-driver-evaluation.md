# Virtual Controller Driver Evaluation

Status: **decision pending review.** Nothing is installed or bundled. The engine ships with `UnavailableBackend`, which reports that no driver is configured.

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
