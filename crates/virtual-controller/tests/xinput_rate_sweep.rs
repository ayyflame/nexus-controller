//! Measurement only (feasibility of high output rates): how fast ViGEmBus
//! accepts updates and how many of them Windows' XInput API (what games read)
//! actually shows, at 125, 250, 500, 1000, 2000, 4000 and 8000 updates per
//! second. Nothing here changes how NEXUS runs.
//!
//! Per rate, for a 2 s stream of updates that each carry a unique tag in the
//! two analog triggers (no buttons):
//! - achieved submit spacing and deadline misses (an update started after
//!   the next one was already due);
//! - the synchronous driver call's duration and the sender thread's kernel
//!   CPU time (the driver's work runs in the caller's thread);
//! - submit → XInput latency, XInput's distinct visible updates per second,
//!   updates XInput never showed, and XInput's packet counter;
//! - the measuring reader's own poll spacing (the resolution of the check).
//!
//! Also: unchanged frames (the same state resubmitted) and two rates with
//! every core busy.
//!
//! Simulated output on a virtual machine; not a physical controller or a game.
//! Needs Windows with ViGEmBus; `#[ignore]`d, run by the "XInput loopback
//! check" workflow:
//!
//! ```text
//! cargo test --release -p nexus-virtual-controller --test xinput_rate_sweep -- --ignored --nocapture --test-threads=1
//! ```
#![cfg(windows)]
#![allow(clippy::field_reassign_with_default)]

use nexus_controller_core::{ControllerState, TriggerState, VirtualOutputKind};
use nexus_virtual_controller::vigem::ViGEmBackend;
use nexus_virtual_controller::{BackendStatus, VirtualControllerBackend, VirtualOutputManager};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct FileTime {
    low: u32,
    high: u32,
}
impl FileTime {
    /// 100 ns units.
    fn ticks(self) -> u64 {
        u64::from(self.low) | (u64::from(self.high) << 32)
    }
}

