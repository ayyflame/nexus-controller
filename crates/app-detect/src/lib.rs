//! Game detection for automatic profile switching.
//!
//! Uses only the standard Windows APIs that task managers use: the
//! foreground window → its process ID → the process's executable path
//! (`PROCESS_QUERY_LIMITED_INFORMATION`). NEXUS never reads or writes another
//! process's memory and never injects anything.

#![deny(unsafe_code)]

use std::time::{Duration, Instant};

/// What is in the foreground.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Foreground {
    /// No window has focus (e.g. locked screen).
    Nothing,
    /// Executable file name, lower case (e.g. `eldenring.exe`).
    Executable(String),
    /// A window has focus but its program could not be identified (for
    /// example an elevated process). Treated as "no change".
    Unknown,
}

/// Returns the program owning the foreground window.
pub fn foreground() -> Foreground {
    ForegroundWatcher::default().current()
}

/// Remembers which program owns the foreground window, so asking twice a
/// second does not open a handle to that program (usually the game) every
/// time. The program is looked up again only when the foreground window or
/// its process changes; finding the window and its process ID opens nothing.
#[derive(Debug, Default)]
pub struct ForegroundWatcher {
    last: Option<((usize, u32), Foreground)>,
}

impl ForegroundWatcher {
    pub fn current(&mut self) -> Foreground {
        #[cfg(windows)]
        {
            match windows::foreground_window() {
                None => self.resolve(None, || Foreground::Nothing),
                Some((_, 0)) => Foreground::Unknown,
                Some(key) => self.resolve(Some(key), || windows::executable_of(key.1)),
            }
        }
        #[cfg(not(windows))]
        {
            Foreground::Unknown
        }
    }

    /// `key` is (window, process ID); `lookup` names the program.
    #[cfg_attr(not(windows), allow(dead_code))]
    fn resolve(
        &mut self,
        key: Option<(usize, u32)>,
        lookup: impl FnOnce() -> Foreground,
    ) -> Foreground {
        let Some(key) = key else {
            self.last = None;
            return lookup();
        };
        match &self.last {
            Some((k, fg)) if *k == key => fg.clone(),
            _ => {
                let fg = lookup();
                self.last = Some((key, fg.clone()));
                fg
            }
        }
    }
}

pub fn supported() -> bool {
    cfg!(windows)
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod windows {
    use super::Foreground;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    /// The foreground window and its process ID. Opens nothing.
    pub fn foreground_window() -> Option<(usize, u32)> {
        // SAFETY: plain Win32 queries with a valid out-pointer.
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            Some((hwnd as usize, pid))
        }
    }

    /// The executable file name of a process (query-only handle, closed
    /// before returning).
    pub fn executable_of(pid: u32) -> Foreground {
        // SAFETY: plain Win32 queries with valid out-pointers; the process
        // handle is closed before returning.
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return Foreground::Unknown;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok =
                QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len)
                    != 0;
            CloseHandle(process);
            if !ok {
                return Foreground::Unknown;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            match path.rsplit(['\\', '/']).next() {
                Some(name) if !name.is_empty() => Foreground::Executable(name.to_lowercase()),
                _ => Foreground::Unknown,
            }
        }
    }
}

/// Decides when to switch profiles as the foreground program changes.
///
/// * A game must stay in the foreground for `settle` before switching
///   (alt-tabbing past a game does nothing).
/// * The profile active before the game ("home") is restored when the user
///   leaves the game, unless they switched profile manually meanwhile.
/// * NEXUS itself and unidentifiable programs never cause a switch.
#[derive(Debug)]
pub struct AutoSwitcher {
    settle: Duration,
    home: Option<i64>,
    game_profile: Option<i64>,
    candidate: Option<(Foreground, Instant)>,
    ignore: Vec<String>,
}

impl AutoSwitcher {
    pub fn new(settle: Duration, ignore: &[&str]) -> Self {
        Self {
            settle,
            home: None,
            game_profile: None,
            candidate: None,
            ignore: ignore.iter().map(|s| s.to_lowercase()).collect(),
        }
    }

    /// Forget any game in progress (e.g. when switching is turned off).
    pub fn reset(&mut self) {
        self.home = None;
        self.game_profile = None;
        self.candidate = None;
    }

