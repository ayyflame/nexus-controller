//! Windows HID backend built directly on SetupAPI, CfgMgr32 and HID.dll.
//!
//! * Enumeration opens each HID interface with **zero access rights**
//!   (query-only). That works even while another process holds the device,
//!   and it never changes device state.
//! * Reading uses overlapped I/O, so a read can time out and be cancelled
//!   cleanly. That lets reader threads notice stop requests.
//! * No administrator rights are required.

use crate::backend::HidBackend;
use nexus_controller_core::{
    HidConnection, HidDeviceInfo, HidError, HidInterfaceDetails, HidUsageRange,
};
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
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Register_Notification, CM_Unregister_Notification, CM_NOTIFY_ACTION,
    CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL, CM_NOTIFY_ACTION_DEVICEINTERFACEREMOVAL,
    CM_NOTIFY_EVENT_DATA, CM_NOTIFY_FILTER, CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE, HCMNOTIFICATION,
};
use windows_sys::Win32::Devices::HumanInterfaceDevice::{
    HidD_FreePreparsedData, HidD_GetAttributes, HidD_GetHidGuid, HidD_GetManufacturerString,
    HidD_GetPreparsedData, HidD_GetProductString, HidD_GetSerialNumberString, HidP_GetButtonCaps,
    HidP_GetCaps, HidP_GetValueCaps, HidP_Input, HIDD_ATTRIBUTES, HIDP_BUTTON_CAPS, HIDP_CAPS,
    HIDP_STATUS_SUCCESS, HIDP_VALUE_CAPS, PHIDP_PREPARSED_DATA,
};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_BAD_COMMAND, ERROR_DEVICE_NOT_CONNECTED,
    ERROR_DEVICE_REMOVED, ERROR_FILE_NOT_FOUND, ERROR_GEN_FAILURE, ERROR_INVALID_HANDLE,
    ERROR_IO_PENDING, ERROR_OPERATION_ABORTED, GENERIC_READ, GENERIC_WRITE, HANDLE,
    INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
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
    vendor_ids: Option<&[u16]>,
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
    if vendor_ids.is_some_and(|v| !v.contains(&attrs.VendorID)) {
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

/// Every present HID interface: (path, instance ID, device instance). No
/// device is opened here.
fn hid_interfaces() -> Result<Vec<(String, Option<String>, u32)>, HidError> {
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
            SetupDiGetDeviceInterfaceDetailW(set, &iface, null_mut(), 0, &mut required, null_mut())
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

        devices.push((path, instance_id, devinfo.DevInst));
    }

    // SAFETY: destroying the set created above.
    unsafe { SetupDiDestroyDeviceInfoList(set) };
    Ok(devices)
}

/// Reads the input usages declared by an interface's report descriptor
/// through a query-only handle.
fn interface_details(info: &HidDeviceInfo) -> HidInterfaceDetails {
    let mut d = HidInterfaceDetails::from_info(info);
    let Ok(handle) = OwnedHandle::open(&wide(&info.path), 0, 0) else {
        return d;
    };
    let mut pp: PHIDP_PREPARSED_DATA = 0;
    // SAFETY: valid handle and out-pointer; data is freed below.
    if !unsafe { HidD_GetPreparsedData(handle.0, &mut pp) } {
        return d;
    }
    // SAFETY: zeroed POD out-struct.
    let mut caps: HIDP_CAPS = unsafe { zeroed() };
    // SAFETY: `pp` is valid until freed.
    if unsafe { HidP_GetCaps(pp, &mut caps) } == HIDP_STATUS_SUCCESS {
        let mut n = caps.NumberInputButtonCaps;
        let mut buttons = vec![HIDP_BUTTON_CAPS::default(); usize::from(n)];
        // SAFETY: buffer of `n` elements; `n` is updated to the count written.
        if n > 0
            && unsafe { HidP_GetButtonCaps(HidP_Input, buttons.as_mut_ptr(), &mut n, pp) }
                == HIDP_STATUS_SUCCESS
        {
            for b in &buttons[..usize::from(n)] {
                // SAFETY: the union member is selected by IsRange.
                let (min, max) = unsafe {
                    if b.IsRange {
                        (b.Anonymous.Range.UsageMin, b.Anonymous.Range.UsageMax)
                    } else {
                        (b.Anonymous.NotRange.Usage, b.Anonymous.NotRange.Usage)
                    }
                };
                d.input_buttons.push(HidUsageRange {
                    usage_page: b.UsagePage,
                    usage_min: min,
                    usage_max: max,
                    report_id: b.ReportID,
                    bit_size: 1,
                    report_count: b.ReportCount,
                });
            }
        }
        let mut n = caps.NumberInputValueCaps;
        let mut values = vec![HIDP_VALUE_CAPS::default(); usize::from(n)];
        // SAFETY: as above.
        if n > 0
            && unsafe { HidP_GetValueCaps(HidP_Input, values.as_mut_ptr(), &mut n, pp) }
                == HIDP_STATUS_SUCCESS
        {
            for v in &values[..usize::from(n)] {
                // SAFETY: the union member is selected by IsRange.
                let (min, max) = unsafe {
                    if v.IsRange {
                        (v.Anonymous.Range.UsageMin, v.Anonymous.Range.UsageMax)
                    } else {
                        (v.Anonymous.NotRange.Usage, v.Anonymous.NotRange.Usage)
                    }
                };
                d.input_values.push(HidUsageRange {
                    usage_page: v.UsagePage,
                    usage_min: min,
                    usage_max: max,
                    report_id: v.ReportID,
                    bit_size: v.BitSize,
                    report_count: v.ReportCount,
                });
            }
        }
        d.caps_unavailable = false;
    }
    // SAFETY: frees what HidD_GetPreparsedData allocated.
    unsafe { HidD_FreePreparsedData(pp) };
    d
}

