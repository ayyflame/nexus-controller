//! Read-only detection of the optional third-party drivers.
//!
//! Only checks whether each driver's device interface exists. It never opens
//! the ViGEm bus, never sends a request to either driver, and never installs
//! anything.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DriverPresence {
    Installed,
    NotInstalled,
    /// Detection is not possible here (non-Windows) or failed.
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverStatus {
    /// ViGEmBus (virtual Xbox 360 / DualShock 4 bus driver).
    pub vigembus: DriverPresence,
    /// HidHide (hides the physical controller from games).
    pub hidhide: DriverPresence,
}

pub fn probe_drivers() -> DriverStatus {
    #[cfg(windows)]
    {
        DriverStatus {
            vigembus: windows::vigembus(),
            hidhide: windows::hidhide(),
        }
    }
    #[cfg(not(windows))]
    {
        DriverStatus {
            vigembus: DriverPresence::Unknown,
            hidhide: DriverPresence::Unknown,
        }
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod windows {
    use super::DriverPresence;
    use std::mem::{size_of, zeroed};
    use std::ptr::{null, null_mut};
    use windows_sys::core::GUID;
    use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
        SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW,
        DIGCF_DEVICEINTERFACE, DIGCF_PRESENT, SP_DEVICE_INTERFACE_DATA,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    /// `GUID_DEVINTERFACE_BUSENUM_VIGEM` {96E42B22-F5E9-42F8-B043-ED0F932F014F}.
    const VIGEM_BUS_INTERFACE: GUID = GUID {
        data1: 0x96E4_2B22,
        data2: 0xF5E9,
        data3: 0x42F8,
        data4: [0xB0, 0x43, 0xED, 0x0F, 0x93, 0x2F, 0x01, 0x4F],
    };

    pub fn vigembus() -> DriverPresence {
        // SAFETY: standard SetupAPI enumeration; the list is destroyed below.
        unsafe {
            let set = SetupDiGetClassDevsW(
                &VIGEM_BUS_INTERFACE,
                null(),
                null_mut(),
                DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
            );
            if set as isize == INVALID_HANDLE_VALUE as isize {
                return DriverPresence::Unknown;
            }
            let mut data: SP_DEVICE_INTERFACE_DATA = zeroed();
            data.cbSize = size_of::<SP_DEVICE_INTERFACE_DATA>() as u32;
            let found =
                SetupDiEnumDeviceInterfaces(set, null(), &VIGEM_BUS_INTERFACE, 0, &mut data) != 0;
            SetupDiDestroyDeviceInfoList(set);
            if found {
                DriverPresence::Installed
            } else {
                DriverPresence::NotInstalled
            }
        }
    }

    pub fn hidhide() -> DriverPresence {
        let path: Vec<u16> = r"\\.\HidHide"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: opens the control device with zero access rights (existence
        // check only); the handle is closed immediately.
        unsafe {
            let h = CreateFileW(
                path.as_ptr(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null(),
                OPEN_EXISTING,
                0,
                null_mut(),
            );
            if h != INVALID_HANDLE_VALUE {
                CloseHandle(h);
                return DriverPresence::Installed;
            }
            match GetLastError() {
                ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => DriverPresence::NotInstalled,
                // Exists but refused (e.g. access denied): installed.
                _ => DriverPresence::Installed,
            }
        }
    }
}
