//! User-configurable processing settings, stored per profile as JSON.
//!
//! Every field has a default, so profiles saved by older versions load
//! unchanged, and [`ProcessingConfig::sanitized`] clamps anything out of
//! range (for example values edited by hand or written by a newer build).

use nexus_controller_core::Button;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProcessingConfig {
    pub left_stick: StickConfig,
    pub right_stick: StickConfig,
    pub left_trigger: TriggerConfig,
    pub right_trigger: TriggerConfig,
    /// Physical button → output button (`None` = disabled). Buttons not
    /// listed keep their normal function.
    pub remap: Vec<RemapRule>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeadzoneShape {
    /// Deadzone measured on the stick's distance from centre (recommended).
    #[default]
    Radial,
    /// Separate deadzone on each axis (some older games expect this).
    Axial,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct CurvePoint {
    pub x: f32,
    pub y: f32,
}

/// Maps stick deflection (0 → 1, after deadzones) to output (0 → 1).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ResponseCurve {
    #[default]
    Linear,
    /// `out = in ^ exponent`. Above 1 is more precise near the centre;
    /// below 1 reacts faster.
    Power { exponent: f32 },
    /// Straight lines through these points; (0,0) and (1,1) are implied.
    Custom { points: Vec<CurvePoint> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StickConfig {
    /// Movement below this distance from centre is ignored (0 – 0.9).
    pub deadzone: f32,
    /// Deflection beyond `1 - outer_deadzone` counts as full (0 – 0.5).
    pub outer_deadzone: f32,
    /// Smallest output once outside the deadzone, to overcome a game's own
    /// deadzone (0 – 0.9).
    pub anti_deadzone: f32,
    /// Output multiplier (0.1 – 3.0); output never exceeds full deflection.
    pub sensitivity: f32,
    pub curve: ResponseCurve,
    pub shape: DeadzoneShape,
    /// Limit output to a circle so diagonals are not faster than straight lines.
    pub circular: bool,
    pub invert_x: bool,
    pub invert_y: bool,
}

impl Default for StickConfig {
    fn default() -> Self {
        Self {
            deadzone: 0.05,
            outer_deadzone: 0.0,
            anti_deadzone: 0.0,
            sensitivity: 1.0,
            curve: ResponseCurve::Linear,
            shape: DeadzoneShape::Radial,
            circular: true,
            invert_x: false,
            invert_y: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TriggerConfig {
    /// Travel below this is ignored (0 – 0.9).
    pub deadzone: f32,
    /// Travel at or beyond this counts as fully pressed.
    pub max_input: f32,
    /// Output range once the trigger is past its deadzone (0 – 1).
    pub output_min: f32,
    pub output_max: f32,
}

impl Default for TriggerConfig {
    fn default() -> Self {
        Self {
            deadzone: 0.0,
            max_input: 1.0,
            output_min: 0.0,
            output_max: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapRule {
    pub from: Button,
    /// `None` disables the button.
    pub to: Option<Button>,
}

fn clamp(v: f32, lo: f32, hi: f32, fallback: f32) -> f32 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        fallback
    }
}

impl StickConfig {
    fn sanitized(&self) -> Self {
        let d = Self::default();
        let deadzone = clamp(self.deadzone, 0.0, 0.9, d.deadzone);
        let outer = clamp(self.outer_deadzone, 0.0, 0.5, d.outer_deadzone)
            .min(0.95 - deadzone)
            .max(0.0);
        let curve = match &self.curve {
            ResponseCurve::Linear => ResponseCurve::Linear,
            ResponseCurve::Power { exponent } => ResponseCurve::Power {
                exponent: clamp(*exponent, 0.2, 5.0, 1.0),
            },
            ResponseCurve::Custom { points } => {
                let mut pts: Vec<CurvePoint> = points
                    .iter()
                    .filter(|p| p.x.is_finite() && p.y.is_finite())
                    .map(|p| CurvePoint {
                        x: p.x.clamp(0.0, 1.0),
                        y: p.y.clamp(0.0, 1.0),
                    })
                    .filter(|p| p.x > 0.0 && p.x < 1.0)
                    .collect();
                pts.sort_by(|a, b| a.x.total_cmp(&b.x));
                pts.dedup_by(|a, b| (a.x - b.x).abs() < 1e-4);
                pts.truncate(MAX_CURVE_POINTS);
                ResponseCurve::Custom { points: pts }
            }
        };
        Self {
            deadzone,
            outer_deadzone: outer,
            anti_deadzone: clamp(self.anti_deadzone, 0.0, 0.9, d.anti_deadzone),
            sensitivity: clamp(self.sensitivity, 0.1, 3.0, d.sensitivity),
            curve,
            shape: self.shape,
            circular: self.circular,
            invert_x: self.invert_x,
            invert_y: self.invert_y,
        }
    }
}

pub const MAX_CURVE_POINTS: usize = 8;

impl TriggerConfig {
    fn sanitized(&self) -> Self {
        let d = Self::default();
        let deadzone = clamp(self.deadzone, 0.0, 0.9, d.deadzone);
        let max_input = clamp(self.max_input, deadzone + 0.05, 1.0, 1.0);
        let output_min = clamp(self.output_min, 0.0, 1.0, d.output_min);
        let output_max = clamp(self.output_max, output_min, 1.0, d.output_max);
        Self {
            deadzone,
            max_input,
            output_min,
            output_max,
        }
    }
}

impl ProcessingConfig {
    /// A copy with every value in its valid range and duplicate remap
    /// rules removed (the first rule for a button wins).
    pub fn sanitized(&self) -> Self {
        let mut seen = 0u32;
        let remap = self
            .remap
            .iter()
            .filter(|r| {
                let new = seen & r.from.bit() == 0;
                seen |= r.from.bit();
                new && r.to != Some(r.from)
            })
            .copied()
            .collect();
        Self {
            left_stick: self.left_stick.sanitized(),
            right_stick: self.right_stick.sanitized(),
            left_trigger: self.left_trigger.sanitized(),
            right_trigger: self.right_trigger.sanitized(),
            remap,
        }
    }

    /// Settings that change nothing (pure pass-through).
    pub fn passthrough() -> Self {
        let stick = StickConfig {
            deadzone: 0.0,
            circular: false,
            ..StickConfig::default()
        };
        Self {
            left_stick: stick.clone(),
            right_stick: stick,
            ..Self::default()
        }
    }
}
