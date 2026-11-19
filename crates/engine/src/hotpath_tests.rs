//! Hot-path latency and allocation measurements for the per-report handler.
//!
//! `hotpath_benchmark` is `#[ignore]`d (timing depends on the machine); run it
//! with `cargo test --release -p nexus-engine hotpath_benchmark -- --ignored
//! --nocapture`. The allocation test runs always.

use super::*;
use nexus_controller_core::{
    ConnectedDevice, ControllerModel, DeviceId, DeviceOrigin, ReportParser,
};
use nexus_device_manager::mock::MockHidBackend;
use nexus_dualsense::synthetic::Payload;
use nexus_dualsense::DualSenseParser;
use nexus_macro_engine::{Macro, MacroButton, MacroStep, PlaybackMode};
use nexus_virtual_controller::{OutputError, VirtualDeviceHandle};
use std::sync::atomic::AtomicU64;

// ---- allocation counter (test-only crate; counts this thread only) ---------

#[global_allocator]
static GLOBAL: nexus_test_alloc_counter::Counting = nexus_test_alloc_counter::Counting;

use nexus_test_alloc_counter::count as count_allocs;

// ---- a virtual pad that only timestamps submissions (no allocation) ---------

static EPOCH: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
fn epoch() -> Instant {
    *EPOCH.get_or_init(Instant::now)
}

struct TimestampPad {
    last_submit_ns: Arc<AtomicU64>,
}

impl VirtualControllerBackend for TimestampPad {
    fn name(&self) -> &'static str {
        "timestamp"
    }
    fn status(&self) -> BackendStatus {
        BackendStatus::Ready { version: None }
    }
    fn supports(&self, kind: VirtualOutputKind) -> bool {
        kind == VirtualOutputKind::Xbox360
    }
    fn connect(&mut self, _: VirtualOutputKind) -> Result<VirtualDeviceHandle, OutputError> {
        Ok(VirtualDeviceHandle(1))
    }
    fn update(&mut self, _: VirtualDeviceHandle, s: &ControllerState) -> Result<(), OutputError> {
        std::hint::black_box(nexus_virtual_controller::translate::to_xusb(s));
        self.last_submit_ns
            .store(epoch().elapsed().as_nanos() as u64, Ordering::Release);
        Ok(())
    }
    fn disconnect(&mut self, _: VirtualDeviceHandle) -> Result<(), OutputError> {
        Ok(())
    }
}

fn device() -> ConnectedDevice {
    ConnectedDevice {
        id: DeviceId("bench".into()),
        model: ControllerModel::DualSense,
        connection: ConnectionType::Usb,
        origin: DeviceOrigin::Physical,
        vendor_id: 0x054C,
        product_id: 0x0CE6,
        product_name: None,
        serial_number: None,
        output_report_len: 48,
    }
}

fn macro_r3() -> Macro {
    Macro {
        id: "m".into(),
        name: "M".into(),
        description: String::new(),
        enabled: true,
        steps: vec![
            MacroStep {
                id: "a".into(),
                buttons: vec![MacroButton::North],
                hold_ms: 40,
                delay_after_ms: 40,
            },
            MacroStep {
                id: "b".into(),
                buttons: vec![MacroButton::North],
                hold_ms: 40,
                delay_after_ms: 40,
            },
        ],
        trigger: Some(MacroButton::RightStick),
        mode: PlaybackMode::RepeatWhileHeld,
        repeat_delay_ms: 40,
        block_trigger: true,
        activation_ms: 0,
        created_at_ms: 0,
        updated_at_ms: 0,
    }
}

/// A report handler wired to a real engine `Shared`, Xbox 360 output and a
/// playing Repeat While Held macro: the production hot path, minus USB.
fn handler() -> (Engine, Box<dyn SessionHandler>, Arc<AtomicU64>) {
    let stamp = Arc::new(AtomicU64::new(0));
    let s = stamp.clone();
    let factory: OutputBackendFactory = Arc::new(move || {
        Box::new(TimestampPad {
            last_submit_ns: s.clone(),
        })
    });
    let e = Engine::start(
        Arc::new(MockHidBackend::new()),
        vec![Arc::new(nexus_dualsense::DualSenseDriver)],
        factory.clone(),
        EngineConfig {
            initial_output: VirtualOutputKind::Xbox360,
            hotplug: false,
            ..Default::default()
        },
    );
    e.set_macros(vec![macro_r3()]);
    let h = new_session_handler(&e.shared, &factory, &device());
    (e, h, stamp)
}

