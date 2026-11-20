//! "Start with Windows": an entry in the current user's `Run` registry key.
//!
//! - Per user (HKCU) only, no administrator rights, nothing system-wide.
//! - The entry is named `NEXUS`, the product name. The NSIS uninstaller already
//!   removes `HKCU\…\Run\NEXUS` on uninstall (not on updates), and NEXUS's
//!   installer hooks also remove the Task Manager on/off flag and do the same
//!   for the MSI.
//! - Windows' own switch (Task Manager › Startup apps, Settings › Apps ›
//!   Startup) is respected and shown: it lives in `StartupApproved\Run`.
//!   Turning the option on in NEXUS clears that "disabled" flag, because
//!   that is what the user just asked for.
//!
//! The rules are pure functions over [`StartupStore`], so they are tested
//! without touching the registry.

// Only the Windows build uses the registry; the rules are tested everywhere.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;
use std::path::Path;

/// Name of the value in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
pub const RUN_VALUE: &str = "NEXUS";
/// Added to the command so NEXUS knows it was started by Windows.
pub const BACKGROUND_ARG: &str = "--background";

/// Where the startup entry is kept (the registry on Windows, memory in tests).
pub trait StartupStore {
    fn run_value(&self) -> Result<Option<String>, String>;
    fn set_run_value(&mut self, command: &str) -> Result<(), String>;
    fn delete_run_value(&mut self) -> Result<(), String>;
    /// `Some(false)` if the entry was switched off in Task Manager or
    /// Settings, `Some(true)` if switched on there, `None` if never touched.
    fn approved(&self) -> Result<Option<bool>, String>;
    fn clear_approval(&mut self) -> Result<(), String>;
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    /// Start with Windows can be set on this system.
    pub supported: bool,
    /// NEXUS's entry exists.
    pub enabled: bool,
    /// The entry exists but Windows was told not to run it (Task Manager).
    pub disabled_in_windows: bool,
    pub error: Option<String>,
}

/// The command Windows runs at sign-in.
pub fn command_for(exe: &Path) -> String {
    format!("\"{}\" {BACKGROUND_ARG}", exe.display())
}

/// NEXUS was started by Windows at sign-in.
pub fn started_at_sign_in<S: AsRef<str>>(args: &[S]) -> bool {
    args.iter().skip(1).any(|a| a.as_ref() == BACKGROUND_ARG)
}

/// An entry NEXUS wrote (by its argument), whatever folder it points to.
fn is_ours(command: &str) -> bool {
    command.trim_end().ends_with(BACKGROUND_ARG)
}

pub fn status(store: &impl StartupStore) -> StartupStatus {
    let result = (|| {
        let enabled = store.run_value()?.is_some();
        let disabled = enabled && store.approved()? == Some(false);
        Ok::<_, String>((enabled, disabled))
    })();
    match result {
        Ok((enabled, disabled_in_windows)) => StartupStatus {
            supported: true,
            enabled,
            disabled_in_windows,
            error: None,
        },
        Err(e) => StartupStatus {
            supported: true,
            error: Some(e),
            ..Default::default()
        },
    }
}

/// Turns starting with Windows on or off.
pub fn set_enabled(
    store: &mut impl StartupStore,
    exe: &Path,
    on: bool,
) -> Result<StartupStatus, String> {
    if on {
        store.set_run_value(&command_for(exe))?;
        if store.approved()? == Some(false) {
            store.clear_approval()?;
        }
    } else {
        store.delete_run_value()?;
        store.clear_approval()?;
    }
    Ok(status(store))
}

