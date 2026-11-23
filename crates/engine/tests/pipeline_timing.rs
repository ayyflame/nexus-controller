//! Real-driver timing of the whole NEXUS input path, without USB hardware:
//!
//! synthetic DualSense reports (one every 4 ms, a USB DualSense's pace)
//!   → NEXUS engine (reader thread, parsing, mapping, macros)
//!   → ViGEmBus (real driver) → Windows XInput (what the game reads).
//!
//! The reports come from a stand-in HID device whose read blocks until a
//! report arrives, like a real HID read (the test-support mock instead polls
//! every 2 ms, which would distort timing). Each report carries a unique tag
//! in its two analog triggers, which NEXUS's default trigger settings pass
//! through exactly; a time-critical reader thread polls XInput and records
//! when each tag first becomes visible.
//!
//! Scenarios: B default settings, C mappings (remaps, stick curve and
//! deadzone, a shift layer), D a macro repeating while its button is held;
//! each idle and with every CPU core busy (a stand-in for a game).
//!
//! Needs Windows with ViGEmBus; `#[ignore]`d, run by the "XInput loopback
//! check" workflow:
//!
//! ```text
//! cargo test -p nexus-engine --test pipeline_timing -- --ignored --nocapture --test-threads=1
//! ```
#![cfg(windows)]
#![allow(clippy::field_reassign_with_default)]

use nexus_controller_core::{Button, HidConnection, HidDeviceInfo, HidError, VirtualOutputKind};
use nexus_device_manager::{DeviceManagerConfig, HidBackend, STALE_INPUT_AFTER};
use nexus_dualsense::synthetic::Payload;
use nexus_engine::{supported_drivers, Engine, EngineConfig};
use nexus_input_processing::{LayerMode, MappingLayer, ProcessingConfig, RemapRule, ResponseCurve};
use nexus_macro_engine::{Macro, MacroButton, MacroStep, PlaybackMode};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
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
#[link(name = "kernel32", kind = "raw-dylib")]
extern "system" {
    fn GetCurrentThread() -> isize;
    fn SetThreadPriority(thread: isize, priority: i32) -> i32;
}
fn set_priority(p: i32) {
    // SAFETY: pseudo-handle of the calling thread; a documented priority value.
    unsafe { SetThreadPriority(GetCurrentThread(), p) };
}
fn read(slot: u32) -> Option<XInputState> {
    let mut s = XInputState::default();
    // SAFETY: `s` is a valid, writable XINPUT_STATE for the duration of the call.
    (unsafe { XInputGetState(slot, &mut s) } == 0).then_some(s)
}

// ---- A HID device whose read blocks until a report arrives ----------------

type Queue = Arc<(Mutex<VecDeque<Vec<u8>>>, Condvar)>;
const PATH: &str = r"\\?\hid#vid_054c&pid_0ce6&mi_03#timing#{4d1e55b2-f16f-11cf-88cb-001111000030}";

struct Backend(Queue);
struct Connection(Queue);

impl HidBackend for Backend {
    fn name(&self) -> &'static str {
        "timing"
    }
    fn enumerate(&self, vendor_ids: &[u16]) -> Result<Vec<HidDeviceInfo>, HidError> {
        let info = HidDeviceInfo {
            path: PATH.into(),
            vendor_id: 0x054C,
            product_id: 0x0CE6,
            usage_page: 1,
            usage: 5,
            input_report_len: 64,
            output_report_len: 48,
            product: Some("DualSense Wireless Controller".into()),
            ancestor_instance_ids: vec![
                r"USB\VID_054C&PID_0CE6&MI_03\x".into(),
                r"USB\VID_054C&PID_0CE6\y".into(),
                r"PCI\VEN_8086\z".into(),
            ],
            ..Default::default()
        };
        Ok(if vendor_ids.contains(&info.vendor_id) {
            vec![info]
        } else {
            vec![]
        })
    }
    fn open(&self, _: &HidDeviceInfo) -> Result<Box<dyn HidConnection>, HidError> {
        Ok(Box::new(Connection(self.0.clone())))
    }
}

