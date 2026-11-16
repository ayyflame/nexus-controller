//! Test-only allocation counter. Declare it as the global allocator in a test
//! binary and wrap the code under test in [`count`]. Only allocations made on
//! the calling thread while counting are counted.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicU64, Ordering};

thread_local! { static COUNTING: Cell<bool> = const { Cell::new(false) }; }
static ALLOCS: AtomicU64 = AtomicU64::new(0);

pub struct Counting;

fn tick() {
    if COUNTING.with(Cell::get) {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
    }
}

// SAFETY: forwards every call unchanged to the system allocator.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        tick();
        // SAFETY: same contract as the caller's.
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        // SAFETY: same contract as the caller's.
        unsafe { System.dealloc(p, l) }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        tick();
        // SAFETY: same contract as the caller's.
        unsafe { System.realloc(p, l, n) }
    }
}

/// Runs `f` and returns its result and the allocations it made on this thread.
pub fn count<R>(f: impl FnOnce() -> R) -> (R, u64) {
    let before = ALLOCS.load(Ordering::Relaxed);
    COUNTING.with(|c| c.set(true));
    let r = f();
    COUNTING.with(|c| c.set(false));
    (r, ALLOCS.load(Ordering::Relaxed) - before)
}
