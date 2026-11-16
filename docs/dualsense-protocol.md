> NEXUS supports **USB only**. The Bluetooth sections below document code that is kept but unused; Bluetooth is permanently out of scope.

# DualSense Input Report Format

Implemented in `crates/dualsense/src/report.rs`. Sources: the Linux kernel `drivers/hid/hid-playstation.c` (`struct dualsense_input_report`) and SDL `src/joystick/hidapi/SDL_hidapi_ps5.c`; the two agree on every field used here.

**Verification status:** validated against **synthetic** reports built from this specification (`crates/dualsense/src/synthetic.rs`). **Not yet validated against a physical controller.** Use the checklist in `tests/hardware-verification.md`.

## Identification

| | VID | PID | HID collection |
|---|---|---|---|
| DualSense (CFI-ZCT1) | `0x054C` | `0x0CE6` | Usage Page `0x01`, Usage `0x05` (Gamepad) |
| DualSense Edge (CFI-ZCP1) | `0x054C` | `0x0DF2` | same (Edge-only inputs not decoded yet) |

`0x05C4` / `0x09CC` (DualShock 4) are deliberately **not** matched. They are also what ViGEm's virtual DS4 reports.

## Transport detection (in order of reliability)

1. **PnP parent**: `USB\VID_054C&PID_0CE6&MI_03\…` → USB; `BTHENUM\{00001124-…}_VID&0002054C_PID&0CE6\…` → Bluetooth.
2. **Interface path**: Bluetooth HID paths contain `{00001124-0000-1000-8000-00805f9b34fb}`.
3. **Input report length** from `HidP_GetCaps`: 64 on USB, 78 on Bluetooth.

If none is conclusive, the connection is shown as *Undetermined*.

## Physical vs virtual

The PnP ancestor chain is walked nearest-first, skipping `HID\` and `USB\` nodes (virtual buses also create `USB\VID_…` children). The first other node decides:

- `PCI\`, `ACPI\`, `URS\`, `USB4\` (host controller) or `BTHENUM\`/`BTHLEDEVICE\` → **physical**
- `ROOT\` or `SWD\` (software-enumerated bus, e.g. `ROOT\SYSTEM\0001` for ViGEmBus) → **virtual**, never opened
- anything else → **unknown** (opened, and shown as unknown)

## Report layouts

| Transport | Report ID | Header | Payload offset | Length | Integrity |
|---|---|---|---|---|---|
| USB | `0x01` | id | 1 | 64 | none |
| Bluetooth extended | `0x31` | id, seq/tag byte | 2 | 78 | CRC-32 in bytes 74–77 (LE) |
| Bluetooth basic | `0x01` | id | special (below) | 10 | none |

A Bluetooth DualSense starts in **basic** mode (report `0x01`, 10 bytes: sticks, buttons, triggers only). Reading feature report **`0x05`** (IMU calibration), a side-effect-free query, switches it to **extended** report `0x31`. NEXUS does this once in `DualSenseDriver::initialize`. On Windows, reads are padded to the collection's `InputReportByteLength` (78 on Bluetooth), so a 10-byte basic report arrives in a 78-byte buffer. The parser therefore picks the layout by transport, not by length.

**Bluetooth CRC:** standard CRC-32 (reflected, poly `0xEDB88320`, init `0xFFFFFFFF`, final XOR) over the byte `0xA1` followed by report bytes 0–73. Reports with a bad CRC are rejected and counted as parse errors.

### Shared 63-byte payload (offsets relative to payload start)

| Offset | Field |
|---|---|
| 0–1 | Left stick X, Y (`0x80` = centre, Y grows downward) |
| 2–3 | Right stick X, Y |
| 4 | L2 analog (0–255) |
| 5 | R2 analog |
| 6 | Sequence counter |
| 7 | bits 0–3 D-pad hat (0 = N, clockwise, 8 = neutral); bit 4 Square, 5 Cross, 6 Circle, 7 Triangle |
| 8 | bit 0 L1, 1 R1, 2 L2 digital, 3 R2 digital, 4 Create, 5 Options, 6 L3, 7 R3 |
| 9 | bit 0 PS, 1 Touchpad click, 2 Mic mute (Edge: further bits for Fn/paddles, not decoded) |
| 10 | Reserved / Edge |
| 11–14 | Reserved |
| 15–20 | Gyro X, Y, Z (i16 LE, uncalibrated) |
| 21–26 | Accelerometer X, Y, Z (i16 LE, uncalibrated) |
| 27–30 | Sensor timestamp (u32 LE) |
| 31 | Reserved |
| 32–35 | Touch point 1: `[bit7 = NOT touching, bits0-6 id] [x lo] [x hi(4) / y lo(4)] [y hi]` |
| 36–39 | Touch point 2 |
| 40–51 | Reserved |
| 52 | Battery: low nibble level 0–10 (`×10 + 5`, capped at 100%), high nibble 0 = discharging, 1 = charging, 2 = full, A/B/F = error |
| 53–62 | Reserved |

Touchpad resolution: 1920 × 1080.

### Bluetooth basic report `0x01`

`[0]=0x01 [1]LX [2]LY [3]RX [4]RY [5]buttons0 [6]buttons1 [7]buttons2 [8]L2 [9]R2`. The button bytes use the same bit layout as payload bytes 7–9.

## Normalization (controller-core)

- Sticks: `(raw − 128) / 127`, clamped to `[−1, 1]`; Y is inverted so **up is positive**; exact centre → `0.0`.
- Triggers: `raw / 255`.
- Raw values are kept alongside normalized ones.
- No deadzone is applied at this layer.