    /// Returns the profile to switch to, if any.
    ///
    /// `lookup` maps an executable to the profile configured for it.
    pub fn update(
        &mut self,
        now: Instant,
        foreground: Foreground,
        active_profile: i64,
        lookup: impl Fn(&str) -> Option<i64>,
    ) -> Option<i64> {
        let exe = match &foreground {
            Foreground::Unknown => return None,
            Foreground::Executable(e) if self.ignore.contains(e) => return None,
            Foreground::Executable(e) => Some(e.clone()),
            Foreground::Nothing => None,
        };
        match &self.candidate {
            Some((f, since)) if *f == foreground => {
                if now.saturating_duration_since(*since) < self.settle {
                    return None;
                }
            }
            _ => {
                self.candidate = Some((foreground, now));
                return None;
            }
        }
        match exe.as_deref().and_then(&lookup) {
            Some(target) => {
                if self.game_profile == Some(target) {
                    return None; // already handled; respect manual changes
                }
                if self.game_profile.is_none() {
                    self.home = Some(active_profile);
                }
                self.game_profile = Some(target);
                (active_profile != target).then_some(target)
            }
            None => {
                let game = self.game_profile.take()?;
                let home = self.home.take();
                // Only restore if the user is still on the game's profile.
                if active_profile == game {
                    home.filter(|h| *h != active_profile)
                } else {
                    None
                }
            }
        }
    }
}

/// Windows' own shell programs: never offered as games.
const SHELL_PROGRAMS: [&str; 9] = [
    "explorer.exe",
    "searchhost.exe",
    "searchapp.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "applicationframehost.exe",
    "lockapp.exe",
    "textinputhost.exe",
    "taskmgr.exe",
];

/// Programs that were recently in the foreground, newest first, so a game
/// can be linked to a profile by picking it instead of typing its file name.
/// Kept in memory only (never saved or sent anywhere).
#[derive(Debug)]
pub struct RecentPrograms {
    items: Vec<String>,
    ignore: Vec<String>,
    capacity: usize,
}

impl RecentPrograms {
    pub fn new(capacity: usize, ignore: &[&str]) -> Self {
        Self {
            items: Vec::with_capacity(capacity),
            ignore: ignore.iter().map(|s| s.to_lowercase()).collect(),
            capacity,
        }
    }

    pub fn record(&mut self, foreground: &Foreground) {
        let Foreground::Executable(exe) = foreground else {
            return;
        };
        if exe.is_empty()
            || self.ignore.contains(exe)
            || SHELL_PROGRAMS.contains(&exe.as_str())
            || self.items.first() == Some(exe)
        {
            return;
        }
        self.items.retain(|e| e != exe);
        self.items.insert(0, exe.clone());
        self.items.truncate(self.capacity);
    }

    pub fn list(&self) -> Vec<String> {
        self.items.clone()
    }
}

#[cfg(test)]
mod recent_tests {
    use super::*;

    fn exe(s: &str) -> Foreground {
        Foreground::Executable(s.into())
    }

    #[test]
    fn newest_first_without_duplicates_and_bounded() {
        let mut r = RecentPrograms::new(3, &["nexus-desktop.exe"]);
        for e in [
            "cod.exe",
            "discord.exe",
            "cod.exe",
            "chrome.exe",
            "steam.exe",
        ] {
            r.record(&exe(e));
        }
        assert_eq!(r.list(), ["steam.exe", "chrome.exe", "cod.exe"]);
    }

