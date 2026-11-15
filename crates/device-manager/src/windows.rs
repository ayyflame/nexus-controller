//! Windows HID backend built directly on SetupAPI, CfgMgr32 and HID.dll.
//!
//! * Enumeration opens each HID interface with **zero access rights**
//!   (query-only). That works even while another process holds the device,
//!   and it never changes device state.
//! * Reading uses overlapped I/O, so a read can time out and be cancelled
//!   cleanly. That lets reader threads notice stop requests.
//! * No administrator rights are required.

use crate::backend::HidBackend;
use nexus_controller_core::{HidConnection, HidDeviceInfo, HidError};
use std::ffi::c_void;
use std::mem::{offset_of, size_of, zeroed};
use std::ptr::{null, null_mut};
use std::time::Duration;

use windows_sys::core::GUID;
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_Device_IDW, CM_Get_Parent, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces,
    SetupDiGetClassDevsW, SetupDiGetDeviceInstanceIdW, SetupDiGetDeviceInterfaceDetailW,
    CR_SUCCESS, DIGCF_DEVICEINTERFACE, DIGCF_PRESENT, SP_DEVICE_INTERFACE_DATA,
    SP_DEVICE_INTERFACE_DETAIL_DATA_W, SP_DEVINFO_DATA,
};
use windows_sys::Win32::Devices::HumanInterfaceDevice::{
    HidD_FreePreparsedData, HidD_GetAttributes, HidD_GetHidGuid, HidD_GetManufacturerString,
    HidD_GetPreparsedData, HidD_GetProductString, HidD_GetSerialNumberString, HidP_GetCaps,
    HIDD_ATTRIBUTES, HIDP_CAPS, HIDP_STATUS_SUCCESS, PHIDP_PREPARSED_DATA,
};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_BAD_COMMAND, ERROR_DEVICE_NOT_CONNECTED,
    ERROR_DEVICE_REMOVED, ERROR_FILE_NOT_FOUND, ERROR_GEN_FAILURE, ERROR_INVALID_HANDLE,
    ERROR_IO_PENDING, ERROR_OPERATION_ABORTED, GENERIC_READ, GENERIC_WRITE, HANDLE,
    INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, FILE_FLAG_OVERLAPPED, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows_sys::Win32::System::IO::{
    CancelIoEx, DeviceIoControl, GetOverlappedResult, OVERLAPPED,
};

/// `HID_OUT_CTL_CODE(100)`: CTL_CODE(FILE_DEVICE_KEYBOARD, 100, METHOD_OUT_DIRECT, FILE_ANY_ACCESS).
const IOCTL_HID_GET_FEATURE: u32 = 0x000B_0192;
const MAX_ANCESTORS: usize = 32;
const FEATURE_TIMEOUT_MS: u32 = 1000;

#[derive(Debug, Default)]
pub struct WindowsHidBackend;

