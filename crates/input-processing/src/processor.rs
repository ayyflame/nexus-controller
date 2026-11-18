//! The configured processing stage. Built once per settings change; holds a
//! little per-controller state (gyro smoothing, toggles, swipe tracking) and
//! never allocates while processing a report.
//!
//! Order per report:
//! 1. sticks (calibration → deadzones/curve → per-axis sensitivity → shape)
//! 2. triggers (calibration → deadzone/curve/range → activation threshold)
//! 3. gyro → right stick
//! 4. touchpad zones and swipes
//! 5. mapping layers + button remapping (incl. one-to-many)

use crate::config::{
    CurvePoint, DeadzoneShape, GyroActivation, GyroHorizontalAxis, LayerMode, ProcessingConfig,
    RemapRule, ResponseCurve, StickConfig, TouchLayout, TriggerConfig,
};
use crate::InputProcessor;
use nexus_controller_core::{Button, ControllerState, StickState, TriggerState};
use std::time::{Duration, Instant};

const BUTTON_COUNT: usize = Button::ALL.len();

/// Approximate DualSense gyro resolution (LSB per degree/second) for the
/// ±2000 °/s range, used without per-controller factory calibration. This is
/// an estimate until verified on hardware; sensitivity is user-adjustable.
pub const GYRO_LSB_PER_DPS: f32 = 16.384;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Entry {
    to: Option<Button>,
    also: u32,
}

type RemapTable = [Option<Entry>; BUTTON_COUNT];

fn table(rules: &[RemapRule]) -> RemapTable {
    let mut t: RemapTable = [None; BUTTON_COUNT];
    for r in rules {
        t[r.from as usize] = Some(Entry {
            to: r.to,
            also: r.also.iter().fold(0, |m, b| m | b.bit()),
        });
    }
    t
}

struct Layer {
    activator: Button,
    mode: LayerMode,
    table: RemapTable,
}

#[derive(Default)]
struct GyroState {
    smoothed: (f32, f32),
    toggled: bool,
    button_was_down: bool,
}

#[derive(Default)]
struct TouchState {
    last_pos: Option<(f32, f32)>,
    /// (contact id, start position, start time)
    track: Option<(u8, (f32, f32), Instant)>,
    pulse: Option<(Button, Instant)>,
}

pub struct ConfiguredProcessor {
    config: ProcessingConfig,
    base: RemapTable,
    layers: Vec<Layer>,
    layer_toggled: [bool; crate::config::MAX_LAYERS],
    prev_physical: u32,
    gyro: GyroState,
    touch: TouchState,
}

impl ConfiguredProcessor {
    pub fn new(config: &ProcessingConfig) -> Self {
        let c = config.sanitized();
        Self {
            base: table(&c.remap),
            layers: c
                .layers
                .iter()
                .map(|l| Layer {
                    activator: l.activator,
                    mode: l.mode,
                    table: table(&l.remap),
                })
                .collect(),
            layer_toggled: [false; crate::config::MAX_LAYERS],
            prev_physical: 0,
            gyro: GyroState::default(),
            touch: TouchState::default(),
            config: c,
        }
    }

    /// Index of the active mapping layer, if any.
    pub fn active_layer(&self) -> Option<usize> {
        self.layers.iter().enumerate().find_map(|(i, l)| {
            let on = match l.mode {
                LayerMode::Hold => self.prev_physical & l.activator.bit() != 0,
                LayerMode::Toggle => self.layer_toggled[i],
            };
            on.then_some(i)
        })
    }

    pub fn gyro_active(&self) -> bool {
        let g = &self.config.gyro;
        g.enabled
            && match g.activation {
                GyroActivation::Always => true,
                GyroActivation::WhileHeld => self.gyro.button_was_down,
                GyroActivation::Toggle => self.gyro.toggled,
            }
    }

