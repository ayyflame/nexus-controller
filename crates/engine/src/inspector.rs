//! Report Inspector: finds out which bits of the raw USB input report change
//! when the user presses something. Built to investigate controllers such as
//! the ModdedZone MZ Titan, whose back paddles may produce data NEXUS does not
//! decode yet.
//!
//! Method:
//! 1. **Baseline**: reports recorded while nobody touches the controller.
//!    For each byte, the most common value is the reference, and every bit
//!    that changed anyway (counters, timestamps, motion, stick noise) is
//!    marked as noisy and ignored.
//! 2. **Action**: reports recorded while the user holds one input. Any
//!    non-noisy bit that differs from the reference is reported, with its
//!    field name and whether NEXUS already decodes it.
//! 3. **Ignored fields**: timestamps, counters, motion sensors and battery
//!    status change by themselves over time (a slow counter can look steady
//!    during the baseline and differ minutes later). They are never input,
//!    so they are listed as ignored and can't produce a candidate.
//! 4. **Candidates**: only undecoded bits of button bytes and unused bytes
//!    that changed in at least a fifth of the action reports. A held paddle
//!    shows in nearly every report; a one-off flicker is only noted.
//!
//! The analysis only describes data. A change in a decoded bit such as Cross
//! means "the controller reports Cross", which is exactly what a paddle mapped
//! to Cross looks like. It is never presented as an independent paddle.

use nexus_dualsense::layout::{usb_byte, usb_decoded_bit, usb_undecoded_hint, FieldKind};
use serde::Serialize;