/// At start-up: if NEXUS's entry points at another copy of the program (it
/// was reinstalled elsewhere), point it at this one. Returns whether it changed.
/// Entries that are not NEXUS's own are never touched.
pub fn repair(store: &mut impl StartupStore, exe: &Path) -> Result<bool, String> {
    let want = command_for(exe);
    match store.run_value()? {
        Some(current) if current != want && is_ours(&current) => {
            store.set_run_value(&want)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// Key in the profile database's `app_settings` table: the user's choice,
/// `"true"` or `"false"`. It lives with the profiles, so it survives an
/// uninstall that keeps the data (the registry entry does not).
pub const PREFERENCE_KEY: &str = "start_with_windows";

/// What [`reconcile`] did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reconciled {
    /// The choice to save, if it should change (first run of this version
    /// adopts what the registry says).
    pub save: Option<bool>,
    /// The entry was missing and was put back.
    pub restored: bool,
    /// The entry pointed at another copy of NEXUS and was updated.
    pub repaired: bool,
}

/// At start-up (installed builds): make the registry match the user's choice.
///
/// Upgrading by hand with the installer's default *Uninstall before
/// installing* runs the old uninstaller, which removes the `Run` entry. The
/// choice is kept in NEXUS's own settings, so the entry comes back on the
/// next start. A choice made before this existed is adopted from the
/// registry. Entries that aren't NEXUS's are never touched, and NEXUS never
/// adds an entry the user didn't ask for.
pub fn reconcile(
    store: &mut impl StartupStore,
    exe: &Path,
    wanted: Option<bool>,
) -> Result<Reconciled, String> {
    let current = store.run_value()?;
    let mut out = Reconciled {
        save: None,
        restored: false,
        repaired: false,
    };
    match wanted {
        None => out.save = Some(current.as_deref().is_some_and(is_ours)),
        Some(true) if current.is_none() => {
            store.set_run_value(&command_for(exe))?;
            out.restored = true;
        }
        _ => {}
    }
    out.repaired = repair(store, exe)?;
    Ok(out)
}

/// Parses the saved choice.
pub fn preference(saved: Option<&str>) -> Option<bool> {
    match saved {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => None,
    }
}

// ---- The registry ----------------------------------------------------------

#[cfg(windows)]
pub use registry::Registry;

#[cfg(windows)]
mod registry {
    use super::{StartupStore, RUN_VALUE};
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
        RRF_RT_REG_BINARY, RRF_RT_REG_SZ,
    };

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED_KEY: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn fail(what: &str, code: u32) -> String {
        format!("Could not {what} the Windows startup entry (Windows error {code}).")
    }

    /// HKCU Run and StartupApproved\Run, value `NEXUS` (another name only
    /// in tests, so they never touch the real entry).
    pub struct Registry {
        name: String,
    }

    impl Registry {
        pub fn nexus() -> Self {
            Self::named(RUN_VALUE)
        }

        pub fn named(name: &str) -> Self {
            Self {
                name: name.to_owned(),
            }
        }
    }

    impl Registry {
        fn get(&self, key: &str, flags: u32, buf: &mut [u8]) -> Result<Option<usize>, u32> {
            let (key, name) = (wide(key), wide(&self.name));
            let mut len = buf.len() as u32;
            // SAFETY: both strings are NUL-terminated and outlive the call;
            // `buf` is writable for `len` bytes and `len` is updated in place.
            #[allow(unsafe_code)]
            let code = unsafe {
                RegGetValueW(
                    HKEY_CURRENT_USER,
                    key.as_ptr(),
                    name.as_ptr(),
                    flags,
                    std::ptr::null_mut(),
                    buf.as_mut_ptr().cast(),
                    &mut len,
                )
            };
            match code {
                ERROR_SUCCESS => Ok(Some(len as usize)),
                ERROR_FILE_NOT_FOUND => Ok(None),
                e => Err(e),
            }
        }

        fn delete(&self, key: &str) -> Result<(), u32> {
            let (key, name) = (wide(key), wide(&self.name));
            // SAFETY: both strings are NUL-terminated and outlive the call.
            #[allow(unsafe_code)]
            let code =
                unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) };
            match code {
                ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => Ok(()),
                e => Err(e),
            }
        }
    }

    impl StartupStore for Registry {
        fn run_value(&self) -> Result<Option<String>, String> {
            let mut buf = vec![0u8; 4096];
            match self.get(RUN_KEY, RRF_RT_REG_SZ, &mut buf) {
                Ok(Some(len)) => {
                    let units: Vec<u16> = buf[..len]
                        .chunks_exact(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .take_while(|&u| u != 0)
                        .collect();
                    Ok(Some(String::from_utf16_lossy(&units)))
                }
                Ok(None) => Ok(None),
                Err(e) => Err(fail("read", e)),
            }
        }

        fn set_run_value(&mut self, command: &str) -> Result<(), String> {
            let (key, name, data) = (wide(RUN_KEY), wide(&self.name), wide(command));
            // SAFETY: NUL-terminated strings that outlive the call; the data
            // length is the UTF-16 byte length including the terminator.
            #[allow(unsafe_code)]
            let code = unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    key.as_ptr(),
                    name.as_ptr(),
                    REG_SZ,
                    data.as_ptr().cast(),
                    (data.len() * 2) as u32,
                )
            };
            if code == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(fail("write", code))
            }
        }

        fn delete_run_value(&mut self) -> Result<(), String> {
            self.delete(RUN_KEY).map_err(|e| fail("remove", e))
        }

        fn approved(&self) -> Result<Option<bool>, String> {
            // 12 bytes; the first is even when enabled (2), odd when disabled (3).
            let mut buf = [0u8; 64];
            match self.get(APPROVED_KEY, RRF_RT_REG_BINARY, &mut buf) {
                Ok(Some(len)) if len > 0 => Ok(Some(buf[0] & 1 == 0)),
                Ok(_) => Ok(None),
                Err(e) => Err(fail("read", e)),
            }
        }

        fn clear_approval(&mut self) -> Result<(), String> {
            self.delete(APPROVED_KEY).map_err(|e| fail("update", e))
        }
    }
}