impl HidConnection for Connection {
    fn read_report(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize, HidError> {
        let (q, ready) = &*self.0;
        let guard = q.lock().unwrap();
        let (mut guard, _) = ready
            .wait_timeout_while(guard, timeout, |q| q.is_empty())
            .unwrap();
        Ok(guard.pop_front().map_or(0, |r| {
            buf[..r.len()].copy_from_slice(&r);
            r.len()
        }))
    }
    fn get_feature_report(&mut self, buf: &mut [u8]) -> Result<usize, HidError> {
        Ok(buf.len())
    }
    fn write_output_report(&mut self, r: &[u8]) -> Result<usize, HidError> {
        Ok(r.len())
    }
}

// ---- Measurement ---------------------------------------------------------

fn dist(mut v: Vec<f64>) -> String {
    if v.is_empty() {
        return "no samples".into();
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |q: f64| v[((v.len() - 1) as f64 * q).round() as usize];
    format!(
        "n {} mean {:.0} p50 {:.0} p95 {:.0} p99 {:.0} max {:.0} us",
        v.len(),
        v.iter().sum::<f64>() / v.len() as f64,
        at(0.5),
        at(0.95),
        at(0.99),
        v[v.len() - 1]
    )
}

struct Load(Arc<AtomicBool>, Vec<std::thread::JoinHandle<()>>);
impl Load {
    fn start() -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let n = std::thread::available_parallelism().map_or(4, |n| n.get());
        let h = (0..n)
            .map(|_| {
                let stop = stop.clone();
                std::thread::spawn(move || {
                    let mut x = 1u64;
                    while !stop.load(Ordering::Relaxed) {
                        x = x.wrapping_mul(6364136223846793005).wrapping_add(1);
                        std::hint::black_box(x);
                    }
                })
            })
            .collect();
        Self(stop, h)
    }
}
impl Drop for Load {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
        for h in self.1.drain(..) {
            let _ = h.join();
        }
    }
}

fn report(k: u32, hold_r3: bool) -> Vec<u8> {
    let mut p = Payload::neutral();
    p.r2 = (k % 256) as u8;
    p.l2 = ((k / 256) % 256) as u8;
    if hold_r3 {
        p.buttons[1] |= 0x80;
    }
    p.usb_report()
}
fn tag_of(g: &XInputGamepad) -> u32 {
    u32::from(g.right_trigger) + 256 * u32::from(g.left_trigger)
}

