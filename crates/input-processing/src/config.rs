//! User-configurable processing settings, stored per profile as JSON.
//!
//! Every field has a default, so profiles saved by older versions load
//! unchanged, and [`ProcessingConfig::sanitized`] clamps anything out of
//! range (for example values edited by hand or written by a newer build).

use nexus_controller_core::Button;
use serde::{Deserialize, Serialize};

pub const MAX_CURVE_POINTS: usize = 8;
pub const MAX_LAYERS: usize = 4;
pub const MAX_EXTRA_ACTIONS: usize = 3;

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
    /// Alternate layouts active while a button is held (or toggled).
    pub layers: Vec<MappingLayer>,
    pub gyro: GyroConfig,
    pub touchpad: TouchpadConfig,
}

// ---- Sticks -----------------------------------------------------------------

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

/// Measured centre and travel of a physical stick. Identity by default.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StickCalibration {
    pub center_x: f32,
    pub center_y: f32,
    pub min_x: f32,
    pub max_x: f32,
    pub min_y: f32,
    pub max_y: f32,
}

impl Default for StickCalibration {
    fn default() -> Self {
        Self {
            center_x: 0.0,
            center_y: 0.0,
            min_x: -1.0,
            max_x: 1.0,
            min_y: -1.0,
            max_y: 1.0,
        }
    }
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
    /// Extra multipliers per axis, applied after the curve.
    pub sensitivity_x: f32,
    pub sensitivity_y: f32,
    /// Stretch circular output to the full square (for games that expect
    /// full range on diagonals). Overrides `circular`.
    pub square_output: bool,
    pub calibration: StickCalibration,
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
            sensitivity_x: 1.0,
            sensitivity_y: 1.0,
            square_output: false,
            calibration: StickCalibration::default(),
        }
    }
}

// ---- Triggers ---------------------------------------------------------------

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
    /// Output level at which the trigger counts as a pressed button (for
    /// remapping and the digital trigger bit).
    pub activation: f32,
    /// Sensitivity curve exponent: above 1 needs more travel, below 1 less.
    pub curve: f32,
    /// Measured raw travel of this trigger (calibration). 0 and 1 = none.
    pub raw_min: f32,
    pub raw_max: f32,
}

impl Default for TriggerConfig {
    fn default() -> Self {
        Self {
            deadzone: 0.0,
            max_input: 1.0,
            output_min: 0.0,
            output_max: 1.0,
            activation: 0.5,
            curve: 1.0,
            raw_min: 0.0,
            raw_max: 1.0,
        }
    }
}

// ---- Buttons and layers -----------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapRule {
    pub from: Button,
    /// `None` disables the button.
    pub to: Option<Button>,
    /// Further buttons pressed together with `to` (one input, several actions).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub also: Vec<Button>,
}

impl RemapRule {
    pub fn new(from: Button, to: Option<Button>) -> Self {
        Self {
            from,
            to,
            also: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LayerMode {
    /// Active while the activator is held.
    #[default]
    Hold,
    /// Press the activator to switch the layer on, press again for off.
    Toggle,
}

/// A shift layer: while active, its rules replace the base rules for the
/// buttons they list. The activator button itself is not sent to games.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingLayer {
    pub name: String,
    pub activator: Button,
    #[serde(default)]
    pub mode: LayerMode,
    #[serde(default)]
    pub remap: Vec<RemapRule>,
}

// ---- Gyro -------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GyroActivation {
    #[default]
    Always,
    /// Only while `button` is held (e.g. aim with L2).
    WhileHeld,
    /// `button` switches gyro on and off.
    Toggle,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GyroHorizontalAxis {
    /// Turning the controller left/right while holding it normally.
    #[default]
    Yaw,
    /// Tilting the controller left/right like a steering wheel.
    Roll,
}

/// Motion controls: controller rotation moves the right stick.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GyroConfig {
    pub enabled: bool,
    pub activation: GyroActivation,
    pub button: Option<Button>,
    /// Hide the activation button from games.
    pub suppress_button: bool,
    /// Rotation speed (degrees per second) for full stick deflection at
    /// sensitivity 1.
    pub full_scale_dps: f32,
    pub sensitivity_x: f32,
    pub sensitivity_y: f32,
    pub invert_x: bool,
    pub invert_y: bool,
    /// 0 = raw, up to 0.95 = very smooth (exponential smoothing).
    pub smoothing: f32,
    /// Rotation slower than this (deg/s) is ignored, so a resting hand does
    /// not move the view.
    pub threshold_dps: f32,
    pub horizontal_axis: GyroHorizontalAxis,
    /// Resting offset of each gyro axis in raw units (from calibration).
    pub bias: [f32; 3],
}

impl Default for GyroConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            activation: GyroActivation::Always,
            button: None,
            suppress_button: false,
            full_scale_dps: 250.0,
            sensitivity_x: 1.0,
            sensitivity_y: 1.0,
            invert_x: false,
            invert_y: false,
            smoothing: 0.3,
            threshold_dps: 2.0,
            horizontal_axis: GyroHorizontalAxis::Yaw,
            bias: [0.0; 3],
        }
    }
}