    /// Processes `state` (a copy of `physical`) in place.
    pub fn process_at(
        &mut self,
        state: &mut ControllerState,
        physical: &ControllerState,
        now: Instant,
    ) {
        let c = &self.config;
        process_stick(&c.left_stick, &mut state.left_stick);
        process_stick(&c.right_stick, &mut state.right_stick);
        process_trigger(&c.left_trigger, &mut state.left_trigger);
        process_trigger(&c.right_trigger, &mut state.right_trigger);

        let physical_mask = Button::mask_of(physical);
        let pressed_edge = physical_mask & !self.prev_physical;
        for (i, l) in self.layers.iter().enumerate() {
            if l.mode == LayerMode::Toggle && pressed_edge & l.activator.bit() != 0 {
                self.layer_toggled[i] = !self.layer_toggled[i];
            }
        }
        self.prev_physical = physical_mask;

        self.apply_gyro(state, physical);
        let (overlay, consume_click) = self.apply_touchpad(state, physical, now);
        if consume_click {
            state.buttons.touchpad = false;
        }

        let mut hidden = self.layers.iter().fold(0u32, |m, l| m | l.activator.bit());
        let g = &self.config.gyro;
        if g.enabled && g.suppress_button && g.activation != GyroActivation::Always {
            if let Some(b) = g.button {
                hidden |= b.bit();
            }
        }
        let active = self.active_layer();
        let layer_table = active.map(|i| &self.layers[i].table);
        let has_rules = self.base.iter().any(Option::is_some) || layer_table.is_some();
        if has_rules || hidden != 0 {
            apply_remap(
                &self.base,
                layer_table,
                hidden,
                (&self.config.left_trigger, &self.config.right_trigger),
                state,
            );
        }
        for b in Button::from_mask(overlay) {
            press(state, b, &self.config);
        }
    }

    fn apply_gyro(&mut self, state: &mut ControllerState, physical: &ControllerState) {
        let g = &self.config.gyro;
        if !g.enabled {
            return;
        }
        let down = g.button.is_some_and(|b| b.is_pressed(physical));
        if g.activation == GyroActivation::Toggle && down && !self.gyro.button_was_down {
            self.gyro.toggled = !self.gyro.toggled;
        }
        self.gyro.button_was_down = down;
        let Some(motion) = physical.motion else {
            return;
        };
        if !self.gyro_active() {
            self.gyro.smoothed = (0.0, 0.0);
            return;
        }
        let dps = |i: usize| (motion.gyro_raw[i] as f32 - g.bias[i]) / GYRO_LSB_PER_DPS;
        // DualSense axes: 0 = pitch, 1 = yaw, 2 = roll.
        let horizontal = match g.horizontal_axis {
            GyroHorizontalAxis::Yaw => dps(1),
            GyroHorizontalAxis::Roll => dps(2),
        };
        let gate = |v: f32| if v.abs() < g.threshold_dps { 0.0 } else { v };
        // Turning right should move the stick right; positive rotation is
        // counter-clockwise, hence the minus sign. Users can invert either axis.
        let mut x = -gate(horizontal) * g.sensitivity_x / g.full_scale_dps;
        let mut y = gate(dps(0)) * g.sensitivity_y / g.full_scale_dps;
        if g.invert_x {
            x = -x;
        }
        if g.invert_y {
            y = -y;
        }
        let a = g.smoothing;
        let (sx, sy) = self.gyro.smoothed;
        let sm = (sx * a + x * (1.0 - a), sy * a + y * (1.0 - a));
        self.gyro.smoothed = sm;
        let s = &mut state.right_stick;
        let (mut nx, mut ny) = (s.x + sm.0, s.y + sm.1);
        let m = nx.hypot(ny);
        if m > 1.0 {
            nx /= m;
            ny /= m;
        }
        s.x = nx;
        s.y = ny;
        s.raw_x = to_raw(nx);
        s.raw_y = to_raw(-ny);
    }

