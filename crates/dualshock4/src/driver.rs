use crate::identify::identify;
use crate::report::DualShock4Parser;
use crate::VENDOR_ID_SONY;
use nexus_controller_core::{ControllerDriver, HidDeviceInfo, Identification, ReportParser};

/// USB DualShock 4. Needs no initialisation: over USB the controller sends
/// its full report 0x01 from the start, and NEXUS uses the raw motion values
/// (like the DualSense), so the calibration feature report isn't read.
#[derive(Debug, Default, Clone, Copy)]
pub struct DualShock4Driver;

impl ControllerDriver for DualShock4Driver {
    fn name(&self) -> &'static str {
        "dualshock4"
    }

    fn vendor_ids(&self) -> &'static [u16] {
        &[VENDOR_ID_SONY]
    }

    fn identify(&self, device: &HidDeviceInfo) -> Option<Identification> {
        identify(device)
    }

    fn create_parser(&self, _identification: &Identification) -> Box<dyn ReportParser> {
        Box::new(DualShock4Parser::new())
    }
}