// ---- Touchpad ---------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TouchLayout {
    /// The touchpad click stays a single button.
    #[default]
    Whole,
    /// Two zones: left, right.
    LeftRight,
    /// Four zones: top-left, top-right, bottom-left, bottom-right.
    Quadrants,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TouchpadConfig {
    pub layout: TouchLayout,
    /// Button pressed when the touchpad is clicked in each zone (left/right
    /// use the first two). `None` keeps the normal touchpad click.
    pub zones: [Option<Button>; 4],
    pub swipes_enabled: bool,
    /// Minimum swipe length as a fraction of the touchpad width.
    pub swipe_distance: f32,
    /// Longest touch that still counts as a swipe.
    pub swipe_max_ms: u32,
    pub swipe_up: Option<Button>,
    pub swipe_down: Option<Button>,
    pub swipe_left: Option<Button>,
    pub swipe_right: Option<Button>,
    /// How long a swipe presses its button.
    pub swipe_press_ms: u32,
}

impl Default for TouchpadConfig {
    fn default() -> Self {
        Self {
            layout: TouchLayout::Whole,
            zones: [None; 4],
            swipes_enabled: false,
            swipe_distance: 0.25,
            swipe_max_ms: 600,
            swipe_up: None,
            swipe_down: None,
            swipe_left: None,
            swipe_right: None,
            swipe_press_ms: 80,
        }
    }
}

// ---- Sanitising -------------------------------------------------------------

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
        let c = self.calibration;
        let dc = StickCalibration::default();
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
            sensitivity_x: clamp(self.sensitivity_x, 0.1, 3.0, 1.0),
            sensitivity_y: clamp(self.sensitivity_y, 0.1, 3.0, 1.0),
            square_output: self.square_output,
            calibration: StickCalibration {
                center_x: clamp(c.center_x, -0.5, 0.5, 0.0),
                center_y: clamp(c.center_y, -0.5, 0.5, 0.0),
                min_x: clamp(c.min_x, -1.0, -0.2, dc.min_x),
                max_x: clamp(c.max_x, 0.2, 1.0, dc.max_x),
                min_y: clamp(c.min_y, -1.0, -0.2, dc.min_y),
                max_y: clamp(c.max_y, 0.2, 1.0, dc.max_y),
            },
        }
    }
}

impl TriggerConfig {
    fn sanitized(&self) -> Self {
        let d = Self::default();
        let deadzone = clamp(self.deadzone, 0.0, 0.9, d.deadzone);
        let max_input = clamp(self.max_input, deadzone + 0.05, 1.0, 1.0);
        let output_min = clamp(self.output_min, 0.0, 1.0, d.output_min);
        let output_max = clamp(self.output_max, output_min, 1.0, d.output_max);
        let raw_min = clamp(self.raw_min, 0.0, 0.5, 0.0);
        let raw_max = clamp(self.raw_max, raw_min + 0.2, 1.0, 1.0);
        Self {
            deadzone,
            max_input,
            output_min,
            output_max,
            activation: clamp(self.activation, 0.01, 1.0, d.activation),
            curve: clamp(self.curve, 0.3, 3.0, 1.0),
            raw_min,
            raw_max,
        }
    }
}

