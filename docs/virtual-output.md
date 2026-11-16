# Virtual Controller Output and Duplicate-Input Prevention

## Status: experimental Xbox 360 output (macro beta)

| Piece | State |
|---|---|
| `VirtualControllerBackend` interface, one-device-per-controller policy, disconnect-before-switch | Implemented and tested |
| **Neutral report before every removal** (output switched, physical unplug, NEXUS exit) | Implemented and tested |
| Translation to Xbox 360 (XUSB) and DualShock 4 reports | Implemented and tested (`translate.rs`) |
| **Experimental ViGEmBus backend, Xbox 360 only** (`crates/virtual-controller/src/vigem.rs`) | Implemented. Unit-tested through a mock backend; **not yet verified on Windows hardware** |
| Consent switch "Use the experimental virtual controller" (Controller › Virtual Output) | Implemented. Off by default; stored as an app setting (no database migration) |
| DualShock 4 output | Not enabled in this beta |
| HidHide (optional, user-configured) | Guided setup only: NEXUS shows the steps and its program path, never installs or configures HidHide. See [`hidhide-setup.md`](hidhide-setup.md). |

### How it works

- **Driver:** ViGEmBus 1.22 (Nefarius), a **third-party driver that was retired upstream in November 2023**.
  - NEXUS **never bundles or installs it**. The user installs the official release themselves.
  - It is used for experimental testing only; it is not the permanent production driver (see `milestone-5-plan.md` §1 and `vendor-inquiries.md`).
- **Code:** NEXUS talks to the driver through the MIT-licensed `vigem-client` crate (pure Rust, no DLL). The backend is one file behind `VirtualControllerBackend`, so it can be replaced without touching the engine, macros or UI.
- **When the virtual controller exists:** only when the consent switch is on **and** the profile selects Xbox 360 **and** a DualSense is connected over USB **and** ViGEmBus is installed.
- **What it receives:** after every DualSense report (~250 Hz), the processed state, i.e. after remapping, layers and macros. While a macro plays, it is also updated between reports, so macro timing never stalls.
- **Releasing a Repeat While Held trigger:** the macro presses nothing from the very next report, so the button clears within one report interval (about 4 ms).
- **Removal:**
  - before the virtual controller is removed (output turned off, consent turned off, controller unplugged, NEXUS closed), NEXUS sends a report with nothing pressed;
  - if NEXUS crashes, Windows closes its connection to ViGEmBus and the driver removes the controller.
- **Limitations:**
  - Xbox 360 has no touchpad, gyro, mute, adaptive triggers or haptics. Map touchpad zones and gyro-to-stick to Xbox inputs instead.
  - The physical DualSense stays visible to games, so games with PlayStation support or Steam Input may see two controllers. Optional fix: HidHide, set up by the user ([`hidhide-setup.md`](hidhide-setup.md)).

### Install and remove ViGEmBus (user)

1. Open <https://github.com/nefarius/ViGEmBus/releases> and download **ViGEmBus 1.22.0** (`ViGEmBus_1.22.0_x64_x86_arm64.exe`).
2. Run it and approve the Windows administrator prompt. This is the driver's installer; NEXUS itself never needs admin rights.
3. In NEXUS: Controller › Virtual Output › **Check again**. Turn on **Use the experimental virtual controller**, then choose **Xbox 360**.
4. **To remove:** Windows Settings › Apps › Installed apps › *Nefarius Virtual Gamepad Emulation Bus Driver* › Uninstall. NEXUS keeps working; games simply no longer see a virtual controller.

**Game compatibility:** none is claimed. Only titles recorded in the compatibility report have been tested. This beta must not be used to automate play in online games whose rules prohibit macros or third-party input tools, and nothing in NEXUS attempts to hide from anti-cheat systems.

## Report translation

| DualSense | Xbox 360 | DualShock 4 |
|---|---|---|
| Cross / Circle / Square / Triangle | A / B / X / Y | same |
| L1 / R1 | LB / RB | L1 / R1 |
| L2 / R2 (analog 0–255) | LT / RT (0–255) | L2 / R2 (0–255) plus pressed bits |
| L3 / R3 | LS / RS | L3 / R3 |
| Create / Options | Back / Start | Share / Options |
| PS | Guide | PS |
| Touchpad click | not sent | Touchpad click |
| Mute | not sent | not sent |
| D-pad | D-pad bits | hat switch, including diagonals |
| Sticks | ±32767, up positive | 0–255, up = 0 |

Everything sent to games is the **processed** state, after:

1. deadzones and curves;
2. trigger settings;
3. remapping;
4. macros.

## ViGEmBus: risks to accept before enabling it

- **Retired.** The project was archived on 2023-11-02, and 1.22.0 is the final release. There will be no security fixes and no compatibility updates for future Windows versions.
- **Kernel-mode bus driver.** A vulnerability or crash in it affects the whole system, not just NEXUS.
- **Anti-cheat.** Some anti-cheat systems block or flag ViGEm virtual devices, and some games refuse virtual pads.
- **Not bundled, never silent.** NEXUS will detect it and show its status. If it's missing, NEXUS will explain the risks and link to the official signed installer. Installation is a separate action the user approves explicitly.
- **Replaceable.** Everything driver-specific lives in one backend module behind `VirtualControllerBackend`. Production driver selection remains open; libvirtualhid is the maintained alternative, but it needs a paid license.

## Duplicate input (the game sees two controllers)

Once a virtual controller exists, a game can see both the physical DualSense and the virtual pad, and act on both. Options:

| Option | Pros | Cons |
|---|---|---|
| **HidHide** (Nefarius, MIT) | Hides the physical DualSense from every process except an allow-list (NEXUS); widely used | Kernel filter driver; the maintainer says there is "no capacity for major works"; needs a reboot after install; misconfiguration can hide a controller everywhere, and recovery may need manual steps |
| Game-side setting (e.g. disable Steam Input or PlayStation support for that game) | No driver | Per game, manual, easy to get wrong |
| DualShock 4 output only | Some games treat DS4 and DualSense differently | Does not prevent double input |

**Plan, once the gate opens:** treat HidHide as an optional, separately approved install, like ViGEmBus.

- **NEXUS's role:** detect it, add itself to HidHide's allow-list, hide only the DualSense instances it is reading, and undo exactly those changes when the user turns the feature off or uninstalls NEXUS.
- **Conservative changes:** NEXUS never removes entries it did not add, following HidHide's guidance for third-party clients.
- **Without HidHide:** the app warns that games may see two controllers.

NEXUS already prevents duplicates on its own input side: it never reads virtual devices, including its own future output and other tools' virtual pads.
