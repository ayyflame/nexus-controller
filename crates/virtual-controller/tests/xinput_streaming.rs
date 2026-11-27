//! Real-driver timing: how ViGEmBus delivers a **stream** of updates at a
//! controller's pace (one every 4 ms, 250 Hz) to Windows' XInput API, the
//! interface games read. Measures, per update, the time from NEXUS's
//! submission to the moment XInput shows it, and counts updates XInput never
//! showed (coalesced or dropped by the driver).
//!
//! Needs Windows with ViGEmBus; `#[ignore]`d, run by the "XInput loopback
//! check" workflow on a GitHub-hosted machine:
//!
//! ```text
//! cargo test -p nexus-virtual-controller --test xinput_streaming -- --ignored --nocapture --test-threads=1
//! ```
//!
//! Measurement method (this file only, not how NEXUS runs):
//! - each update carries a unique tag in its two analog triggers;
//! - a reader thread at time-critical priority polls XInputGetState
//!   continuously and records when each tag first appears (and XInput's
//!   packet number, which advances once per delivered update);
//! - the sender uses the same priority as NEXUS's reader thread (one step
//!   above normal) and paces updates by deadline (sleep, then a short spin).
//! - "under load": one busy thread per CPU core at normal priority, a
//!   stand-in for a game keeping every core busy.
#![cfg(windows)]
#![allow(clippy::field_reassign_with_default)]

use nexus_controller_core::{ControllerState, TriggerState, VirtualOutputKind};
use nexus_virtual_controller::vigem::ViGEmBackend;
use nexus_virtual_controller::{BackendStatus, VirtualControllerBackend, VirtualOutputManager};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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

#[link(name = "kernel32", kind = "raw-dylib")]
extern "system" {
    fn GetCurrentThread() -> isize;
    fn SetThreadPriority(thread: isize, priority: i32) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
    fn QueryFullProcessImageNameW(
        process: isize,
        flags: u32,
        name: *mut u16,
        size: *mut u32,
    ) -> i32;
    fn CloseHandle(h: isize) -> i32;
}
#[link(name = "user32", kind = "raw-dylib")]
extern "system" {
    fn GetForegroundWindow() -> isize;
    fn GetWindowTextW(hwnd: isize, text: *mut u16, max: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
}

/// The window in front and its program, for the log.
fn foreground() -> String {
    // SAFETY: plain Win32 queries with valid buffers; the process handle is closed.
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut title = [0u16; 256];
        let n = GetWindowTextW(hwnd, title.as_mut_ptr(), 256).max(0) as usize;
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let p = OpenProcess(0x1000, 0, pid);
        let mut name = [0u16; 512];
        let mut len = 512u32;
        let exe = if p != 0 && QueryFullProcessImageNameW(p, 0, name.as_mut_ptr(), &mut len) != 0 {
            String::from_utf16_lossy(&name[..len as usize])
        } else {
            "?".into()
        };
        if p != 0 {
            CloseHandle(p);
        }
        format!(
            "\"{}\" ({exe}, pid {pid})",
            String::from_utf16_lossy(&title[..n])
        )
    }
}

const THREAD_PRIORITY_ABOVE_NORMAL: i32 = 1;
const THREAD_PRIORITY_TIME_CRITICAL: i32 = 15;

fn set_priority(p: i32) {
    // SAFETY: pseudo-handle of the calling thread; a documented priority value.
    unsafe { SetThreadPriority(GetCurrentThread(), p) };
}

fn read(slot: u32) -> Option<XInputState> {
    let mut s = XInputState::default();
    // SAFETY: `s` is a valid, writable XINPUT_STATE for the duration of the call.
    (unsafe { XInputGetState(slot, &mut s) } == 0).then_some(s)
}