/// First rule per button wins; rules with no effect are dropped.
fn sanitize_rules(rules: &[RemapRule]) -> Vec<RemapRule> {
    let mut seen = 0u32;
    rules
        .iter()
        .filter(|r| {
            let new = seen & r.from.bit() == 0;
            seen |= r.from.bit();
            new && !(r.to == Some(r.from) && r.also.is_empty())
        })
        .map(|r| {
            let mut also: Vec<Button> = Vec::new();
            for b in &r.also {
                if Some(*b) != r.to && !also.contains(b) && also.len() < MAX_EXTRA_ACTIONS {
                    also.push(*b);
                }
            }
            RemapRule {
                from: r.from,
                to: r.to,
                also,
            }
        })
        .collect()
}

impl ProcessingConfig {
    /// A copy with every value in its valid range, duplicate rules and
    /// layers removed (the first wins) and at most [`MAX_LAYERS`] layers.
    pub fn sanitized(&self) -> Self {
        let mut seen_activators = 0u32;
        let layers = self
            .layers
            .iter()
            .filter(|l| {
                let new = seen_activators & l.activator.bit() == 0;
                seen_activators |= l.activator.bit();
                new
            })
            .take(MAX_LAYERS)
            .map(|l| MappingLayer {
                name: l.name.trim().chars().take(30).collect(),
                activator: l.activator,
                mode: l.mode,
                remap: sanitize_rules(&l.remap),
            })
            .collect();
        let g = &self.gyro;
        let dg = GyroConfig::default();
        let gyro = GyroConfig {
            enabled: g.enabled,
            activation: g.activation,
            button: g.button,
            suppress_button: g.suppress_button,
            full_scale_dps: clamp(g.full_scale_dps, 30.0, 2000.0, dg.full_scale_dps),
            sensitivity_x: clamp(g.sensitivity_x, 0.1, 10.0, 1.0),
            sensitivity_y: clamp(g.sensitivity_y, 0.1, 10.0, 1.0),
            invert_x: g.invert_x,
            invert_y: g.invert_y,
            smoothing: clamp(g.smoothing, 0.0, 0.95, dg.smoothing),
            threshold_dps: clamp(g.threshold_dps, 0.0, 30.0, dg.threshold_dps),
            horizontal_axis: g.horizontal_axis,
            bias: g.bias.map(|b| clamp(b, -4096.0, 4096.0, 0.0)),
        };
        let t = &self.touchpad;
        let touchpad = TouchpadConfig {
            swipe_distance: clamp(t.swipe_distance, 0.05, 0.9, 0.25),
            swipe_max_ms: t.swipe_max_ms.clamp(100, 3000),
            swipe_press_ms: t.swipe_press_ms.clamp(20, 1000),
            ..t.clone()
        };
        Self {
            left_stick: self.left_stick.sanitized(),
            right_stick: self.right_stick.sanitized(),
            left_trigger: self.left_trigger.sanitized(),
            right_trigger: self.right_trigger.sanitized(),
            remap: sanitize_rules(&self.remap),
            layers,
            gyro,
            touchpad,
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

// ---- Conflicts --------------------------------------------------------------

/// Something in the settings that probably won't do what the user expects.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigConflict {
    pub message: String,
}

/// Finds mapping conflicts, including with macro trigger buttons.
pub fn find_conflicts(c: &ProcessingConfig, macro_triggers: &[Button]) -> Vec<ConfigConflict> {
    let mut out = Vec::new();
    let mut push = |m: String| out.push(ConfigConflict { message: m });
    let mut activators: Vec<Button> = Vec::new();
    if c.layers.len() > MAX_LAYERS {
        push(format!(
            "Only {MAX_LAYERS} layers are supported; the rest are ignored."
        ));
    }
    for l in &c.layers {
        if activators.contains(&l.activator) {
            push(format!(
                "Two layers use the same button ({:?}); only the first one works.",
                l.activator
            ));
        }
        activators.push(l.activator);
        if c.remap.iter().any(|r| r.from == l.activator) {
            push(format!(
                "{:?} switches the layer “{}”, so its own remapping is ignored.",
                l.activator, l.name
            ));
        }
        if macro_triggers.contains(&l.activator) {
            push(format!(
                "{:?} switches the layer “{}” and also starts a macro.",
                l.activator, l.name
            ));
        }
    }
    if c.gyro.enabled && c.gyro.activation != GyroActivation::Always {
        match c.gyro.button {
            None => push("Gyro is set to use a button, but no button is chosen.".into()),
            Some(b) if activators.contains(&b) => {
                push(format!("{b:?} controls both the gyro and a mapping layer."))
            }
            _ => {}
        }
    }
    out
}
