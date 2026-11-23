# DualShock 4 (PS4) USB report format

How NEXUS reads a Sony **DUALSHOCK 4** over **USB**. Code: `crates/dualshock4`. The DualSense has its own format and parser ([dualsense-protocol.md](dualsense-protocol.md)). Both feed the same controller state, so mapping, macros, profiles and the virtual Xbox 360 controller work the same with either.

**Status:** built and tested with synthetic reports, and the layout is checked against a real controller's report descriptor (below). **Not yet tested with a physical DualShock 4.**

## Sources, checked against each other

| Source | What it gives |
|---|---|
| Linux kernel `drivers/hid/hid-playstation.c` | `struct dualshock4_input_report_usb` and `struct dualshock4_output_report_usb`, with compile-time size checks (64 and 32 bytes); battery, touch and button decoding; supported product IDs (`hid-ids.h`) |
| SDL `src/joystick/hidapi/SDL_hidapi_ps4.c` | `PS4StatePacket_t` (same offsets), button bits, touch decoding, output effects block |
| hid-tools `hidtools/device/sony_gamepad.py` (`PS4ControllerUSB`) | The emulator used by the kernel's HID self-tests: field offsets (gyro 13, accelerometer 19, battery 30, touch 33) and the **507-byte USB report descriptor of a real CUH-ZCT1** |

All three agree on every field NEXUS uses. The parser tests decode the real report descriptor (`crates/dualshock4/src/report_tests.rs`) and check that every offset the parser reads (sticks, hat, the 14 buttons, the counter, both triggers, the 64-byte length and the 32-byte output report) is where the controller declares it.

## Identification

| | |
|---|---|
| Vendor | Sony, `0x054C` |
| Products | `0x05C4` CUH-ZCT1 (first revision), `0x09CC` CUH-ZCT2 (second revision, light bar visible on the touchpad) |
| Not claimed | `0x0BA0` Sony USB Wireless Adaptor; `0x0CE6`/`0x0DF2` (DualSense, DualSense Edge, which have their own driver); Bluetooth connections |
| Collection | Generic Desktop / Game Pad (`0x01`/`0x05`) only, so no other interface of the controller is opened |
| Transport | USB from the PnP tree (`USB\…` ancestor) or the interface path; when neither tells, the 64-byte input report length |
| Origin | Physical or virtual from the PnP tree. **ViGEmBus's virtual DualShock 4 uses `054C:05C4` too**; it sits under a `ROOT` bus, is recognised as virtual and is never read |

During a scan NEXUS only opens HID interfaces whose path names Sony's vendor ID, and a controller it has already read is not read again while it stays plugged in (`docs/performance-investigation.md`, change 4).

## Input report 0x01 (USB, 64 bytes)

Byte 0 is the report ID.

| Bytes | Field | NEXUS |
|---|---|---|
| 1, 2 | Left stick X, Y (0–255, centre 0x80, Y grows downward) | `left_stick`, Y flipped so up is positive, as for the DualSense |
| 3, 4 | Right stick X, Y | `right_stick` |
| 5 | Bits 0–3 hat switch (0 = up, clockwise, 8–15 centred); 4 Square, 5 Cross, 6 Circle, 7 Triangle | d-pad, West / South / East / North |
| 6 | 0 L1, 1 R1, 2 L2 (digital), 3 R2 (digital), 4 Share, 5 Options, 6 L3, 7 R3 | shoulders, trigger digital bits, Select, Start, stick clicks |
| 7 | 0 PS, 1 touchpad click, 2–7 report counter (6 bits) | Home, touchpad click; the counter is extended to 8 bits for the dropped-report estimate |
| 8, 9 | L2, R2 analog (0 released – 255 fully pressed) | `left_trigger`, `right_trigger` (0.0–1.0); the digital bit never invents an analog value |
| 10–11 | Sensor timestamp, u16 (≈5.33 µs per step) | `motion.sensor_timestamp` (raw) |
| 12 | Sensor temperature | not used |
| 13–18 | Gyroscope X, Y, Z (i16, uncalibrated, nominal 1024 per °/s) | `motion.gyro_raw`, same axes and scale as the DualSense |
| 19–24 | Accelerometer X, Y, Z (i16, uncalibrated, nominal 8192 per g) | `motion.accel_raw` |
| 30 | Bits 0–3 battery level, bit 4 cable connected | `battery` (below) |
| 33 | Number of touch reports that follow (0–3) | more than 3: the report is rejected as malformed (as the Linux driver does) |
| 34–60 | Three touch reports of 9 bytes, **newest first**: timestamp, then two points | the newest is used; with a count of 0 the previous touch state stays |

