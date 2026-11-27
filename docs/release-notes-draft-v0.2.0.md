<!-- Draft for the first public release. Copy to release-notes/v0.2.0.md, edit, and commit with the version bump (docs/release-setup-checklist.md §6). Users see this text in the update notice. -->
First public release of NEXUS: a USB DualSense or DualShock 4 to virtual Xbox 360 controller for Windows 11.

- Installers are now code-signed, and NEXUS updates itself from this version on (it asks first, checks every update's signature and backs up your data before installing).
- Get ready to play: the Dashboard checklist shows what's missing (USB controller, ViGEmBus, virtual output, player 1) and how to fix it.
- Runs in the tray, starts with Windows if you want, and only one copy runs at a time.
- Stick swap, stick-to-buttons with thresholds and a release margin, button combinations, hold-to-activate macros.
- Daily automatic backups and restore points in Profiles.
- PS4 DualShock 4 support over USB (both hardware revisions), with the same mapping, macros and profiles as the DualSense.
- Lighter while you play: when a game is in front, the NEXUS window updates about 4 times a second, the 3D controller stops redrawing until you click back into NEXUS, and device scans no longer open your other USB devices.

Upgrading from a 0.1.0 build: your profiles, macros and settings are kept. If you choose "Uninstall before installing", turn Settings › Windows › Start with Windows on again once.

Requires ViGEmBus 1.22 (installed separately) for games to see the controller. USB only, for both controllers.