#[allow(clippy::too_many_arguments)]
fn run(e: &Engine, q: &Queue, first: u32, n: u32, hold_r3: bool, label: &str) {
    // The slot the virtual controller is in now (it moves if it was re-created).
    let slot = u32::from(e.status().devices[0].output.player_index.unwrap_or(0));
    let log_before = e.recent_log(500).len();
    let stop = Arc::new(AtomicBool::new(false));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let reader = {
        let (stop, seen) = (stop.clone(), seen.clone());
        std::thread::spawn(move || {
            set_priority(15); // THREAD_PRIORITY_TIME_CRITICAL: the measuring reader only
            let mut last = u32::MAX;
            let mut local = Vec::with_capacity(8 * n as usize);
            let mut prev_poll = Instant::now();
            let mut worst_poll_gap = Duration::ZERO;
            let mut polls = 0u64;
            let mut slot = slot;
            let mut missing_reads = 0u64;
            let mut moves: Vec<String> = Vec::new();
            let started = Instant::now();
            while !stop.load(Ordering::Relaxed) {
                let now = Instant::now();
                worst_poll_gap = worst_poll_gap.max(now - prev_poll);
                prev_poll = now;
                polls += 1;
                let state = read(slot).or_else(|| {
                    // Not in its slot: has Windows re-created it elsewhere?
                    missing_reads += 1;
                    let found = (0..4).find(|s| read(*s).is_some());
                    if let Some(f) = found.filter(|f| *f != slot) {
                        moves.push(format!(
                            "slot {slot} -> {f} after {} ms",
                            started.elapsed().as_millis()
                        ));
                        slot = f;
                    }
                    found.and_then(read)
                });
                if let Some(s) = state {
                    if s.packet != last {
                        last = s.packet;
                        local.push((Instant::now(), tag_of(&s.gamepad), s.gamepad));
                    }
                }
                std::thread::yield_now();
            }
            *seen.lock().unwrap() = local;
            (polls, worst_poll_gap, missing_reads, moves)
        })
    };
    std::thread::sleep(Duration::from_millis(50));
    let before = e.status().devices[0].stale_reports_skipped;
    let flow_before = e.status().devices[0].flow;
    // The stand-in controller is hardware: it must not be starved by the load.
    set_priority(15);
    // The "controller": a report every 4 ms by deadline.
    let period = Duration::from_millis(4);
    let start = Instant::now() + Duration::from_millis(10);
    let mut pushed = Vec::with_capacity(n as usize);
    for i in 0..n {
        let due = start + period * i;
        let now = Instant::now();
        if due > now + Duration::from_micros(1500) {
            std::thread::sleep(due - now - Duration::from_micros(1500));
        }
        while Instant::now() < due {
            std::hint::spin_loop();
        }
        let (lock, ready) = &**q;
        let t = Instant::now();
        lock.lock().unwrap().push_back(report(first + i, hold_r3));
        ready.notify_one();
        pushed.push(t);
    }
    std::thread::sleep(Duration::from_millis(80));
    set_priority(0);
    stop.store(true, Ordering::Relaxed);
    let (polls, worst_poll_gap, missing_reads, moves) = reader.join().unwrap();
    let seen = seen.lock().unwrap().clone();
    let mut first_seen = HashMap::new();
    for (t, tag, _) in &seen {
        first_seen.entry(*tag).or_insert(*t);
    }
    let mut delivery = Vec::new();
    let mut missing = 0;
    for (i, t) in pushed.iter().enumerate() {
        match first_seen.get(&(first + i as u32)) {
            Some(s) => delivery.push(s.saturating_duration_since(*t).as_secs_f64() * 1e6),
            None => missing += 1,
        }
    }
    let ours: Vec<Instant> = seen
        .iter()
        .filter(|(_, tag, _)| *tag >= first && *tag < first + n)
        .map(|(t, _, _)| *t)
        .collect();
    let gaps: Vec<f64> = ours
        .windows(2)
        .map(|w| (w[1] - w[0]).as_secs_f64() * 1e6)
        .collect();
    let push_gaps: Vec<f64> = pushed
        .windows(2)
        .map(|w| (w[1] - w[0]).as_secs_f64() * 1e6)
        .collect();
    let s = e.status();
    let d = &s.devices[0];
    let final_ok = read(slot).map(|s| tag_of(&s.gamepad)) == Some(first + n - 1);
    println!("PIPELINE {label}: {n} reports every 4 ms");
    println!(
        "PIPELINE {label}   report spacing (sent)   {}",
        dist(push_gaps)
    );
    println!(
        "PIPELINE {label}   report -> XInput        {}",
        dist(delivery)
    );
    println!("PIPELINE {label}   XInput change gaps      {}", dist(gaps));
    println!(
        "PIPELINE {label}   never visible: {missing} of {n} ({:.1} %); stale reports skipped by NEXUS: {}; final state shown: {final_ok}",
        100.0 * f64::from(missing) / f64::from(n),
        d.stale_reports_skipped - before
    );
    let o = &d.output;
    let last_seen = seen.last().map(|(_, _, g)| *g);
    let p = d.processed.as_ref();
    println!(
        "PIPELINE {label}   XInput changes seen {} (any value); last XInput state {:?}; NEXUS's last frame: L2 {:?} R2 {:?} buttons south {:?}; frames sent {} (repeats {}) since start of run; expected last tag {} = L2 {} R2 {}",
        seen.len(),
        last_seen,
        p.map(|p| p.left_trigger.raw),
        p.map(|p| p.right_trigger.raw),
        p.map(|p| p.buttons.south),
        d.flow.outputs - flow_before.outputs,
        d.flow.unchanged_outputs - flow_before.unchanged_outputs,
        first + n - 1,
        (first + n - 1) / 256,
        (first + n - 1) % 256,
    );
    println!(
        "PIPELINE {label}   virtual controller: active {:?}, slot read {slot} -> now {:?}, retrying {}, last error {:?}; XInput polls {polls}, longest gap between polls {} us; reads with the controller absent from its slot {missing_reads}; slot moves {moves:?}",
        o.active, o.player_index, o.retrying, o.last_error, worst_poll_gap.as_micros()
    );
    let log = e.recent_log(500);
    for entry in log.iter().skip(log_before) {
        if entry.category == "output" || entry.category == "device" {
            println!(
                "PIPELINE {label}   log: {:?} {} {}",
                entry.level, entry.category, entry.message
            );
        }
    }
    println!(
        "PIPELINE {label}   engine: processing p50 {} p99 {} max {} us; stages p50/p99 ns: handover {}/{}, mapping {}/{}, macros {}/{}, driver call {}/{}; report intervals mean {} max {} us",
        d.pipeline_latency.p50_us, d.pipeline_latency.p99_us, d.pipeline_latency.max_us,
        d.stage_latency.input.p50_ns, d.stage_latency.input.p99_ns,
        d.stage_latency.mapping.p50_ns, d.stage_latency.mapping.p99_ns,
        d.stage_latency.macros.p50_ns, d.stage_latency.macros.p99_ns,
        d.stage_latency.output.p50_ns, d.stage_latency.output.p99_ns,
        d.report_intervals.mean_us, d.report_intervals.max_us,
    );
}

