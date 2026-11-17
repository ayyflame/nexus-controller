//! Real-driver check: NEXUS's virtual Xbox 360 controller, read back through
//! Windows' own XInput API (the interface games use).
//!
//! Needs Windows with ViGEmBus installed, so it is `#[ignore]`d and never
//! runs in the normal test suite. Run it on a machine that has ViGEmBus:
//!
//! ```text
//! cargo test -p nexus-virtual-controller --test xinput_loopback -- --ignored --nocapture
//! ```
//!
//! It creates the virtual controller through the same `VirtualOutputManager`
//! and ViGEm backend the app uses, sends controller states, and asserts that
//! `XInputGetState` returns exactly the translated values. No game, no
//! injection: only the public XInput API.
#![cfg(windows)]
#![allow(clippy::field_reassign_with_default)]

use nexus_controller_core::{Button, ControllerState, StickState, TriggerState, VirtualOutputKind};
use nexus_virtual_controller::translate::{to_xusb, xusb, XusbReport};
use nexus_virtual_controller::vigem::ViGEmBackend;
use nexus_virtual_controller::{BackendStatus, VirtualControllerBackend, VirtualOutputManager};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct XInputGamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    thumb_lx: i16,
    thumb_ly: i16,
    thumb_rx: i16,
    thumb_ry: i16,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
struct XInputState {
    packet: u32,
    gamepad: XInputGamepad,
}

#[link(name = "xinput1_4", kind = "raw-dylib")]
extern "system" {
    fn XInputGetState(user_index: u32, state: *mut XInputState) -> u32;
}

const ERROR_SUCCESS: u32 = 0;
const ERROR_DEVICE_NOT_CONNECTED: u32 = 1167;

/// What XInput reports for one player slot, or `None` if nothing is connected.
fn read(slot: u32) -> Option<XInputGamepad> {
    let mut s = XInputState::default();
    // SAFETY: `s` is a valid, writable XINPUT_STATE for the duration of the call.
    let code = unsafe { XInputGetState(slot, &mut s) };
    match code {
        ERROR_SUCCESS => Some(s.gamepad),
        ERROR_DEVICE_NOT_CONNECTED => None,
        other => panic!("XInputGetState({slot}) failed with Windows error {other}"),
    }
}

fn connected_slots() -> Vec<u32> {
    (0..4).filter(|s| read(*s).is_some()).collect()
}