    /// Returns (buttons to press, whether the touchpad click was consumed).
    fn apply_touchpad(
        &mut self,
        _state: &ControllerState,
        physical: &ControllerState,
        now: Instant,
    ) -> (u32, bool) {
        let t = &self.config.touchpad;
        let mut overlay = 0u32;
        if let Some((b, until)) = self.touch.pulse {
            if now < until {
                overlay |= b.bit();
            } else {
                self.touch.pulse = None;
            }
        }
        let Some(tp) = physical.touchpad else {
            return (overlay, false);
        };
        let p = tp.points[0];
        let (w, h) = (tp.width.max(1) as f32, tp.height.max(1) as f32);
        if p.active {
            self.touch.last_pos = Some((p.x as f32 / w, p.y as f32 / h));
        }

        if t.swipes_enabled {
            match (p.active, self.touch.track) {
                (true, Some((id, _, _))) if id == p.id => {}
                (true, _) => {
                    self.touch.track = self.touch.last_pos.map(|pos| (p.id, pos, now));
                }
                (false, Some((_, start, began))) => {
                    self.touch.track = None;
                    if let Some(end) = self.touch.last_pos {
                        let dx = end.0 - start.0;
                        // Express vertical movement in widths so distance is isotropic.
                        let dy = (end.1 - start.1) * h / w;
                        let quick = now.saturating_duration_since(began)
                            <= Duration::from_millis(t.swipe_max_ms as u64);
                        if quick && dx.abs().max(dy.abs()) >= t.swipe_distance {
                            let target = if dx.abs() >= dy.abs() {
                                if dx > 0.0 {
                                    t.swipe_right
                                } else {
                                    t.swipe_left
                                }
                            } else if dy > 0.0 {
                                t.swipe_down
                            } else {
                                t.swipe_up
                            };
                            if let Some(b) = target {
                                self.touch.pulse =
                                    Some((b, now + Duration::from_millis(t.swipe_press_ms as u64)));
                                overlay |= b.bit();
                            }
                        }
                    }
                }
                (false, None) => {}
            }
        }

        let mut consume = false;
        if t.layout != TouchLayout::Whole && physical.buttons.touchpad {
            if let Some((x, y)) = self.touch.last_pos {
                let zone = match t.layout {
                    TouchLayout::LeftRight => usize::from(x >= 0.5),
                    TouchLayout::Quadrants => usize::from(x >= 0.5) + 2 * usize::from(y >= 0.5),
                    TouchLayout::Whole => 0,
                };
                if let Some(b) = t.zones[zone] {
                    overlay |= b.bit();
                    consume = true;
                }
            }
        }
        (overlay, consume)
    }
}

