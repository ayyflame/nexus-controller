//! The configured processing stage: sticks → triggers → button remapping.
//! Built once per settings change; `process` never allocates.

use crate::config::{
    CurvePoint, DeadzoneShape, ProcessingConfig, RemapRule, ResponseCurve, StickConfig,
    TriggerConfig,
};
use crate::InputProcessor;
use nexus_controller_core::{Button, ControllerState, StickState, TriggerState};

const BUTTON_COUNT: usize = Button::ALL.len();

/// Output for a remapped button: `None` = unchanged, `Some(None)` = disabled.
type RemapTable = [Option<Option<Button>>; BUTTON_COUNT];

pub struct ConfiguredProcessor {
    left_stick: StickConfig,
    right_stick: StickConfig,
    left_trigger: TriggerConfig,
    right_trigger: TriggerConfig,
    remap: RemapTable,
    has_remap: bool,
}

impl ConfiguredProcessor {
    pub fn new(config: &ProcessingConfig) -> Self {
        let c = config.sanitized();
        let mut remap: RemapTable = [None; BUTTON_COUNT];
        for RemapRule { from, to } in &c.remap {
            remap[*from as usize] = Some(*to);
        }
        Self {
            has_remap: !c.remap.is_empty(),
            left_stick: c.left_stick,
            right_stick: c.right_stick,
            left_trigger: c.left_trigger,
            right_trigger: c.right_trigger,
            remap,
        }
    }
}

impl InputProcessor for ConfiguredProcessor {
    fn name(&self) -> &'static str {
        "configured"
    }

    fn process(&mut self, state: &mut ControllerState) {
        process_stick(&self.left_stick, &mut state.left_stick);
        process_stick(&self.right_stick, &mut state.right_stick);
        process_trigger(&self.left_trigger, &mut state.left_trigger);
        process_trigger(&self.right_trigger, &mut state.right_trigger);
        if self.has_remap {
            apply_remap(&self.remap, state);
        }
    }
}

// ---- Curves -----------------------------------------------------------------

/// Evaluates a response curve for `n` in [0, 1].
pub fn evaluate_curve(curve: &ResponseCurve, n: f32) -> f32 {
    let n = n.clamp(0.0, 1.0);
    match curve {
        ResponseCurve::Linear => n,
        ResponseCurve::Power { exponent } => n.powf(*exponent),
        ResponseCurve::Custom { points } => interpolate(points, n),
    }
}

fn interpolate(points: &[CurvePoint], n: f32) -> f32 {
    let mut prev = CurvePoint { x: 0.0, y: 0.0 };
    for p in points
        .iter()
        .copied()
        .chain(std::iter::once(CurvePoint { x: 1.0, y: 1.0 }))
    {
        if n <= p.x {
            let span = p.x - prev.x;
            if span <= f32::EPSILON {
                return p.y;
            }
            return prev.y + (p.y - prev.y) * (n - prev.x) / span;
        }
        prev = p;
    }
    1.0
}

// ---- Sticks -----------------------------------------------------------------

/// Deadzones, curve, sensitivity and anti-deadzone for one magnitude.
pub fn shape_magnitude(c: &StickConfig, m: f32) -> f32 {
    if m <= c.deadzone {
        return 0.0;
    }
    let usable = (1.0 - c.deadzone - c.outer_deadzone).max(f32::EPSILON);
    let n = ((m - c.deadzone) / usable).clamp(0.0, 1.0);
    let shaped = (evaluate_curve(&c.curve, n) * c.sensitivity).clamp(0.0, 1.0);
    c.anti_deadzone + (1.0 - c.anti_deadzone) * shaped
}

fn to_raw(v: f32) -> u8 {
    (v * 127.0 + 128.0).round().clamp(0.0, 255.0) as u8
}

pub fn process_stick(c: &StickConfig, s: &mut StickState) {
    let mut x = if c.invert_x { -s.x } else { s.x };
    let mut y = if c.invert_y { -s.y } else { s.y };
    match c.shape {
        DeadzoneShape::Radial => {
            let m = x.hypot(y);
            if m > 0.0 {
                let out = shape_magnitude(c, m);
                x = x / m * out;
                y = y / m * out;
            }
        }
        DeadzoneShape::Axial => {
            x = x.signum() * shape_magnitude(c, x.abs());
            y = y.signum() * shape_magnitude(c, y.abs());
        }
    }
    if c.circular {
        let m = x.hypot(y);
        if m > 1.0 {
            x /= m;
            y /= m;
        }
    }
    s.x = x.clamp(-1.0, 1.0);
    s.y = y.clamp(-1.0, 1.0);
    s.raw_x = to_raw(s.x);
    s.raw_y = to_raw(-s.y);
}

// ---- Triggers ---------------------------------------------------------------

pub fn trigger_output(c: &TriggerConfig, v: f32) -> f32 {
    if v <= c.deadzone {
        return 0.0;
    }
    let n = ((v - c.deadzone) / (c.max_input - c.deadzone).max(f32::EPSILON)).clamp(0.0, 1.0);
    c.output_min + (c.output_max - c.output_min) * n
}

fn set_trigger_value(t: &mut TriggerState, v: f32) {
    let v = v.clamp(0.0, 1.0);
    t.value = v;
    t.raw = (v * 255.0).round() as u8;
    t.digital = v > 0.0;
}

pub fn process_trigger(c: &TriggerConfig, t: &mut TriggerState) {
    let out = trigger_output(c, t.value);
    set_trigger_value(t, out);
}

// ---- Remapping --------------------------------------------------------------

fn is_trigger(b: Button) -> bool {
    matches!(b, Button::LeftTrigger | Button::RightTrigger)
}

/// Rewrites digital buttons (and triggers) according to `table`.
///
/// * Unmapped analog triggers keep their (processed) analog value.
/// * A trigger mapped to the other trigger carries its analog value.
/// * Any other button mapped onto a trigger presses it fully.
/// * A trigger mapped onto a button presses that button at half travel.
fn apply_remap(table: &RemapTable, s: &mut ControllerState) {
    let pressed = Button::mask_of(s);
    let (lt, rt) = (s.left_trigger.value, s.right_trigger.value);
    let mut out_mask = 0u32;
    let mut lt_out = if table[Button::LeftTrigger as usize].is_none() {
        lt
    } else {
        0.0
    };
    let mut rt_out = if table[Button::RightTrigger as usize].is_none() {
        rt
    } else {
        0.0
    };

    for b in Button::ALL {
        let target = match table[b as usize] {
            None => {
                if !is_trigger(b) && pressed & b.bit() != 0 {
                    out_mask |= b.bit();
                }
                continue;
            }
            Some(None) => continue,
            Some(Some(t)) => t,
        };
        match (b, target) {
            (Button::RightTrigger, Button::LeftTrigger) => lt_out = lt_out.max(rt),
            (Button::LeftTrigger, Button::RightTrigger) => rt_out = rt_out.max(lt),
            _ if pressed & b.bit() == 0 => {}
            (_, Button::LeftTrigger) => lt_out = 1.0,
            (_, Button::RightTrigger) => rt_out = 1.0,
            (_, t) => out_mask |= t.bit(),
        }
    }

    for b in Button::ALL {
        if !is_trigger(b) {
            b.set(s, false);
        }
    }
    for b in Button::from_mask(out_mask) {
        b.set(s, true);
    }
    set_trigger_value(&mut s.left_trigger, lt_out);
    set_trigger_value(&mut s.right_trigger, rt_out);
}