/// Upper bound per capture (12 s at 250 Hz), to bound memory.
pub const MAX_CAPTURE_REPORTS: usize = 3000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCapture {
    pub device_id: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub duration_ms: u32,
    #[serde(skip)]
    pub reports: Vec<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteChange {
    pub index: usize,
    pub field: &'static str,
    /// "input", "varying" or "unknown".
    pub field_kind: &'static str,
    /// Reference value from the baseline.
    pub baseline: u8,
    /// Bits that became 1 / became 0 during the action.
    pub set_bits: u8,
    pub cleared_bits: u8,
    /// Changed bits NEXUS does not decode into any input.
    pub undecoded_bits: u8,
    /// Action reports in which this byte differed from the reference.
    pub reports_changed: u32,
    /// Distinct values seen during the action (up to 8).
    pub values_seen: Vec<u8>,
    /// Names of decoded buttons among the changed bits (e.g. "Cross").
    pub decoded: Vec<&'static str>,
    pub hints: Vec<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Verdict {
    /// Nothing outside the noisy fields changed.
    NoChange,
    /// Only bits NEXUS already decodes changed, e.g. a paddle mapped to Cross.
    DecodedButtons { buttons: Vec<&'static str> },
    /// Bits NEXUS does not decode changed: a candidate independent input.
    UndecodedBits { locations: Vec<String> },
    /// Only sticks, triggers or touch data changed.
    AnalogOnly,
    /// Reports had an unexpected ID or length; see `notes`.
    UnexpectedFormat,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub baseline_reports: usize,
    pub action_reports: usize,
    pub report_len: usize,
    pub noisy_bytes: Vec<usize>,
    /// Bytes that changed but belong to timestamp, counter, motion or
    /// battery fields: never treated as input.
    pub ignored_bytes: Vec<usize>,
    pub changes: Vec<ByteChange>,
    pub verdict: Verdict,
    pub summary: String,
    pub notes: Vec<String>,
}

fn kind_name(k: FieldKind) -> &'static str {
    match k {
        FieldKind::Input => "input",
        FieldKind::Varying => "varying",
        FieldKind::Unknown => "unknown",
    }
}

/// Bits of byte `index` that NEXUS decodes into buttons.
fn decoded_mask(index: usize) -> u8 {
    (0..8)
        .map(|b| 1u8 << b)
        .filter(|&m| usb_decoded_bit(index, m).is_some())
        .fold(0, |a, m| a | m)
}

/// Byte-wise most common value across `reports`.
fn reference(reports: &[Vec<u8>], len: usize) -> Vec<u8> {
    (0..len)
        .map(|i| {
            let mut counts = [0u32; 256];
            for r in reports {
                if let Some(&b) = r.get(i) {
                    counts[usize::from(b)] += 1;
                }
            }
            (0..=255u8)
                .max_by_key(|&v| counts[usize::from(v)])
                .unwrap_or(0)
        })
        .collect()
}

pub fn analyse(baseline: &[Vec<u8>], action: &[Vec<u8>]) -> Analysis {
    let len = baseline
        .iter()
        .chain(action)
        .map(Vec::len)
        .max()
        .unwrap_or(0);
    let mut notes = Vec::new();
    let ids: std::collections::BTreeSet<u8> = baseline
        .iter()
        .chain(action)
        .filter_map(|r| r.first().copied())
        .collect();
    let lens: std::collections::BTreeSet<usize> =
        baseline.iter().chain(action).map(Vec::len).collect();
    let unexpected = ids.iter().any(|&id| id != 0x01) || lens.iter().any(|&l| l != 64);
    if unexpected {
        notes.push(format!(
            "Report IDs seen: {ids:02X?}; lengths seen: {lens:?}. A standard DualSense over USB sends only ID 01 with 64 bytes."
        ));
    }
    let base = reference(baseline, len);
    let mut noisy = vec![0u8; len];
    for r in baseline {
        for (i, n) in noisy.iter_mut().enumerate() {
            *n |= r.get(i).copied().unwrap_or(0) ^ base[i];
        }
    }

    let mut changes: Vec<ByteChange> = Vec::new();
    let mut ignored_bytes = Vec::new();
    let mut flickers = Vec::new();
    for i in 0..len {
        let mut set = 0u8;
        let mut cleared = 0u8;
        let mut count = 0u32;
        let mut values: Vec<u8> = Vec::new();
        for r in action {
            let v = r.get(i).copied().unwrap_or(0);
            let diff = (v ^ base[i]) & !noisy[i];
            if diff != 0 {
                count += 1;
                set |= diff & v;
                cleared |= diff & !v;
                if values.len() < 8 && !values.contains(&v) {
                    values.push(v);
                }
            }
        }
        if count == 0 {
            continue;
        }
        let (field, kind) = usb_byte(i);
        let analog = matches!(i, 1..=6 | 33..=40);
        if kind == FieldKind::Varying && !analog {
            ignored_bytes.push(i);
            continue;
        }
        let changed = set | cleared;
        let mut undecoded = if analog {
            0
        } else {
            changed & !decoded_mask(i)
        };
        if undecoded != 0 && (count as usize) * 5 < action.len() {
            flickers.push(format!(
                "Byte {i} changed in only {count} of {} reports, too rarely to be a held input, so it is not treated as a candidate. If you pressed something, hold the input for the whole recording.",
                action.len()
            ));
            undecoded = 0;
        }
        let mut decoded = Vec::new();
        let mut hints = Vec::new();
        for b in 0..8 {
            let m = 1u8 << b;
            if changed & m == 0 {
                continue;
            }
            if let Some(name) = usb_decoded_bit(i, m) {
                if !analog && !decoded.contains(&name) {
                    decoded.push(name);
                }
            } else if let Some(h) = usb_undecoded_hint(i, m) {
                hints.push(h);
            }
        }
        changes.push(ByteChange {
            index: i,
            field,
            field_kind: kind_name(kind),
            baseline: base[i],
            set_bits: set,
            cleared_bits: cleared,
            undecoded_bits: undecoded,
            reports_changed: count,
            values_seen: values,
            decoded,
            hints,
        });
    }

    let undecoded: Vec<String> = changes
        .iter()
        .filter(|c| c.undecoded_bits != 0)
        .map(|c| format!("byte {} mask 0x{:02X}", c.index, c.undecoded_bits))
        .collect();
    let buttons: Vec<&'static str> = changes
        .iter()
        .flat_map(|c| c.decoded.iter().copied())
        .collect();
    let verdict = if unexpected && changes.is_empty() {
        Verdict::UnexpectedFormat
    } else if !undecoded.is_empty() {
        Verdict::UndecodedBits {
            locations: undecoded,
        }
    } else if !buttons.is_empty() {
        Verdict::DecodedButtons {
            buttons: buttons.clone(),
        }
    } else if !changes.is_empty() {
        Verdict::AnalogOnly
    } else {
        Verdict::NoChange
    };
    let summary = match &verdict {
        Verdict::NoChange => "Nothing changed in the standard input report. If you pressed a paddle, it is not visible here: it may be handled inside the controller, or reported on another interface (see Interfaces).".to_owned(),
        Verdict::DecodedButtons { buttons } => format!(
            "Mapped-button activity: the controller reported {}. This is that normal button, or a paddle mapped to it; it is not an independent input. NEXUS cannot tell a mapped paddle apart from the real button.",
            buttons.join(" + ")
        ),
        Verdict::UndecodedBits { locations } => {
            let mapped = if buttons.is_empty() {
                String::new()
            } else {
                format!(
                    " Separately, the controller also reported {} (mapped-button activity).",
                    buttons.join(" + ")
                )
            };
            format!(
                "Possible independent input: data NEXUS does not decode changed consistently ({}).{mapped} Repeat the capture to confirm it is the same each time.",
                locations.join(", ")
            )
        }
        Verdict::AnalogOnly => "Only sticks, triggers or touch data changed.".to_owned(),
        Verdict::UnexpectedFormat => "The reports do not look like standard DualSense USB reports.".to_owned(),
    };
    notes.extend(flickers);
    if baseline.len() < 50 {
        notes.push(format!(
            "The baseline has only {} reports; noise detection may be incomplete.",
            baseline.len()
        ));
    }
    // Only for the button data that decided the verdict: a brief stick
    // wobble or a flicker already noted above is not what was being tested.
    if let Some(weak) = changes
        .iter()
        .filter(|c| !c.decoded.is_empty())
        .find(|c| (c.reports_changed as usize) * 5 < action.len())
    {
        notes.push(format!(
            "Byte {} changed in only {} of {} reports. Hold the input for the whole recording.",
            weak.index,
            weak.reports_changed,
            action.len()
        ));
    }
    Analysis {
        baseline_reports: baseline.len(),
        action_reports: action.len(),
        report_len: len,
        noisy_bytes: noisy
            .iter()
            .enumerate()
            .filter(|(_, &n)| n != 0)
            .map(|(i, _)| i)
            .collect(),
        ignored_bytes,
        changes,
        verdict,
        summary,
        notes,
    }
}

// ---- session -------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabeledCapture {
    pub label: String,
    pub capture: RawCapture,
    pub analysis: Analysis,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineView {
    pub reports: usize,
    pub duration_ms: u32,
    pub reference_hex: String,
    pub noisy_bytes: Vec<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorView {
    pub device_id: Option<String>,
    pub product_id: Option<u16>,
    pub baseline: Option<BaselineView>,
    pub captures: Vec<LabeledCapture>,
}

/// Captures of one inspection, kept until cleared.
#[derive(Debug, Default)]
pub struct InspectorSession {
    baseline: Option<RawCapture>,
    captures: Vec<LabeledCapture>,
}

pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

impl InspectorSession {
    /// A new baseline starts a new inspection (earlier captures are cleared).
    pub fn set_baseline(&mut self, capture: RawCapture) {
        self.baseline = Some(capture);
        self.captures.clear();
    }

    pub fn add_action(
        &mut self,
        label: &str,
        capture: RawCapture,
    ) -> Result<&LabeledCapture, String> {
        let base = self
            .baseline
            .as_ref()
            .ok_or("Record a baseline first (hands off the controller).")?;
        if base.device_id != capture.device_id {
            return Err("A different controller is connected now. Record a new baseline.".into());
        }
        let label = label.trim();
        let label = if label.is_empty() {
            "Unnamed input"
        } else {
            label
        };
        let analysis = analyse(&base.reports, &capture.reports);
        self.captures.push(LabeledCapture {
            label: label.chars().take(60).collect(),
            capture,
            analysis,
        });
        Ok(self.captures.last().expect("just pushed"))
    }

    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn view(&self) -> InspectorView {
        let base = self.baseline.as_ref();
        InspectorView {
            device_id: base.map(|b| b.device_id.clone()),
            product_id: base.map(|b| b.product_id),
            baseline: base.map(|b| {
                let len = b.reports.iter().map(Vec::len).max().unwrap_or(0);
                let a = analyse(&b.reports, &[]);
                BaselineView {
                    reports: b.reports.len(),
                    duration_ms: b.duration_ms,
                    reference_hex: hex(&reference(&b.reports, len)),
                    noisy_bytes: a.noisy_bytes,
                }
            }),
            captures: self.captures.clone(),
        }
    }

    /// Everything needed to analyse the captures elsewhere, including every
    /// raw report as hex. Contains no serial numbers.
    pub fn export(&self) -> export::ExportCaptures {
        export::ExportCaptures {
            baseline: self.baseline.as_ref().map(|b| export::CaptureDump {
                label: "Baseline (hands off)".into(),
                duration_ms: b.duration_ms,
                reports_hex: b.reports.iter().map(|r| hex(r)).collect(),
                analysis: None,
            }),
            captures: self
                .captures
                .iter()
                .map(|c| export::CaptureDump {
                    label: c.label.clone(),
                    duration_ms: c.capture.duration_ms,
                    reports_hex: c.capture.reports.iter().map(|r| hex(r)).collect(),
                    analysis: Some(c.analysis.clone()),
                })
                .collect(),
        }
    }
}

/// Serializable export pieces (the desktop shell adds app and interface info).
pub mod export {
    use super::Analysis;
    use serde::Serialize;

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CaptureDump {
        pub label: String,
        pub duration_ms: u32,
        pub reports_hex: Vec<String>,
        pub analysis: Option<Analysis>,
    }

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ExportCaptures {
        pub baseline: Option<CaptureDump>,
        pub captures: Vec<CaptureDump>,
    }
}