fn held_report() -> Vec<u8> {
    let mut p = Payload::neutral();
    p.buttons[1] |= 0x80; // R3 held: the macro keeps playing
    p.usb_report()
}

fn pct(mut v: Vec<u64>) -> (u64, u64, u64, u64) {
    v.sort_unstable();
    let at = |q: f64| v[((v.len() - 1) as f64 * q) as usize];
    (at(0.5), at(0.99), at(0.999), *v.last().unwrap())
}

#[test]
#[ignore]
fn hotpath_benchmark() {
    let (e, mut h, stamp) = handler();
    let raw = held_report();
    let mut parser = DualSenseParser::new(ConnectionType::Usb);
    // Released first, so the held trigger is a fresh press and the macro plays.
    let idle = Payload::neutral().usb_report();
    h.on_report(&idle, parser.parse(&idle));
    for _ in 0..2_000 {
        h.on_report(&raw, parser.parse(&raw)); // warm up
    }
    let n = 200_000;
    let (mut to_submit, mut total) = (Vec::with_capacity(n), Vec::with_capacity(n));
    let mut parse = Vec::with_capacity(n);
    for _ in 0..n {
        let p0 = epoch().elapsed().as_nanos() as u64;
        let parsed = parser.parse(&raw);
        parse.push(epoch().elapsed().as_nanos() as u64 - p0);
        let start = epoch().elapsed().as_nanos() as u64;
        h.on_report(&raw, parsed);
        let end = epoch().elapsed().as_nanos() as u64;
        to_submit.push(stamp.load(Ordering::Acquire).saturating_sub(start));
        total.push(end - start);
    }
    let (_, allocs) = count_allocs(|| {
        for _ in 0..1000 {
            h.on_report(&raw, parser.parse(&raw));
        }
    });
    for (name, v) in [
        ("HID report parse", parse),
        ("report entry -> virtual submit", to_submit),
        ("whole handler", total),
    ] {
        let (p50, p99, p999, max) = pct(v);
        println!("HOTPATH {name:<31} p50 {p50:>6} ns  p99 {p99:>6} ns  p99.9 {p999:>7} ns  max {max:>8} ns");
    }
    println!(
        "HOTPATH allocations per report: {:.2}",
        allocs as f64 / 1000.0
    );
    // The engine's own per-stage windows (last 256 reports), as shown in the app.
    let st = e.status().devices[0].stage_latency;
    for (name, x) in [
        ("stage: mapping", st.mapping),
        ("stage: macros", st.macros),
        ("stage: virtual output call", st.output),
    ] {
        println!(
            "HOTPATH {name:<31} p50 {:>6} ns  p99 {:>6} ns  max {:>8} ns",
            x.p50_ns, x.p99_ns, x.max_ns
        );
    }
}

#[test]
fn steady_state_reports_make_no_heap_allocations() {
    let (_e, mut h, stamp) = handler();
    let raw = held_report();
    let idle = Payload::neutral().usb_report();
    let mut parser = DualSenseParser::new(ConnectionType::Usb);
    h.on_report(&idle, parser.parse(&idle));
    for _ in 0..300 {
        h.on_report(&raw, parser.parse(&raw)); // macro starts and keeps repeating
    }
    let before = stamp.load(Ordering::Acquire);
    let ((), allocs) = count_allocs(|| {
        for _ in 0..1000 {
            let parsed = parser.parse(&raw);
            h.on_report(&raw, parsed);
        }
    });
    assert!(
        stamp.load(Ordering::Acquire) > before,
        "the virtual controller received the reports"
    );
    assert_eq!(
        allocs, 0,
        "per-report path must not allocate (was 6 per report)"
    );
}