#[link(name = "xinput1_4", kind = "raw-dylib")]
extern "system" {
    fn XInputGetState(user_index: u32, state: *mut XInputState) -> u32;
}
#[link(name = "kernel32", kind = "raw-dylib")]
extern "system" {
    fn GetCurrentThread() -> isize;
    fn SetThreadPriority(thread: isize, priority: i32) -> i32;
    fn GetThreadTimes(
        thread: isize,
        creation: *mut FileTime,
        exit: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> i32;
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
/// The calling thread's (kernel, user) CPU time.
fn thread_cpu() -> (Duration, Duration) {
    let (mut c, mut e, mut k, mut u) = Default::default();
    // SAFETY: pseudo-handle of the calling thread; four valid FILETIME outputs.
    unsafe { GetThreadTimes(GetCurrentThread(), &mut c, &mut e, &mut k, &mut u) };
    let d = |f: FileTime| Duration::from_nanos(f.ticks() * 100);
    (d(k), d(u))
}

/// Mean, p50, p95, p99, max of `v` (microseconds).
fn dist(mut v: Vec<f64>) -> String {
    if v.is_empty() {
        return "no samples".into();
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |q: f64| v[((v.len() - 1) as f64 * q).round() as usize];
    format!(
        "n {} mean {:.1} p50 {:.1} p95 {:.1} p99 {:.1} max {:.0} us",
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

fn tagged(k: u32) -> ControllerState {
    let mut s = ControllerState::default();
    s.right_trigger = TriggerState::from_u8((k % 256) as u8, false);
    s.left_trigger = TriggerState::from_u8(((k / 256) % 256) as u8, false);
    s
}
fn tag_of(g: &XInputGamepad) -> u32 {
    u32::from(g.right_trigger) + 256 * u32::from(g.left_trigger)
}

struct Seen {
    changes: Vec<(Instant, u32, u32)>,
    poll_gaps_ns: Vec<u32>,
}

/// One 2 s stream at `rate` updates per second; tags `first..first + n`
/// (or `first` every time with `unchanged`).
fn stream(
    m: &mut VirtualOutputManager,
    slot: u32,
    rate: u32,
    first: u32,
    unchanged: bool,
    label: &str,
) -> u32 {
    let n = rate * 2;
    assert!(first + n < 65_536, "tags fit the two triggers");
    let stop = Arc::new(AtomicBool::new(false));
    let reader = {
        let stop = stop.clone();
        std::thread::spawn(move || {
            set_priority(THREAD_PRIORITY_TIME_CRITICAL);
            let mut out = Seen {
                changes: Vec::with_capacity(2 * n as usize),
                poll_gaps_ns: Vec::with_capacity(1 << 20),
            };
            let mut last_packet = u32::MAX;
            let mut prev = Instant::now();
            while !stop.load(Ordering::Relaxed) {
                if let Some(s) = read(slot) {
                    let now = Instant::now();
                    if out.poll_gaps_ns.len() < (1 << 22) {
                        out.poll_gaps_ns
                            .push((now - prev).as_nanos().min(u128::from(u32::MAX)) as u32);
                    }
                    prev = now;
                    if s.packet != last_packet {
                        last_packet = s.packet;
                        out.changes.push((now, s.packet, tag_of(&s.gamepad)));
                    }
                }
                std::thread::yield_now();
            }
            out
        })
    };
    std::thread::sleep(Duration::from_millis(50));
    set_priority(THREAD_PRIORITY_ABOVE_NORMAL);
    let period = Duration::from_nanos(1_000_000_000 / u64::from(rate));
    let start = Instant::now() + Duration::from_millis(10);
    let mut sent = Vec::with_capacity(n as usize);
    let mut call = Vec::with_capacity(n as usize);
    let mut late = Vec::with_capacity(n as usize);
    let mut missed = 0u32;
    let mut failed = 0u32;
    let cpu0 = thread_cpu();
    for i in 0..n {
        let due = start + period * i;
        let now = Instant::now();
        // Sleep only when well ahead (Windows sleeps in about 1 ms steps), then spin.
        if due > now + Duration::from_micros(2000) {
            std::thread::sleep(due - now - Duration::from_micros(2000));
        }
        while Instant::now() < due {
            std::hint::spin_loop();
        }
        let t = Instant::now();
        let lateness = t - due;
        if lateness > period {
            missed += 1;
        }
        late.push(lateness.as_secs_f64() * 1e6);
        m.submit(&tagged(if unchanged { first } else { first + i }));
        call.push(t.elapsed().as_secs_f64() * 1e6);
        if m.take_event().is_some() {
            failed += 1;
        }
        sent.push(t);
    }
    let cpu1 = thread_cpu();
    let wall = sent[sent.len() - 1] - sent[0];
    std::thread::sleep(Duration::from_millis(60));
    stop.store(true, Ordering::Relaxed);
    let seen = reader.join().unwrap();

    let mut first_seen: HashMap<u32, Instant> = HashMap::new();
    for (t, _, tag) in &seen.changes {
        first_seen.entry(*tag).or_insert(*t);
    }
    let ours: Vec<&(Instant, u32, u32)> = seen
        .changes
        .iter()
        .filter(|(t, _, tag)| *tag >= first && *tag < first + n && *t >= sent[0])
        .collect();
    let mut delivery = Vec::new();
    let mut never = 0u32;
    if !unchanged {
        for (i, t) in sent.iter().enumerate() {
            match first_seen.get(&(first + i as u32)) {
                Some(s) => delivery.push(s.saturating_duration_since(*t).as_secs_f64() * 1e6),
                None => never += 1,
            }
        }
    }
    let gaps: Vec<f64> = ours
        .windows(2)
        .map(|w| (w[1].0 - w[0].0).as_secs_f64() * 1e6)
        .collect();
    let spacing: Vec<f64> = sent
        .windows(2)
        .map(|w| (w[1] - w[0]).as_secs_f64() * 1e6)
        .collect();
    let packets = match (ours.first(), ours.last()) {
        (Some(a), Some(b)) => b.1.wrapping_sub(a.1),
        _ => 0,
    };
    let poll: Vec<f64> = seen
        .poll_gaps_ns
        .iter()
        .skip(1)
        .map(|n| f64::from(*n) / 1000.0)
        .collect();
    let secs = wall.as_secs_f64().max(1e-9);
    let kernel = cpu1.0.saturating_sub(cpu0.0);
    let user = cpu1.1.saturating_sub(cpu0.1);
    let final_ok = read(slot).map(|s| tag_of(&s.gamepad))
        == Some(if unchanged { first } else { first + n - 1 });

    println!(
        "SWEEP {label}: {n} updates at {rate} Hz (period {:.1} us)",
        period.as_secs_f64() * 1e6
    );
    println!(
        "SWEEP {label}   achieved {:.0} updates/s; deadline misses {missed} ({:.2} %); driver errors {failed}",
        f64::from(n - 1) / secs,
        100.0 * f64::from(missed) / f64::from(n)
    );
    println!("SWEEP {label}   submit spacing      {}", dist(spacing));
    println!("SWEEP {label}   start lateness      {}", dist(late));
    println!("SWEEP {label}   driver call         {}", dist(call.clone()));
    println!(
        "SWEEP {label}   sender CPU: kernel {:.1} ms ({:.1} % of a core, {:.1} us per update), user {:.1} ms (mostly the pacing spin); driver call time {:.1} % of wall time",
        kernel.as_secs_f64() * 1e3,
        100.0 * kernel.as_secs_f64() / secs,
        kernel.as_secs_f64() * 1e6 / f64::from(n),
        user.as_secs_f64() * 1e3,
        100.0 * call.iter().sum::<f64>() / 1e6 / secs
    );
    if unchanged {
        println!(
            "SWEEP {label}   unchanged frames: XInput packet advanced {} times in total (changes recorded {}); final state shown: {final_ok}",
            seen.changes.last().map_or(0, |l| l.1.wrapping_sub(seen.changes[0].1)),
            seen.changes.len()
        );
    } else {
        println!("SWEEP {label}   submit -> XInput    {}", dist(delivery));
        println!("SWEEP {label}   XInput change gaps  {}", dist(gaps));
        println!(
            "SWEEP {label}   XInput showed {} distinct updates ({:.0}/s); never visible {never} of {n} ({:.1} %); packet number advanced {packets}; final state shown: {final_ok}",
            ours.len(),
            ours.len() as f64 / secs,
            100.0 * f64::from(never) / f64::from(n)
        );
    }
    println!(
        "SWEEP {label}   measuring reader: XInputGetState every {}",
        dist(poll)
    );
    first + n + 10
}

#[test]
#[ignore = "needs Windows with ViGEmBus; run by the XInput loopback workflow"]
fn output_rate_sweep_through_vigembus_and_xinput() {
    let backend = ViGEmBackend::new();
    if let BackendStatus::Unavailable { reason } = backend.status() {
        panic!("ViGEmBus is not available on this machine: {reason}");
    }
    println!(
        "SWEEP machine: {} logical processors",
        std::thread::available_parallelism().map_or(0, |n| n.get())
    );
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
    let mut k = 1;
    for rate in [125, 250, 500, 1000, 2000, 4000, 8000] {
        k = stream(&mut m, slot, rate, k, false, &format!("{rate} Hz"));
        std::thread::sleep(Duration::from_millis(200));
    }
    // Tags restart low; every run's tags differ from the state left by the last one.
    let mut k = 40_000;
    for rate in [1000, 8000] {
        k = stream(
            &mut m,
            slot,
            rate,
            k,
            true,
            &format!("{rate} Hz unchanged frames"),
        );
        k += 1;
        std::thread::sleep(Duration::from_millis(200));
    }
    let mut k = 1;
    {
        let _load = Load::start();
        std::thread::sleep(Duration::from_millis(200));
        for rate in [1000, 8000] {
            k = stream(
                &mut m,
                slot,
                rate,
                k,
                false,
                &format!("{rate} Hz, all cores busy"),
            );
        }
    }
    m.set_mode(VirtualOutputKind::Disabled).expect("remove");
}