fn wait_for<T>(what: &str, timeout: Duration, mut f: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(v) = f() {
            return v;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// The public XInputGetState never reports the Guide button.
fn as_game_sees(r: XusbReport) -> XInputGamepad {
    XInputGamepad {
        buttons: r.buttons & !xusb::GUIDE,
        left_trigger: r.left_trigger,
        right_trigger: r.right_trigger,
        thumb_lx: r.thumb_lx,
        thumb_ly: r.thumb_ly,
        thumb_rx: r.thumb_rx,
        thumb_ry: r.thumb_ry,
    }
}

/// Updates that did not show up in XInput after one submit and were only
/// delivered by the keep-alive (what the app does while input is quiet).
static REPAIRED: AtomicU32 = AtomicU32::new(0);
static SENT: AtomicU32 = AtomicU32::new(0);

/// Sends `s` once, as the app does for a one-off frame. If XInput does not
/// show it within 50 ms the update was lost in the driver; the keep-alive
/// must then deliver it.
fn expect(m: &mut VirtualOutputManager, slot: u32, s: &ControllerState, what: &str) {
    let want = as_game_sees(to_xusb(s));
    m.submit(s);
    assert_eq!(
        m.take_event(),
        None,
        "{what}: the driver rejected the update"
    );
    SENT.fetch_add(1, Ordering::Relaxed);
    let first = Instant::now();
    while first.elapsed() < Duration::from_millis(50) {
        if read(slot) == Some(want) {
            return;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    println!(
        "LOOPBACK lost update ({what}): XInput still shows {:?}",
        read(slot)
    );
    REPAIRED.fetch_add(1, Ordering::Relaxed);
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        m.keep_alive();
        assert_eq!(m.take_event(), None, "{what}: keep-alive failed");
        std::thread::sleep(Duration::from_millis(4));
        let got = read(slot);
        if got == Some(want) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "{what}: XInput reports {got:?}, expected {want:?}, even after keep-alives"
        );
    }
}

fn pressed(buttons: &[Button]) -> ControllerState {
    let mut s = ControllerState::default();
    for b in buttons {
        b.set(&mut s, true);
    }
    s
}

#[test]
#[ignore = "needs Windows with ViGEmBus installed"]
fn virtual_xbox_controller_is_read_back_exactly_through_xinput() {
    let backend = ViGEmBackend::new();
    match backend.status() {
        BackendStatus::Ready { .. } => {}
        BackendStatus::Unavailable { reason } => panic!("ViGEmBus is not usable here: {reason}"),
    }
    let before = connected_slots();
    println!("LOOPBACK XInput slots in use before: {before:?}");

    // 1. Creating the output exposes one new XInput controller.
    let mut m = VirtualOutputManager::new(Box::new(backend));
    m.set_mode(VirtualOutputKind::Xbox360)
        .expect("create virtual Xbox 360 controller");
    let status = m.status();
    assert_eq!(status.active, Some(VirtualOutputKind::Xbox360));
    let slot = wait_for(
        "the controller to appear in XInput",
        Duration::from_secs(10),
        || connected_slots().into_iter().find(|s| !before.contains(s)),
    );
    println!(
        "LOOPBACK appeared in XInput slot {slot} (player {}); driver reported slot {:?}",
        slot + 1,
        status.player_index
    );
    assert_eq!(
        status.player_index,
        Some(slot as u8),
        "the player slot NEXUS shows is the one Windows assigned"
    );
    assert_eq!(
        connected_slots().len(),
        before.len() + 1,
        "exactly one new controller"
    );

    // 2. A new controller is neutral before NEXUS has sent any input (the
    //    backend primes it; unprimed, the sticks read about 10 % off-centre).
    assert_eq!(
        read(slot),
        Some(XInputGamepad::default()),
        "a new virtual controller must start neutral"
    );
    expect(&mut m, slot, &ControllerState::default(), "neutral");

    // 3. Every button, alone, then released.
    let buttons = [
        Button::South,
        Button::East,
        Button::West,
        Button::North,
        Button::LeftShoulder,
        Button::RightShoulder,
        Button::LeftStick,
        Button::RightStick,
        Button::Start,
        Button::Select,
        Button::DpadUp,
        Button::DpadDown,
        Button::DpadLeft,
        Button::DpadRight,
    ];
    for b in buttons {
        expect(&mut m, slot, &pressed(&[b]), &format!("{b:?}"));
        expect(&mut m, slot, &ControllerState::default(), "release");
    }
    expect(
        &mut m,
        slot,
        &pressed(&[
            Button::South,
            Button::North,
            Button::DpadUp,
            Button::DpadRight,
            Button::RightShoulder,
        ]),
        "five buttons together",
    );
    // Guide is sent to the driver but hidden from games by XInput itself.
    expect(
        &mut m,
        slot,
        &pressed(&[Button::Home, Button::South]),
        "Guide + A",
    );

    // 4. Sticks: extremes, centre, and intermediate values.
    for (lx, ly, rx, ry) in [
        (255u8, 128u8, 128u8, 128u8),
        (0, 128, 128, 128),
        (128, 0, 128, 128),
        (128, 255, 128, 128),
        (128, 128, 255, 0),
        (128, 128, 0, 255),
        (200, 90, 40, 170),
        (129, 127, 128, 128),
        (128, 128, 128, 128),
    ] {
        let mut s = ControllerState::default();
        s.left_stick = StickState::from_u8(lx, ly);
        s.right_stick = StickState::from_u8(rx, ry);
        expect(&mut m, slot, &s, &format!("sticks {lx},{ly},{rx},{ry}"));
    }

    // 5. Triggers: every analog value.
    for v in 0..=255u8 {
        let mut s = ControllerState::default();
        s.left_trigger = TriggerState::from_u8(v, v > 0);
        s.right_trigger = TriggerState::from_u8(255 - v, v < 255);
        expect(&mut m, slot, &s, &format!("triggers {v}"));
    }

    // 6. Sustained output at the controller's rate: 2,500 updates (10 s of
    //    play at 250 Hz, sent back to back), alternating A with a moving stick.
    let started = Instant::now();
    let mut slowest = Duration::ZERO;
    let n = 2500u32;
    for i in 0..n {
        let mut s = if i % 2 == 0 {
            pressed(&[Button::South])
        } else {
            ControllerState::default()
        };
        s.left_stick = StickState::from_u8((i % 256) as u8, 128);
        let t = Instant::now();
        m.submit(&s);
        slowest = slowest.max(t.elapsed());
        assert_eq!(m.take_event(), None, "update {i} failed");
    }
    let total = started.elapsed();
    println!(
        "LOOPBACK {n} updates in {:.1} ms: average {:.1} us per update, slowest {:.1} us",
        total.as_secs_f64() * 1e3,
        total.as_secs_f64() * 1e6 / f64::from(n),
        slowest.as_secs_f64() * 1e6
    );
    assert_eq!(
        m.status().active,
        Some(VirtualOutputKind::Xbox360),
        "still connected"
    );
    // The last state sent is the state XInput ends on: nothing lost or stuck.
    let mut last = pressed(&[Button::East]);
    last.right_trigger = TriggerState::from_u8(77, true);
    expect(&mut m, slot, &last, "state after sustained output");

    // 7. Turning output off removes the controller from XInput.
    m.set_mode(VirtualOutputKind::Disabled).expect("remove");
    wait_for(
        "the controller to leave XInput",
        Duration::from_secs(10),
        || (connected_slots() == before).then_some(()),
    );
    assert_eq!(m.status().active, None);

    // 8. Turning it on again gives a fresh, neutral, working controller.
    m.set_mode(VirtualOutputKind::Xbox360)
        .expect("create again");
    let slot2 = wait_for(
        "the controller to reappear",
        Duration::from_secs(10),
        || connected_slots().into_iter().find(|s| !before.contains(s)),
    );
    assert_eq!(m.status().player_index, Some(slot2 as u8));
    assert_eq!(
        read(slot2),
        Some(XInputGamepad::default()),
        "starts neutral, not on the old state"
    );
    expect(
        &mut m,
        slot2,
        &pressed(&[Button::West]),
        "X after re-enabling",
    );

    println!(
        "LOOPBACK one-off updates: {} sent, {} lost by the driver and repaired by keep-alive",
        SENT.load(Ordering::Relaxed),
        REPAIRED.load(Ordering::Relaxed)
    );

    // 9. Dropping the manager (app exit) leaves nothing behind.
    drop(m);
    wait_for("cleanup after exit", Duration::from_secs(10), || {
        (connected_slots() == before).then_some(())
    });
    println!(
        "LOOPBACK passed: slots after cleanup {:?}",
        connected_slots()
    );
}