#[test]
fn stick_swapping_and_stick_buttons_make_no_heap_allocations() {
    use nexus_controller_core::Button;
    use nexus_input_processing::{ProcessingConfig, StickButtons, StickDirections, StickSource};
    let (e, _, stamp) = handler();
    let mut c = ProcessingConfig::default();
    c.stick_routing.left_output = StickSource::Right;
    c.stick_routing.right_output = StickSource::Left;
    c.left_stick.buttons = StickButtons {
        enabled: true,
        up: Some(Button::DpadUp),
        down: Some(Button::DpadDown),
        left: Some(Button::DpadLeft),
        right: Some(Button::RightTrigger),
        directions: StickDirections::Four,
        passthrough: true,
        ..StickButtons::default()
    };
    e.set_processing(c);
    let factory: OutputBackendFactory = {
        let s = stamp.clone();
        Arc::new(move || {
            Box::new(TimestampPad {
                last_submit_ns: s.clone(),
            })
        })
    };
    let mut h = new_session_handler(&e.shared, &factory, &device());
    // The left stick sweeps through every direction and the centre.
    let reports: Vec<Vec<u8>> = [
        (128, 0),
        (255, 0),
        (255, 128),
        (255, 255),
        (0, 255),
        (0, 0),
        (128, 128),
    ]
    .iter()
    .map(|&(lx, ly)| {
        let mut p = Payload::neutral();
        p.lx = lx;
        p.ly = ly;
        p.rx = 200;
        p.usb_report()
    })
    .collect();
    let mut parser = DualSenseParser::new(ConnectionType::Usb);
    for r in reports.iter().cycle().take(300) {
        h.on_report(r, parser.parse(r));
    }
    let before = stamp.load(Ordering::Acquire);
    let ((), allocs) = count_allocs(|| {
        for r in reports.iter().cycle().take(1000) {
            let parsed = parser.parse(r);
            h.on_report(r, parsed);
        }
    });
    assert!(stamp.load(Ordering::Acquire) > before);
    assert_eq!(allocs, 0, "stick mapping must not allocate per report");
}

/// A pad that, at submit time, records how many raw reports the history
/// already holds: proves output is sent before that report's bookkeeping.
struct OrderPad {
    shared: Arc<std::sync::OnceLock<Arc<Shared>>>,
    seen: Arc<Mutex<Vec<usize>>>,
}

impl VirtualControllerBackend for OrderPad {
    fn name(&self) -> &'static str {
        "order"
    }
    fn status(&self) -> BackendStatus {
        BackendStatus::Ready { version: None }
    }
    fn supports(&self, kind: VirtualOutputKind) -> bool {
        kind == VirtualOutputKind::Xbox360
    }
    fn connect(&mut self, _: VirtualOutputKind) -> Result<VirtualDeviceHandle, OutputError> {
        Ok(VirtualDeviceHandle(1))
    }
    fn update(&mut self, _: VirtualDeviceHandle, _: &ControllerState) -> Result<(), OutputError> {
        let raw = self
            .shared
            .get()
            .map_or(0, |s| s.telemetry.recent_raw(1000).len());
        self.seen.lock().unwrap().push(raw);
        Ok(())
    }
    fn disconnect(&mut self, _: VirtualDeviceHandle) -> Result<(), OutputError> {
        Ok(())
    }
}

#[test]
fn the_virtual_report_is_sent_before_diagnostics_bookkeeping() {
    let cell = Arc::new(std::sync::OnceLock::new());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (c, s) = (cell.clone(), seen.clone());
    let factory: OutputBackendFactory = Arc::new(move || {
        Box::new(OrderPad {
            shared: c.clone(),
            seen: s.clone(),
        })
    });
    let e = Engine::start(
        Arc::new(MockHidBackend::new()),
        vec![Arc::new(nexus_dualsense::DualSenseDriver)],
        factory.clone(),
        EngineConfig {
            initial_output: VirtualOutputKind::Xbox360,
            hotplug: false,
            ..Default::default()
        },
    );
    let _ = cell.set(e.shared.clone());
    let mut h = new_session_handler(&e.shared, &factory, &device());
    let raw = Payload::neutral().usb_report();
    let mut parser = DualSenseParser::new(ConnectionType::Usb);
    for _ in 0..3 {
        h.on_report(&raw, parser.parse(&raw));
    }
    // At each submit, the history held only the earlier reports.
    assert_eq!(*seen.lock().unwrap(), vec![0, 1, 2]);
    assert_eq!(
        e.recent_raw_reports(10).len(),
        3,
        "bookkeeping still happens"
    );
}