/// The real registry on Windows, under a throwaway value name, removed again.
#[cfg(all(test, windows))]
mod registry_tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn start_with_windows_round_trips_through_the_real_registry() {
        let name = format!("NEXUS-test-{}", std::process::id());
        let mut r = Registry::named(&name);
        let exe = PathBuf::from(r"C:\Test\nexus-desktop.exe");
        let _ = set_enabled(&mut r, &exe, false);
        assert!(!status(&r).enabled);
        let s = set_enabled(&mut r, &exe, true).unwrap();
        assert!(
            s.enabled && !s.disabled_in_windows && s.error.is_none(),
            "{s:?}"
        );
        assert_eq!(
            r.run_value().unwrap().as_deref(),
            Some(command_for(&exe).as_str())
        );
        // A reinstall elsewhere is repaired to point at the new copy.
        let moved = PathBuf::from(r"D:\Games\NEXUS\nexus-desktop.exe");
        assert!(repair(&mut r, &moved).unwrap());
        assert_eq!(
            r.run_value().unwrap().as_deref(),
            Some(command_for(&moved).as_str())
        );
        let s = set_enabled(&mut r, &exe, false).unwrap();
        assert!(!s.enabled);
        assert_eq!(r.run_value().unwrap(), None, "nothing left behind");
        assert_eq!(r.approved().unwrap(), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[derive(Default)]
    struct Memory {
        run: Option<String>,
        approved: Option<bool>,
        fail_reads: bool,
    }

    impl StartupStore for Memory {
        fn run_value(&self) -> Result<Option<String>, String> {
            if self.fail_reads {
                return Err("access denied".into());
            }
            Ok(self.run.clone())
        }
        fn set_run_value(&mut self, command: &str) -> Result<(), String> {
            self.run = Some(command.into());
            Ok(())
        }
        fn delete_run_value(&mut self) -> Result<(), String> {
            self.run = None;
            Ok(())
        }
        fn approved(&self) -> Result<Option<bool>, String> {
            Ok(self.approved)
        }
        fn clear_approval(&mut self) -> Result<(), String> {
            self.approved = None;
            Ok(())
        }
    }

    fn exe() -> PathBuf {
        PathBuf::from(r"C:\Users\p\AppData\Local\NEXUS\nexus-desktop.exe")
    }

    #[test]
    fn the_command_quotes_the_path_and_marks_a_sign_in_start() {
        assert_eq!(
            command_for(&exe()),
            r#""C:\Users\p\AppData\Local\NEXUS\nexus-desktop.exe" --background"#
        );
        assert!(started_at_sign_in(&["nexus.exe", "--background"]));
        assert!(!started_at_sign_in(&["nexus.exe"]));
        assert!(
            !started_at_sign_in(&["--background"]),
            "the program path itself is not an argument"
        );
    }

    #[test]
    fn turning_it_on_and_off_writes_and_removes_the_entry() {
        let mut m = Memory::default();
        assert_eq!(
            status(&m),
            StartupStatus {
                supported: true,
                ..Default::default()
            }
        );
        let s = set_enabled(&mut m, &exe(), true).unwrap();
        assert!(s.enabled && !s.disabled_in_windows);
        assert_eq!(m.run.as_deref(), Some(command_for(&exe()).as_str()));
        let s = set_enabled(&mut m, &exe(), false).unwrap();
        assert!(!s.enabled);
        assert_eq!(m.run, None, "nothing is left behind");
    }

    #[test]
    fn a_switch_off_in_task_manager_is_shown_and_cleared_when_turned_on_again() {
        let mut m = Memory {
            run: Some(command_for(&exe())),
            approved: Some(false),
            ..Default::default()
        };
        let s = status(&m);
        assert!(s.enabled && s.disabled_in_windows);
        let s = set_enabled(&mut m, &exe(), true).unwrap();
        assert!(!s.disabled_in_windows);
        assert_eq!(m.approved, None);
        // Switched on in Task Manager is not "disabled".
        m.approved = Some(true);
        assert!(!status(&m).disabled_in_windows);
    }

    #[test]
    fn an_entry_for_a_moved_install_is_repaired_but_foreign_entries_are_not() {
        let mut m = Memory {
            run: Some(r#""D:\Old\nexus-desktop.exe" --background"#.into()),
            ..Default::default()
        };
        assert!(repair(&mut m, &exe()).unwrap());
        assert_eq!(m.run.as_deref(), Some(command_for(&exe()).as_str()));
        assert!(!repair(&mut m, &exe()).unwrap(), "already right");

        let mut other = Memory {
            run: Some(r#""C:\Other\nexus.exe""#.into()),
            ..Default::default()
        };
        assert!(!repair(&mut other, &exe()).unwrap());
        assert_eq!(other.run.as_deref(), Some(r#""C:\Other\nexus.exe""#));
        let mut none = Memory::default();
        assert!(!repair(&mut none, &exe()).unwrap(), "off stays off");
        assert_eq!(none.run, None);
    }

    #[test]
    fn an_upgrade_that_uninstalled_first_gets_start_with_windows_back() {
        // The user turned it on (saved), then upgraded with "Uninstall before
        // installing", which removed the entry.
        let mut m = Memory::default();
        let r = reconcile(&mut m, &exe(), Some(true)).unwrap();
        assert!(r.restored);
        assert_eq!(m.run.as_deref(), Some(command_for(&exe()).as_str()));
        assert_eq!(r.save, None, "the choice is unchanged");
        // Next start: nothing to do.
        let r = reconcile(&mut m, &exe(), Some(true)).unwrap();
        assert!(!r.restored && !r.repaired);
    }

    #[test]
    fn a_choice_made_before_it_was_saved_is_adopted_from_the_registry() {
        let mut on = Memory {
            run: Some(command_for(&exe())),
            ..Default::default()
        };
        assert_eq!(reconcile(&mut on, &exe(), None).unwrap().save, Some(true));
        let mut off = Memory::default();
        let r = reconcile(&mut off, &exe(), None).unwrap();
        assert_eq!(r.save, Some(false));
        assert_eq!(off.run, None, "never added without being asked");
        let mut foreign = Memory {
            run: Some(r#""C:\Other\nexus.exe""#.into()),
            ..Default::default()
        };
        assert_eq!(
            reconcile(&mut foreign, &exe(), None).unwrap().save,
            Some(false),
            "someone else's entry isn't NEXUS's choice"
        );
    }

    #[test]
    fn turned_off_stays_off_and_moved_installs_are_repaired() {
        let mut m = Memory::default();
        assert!(!reconcile(&mut m, &exe(), Some(false)).unwrap().restored);
        assert_eq!(m.run, None);
        let mut moved = Memory {
            run: Some(r#""D:\Old\nexus-desktop.exe" --background"#.into()),
            ..Default::default()
        };
        assert!(reconcile(&mut moved, &exe(), Some(true)).unwrap().repaired);
        assert_eq!(moved.run.as_deref(), Some(command_for(&exe()).as_str()));
        assert_eq!(preference(Some("true")), Some(true));
        assert_eq!(preference(Some("false")), Some(false));
        assert_eq!(preference(None), None);
        assert_eq!(preference(Some("junk")), None);
    }

    #[test]
    fn a_registry_error_is_reported_not_hidden() {
        let m = Memory {
            fail_reads: true,
            ..Default::default()
        };
        let s = status(&m);
        assert!(!s.enabled);
        assert_eq!(s.error.as_deref(), Some("access denied"));
    }
}