impl HidBackend for WindowsHidBackend {
    fn name(&self) -> &'static str {
        "windows-hid"
    }

    fn enumerate(&self, vendor_ids: &[u16]) -> Result<Vec<HidDeviceInfo>, HidError> {
        Ok(hid_interfaces()?
            .into_iter()
            .filter_map(|(path, instance_id, devinst)| {
                query_device(&path, Some(vendor_ids), instance_id, || {
                    ancestors_of(devinst)
                })
            })
            .collect())
    }

    fn related_interfaces(&self, of: &HidDeviceInfo) -> Result<Vec<HidInterfaceDetails>, HidError> {
        let parent = crate::backend::composite_parent(&of.ancestor_instance_ids).map(str::to_owned);
        let mut out = Vec::new();
        for (path, instance_id, devinst) in hid_interfaces()? {
            // Ancestry comes from the PnP tree; nothing is opened unless the
            // interface belongs to the same physical USB device.
            let ancestors = ancestors_of(devinst);
            let same = path == of.path
                || (parent.is_some()
                    && crate::backend::composite_parent(&ancestors) == parent.as_deref());
            if !same {
                continue;
            }
            if let Some(info) = query_device(&path, None, instance_id, || ancestors) {
                out.push(interface_details(&info));
            }
        }
        Ok(out)
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

    fn write_output_report(&mut self, report: &[u8]) -> Result<usize, HidError> {
        let mut ov = self.new_overlapped();
        // SAFETY: `report` and `ov` outlive the operation (see `complete`).
        let ok = unsafe {
            WriteFile(
                self.handle.0,
                report.as_ptr(),
                report.len() as u32,
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

// ---- Device arrival/removal notifications --------------------------------

/// Registration for HID interface notifications. The callback context is a
/// leaked `Box<HotplugCallback>` that is reclaimed after unregistering.
pub(crate) struct NotificationHandle {
    handle: HCMNOTIFICATION,
    context: *mut crate::hotplug::HotplugCallback,
}

// SAFETY: the handle is only used to unregister, which may happen on any
// thread; the context is only read by the OS callback.
unsafe impl Send for NotificationHandle {}

unsafe extern "system" fn on_notification(
    _handle: HCMNOTIFICATION,
    context: *const c_void,
    action: CM_NOTIFY_ACTION,
    _data: *const CM_NOTIFY_EVENT_DATA,
    _size: u32,
) -> u32 {
    if action == CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL
        || action == CM_NOTIFY_ACTION_DEVICEINTERFACEREMOVAL
    {
        // SAFETY: `context` is the boxed callback, alive until unregistered.
        let callback = unsafe { &*(context as *const crate::hotplug::HotplugCallback) };
        // Never unwind into the OS.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback()));
    }
    0 // ERROR_SUCCESS
}

impl NotificationHandle {
    pub(crate) fn register(callback: crate::hotplug::HotplugCallback) -> Result<Self, String> {
        // SAFETY: zeroed POD; fields set below as the API requires.
        let mut filter: CM_NOTIFY_FILTER = unsafe { zeroed() };
        filter.cbSize = size_of::<CM_NOTIFY_FILTER>() as u32;
        filter.FilterType = CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE;
        // SAFETY: writes the HID interface class GUID into the union.
        unsafe { HidD_GetHidGuid(&mut filter.u.DeviceInterface.ClassGuid) };

        let context = Box::into_raw(Box::new(callback));
        let mut handle: HCMNOTIFICATION = unsafe { zeroed() };
        // SAFETY: filter, context and out-handle are valid for the call; the
        // context stays alive until `Drop`.
        let cr = unsafe {
            CM_Register_Notification(
                &filter,
                context as *const c_void,
                Some(on_notification),
                &mut handle,
            )
        };
        if cr != CR_SUCCESS {
            // SAFETY: registration failed, so the OS never saw the context.
            drop(unsafe { Box::from_raw(context) });
            return Err(format!("CM_Register_Notification failed (CONFIGRET {cr})"));
        }
        Ok(Self { handle, context })
    }
}

impl Drop for NotificationHandle {
    fn drop(&mut self) {
        // SAFETY: unregistering waits for in-flight callbacks to finish, after
        // which the context can be freed.
        unsafe {
            CM_Unregister_Notification(self.handle);
            drop(Box::from_raw(self.context));
        }
    }
}