#[test]
#[ignore = "needs Windows with ViGEmBus; run by the XInput loopback workflow"]
fn controller_reports_reach_xinput_through_nexus_on_time() {
    let q: Queue = Arc::new((Mutex::new(VecDeque::new()), Condvar::new()));
    let before: Vec<u32> = (0..4).filter(|s| read(*s).is_some()).collect();
    let e = Engine::start(
        Arc::new(Backend(q.clone())),
        supported_drivers(),
        Arc::new(nexus_virtual_controller::platform_backend),
        EngineConfig {
            devices: DeviceManagerConfig {
                scan_interval: Duration::from_millis(20),
                read_timeout: Duration::from_millis(100),
                stale_after: STALE_INPUT_AFTER,
            },
            hotplug: false,
            initial_output: VirtualOutputKind::Xbox360,
            ..Default::default()
        },
    );
    let deadline = Instant::now() + Duration::from_secs(15);
    let slot = loop {
        if let Some(s) = (0..4).find(|s| !before.contains(s) && read(*s).is_some()) {
            break s;
        }
        assert!(
            Instant::now() < deadline,
            "the virtual controller never appeared in XInput: {:?}",
            e.status().devices.first().map(|d| &d.output)
        );
        std::thread::sleep(Duration::from_millis(10));
    };
    // The tag must pass through default processing exactly.
    {
        let (lock, ready) = &*q;
        lock.lock().unwrap().push_back(report(300, false));
        ready.notify_one();
        let t = Instant::now();
        while read(slot).map(|s| tag_of(&s.gamepad)) != Some(300) {
            assert!(
                t.elapsed() < Duration::from_secs(2),
                "tag not passed through exactly: {:?}",
                read(slot)
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    let n = 1500;
    let mapping = {
        let mut c = ProcessingConfig::default();
        c.remap = vec![
            RemapRule::new(Button::South, Some(Button::East)),
            RemapRule::new(Button::West, Some(Button::North)),
            RemapRule::new(Button::Touchpad, Some(Button::Select)),
        ];
        c.left_stick.deadzone = 0.12;
        c.left_stick.curve = ResponseCurve::Power { exponent: 1.6 };
        c.right_stick.curve = ResponseCurve::Power { exponent: 2.0 };
        c.layers = vec![MappingLayer {
            name: "Shift".into(),
            activator: Button::LeftShoulder,
            mode: LayerMode::Hold,
            remap: vec![RemapRule::new(Button::North, Some(Button::South))],
        }];
        c
    };
    let rapid = Macro {
        id: "rapid".into(),
        name: "Rapid A".into(),
        description: String::new(),
        enabled: true,
        steps: vec![MacroStep {
            id: "s".into(),
            buttons: vec![MacroButton::South],
            hold_ms: 30,
            delay_after_ms: 30,
        }],
        trigger: Some(MacroButton::RightStick),
        mode: PlaybackMode::RepeatWhileHeld,
        repeat_delay_ms: 0,
        block_trigger: true,
        activation_ms: 0,
        created_at_ms: 0,
        updated_at_ms: 0,
    };
    let mut k = 1000;
    for loaded in [false, true] {
        let _load = loaded.then(Load::start);
        let tail = if loaded { ", all cores busy" } else { "" };
        std::thread::sleep(Duration::from_millis(200));
        e.set_processing(ProcessingConfig::default());
        e.set_macros(vec![]);
        run(&e, &q, k, n, false, &format!("B default{tail}"));
        k += n + 100;
        e.set_processing(mapping.clone());
        run(&e, &q, k, n, false, &format!("C mappings{tail}"));
        k += n + 100;
        e.set_processing(ProcessingConfig::default());
        e.set_macros(vec![rapid.clone()]);
        run(&e, &q, k, n, true, &format!("D macro playing{tail}"));
        k += n + 100;
        e.set_macros(vec![]);
    }
    e.shutdown();
}