impl InputProcessor for ConfiguredProcessor {
    fn name(&self) -> &'static str {
        "configured"
    }

    fn process(&mut self, state: &mut ControllerState) {
        let physical = *state;
        self.process_at(state, &physical, Instant::now());
    }

    fn active_layer(&self) -> Option<usize> {
        ConfiguredProcessor::active_layer(self)
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

/// Maps a measured axis range to −1…1 around the measured centre.
fn calibrate_axis(v: f32, center: f32, min: f32, max: f32) -> f32 {
    let out = if v >= center {
        (v - center) / (max - center).max(f32::EPSILON)
    } else {
        (v - center) / (center - min).max(f32::EPSILON)
    };
    out.clamp(-1.0, 1.0)
}

pub fn process_stick(c: &StickConfig, s: &mut StickState) {
    let cal = &c.calibration;
    let mut x = calibrate_axis(s.x, cal.center_x, cal.min_x, cal.max_x);
    let mut y = calibrate_axis(s.y, cal.center_y, cal.min_y, cal.max_y);
    if c.invert_x {
        x = -x;
    }
    if c.invert_y {
        y = -y;
    }
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
    x *= c.sensitivity_x;
    y *= c.sensitivity_y;
    if c.square_output {
        // Stretch each direction so the circle's edge maps to the square's.
        let m = x.hypot(y).min(1.0);
        let k = x.abs().max(y.abs());
        if k > 0.0 {
            x = x / k * m;
            y = y / k * m;
        }
    } else if c.circular {
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
    let v = ((v - c.raw_min) / (c.raw_max - c.raw_min).max(f32::EPSILON)).clamp(0.0, 1.0);
    if v <= c.deadzone {
        return 0.0;
    }
    let n = ((v - c.deadzone) / (c.max_input - c.deadzone).max(f32::EPSILON)).clamp(0.0, 1.0);
    c.output_min + (c.output_max - c.output_min) * n.powf(c.curve)
}

fn set_trigger_value(t: &mut TriggerState, v: f32, activation: f32) {
    let v = v.clamp(0.0, 1.0);
    t.value = v;
    t.raw = (v * 255.0).round() as u8;
    t.digital = v > 0.0 && v >= activation;
}

pub fn process_trigger(c: &TriggerConfig, t: &mut TriggerState) {
    let out = trigger_output(c, t.value);
    set_trigger_value(t, out, c.activation);
}

// ---- Remapping --------------------------------------------------------------

fn is_trigger(b: Button) -> bool {
    matches!(b, Button::LeftTrigger | Button::RightTrigger)
}

/// Digital buttons after processing; triggers use their activation threshold.
fn digital_mask(s: &ControllerState) -> u32 {
    let mut m = 0u32;
    for b in Button::ALL {
        let on = match b {
            Button::LeftTrigger => s.left_trigger.digital,
            Button::RightTrigger => s.right_trigger.digital,
            _ => b.is_pressed(s),
        };
        if on {
            m |= b.bit();
        }
    }
    m
}

fn press(s: &mut ControllerState, b: Button, c: &ProcessingConfig) {
    match b {
        Button::LeftTrigger => {
            set_trigger_value(&mut s.left_trigger, 1.0, c.left_trigger.activation)
        }
        Button::RightTrigger => {
            set_trigger_value(&mut s.right_trigger, 1.0, c.right_trigger.activation)
        }
        _ => b.set(s, true),
    }
}

/// Rewrites buttons (and triggers) through the base table, overridden by
/// the active layer's table, after hiding `hidden` buttons.
///
/// * Unmapped analog triggers keep their (processed) analog value.
/// * A trigger mapped to the other trigger carries its analog value.
/// * Any other button mapped onto a trigger presses it fully.
/// * A trigger mapped onto a button presses it at its activation threshold.
fn apply_remap(
    base: &RemapTable,
    layer: Option<&RemapTable>,
    hidden: u32,
    triggers: (&TriggerConfig, &TriggerConfig),
    s: &mut ControllerState,
) {
    let pressed = digital_mask(s) & !hidden;
    let (lt, rt) = (s.left_trigger.value, s.right_trigger.value);
    let entry = |b: Button| layer.and_then(|t| t[b as usize]).or(base[b as usize]);
    let visible = |b: Button| hidden & b.bit() == 0;
    let mut out_mask = 0u32;
    let mut lt_out = if entry(Button::LeftTrigger).is_none() && visible(Button::LeftTrigger) {
        lt
    } else {
        0.0
    };
    let mut rt_out = if entry(Button::RightTrigger).is_none() && visible(Button::RightTrigger) {
        rt
    } else {
        0.0
    };

    for b in Button::ALL {
        let Some(e) = entry(b) else {
            if !is_trigger(b) && pressed & b.bit() != 0 {
                out_mask |= b.bit();
            }
            continue;
        };
        if !visible(b) {
            continue;
        }
        match (b, e.to) {
            (Button::RightTrigger, Some(Button::LeftTrigger)) => lt_out = lt_out.max(rt),
            (Button::LeftTrigger, Some(Button::RightTrigger)) => rt_out = rt_out.max(lt),
            _ => {}
        }
        if pressed & b.bit() == 0 {
            continue;
        }
        let analog_swap = matches!(
            (b, e.to),
            (Button::RightTrigger, Some(Button::LeftTrigger))
                | (Button::LeftTrigger, Some(Button::RightTrigger))
        );
        let targets = e.to.filter(|_| !analog_swap).map_or(0, |t| t.bit()) | e.also;
        for t in Button::from_mask(targets) {
            match t {
                Button::LeftTrigger => lt_out = 1.0,
                Button::RightTrigger => rt_out = 1.0,
                _ => out_mask |= t.bit(),
            }
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
    set_trigger_value(&mut s.left_trigger, lt_out, triggers.0.activation);
    set_trigger_value(&mut s.right_trigger, rt_out, triggers.1.activation);
}
