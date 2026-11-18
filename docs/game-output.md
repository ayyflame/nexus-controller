# Game output: DualSense → NEXUS → virtual Xbox 360 controller → games

**Status:** audited and tested in simulation and against Windows' real XInput API on a CI machine (2026-11-17). Not a substitute for trying your own games: see *Compatibility limits*.

## The path

```
DualSense (USB)  →  processing  →  remaps / layers  →  macros  →  virtual Xbox 360 controller  →  Windows (XInput)  →  game
```

- NEXUS reads the DualSense about 250 times a second. Every report is processed and sent on; none is dropped or merged.
- The virtual controller is created by **ViGEmBus**, an optional third-party driver you install yourself (Controller › Virtual Output). NEXUS never installs or bundles drivers.
- Games see a standard **"Controller (XBOX 360 For Windows)"**. Nothing is injected into games and no game process is touched.

## What games receive

| DualSense | Xbox 360 controller | Notes |
|---|---|---|
| Cross / Circle / Square / Triangle | A / B / X / Y | |
| L1 / R1 | LB / RB | |
| L2 / R2 | LT / RT, 0–255 | Full analog travel, after your trigger settings |
| L3 / R3 | Left / right stick click | |
| Left / right stick | Left / right stick, −32768…32767 | Up is positive, as XInput expects. After your deadzone, curve and sensitivity |
| D-pad | D-pad | Diagonals are two directions together |
| Create / Options | Back / Start | |
| PS | Guide | Windows hides Guide from games; it opens the Xbox Game Bar. Disable it under Controller › Mapping if unwanted |
| Touchpad click, Mute | not sent | An Xbox 360 controller has no such buttons. Remap them to an Xbox button to use them |
| Touchpad position, gyro, adaptive triggers, lightbar | not sent | Not part of an Xbox 360 controller. Gyro and touchpad can drive sticks or buttons through NEXUS's own settings |
| Remaps, shift layers, macros | Applied before the game sees anything | A macro's presses are added to what you physically hold |

Stick diagonals stay on a circle (a corner arrives as 0.707 on each axis), like a real stick. Turn on *square output* in the stick settings for games that expect full diagonals.

## What was verified, and how

**Simulated (every build, Linux and Windows CI).** Each input is followed from the USB report to the exact Xbox report: every button; both sticks at their extremes, centre and half; every kind of trigger value; remaps (button to button, button to trigger, trigger to trigger, disabled); deadzone and curve; shift layers; macros together with held buttons, sticks and triggers; profile switch (the same virtual controller stays, no stray frame); output off and on; unplug and re-plug; closing and restarting NEXUS.

**Real Windows XInput (manual CI check, Windows 11, ViGEmBus 1.22).** `xinput-loopback.yml` creates the virtual controller through NEXUS's real driver backend and reads it back with `XInputGetState`, the interface games use:

- the controller appears in XInput, and the player slot NEXUS shows is the one Windows assigned;
- it is neutral before any input;
- every button, stick values and all 256 trigger values read back exactly;
- turning output off removes it; turning it on again gives a fresh neutral controller; exiting leaves nothing behind.

That check runs on a throwaway GitHub virtual machine, the only place a driver is installed by automation. It found two driver behaviours, both now handled:

| Finding | Effect without a fix | What NEXUS does |
|---|---|---|
| A new virtual Xbox 360 controller reports about 10 % stick deflection until its first report, and ignores an all-zero first report | A slight stick drift from the moment output starts until you touch something | The driver backend primes a new controller so it starts at true neutral |
| An update sent right after another can be lost without an error (seen once in about 600 one-off updates across three runs) | A one-off frame with nothing after it, such as a final neutral frame, could leave a button held | While reports flow, the next report (4 ms later) repairs it. When nothing new arrives, NEXUS asks the driver backend to resend its last state |

**Not verified by automation:** real games, your PC's timing, Steam Input, HidHide, anti-cheat behaviour.

## Status in NEXUS

Controller › Virtual Output › *Virtual controller now* and the Dashboard show:

- **Xbox 360 connected · Games see it as player 1.**
- **Connected as player 2 (or later):** another Xbox-type controller holds the earlier slot. Many games only listen to player 1. Unplug the other controller, then turn the output off and on.
- **Reconnecting…:** the virtual controller stopped working and NEXUS is creating it again by itself (1 s, then doubling up to 30 s between tries).
- **Waiting for your DualSense / Waiting for ViGEmBus / Off:** why there is no virtual controller.

Check it in Windows: Win + R, `joy.cpl`, *Controller (XBOX 360 For Windows)* › Properties.

## No stuck buttons

A neutral frame (nothing pressed, sticks centred) is sent before the virtual controller is removed, and whenever the state can no longer be trusted:

| Situation | What happens |
|---|---|
| DualSense unplugged, output turned off, NEXUS closed | Neutral frame, then the virtual controller is removed |
| NEXUS crashes or is killed | Windows closes the driver connection and ViGEmBus removes the controller |
| Profile switched or macro edited | Macros stop; a held trigger must be released and pressed again |
| Profile switched while the DualSense sends nothing | Neutral frame |
| 8 unreadable reports in a row | Macros stop, neutral frame, controller stays connected; input resumes on the first readable report |
| The driver rejects an update | The virtual controller is dropped and re-created automatically |

## Compatibility limits

- **Double input.** Windows still shows the physical DualSense. Games with PlayStation support, and Steam Input, may react to both controllers. Turn off PlayStation support in the game or Steam, or hide the DualSense with HidHide (`docs/hidhide-setup.md`, optional, installed by you).
- **Player slot.** XInput has four slots. If another Xbox-type controller is connected first, NEXUS's controller is not player 1 (shown in NEXUS).
- **Button prompts.** Games show Xbox glyphs (A/B/X/Y), not PlayStation ones.
- **No vibration from games.** Rumble a game sends to the virtual Xbox controller is not passed on to the DualSense. NEXUS's own vibration test is separate.
- **No DualSense-only features in games:** adaptive triggers, haptics, touchpad, gyro, lightbar and the speaker are not available to a game through an Xbox 360 controller.
- **Games that do not use XInput.** Most PC games do. Very old DirectInput-only games see the Xbox controller with both triggers sharing one axis (a Windows limitation of Xbox controllers).
- **Very short presses.** A game reads the controller once per frame (16.7 ms at 60 fps, 33 ms at 30 fps). A macro press shorter than one frame can be missed by the game. Keep press times at 40–50 ms or more unless you know the game's frame rate.
- **Online games and anti-cheat.** Some anti-cheat systems block or penalise virtual controllers or macros. NEXUS does nothing to hide from them and must not be used where a game's rules forbid it.
- **ViGEmBus** was retired by its developer in 2023. It works on current Windows 10 and 11, but a future Windows update could break it. NEXUS keeps it behind one replaceable module.
- **Windows Server** has no Xbox 360 controller driver, so the virtual controller cannot be created there.
- **Driver timing on your PC is unmeasured.** Sending one update to the driver normally takes tens of microseconds, and it happens on NEXUS's input thread. The CI machine was too noisy to judge this. Check **Performance › NEXUS processing time** while a game runs: the 99th percentile and maximum include the driver call. Values of several milliseconds there would mean the driver is slowing input and should be reported.