**Touch point** (4 bytes): byte 0 bit 7 set = no finger, bits 0–6 tracking ID; X = byte 1 + (byte 2 low nibble) × 256; Y = (byte 2 high nibble) + byte 3 × 16. Touchpad size **1920 × 942** (the DualSense's is 1920 × 1080); the size travels with the state, so touchpad zones and swipes scale correctly. The coordinates of an inactive point are not valid and are reported as 0.

**Battery** (Linux driver): the level is in tenths; NEXUS shows the middle of the range (level 5 = 55 %).
- Cable connected: 0–9 charging; 10 charging at 100 %; 11 full; 14, 15 charging error; other values unknown.
- No cable: 0–9 discharging; 10 or more is 100 %.

**There is no mute button** on a DualShock 4; it is always released.

**Rejected reports** (counted on the Performance page as unreadable, and never replacing the last good input):
- an empty read;
- a report ID other than 0x01, including 0x11 (the Bluetooth report);
- fewer than 64 bytes;
- a touch report count above 3.

Longer reads are accepted, since Windows may pad them.

## Output report 0x05 (USB, 32 bytes)

Sent only when you turn on the light bar or test vibration (*Controller › Lighting & Haptics*), and only when something changes.

| Byte | Field |
|---|---|
| 0 | Report ID 0x05 |
| 1 | Valid flags: bit 0 motors, bit 1 light bar colour |
| 4 / 5 | Right (light) / left (heavy) motor |
| 6–8 | Light bar red, green, blue |

The DualShock 4 has no player lights; that setting does nothing for it, and no report is sent for it alone.

## Differences from the DualSense that the separate parser handles

| | DualSense (USB 0x01) | DualShock 4 (USB 0x01) |
|---|---|---|
| Triggers | bytes 5, 6 | bytes 8, 9 |
| Buttons | bytes 8–10 | bytes 5–7 |
| Report counter | byte 7, 8 bits | byte 7 bits 2–7, 6 bits |
| Gyro / accelerometer | bytes 16 / 22 | bytes 13 / 19 |
| Touch | bytes 33–40, 1920 × 1080 | newest of three reports from byte 34, 1920 × 942 |
| Battery | byte 53, other encoding | byte 30 |
| Mute button | yes | no |

Reading a DualShock 4 report with the DualSense layout would misread it: for example, it reads the DualShock 4's L2 byte as face buttons. A test covers this.

## Not supported

- **Bluetooth.** A Bluetooth DualShock 4 sends report 0x11 only after a mode switch NEXUS doesn't perform; it isn't claimed, so NEXUS shows no controller.
- **The Sony USB Wireless Adaptor** (`0x0BA0`).
- **Third-party "DS4-compatible" pads** with other product IDs aren't recognised. Pads that report Sony's IDs are read as a DualShock 4 but haven't been tested.
- Audio (headset jack, speaker) and the IMU calibration feature report. Motion values are raw, as for the DualSense; NEXUS's own gyro calibration removes the resting bias.

## Tests

- `crates/dualshock4`:
  - identification: both revisions, DualSense versus DualShock 4, keyboards, mice and other collections, Bluetooth, a ViGEmBus virtual DualShock 4;
  - the descriptor check;
  - every button alone and all together, all 16 hat values, stick and trigger boundaries;
  - battery, touch, motion and counter decoding;
  - invalid lengths, report IDs and malformed reports;
  - a 20,000-report fuzz test.
- `crates/engine/src/ds4_tests.rs`: DualShock 4 to the virtual Xbox 360 pad:
  - every button, sticks and triggers;
  - remapping, stick routing and stick-to-buttons, trigger tuning, combinations;
  - macros and hold-to-activate, profile switching;
  - unplug mid-press giving neutral output and a clean reconnect;
  - a DualShock 4 next to a DualSense, two DualShock 4s;
  - light bar and vibration reports, bad reports, drop estimates, the Report Inspector.
- `crates/engine/src/hotpath_tests.rs`: the DualShock 4 per-report path allocates nothing. Parsing takes about 55 ns per report against about 57 ns for the DualSense (Linux cloud machine, release build).

Checks that need a real controller: `tests/hardware-verification.md` (*D41–D48*).
