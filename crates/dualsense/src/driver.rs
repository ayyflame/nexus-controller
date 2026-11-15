use crate::identify::identify;
use crate::report::{DualSenseParser, BT_REPORT_LEN};
use crate::VENDOR_ID_SONY;
use nexus_controller_core::{
    ConnectionType, ControllerDriver, HidConnection, HidDeviceInfo, HidError, Identification,
    ReportParser,
};

/// Feature report 0x05 holds IMU calibration. Reading it is a side-effect-free
/// query, and it is also what makes a Bluetooth-connected DualSense switch
/// from the basic 0x01 report to the extended 0x31 report.
const FEATURE_REPORT_CALIBRATION: u8 = 0x05;
const FEATURE_REPORT_CALIBRATION_LEN: usize = 41;

#[derive(Debug, Default, Clone, Copy)]
pub struct DualSenseDriver;

impl ControllerDriver for DualSenseDriver {
    fn name(&self) -> &'static str {
        "dualsense"
    }

    fn vendor_ids(&self) -> &'static [u16] {
        &[VENDOR_ID_SONY]
    }

    fn identify(&self, device: &HidDeviceInfo) -> Option<Identification> {
        identify(device)
    }

    fn initialize(
        &self,
        connection: &mut dyn HidConnection,
        device: &HidDeviceInfo,
        identification: &Identification,
    ) -> Result<(), HidError> {
        let bluetooth = identification.connection == ConnectionType::Bluetooth
            || (identification.connection == ConnectionType::Unknown
                && device.input_report_len as usize == BT_REPORT_LEN);
        if !bluetooth {
            return Ok(());
        }
        let len = (device.feature_report_len as usize).max(FEATURE_REPORT_CALIBRATION_LEN);
        let mut buf = vec![0u8; len];
        buf[0] = FEATURE_REPORT_CALIBRATION;
        connection.get_feature_report(&mut buf).map(|_| ())
    }

    fn create_parser(&self, identification: &Identification) -> Box<dyn ReportParser> {
        Box::new(DualSenseParser::new(identification.connection))
    }
}