    #[test]
    fn nexus_the_windows_shell_and_unknown_programs_are_never_listed() {
        let mut r = RecentPrograms::new(5, &["nexus-desktop.exe"]);
        for f in [
            exe("nexus-desktop.exe"),
            exe("explorer.exe"),
            exe("taskmgr.exe"),
            Foreground::Unknown,
            Foreground::Nothing,
            exe(""),
        ] {
            r.record(&f);
        }
        assert!(r.list().is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAME: i64 = 2;
    const HOME: i64 = 1;

    fn lookup(exe: &str) -> Option<i64> {
        match exe {
            "game.exe" => Some(GAME),
            "racer.exe" => Some(3),
            _ => None,
        }
    }

    fn exe(s: &str) -> Foreground {
        Foreground::Executable(s.into())
    }

    struct Sim {
        s: AutoSwitcher,
        t: Instant,
        active: i64,
    }

    impl Sim {
        fn new() -> Self {
            Self {
                s: AutoSwitcher::new(Duration::from_millis(1000), &["nexus.exe"]),
                t: Instant::now(),
                active: HOME,
            }
        }
        /// Keeps `f` in the foreground for `ms`, polling every 250 ms.
        fn focus(&mut self, f: Foreground, ms: u64) -> Vec<i64> {
            let mut switches = vec![];
            for _ in 0..=(ms / 250) {
                if let Some(p) = self.s.update(self.t, f.clone(), self.active, lookup) {
                    self.active = p;
                    switches.push(p);
                }
                self.t += Duration::from_millis(250);
            }
            switches
        }
    }

    #[test]
    fn switches_to_game_profile_and_back() {
        let mut sim = Sim::new();
        assert_eq!(sim.focus(exe("game.exe"), 1500), vec![GAME]);
        assert_eq!(sim.focus(exe("explorer.exe"), 1500), vec![HOME]);
    }

    #[test]
    fn brief_focus_does_not_switch() {
        let mut sim = Sim::new();
        assert!(
            sim.focus(exe("game.exe"), 500).is_empty(),
            "alt-tab past a game"
        );
        assert!(sim.focus(exe("explorer.exe"), 1500).is_empty());
        assert_eq!(sim.active, HOME);
    }

    #[test]
    fn nexus_window_and_unknown_programs_never_switch() {
        let mut sim = Sim::new();
        sim.focus(exe("game.exe"), 1500);
        assert!(
            sim.focus(exe("nexus.exe"), 3000).is_empty(),
            "opening NEXUS mid-game keeps the game profile"
        );
        assert!(
            sim.focus(Foreground::Unknown, 3000).is_empty(),
            "elevated window: no change"
        );
        assert_eq!(sim.active, GAME);
    }

    #[test]
    fn manual_choice_during_a_game_is_respected() {
        let mut sim = Sim::new();
        sim.focus(exe("game.exe"), 1500);
        sim.active = 9; // user picks another profile while playing
        assert!(
            sim.focus(exe("game.exe"), 3000).is_empty(),
            "not forced back"
        );
        assert!(
            sim.focus(exe("explorer.exe"), 1500).is_empty(),
            "leaving keeps the manual choice"
        );
        assert_eq!(sim.active, 9);
    }

    #[test]
    fn game_to_game_returns_to_original_home() {
        let mut sim = Sim::new();
        sim.focus(exe("game.exe"), 1500);
        assert_eq!(sim.focus(exe("racer.exe"), 1500), vec![3]);
        assert_eq!(sim.focus(Foreground::Nothing, 1500), vec![HOME]);
    }

    #[test]
    fn already_on_the_game_profile_and_reset() {
        let mut sim = Sim::new();
        sim.active = GAME;
        assert!(
            sim.focus(exe("game.exe"), 1500).is_empty(),
            "no redundant switch"
        );
        assert!(
            sim.focus(exe("explorer.exe"), 1500).is_empty(),
            "home was the game profile"
        );
        sim.s.reset();
        assert_eq!(sim.focus(exe("racer.exe"), 1500), vec![3]);
    }
}

#[cfg(test)]
mod watcher_tests {
    use super::*;
    use std::cell::Cell;

    fn exe(name: &str) -> Foreground {
        Foreground::Executable(name.into())
    }

    #[test]
    fn the_game_is_looked_up_once_while_it_stays_in_front() {
        let mut w = ForegroundWatcher::default();
        let lookups = Cell::new(0);
        let game = |name: &'static str| {
            let lookups = &lookups;
            move || {
                lookups.set(lookups.get() + 1);
                exe(name)
            }
        };
        // Ten minutes of polling twice a second with the game in front.
        for _ in 0..1200 {
            assert_eq!(
                w.resolve(Some((0x10, 4242)), game("cod.exe")),
                exe("cod.exe")
            );
        }
        assert_eq!(lookups.get(), 1, "one handle opened, not 1200");
        // Alt-tab to another window, then back: one lookup each.
        assert_eq!(
            w.resolve(Some((0x20, 77)), game("discord.exe")),
            exe("discord.exe")
        );
        assert_eq!(
            w.resolve(Some((0x10, 4242)), game("cod.exe")),
            exe("cod.exe")
        );
        assert_eq!(lookups.get(), 3);
    }

    #[test]
    fn a_new_process_behind_the_same_window_handle_is_looked_up_again() {
        let mut w = ForegroundWatcher::default();
        assert_eq!(w.resolve(Some((0x10, 1)), || exe("a.exe")), exe("a.exe"));
        assert_eq!(w.resolve(Some((0x10, 2)), || exe("b.exe")), exe("b.exe"));
        assert_eq!(w.resolve(Some((0x11, 2)), || exe("c.exe")), exe("c.exe"));
    }

    #[test]
    fn no_foreground_window_is_never_cached() {
        let mut w = ForegroundWatcher::default();
        assert_eq!(w.resolve(Some((0x10, 1)), || exe("a.exe")), exe("a.exe"));
        assert_eq!(w.resolve(None, || Foreground::Nothing), Foreground::Nothing);
        // The same window coming back is looked up again (the cache was cleared).
        let looked = Cell::new(false);
        w.resolve(Some((0x10, 1)), || {
            looked.set(true);
            exe("a.exe")
        });
        assert!(looked.get());
    }
}