impl WindowsHidBackend {
    pub fn new() -> Self {
        Self
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn map_error(code: u32) -> HidError {
    match code {
        ERROR_DEVICE_NOT_CONNECTED
        | ERROR_DEVICE_REMOVED
        | ERROR_INVALID_HANDLE
        | ERROR_BAD_COMMAND
        | ERROR_GEN_FAILURE
        | ERROR_FILE_NOT_FOUND => HidError::Disconnected,
        ERROR_ACCESS_DENIED => HidError::AccessDenied,
        other => HidError::Io(format!("Win32 error {other}")),
    }
}

fn last_error() -> u32 {
    // SAFETY: trivially safe FFI call.
    unsafe { GetLastError() }
}

/// Owned Win32 handle closed on drop.
struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn open(path: &[u16], access: u32, flags: u32) -> Result<Self, HidError> {
        // SAFETY: `path` is NUL-terminated; other pointers are null as allowed.
        let h = unsafe {
            CreateFileW(
                path.as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null(),
                OPEN_EXISTING,
                flags,
                null_mut(),
            )
        };
        if h == INVALID_HANDLE_VALUE {
            Err(map_error(last_error()))
        } else {
            Ok(Self(h))
        }
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: we own the handle.
        unsafe { CloseHandle(self.0) };
    }
}

/// Reads one HID string descriptor (product, manufacturer, serial).
fn hid_string(
    handle: HANDLE,
    f: unsafe extern "system" fn(HANDLE, *mut c_void, u32) -> bool,
) -> Option<String> {
    let mut buf = [0u16; 256];
    // SAFETY: buffer length is passed in bytes, as the API requires.
    let ok = unsafe { f(handle, buf.as_mut_ptr().cast(), (buf.len() * 2) as u32) };
    if !ok {
        return None;
    }
    let s = from_wide(&buf).trim().to_owned();
    (!s.is_empty()).then_some(s)
}

fn device_id_of(devinst: u32) -> Option<String> {
    let mut buf = [0u16; 512];
    // SAFETY: buffer length in characters, as the API requires.
    let cr = unsafe { CM_Get_Device_IDW(devinst, buf.as_mut_ptr(), buf.len() as u32, 0) };
    (cr == CR_SUCCESS).then(|| from_wide(&buf))
}

fn ancestors_of(devinst: u32) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = devinst;
    for _ in 0..MAX_ANCESTORS {
        let mut parent = 0u32;
        // SAFETY: out-pointer to a local.
        if unsafe { CM_Get_Parent(&mut parent, current, 0) } != CR_SUCCESS {
            break;
        }
        match device_id_of(parent) {
            Some(id) => out.push(id),
            None => break,
        }
        current = parent;
    }
    out
}

/// Queries attributes, capabilities and strings through a query-only handle.
fn query_device(
    path: &str,
    vendor_ids: &[u16],
    instance_id: Option<String>,
    ancestors: impl FnOnce() -> Vec<String>,
) -> Option<HidDeviceInfo> {
    let wpath = wide(path);
    let handle = OwnedHandle::open(&wpath, 0, 0).ok()?;

    // SAFETY: zeroed POD struct with Size set, as the API requires.
    let mut attrs: HIDD_ATTRIBUTES = unsafe { zeroed() };
    attrs.Size = size_of::<HIDD_ATTRIBUTES>() as u32;
    // SAFETY: valid handle and out-pointer.
    if !unsafe { HidD_GetAttributes(handle.0, &mut attrs) } {
        return None;
    }
    if !vendor_ids.contains(&attrs.VendorID) {
        return None;
    }

    let mut info = HidDeviceInfo {
        path: path.to_owned(),
        vendor_id: attrs.VendorID,
        product_id: attrs.ProductID,
        release_number: attrs.VersionNumber,
        instance_id,
        ..Default::default()
    };

    let mut pp: PHIDP_PREPARSED_DATA = 0;
    // SAFETY: valid handle and out-pointer; data is freed below.
    if unsafe { HidD_GetPreparsedData(handle.0, &mut pp) } {
        // SAFETY: zeroed POD out-struct.
        let mut caps: HIDP_CAPS = unsafe { zeroed() };
        // SAFETY: `pp` is valid until freed.
        if unsafe { HidP_GetCaps(pp, &mut caps) } == HIDP_STATUS_SUCCESS {
            info.usage_page = caps.UsagePage;
            info.usage = caps.Usage;
            info.input_report_len = caps.InputReportByteLength;
            info.output_report_len = caps.OutputReportByteLength;
            info.feature_report_len = caps.FeatureReportByteLength;
        }
        // SAFETY: frees what HidD_GetPreparsedData allocated.
        unsafe { HidD_FreePreparsedData(pp) };
    }

    info.product = hid_string(handle.0, HidD_GetProductString);
    info.manufacturer = hid_string(handle.0, HidD_GetManufacturerString);
    info.serial_number = hid_string(handle.0, HidD_GetSerialNumberString);
    info.ancestor_instance_ids = ancestors();
    Some(info)
}

