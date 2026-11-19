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

    /// HKCU Run and StartupApproved\Run, value `NEXUS`.
    pub struct Registry;

    impl Registry {
        fn get(&self, key: &str, flags: u32, buf: &mut [u8]) -> Result<Option<usize>, u32> {
            let (key, name) = (wide(key), wide(RUN_VALUE));
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
            let (key, name) = (wide(key), wide(RUN_VALUE));
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
            let (key, name, data) = (wide(RUN_KEY), wide(RUN_VALUE), wide(command));
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