/// Distribution of `v` (microseconds): mean, p50, p95, p99, max.
pub fn dist(mut v: Vec<f64>) -> String {
    if v.is_empty() {
        return "no samples".into();
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |q: f64| v[((v.len() - 1) as f64 * q).round() as usize];
    let mean = v.iter().sum::<f64>() / v.len() as f64;
    format!(
        "n {} mean {:.0} p50 {:.0} p95 {:.0} p99 {:.0} max {:.0} us",
        v.len(),
        mean,
        at(0.5),
        at(0.95),
        at(0.99),
        v[v.len() - 1]
    )
}

/// Busy threads on every core (a stand-in for a game), until dropped.
struct Load(Arc<AtomicBool>, Vec<std::thread::JoinHandle<()>>);
impl Load {
    fn start() -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let n = std::thread::available_parallelism().map_or(4, |n| n.get());
        let handles = (0..n)
            .map(|_| {
                let stop = stop.clone();
                std::thread::spawn(move || {
                    let mut x = 0u64;
                    while !stop.load(Ordering::Relaxed) {
                        x = x.wrapping_mul(6364136223846793005).wrapping_add(1);
                        std::hint::black_box(x);
                    }
                })
            })
            .collect();
        Self(stop, handles)
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

/// The tag of update `k`: its two trigger values.
fn tagged(k: u32) -> ControllerState {
    let mut s = ControllerState::default();
    s.right_trigger = TriggerState::from_u8((k % 256) as u8, false);
    s.left_trigger = TriggerState::from_u8(((k / 256) % 256) as u8, false);
    s
}
fn tag_of(g: &XInputGamepad) -> u32 {
    u32::from(g.right_trigger) + 256 * u32::from(g.left_trigger)
}

/// `press_a`: also press A for 30 ms every 60 ms (the pattern of a rapid-fire macro).
fn stream(m: &mut VirtualOutputManager, slot: u32, n: u32, first: u32, press_a: bool, label: &str) {
    println!("STREAM {label}: in front before: {}", foreground());
    let stop = Arc::new(AtomicBool::new(false));
    let seen: Arc<Mutex<Vec<(Instant, u32, u32)>>> =
        Arc::new(Mutex::new(Vec::with_capacity(4 * n as usize)));
    let reader = {
        let (stop, seen) = (stop.clone(), seen.clone());
        std::thread::spawn(move || {
            set_priority(THREAD_PRIORITY_TIME_CRITICAL);
            let mut last_packet = u32::MAX;
            let mut local = Vec::with_capacity(4 * n as usize);
            while !stop.load(Ordering::Relaxed) {
                if let Some(s) = read(slot) {
                    if s.packet != last_packet {
                        last_packet = s.packet;
                        local.push((Instant::now(), s.packet, tag_of(&s.gamepad)));
                    }
                }
                std::thread::yield_now();
            }
            *seen.lock().unwrap() = local;
        })
    };
    std::thread::sleep(Duration::from_millis(50));
    set_priority(THREAD_PRIORITY_ABOVE_NORMAL);
    let period = Duration::from_millis(4);
    let start = Instant::now() + Duration::from_millis(10);
    let mut sent = Vec::with_capacity(n as usize);
    let mut call = Vec::with_capacity(n as usize);
    for i in 0..n {
        let due = start + period * i;
        let now = Instant::now();
        if due > now + Duration::from_micros(1500) {
            std::thread::sleep(due - now - Duration::from_micros(1500));
        }
        while Instant::now() < due {
            std::hint::spin_loop();
        }
        let t = Instant::now();
        let mut s = tagged(first + i);
        // 4 ms per update: 30 ms ≈ 7.5 updates; on for 8, off for 7.
        s.buttons.south = press_a && (i % 15) < 8;
        m.submit(&s);
        call.push(t.elapsed().as_secs_f64() * 1e6);
        assert_eq!(m.take_event(), None, "update {i} failed");
        sent.push(t);
    }
    std::thread::sleep(Duration::from_millis(60));
    stop.store(true, Ordering::Relaxed);
    reader.join().unwrap();
    let seen = seen.lock().unwrap().clone();

    // First time each tag was visible.
    let mut first_seen: HashMap<u32, Instant> = HashMap::new();
    for (t, _, tag) in &seen {
        first_seen.entry(*tag).or_insert(*t);
    }
    let mut delivery = Vec::new();
    let mut missing = 0u32;
    for (i, t) in sent.iter().enumerate() {
        match first_seen.get(&(first + i as u32)) {
            Some(s) => delivery.push(s.saturating_duration_since(*t).as_secs_f64() * 1e6),
            None => missing += 1,
        }
    }
    let visible: Vec<&(Instant, u32, u32)> = seen
        .iter()
        .filter(|(_, _, tag)| *tag >= first && *tag < first + n)
        .collect();
    let gaps: Vec<f64> = visible
        .windows(2)
        .map(|w| (w[1].0 - w[0].0).as_secs_f64() * 1e6)
        .collect();
    let packets = visible.last().map_or(0, |l| l.1.wrapping_sub(visible[0].1));
    let send_gaps: Vec<f64> = sent
        .windows(2)
        .map(|w| (w[1] - w[0]).as_secs_f64() * 1e6)
        .collect();
    let last_ok = read(slot).map(|s| tag_of(&s.gamepad)) == Some(first + n - 1);
    // When did XInput stop following (if it did)? The last tag it showed.
    if let Some((t, _, tag)) = visible.last() {
        if *tag != first + n - 1 {
            println!(
                "STREAM {label}   XInput stopped following after update {} ({} ms into the stream); last XInput state {:?}",
                tag - first,
                t.saturating_duration_since(sent[0]).as_millis(),
                read(slot).map(|s| s.gamepad)
            );
        }
    }
    println!("STREAM {label}   in front after: {}", foreground());
    println!("STREAM {label}: {n} updates every 4 ms");
    println!("STREAM {label}   submit spacing      {}", dist(send_gaps));
    println!("STREAM {label}   driver call         {}", dist(call));
    println!("STREAM {label}   submit -> XInput    {}", dist(delivery));
    println!("STREAM {label}   XInput change gaps  {}", dist(gaps));
    println!(
        "STREAM {label}   never visible in XInput: {missing} of {n} ({:.1} %); XInput packet numbers advanced {packets}; final state shown: {last_ok}",
        100.0 * f64::from(missing) / f64::from(n)
    );
}

#[test]
#[ignore = "needs Windows with ViGEmBus; run by the XInput loopback workflow"]
fn a_stream_of_updates_reaches_xinput_on_time() {
    let backend = ViGEmBackend::new();
    if let BackendStatus::Unavailable { reason } = backend.status() {
        panic!("ViGEmBus is not available on this machine: {reason}");
    }
    let before: Vec<u32> = (0..4).filter(|s| read(*s).is_some()).collect();
    let mut m = VirtualOutputManager::new(Box::new(backend));
    m.set_mode(VirtualOutputKind::Xbox360)
        .expect("create the virtual controller");
    let deadline = Instant::now() + Duration::from_secs(10);
    let slot = loop {
        if let Some(s) = (0..4).find(|s| !before.contains(s) && read(*s).is_some()) {
            break s;
        }
        assert!(
            Instant::now() < deadline,
            "the virtual controller never appeared in XInput"
        );
        std::thread::sleep(Duration::from_millis(10));
    };
    std::thread::sleep(Duration::from_millis(300));
    stream(&mut m, slot, 1500, 1, false, "idle");
    {
        let _load = Load::start();
        std::thread::sleep(Duration::from_millis(200));
        stream(&mut m, slot, 1500, 2000, false, "all cores busy");
    }
    // The pattern NEXUS sends while a rapid-fire macro plays, without NEXUS's
    // engine: if XInput stops following here too, the cause is outside NEXUS.
    stream(
        &mut m,
        slot,
        2500,
        4000,
        true,
        "A pressed every 60 ms (macro pattern)",
    );
    std::thread::sleep(Duration::from_millis(500));
    stream(&mut m, slot, 500, 7000, false, "afterwards, no buttons");
    m.set_mode(VirtualOutputKind::Disabled).expect("remove");
}
