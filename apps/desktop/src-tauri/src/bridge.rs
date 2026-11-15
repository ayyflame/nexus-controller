//! Pushes engine state to the UI.
//!
//! The engine never calls into Tauri. This thread polls the engine at a fixed
//! UI rate, which decouples controller input (≈250 Hz or more) from rendering.
//! A stalled webview therefore cannot back-pressure the input path.

use nexus_engine::Engine;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const EVENT_STATUS: &str = "nexus://status";
pub const EVENT_ENGINE: &str = "nexus://engine-event";
const FRAME: Duration = Duration::from_millis(16);

pub struct Bridge {
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Bridge {
    pub fn spawn(app: AppHandle, engine: Arc<Engine>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let events = engine.subscribe();
        let thread = std::thread::Builder::new()
            .name("nexus-ui-bridge".into())
            .spawn(move || {
                let mut last_revision = 0;
                while !flag.load(Ordering::Acquire) {
                    for event in events.try_iter() {
                        let _ = app.emit(EVENT_ENGINE, &event);
                    }
                    let revision = engine.revision();
                    if revision != last_revision {
                        last_revision = revision;
                        let _ = app.emit(EVENT_STATUS, engine.status());
                    }
                    std::thread::sleep(FRAME);
                }
            })
            .expect("failed to spawn UI bridge thread");
        Self {
            stop,
            thread: Mutex::new(Some(thread)),
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = t.join();
        }
    }
}
