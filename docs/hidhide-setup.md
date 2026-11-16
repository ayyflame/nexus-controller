# Avoiding double input with HidHide (optional)

When NEXUS's virtual Xbox 360 controller is on, Windows still shows your physical DualSense too. Games with PlayStation support, and Steam Input, may react to **both**, so one press counts twice.

**HidHide** is a free, optional driver by Nefarius, the developer of ViGEmBus. It can hide the DualSense from every program except the ones you allow, such as NEXUS.

- NEXUS **never installs HidHide and never changes its settings.** You set it up once in HidHide's own app.
- HidHide is **not required**. Without it, NEXUS works normally. If you see double input, turn off PlayStation controller support in the game or in Steam instead.
- NEXUS itself never needs administrator rights. Only HidHide's installer asks for them.

The same steps are shown in NEXUS: **Controller › Virtual Output › Avoid double input (optional)**. That page also shows NEXUS's exact program path with a **Copy** button.

## 1. Install (once)

1. Open the official release page: <https://github.com/nefarius/HidHide/releases>. Only the GitHub repository and the nefarius.at sites are official.
2. Download the latest `HidHide_…_x64.exe` and run it. Approve the Windows administrator prompt.
3. Restart Windows if the installer asks.
4. In NEXUS, click **Check again** on the Virtual Output tab. HidHide should show as **Installed**.

## 2. Configure: keep NEXUS allowed, hide the DualSense from games

1. Start **HidHide Configuration Client** from the Start menu.
2. **Applications** tab: click **+** and select the NEXUS program. Copy the path from NEXUS (Virtual Output tab → *NEXUS program path*).
   - Add **only NEXUS**. Do not add Steam or games, or they would see the DualSense again.
3. **Devices** tab: tick **DualSense Wireless Controller**. The *Gaming devices only* filter helps you find it.
   - Do **not** tick the Xbox 360 controller: that is NEXUS's output, which games should see.
4. Tick **Enable device hiding**.
5. Check the result:
   - NEXUS still shows the DualSense as connected.
   - `joy.cpl` (Win + R) lists only **Controller (XBOX 360 For Windows)**.
   - A gamepad tester or Steam shows one controller.

## Things to know

- **While hiding is on, games see no controller when NEXUS is closed.** Untick **Enable device hiding** when you want to play without NEXUS.
- **A different USB port** may make Windows show the DualSense as a new device. If games see it again, tick it again in the Devices tab.
- **NEXUS updates** install to the same folder, so the Applications entry keeps working. If the program path ever changes, add NEXUS again.
- HidHide is a kernel filter driver published and signed by Nefarius. Its developer says there is currently little capacity for further development. Like ViGEmBus, it is third-party software that you can remove at any time.

## Undo and recovery

| Problem | Fix |
|---|---|
| Games should see the DualSense again | HidHide Configuration Client → untick **Enable device hiding** |
| NEXUS no longer finds the DualSense after setting up HidHide | NEXUS is missing from the **Applications** list, or its path changed. Add it again, or untick Enable device hiding. NEXUS shows a hint on the Virtual Output tab when HidHide is installed and no controller is found. |
| Remove HidHide completely | Windows Settings › Apps › Installed apps › **HidHide** › Uninstall; restart if asked. All devices are visible again; NEXUS keeps working. |

## Licence

HidHide is MIT-licensed (© Nefarius Software Solutions e.U.). ViGEmBus is BSD-3-Clause. NEXUS does not redistribute either. Download them from the official release pages.
