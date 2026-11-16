# Virtual Controller Output and Duplicate-Input Prevention

## Status (Milestone 2)

| Piece | State |
|---|---|
| `VirtualControllerBackend` interface, one-device-per-controller policy, disconnect-before-switch | Implemented and tested (`crates/virtual-controller/src/lib.rs`) |
| Translation to Xbox 360 (XUSB) and DualShock 4 reports | Implemented and tested (`translate.rs`) |
| Read-only detection of ViGEmBus and HidHide | Implemented (`drivers.rs`), shown in the app |
| **Experimental ViGEmBus backend** | **Not implemented: blocked by the hardware gate** |
| **HidHide integration** | **Not implemented: blocked by the hardware gate** |

### The hardware gate

The project rule is that no ViGEmBus code ships until **physical DualSense input has been verified on real Windows 11 hardware**, over USB (Bluetooth is out of scope). At the time of this milestone, every row of `tests/hardware-verification.md` is empty: no diagnostics reports or recorded fixtures exist. Synthetic tests do not count.

To open the gate:

1. Install the current NEXUS build (`docs/install-windows.md`).
2. Complete the USB sections of `tests/hardware-verification.md`.
3. Share both **Copy diagnostics report** outputs (Settings → HID Devices).
4. Raw reports from those files become regression fixtures. Any parsing fixes land first, then the ViGEmBus backend.

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