impl HidBackend for WindowsHidBackend {
    fn name(&self) -> &'static str {
        "windows-hid"
    }

    fn enumerate(&self, vendor_ids: &[u16]) -> Result<Vec<HidDeviceInfo>, HidError> {
        // SAFETY: zeroed GUID is a valid out-param.
        let mut guid: GUID = unsafe { zeroed() };
        // SAFETY: out-pointer to a local.
        unsafe { HidD_GetHidGuid(&mut guid) };

        // SAFETY: standard call; the set is destroyed below.
        let set = unsafe {
            SetupDiGetClassDevsW(
                &guid,
                null(),
                null_mut(),
                DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
            )
        };
        if set as isize == INVALID_HANDLE_VALUE as isize {
            return Err(HidError::Io(format!(
                "SetupDiGetClassDevs failed (Win32 error {})",
                last_error()
            )));
        }

        let mut devices = Vec::new();
        for index in 0.. {
            // SAFETY: zeroed POD with cbSize set.
            let mut iface: SP_DEVICE_INTERFACE_DATA = unsafe { zeroed() };
            iface.cbSize = size_of::<SP_DEVICE_INTERFACE_DATA>() as u32;
            // SAFETY: valid set and out-struct.
            if unsafe { SetupDiEnumDeviceInterfaces(set, null(), &guid, index, &mut iface) } == 0 {
                break; // ERROR_NO_MORE_ITEMS
            }

            let mut required = 0u32;
            // SAFETY: size query; failure with ERROR_INSUFFICIENT_BUFFER is expected.
            unsafe {
                SetupDiGetDeviceInterfaceDetailW(
                    set,
                    &iface,
                    null_mut(),
                    0,
                    &mut required,
                    null_mut(),
                )
            };
            if required == 0 {
                continue;
            }
            // u64 storage guarantees the struct's alignment.
            let mut storage = vec![0u64; (required as usize).div_ceil(8)];
            let detail = storage
                .as_mut_ptr()
                .cast::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>();
            // SAFETY: `storage` is large enough and suitably aligned.
            unsafe { (*detail).cbSize = size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32 };
            // SAFETY: zeroed POD with cbSize set.
            let mut devinfo: SP_DEVINFO_DATA = unsafe { zeroed() };
            devinfo.cbSize = size_of::<SP_DEVINFO_DATA>() as u32;
            // SAFETY: buffer of `required` bytes.
            let ok = unsafe {
                SetupDiGetDeviceInterfaceDetailW(
                    set,
                    &iface,
                    detail,
                    required,
                    null_mut(),
                    &mut devinfo,
                )
            } != 0;
            if !ok {
                continue;
            }
            let path_offset = offset_of!(SP_DEVICE_INTERFACE_DETAIL_DATA_W, DevicePath);
            let path_chars = (required as usize).saturating_sub(path_offset) / 2;
            // SAFETY: DevicePath is a NUL-terminated string inside `storage`.
            let path = from_wide(unsafe {
                std::slice::from_raw_parts(
                    storage.as_ptr().cast::<u8>().add(path_offset).cast::<u16>(),
                    path_chars,
                )
            });

            let mut id_buf = [0u16; 512];
            // SAFETY: buffer size in characters.
            let instance_id = (unsafe {
                SetupDiGetDeviceInstanceIdW(
                    set,
                    &devinfo,
                    id_buf.as_mut_ptr(),
                    id_buf.len() as u32,
                    null_mut(),
                )
            } != 0)
                .then(|| from_wide(&id_buf));

            let devinst = devinfo.DevInst;
            if let Some(info) =
                query_device(&path, vendor_ids, instance_id, || ancestors_of(devinst))
            {
                devices.push(info);
            }
        }

        // SAFETY: destroying the set created above.
        unsafe { SetupDiDestroyDeviceInfoList(set) };
        Ok(devices)
    }

    fn open(&self, device: &HidDeviceInfo) -> Result<Box<dyn HidConnection>, HidError> {
        let path = wide(&device.path);
        // Read/write is needed later for output reports; fall back to read-only
        // if write access is refused.
        let handle = OwnedHandle::open(&path, GENERIC_READ | GENERIC_WRITE, FILE_FLAG_OVERLAPPED)
            .or_else(|_| OwnedHandle::open(&path, GENERIC_READ, FILE_FLAG_OVERLAPPED))?;
        // SAFETY: manual-reset, initially non-signalled, unnamed event.
        let event = unsafe { CreateEventW(null(), 1, 0, null()) };
        if event.is_null() {
            return Err(map_error(last_error()));
        }
        Ok(Box::new(WindowsHidConnection {
            handle,
            event: OwnedHandle(event),
        }))
    }
}

