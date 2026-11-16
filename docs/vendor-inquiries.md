# Virtual controller driver: vendor enquiries (drafts)

These are drafts for the owner to send (decision D1). Nothing has been sent. Use each vendor's official contact channel listed on its own website. The contact routes below are where to look, not verified addresses.

- **Nefarius Software Solutions e.U.** (VirtualPad): see the contact or partner information on [docs.nefarius.at](https://docs.nefarius.at/projects/VirtualPad/).
- **LizardByte** (Virtual HID Driver for libvirtualhid): see the licensing or contact information on [app.lizardbyte.dev](https://app.lizardbyte.dev/libvirtualhid/virtual-hid-driver/) and the [libvirtualhid docs](https://docs.lizardbyte.dev/projects/libvirtualhid/latest/md_docs_2windows-driver.html).

The answers are recorded in the table at the end and compared in `milestone-5-plan.md` §1.

---

## Draft 1: Nefarius (VirtualPad)

**Subject:** Licensing enquiry: VirtualPad for a Windows controller configuration application

Hello,

We are developing NEXUS Controller Engine, a Windows 11 x64 desktop application that configures Sony DualSense controllers connected over USB (remapping, macros, stick and trigger processing). We would like to offer optional virtual Xbox 360 (XInput) and DualShock 4 output, and are evaluating VirtualPad as the driver for it.

Could you please share:

1. **Licensing model and pricing:** one-time, annual, or per end-user machine; minimum commitments; costs for a small private beta compared with commercial distribution.
2. **Redistribution:** may we distribute the driver installer with our application, or must users install it separately? Are there branding or attribution requirements?
3. **Online requirements:** does the driver or SDK need an internet connection or licence server at install time or at runtime?
4. **Technical scope:** supported emulated devices (Xbox 360 wired, DualShock 4 with touchpad and motion through extended reports, others); Windows 11 x64 support; signing (WHQL or attestation); install and uninstall method (silent install possible with user consent?); coexistence with ViGEmBus and HidHide.
5. **SDK and API:** available languages and bindings (we use Rust; a C API or IOCTL documentation would suffice), sample code, versioning and update policy.
6. **Support and maintenance:** update cadence, support channel, and a commitment for future Windows versions.
7. **Evaluation:** is an evaluation licence available for internal testing?

We do not ask for any custom kernel work, and we will not install anything without explicit user consent.

Thank you,
[Name], NEXUS Controller Engine

---

## Draft 2: LizardByte (Virtual HID Driver)

**Subject:** Commercial licensing enquiry: Virtual HID Driver gamepads for a Windows application

Hello,

We are developing NEXUS Controller Engine, a Windows 11 x64 application that configures Sony DualSense controllers over USB and would offer optional virtual Xbox 360 (XInput) and DualShock 4 output. We are evaluating libvirtualhid with the Virtual HID Driver.

Could you please clarify:

1. **Pricing and licence model** for gamepads created through the Virtual HID Driver: per machine, per seat or per year? Is there OEM or volume licensing for an application vendor, so end users don't buy licences individually?
2. **Online licence check:** your documentation says an internet connection is needed when a gamepad is created. Is there an offline option for vendor or OEM licences? What happens when the licence server is unreachable?
3. **Redistribution:** may we ship the driver installer with our installer, or launch it from our app with user consent? Branding and attribution requirements?
4. **XInput path:** how does the "XUSB companion" for Xbox 360 work, which components does it install, and how is it signed?
5. **DualShock 4:** touchpad and motion support, and feature-report behaviour for games and Steam.
6. **Technical requirements:** Windows 11 x64 versions supported, signing (attestation or WHQL), install and uninstall procedure, and coexistence with ViGEmBus and HidHide.
7. **Integration:** is libvirtualhid's licence compatible with a closed-source commercial application (we use Rust; a C API is fine)?
8. **Evaluation licence** for internal testing?

Thank you,
[Name], NEXUS Controller Engine

---

## Answers received

| Question | Nefarius VirtualPad | LizardByte Virtual HID Driver |
|---|---|---|
| Price / model | — | — |
| Per-machine fees | — | — |
| Redistribution allowed | — | — |
| Online requirement | — | — |
| Xbox 360 / DS4 (touch, motion) | — | — |
| Signing | — | — |
| Silent install with consent | — | — |
| SDK / Rust usability | — | — |
| Evaluation licence | — | — |
| Date received | — | — |