struct WindowsHidConnection {
    handle: OwnedHandle,
    event: OwnedHandle,
}

// SAFETY: the handles are used from one thread at a time (the reader thread
// owns the connection); Win32 file and event handles may move between threads.
unsafe impl Send for WindowsHidConnection {}

impl WindowsHidConnection {
    /// Waits for an overlapped operation. On timeout the I/O is cancelled and
    /// awaited, so the caller's buffer is never written after we return.
    fn complete(&self, ov: &mut OVERLAPPED, timeout_ms: u32) -> Result<usize, HidError> {
        // SAFETY: event handle is valid.
        let wait = unsafe { WaitForSingleObject(self.event.0, timeout_ms) };
        let mut transferred = 0u32;
        if wait == WAIT_TIMEOUT {
            // SAFETY: cancel only this operation, then wait for it to finish.
            unsafe { CancelIoEx(self.handle.0, ov) };
            let ok = unsafe { GetOverlappedResult(self.handle.0, ov, &mut transferred, 1) } != 0;
            if !ok {
                return match last_error() {
                    ERROR_OPERATION_ABORTED => Ok(0),
                    e => Err(map_error(e)),
                };
            }
            return Ok(transferred as usize); // completed just before cancel
        }
        if wait != WAIT_OBJECT_0 {
            // Make sure nothing is still pending before reporting.
            unsafe { CancelIoEx(self.handle.0, ov) };
            unsafe { GetOverlappedResult(self.handle.0, ov, &mut transferred, 1) };
            return Err(HidError::Io(format!(
                "wait failed (Win32 error {})",
                last_error()
            )));
        }
        // SAFETY: operation completed; fetch its result.
        if unsafe { GetOverlappedResult(self.handle.0, ov, &mut transferred, 0) } == 0 {
            return Err(map_error(last_error()));
        }
        Ok(transferred as usize)
    }

    fn new_overlapped(&self) -> OVERLAPPED {
        // SAFETY: zeroed OVERLAPPED is valid.
        let mut ov: OVERLAPPED = unsafe { zeroed() };
        ov.hEvent = self.event.0;
        ov
    }
}

impl HidConnection for WindowsHidConnection {
    fn read_report(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize, HidError> {
        let mut ov = self.new_overlapped();
        // SAFETY: `buf` and `ov` outlive the operation because `complete`
        // does not return until it has finished or been cancelled.
        let ok = unsafe {
            ReadFile(
                self.handle.0,
                buf.as_mut_ptr(),
                buf.len() as u32,
                null_mut(),
                &mut ov,
            )
        } != 0;
        if !ok {
            let e = last_error();
            if e != ERROR_IO_PENDING {
                return Err(map_error(e));
            }
        }
        let ms = timeout.as_millis().min(u32::MAX as u128) as u32;
        self.complete(&mut ov, ms)
    }

    fn get_feature_report(&mut self, buf: &mut [u8]) -> Result<usize, HidError> {
        let mut ov = self.new_overlapped();
        let len = buf.len() as u32;
        let ptr = buf.as_mut_ptr().cast::<c_void>();
        // SAFETY: same buffer for input (report ID) and output, as HID
        // expects; it outlives the operation (see `complete`).
        let ok = unsafe {
            DeviceIoControl(
                self.handle.0,
                IOCTL_HID_GET_FEATURE,
                ptr,
                len,
                ptr,
                len,
                null_mut(),
                &mut ov,
            )
        } != 0;
        if !ok {
            let e = last_error();
            if e != ERROR_IO_PENDING {
                return Err(map_error(e));
            }
        }
        self.complete(&mut ov, FEATURE_TIMEOUT_MS)
    }
}

impl Drop for WindowsHidConnection {
    fn drop(&mut self) {
        // SAFETY: cancel any I/O still queued on this handle before closing.
        unsafe { CancelIoEx(self.handle.0, null()) };
    }
}
