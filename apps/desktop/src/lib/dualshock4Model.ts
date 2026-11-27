// Finds the individual controls inside the DualShock 4 model
// (src/assets/models/dualshock4.glb, "DualShock 4 PlayStation Controller" by
// shaielwolf, CC BY 4.0). The file groups parts by kind: one mesh holds all
// the buttons, one both sticks, one the bumpers and triggers, one the
// touchpad. Inside each mesh every control is its own piece of geometry (an
// "island"), so, as for the DualSense (lib/dualsenseModel.ts), each control
// is found by where its island is and moves on its own.
// Pure (no three.js): unit-tested against the real model file.

import type { ModelSpec, V3 } from "./dualsenseModel.ts";

/**
 * File units → the shared frame. The file (after its node transforms, which
 * cancel out) is already x right, y up, z out of the face, 30.62 units wide;
 * this centres it and scales it to 2 units wide, the DualSense's size.
 */
export const DS4_NORMALISE: { centre: V3; scale: number } = {
  centre: [0, 9.050942, -1.291630],
  scale: 2 / 30.619,
};

const press = (material: string, centre: V3) => ({ material, centre, tolerance: 0.04, motion: "press" as const });

/**
 * Where each control is, in the shared frame (measured from the file).
 * Materials: MAT_5 buttons, MAT_4 sticks, MAT_6 bumpers and triggers,
 * MAT_3 touchpad. A DualShock 4 has no Mute button.
 */
export const DS4_PARTS: ModelSpec["parts"] = {
  dpadUp: press("MAT_5", [-0.628, 0.347, 0.301]),
  dpadRight: press("MAT_5", [-0.535, 0.254, 0.301]),
  dpadDown: press("MAT_5", [-0.628, 0.161, 0.301]),
  dpadLeft: press("MAT_5", [-0.721, 0.254, 0.301]),
  north: press("MAT_5", [0.628, 0.397, 0.308]),
  west: press("MAT_5", [0.484, 0.254, 0.308]),
  south: press("MAT_5", [0.628, 0.11, 0.308]),
  east: press("MAT_5", [0.771, 0.254, 0.308]),
  home: press("MAT_5", [0, -0.035, 0.216]),
  select: press("MAT_5", [-0.408, 0.455, 0.274]),
  start: press("MAT_5", [0.408, 0.455, 0.274]),
  touchpad: press("MAT_3", [0, 0.369, 0.218]),
  leftStick: { material: "MAT_4", centre: [-0.319, -0.023, 0.295], tolerance: 0.04, motion: "stick" },
  rightStick: { material: "MAT_4", centre: [0.319, -0.023, 0.295], tolerance: 0.04, motion: "stick" },
  leftShoulder: { material: "MAT_6", centre: [-0.612, 0.598, 0.149], tolerance: 0.04, motion: "bumper" },
  rightShoulder: { material: "MAT_6", centre: [0.612, 0.598, 0.149], tolerance: 0.04, motion: "bumper" },
  leftTrigger: { material: "MAT_6", centre: [-0.608, 0.513, -0.107], tolerance: 0.04, motion: "trigger" },
  rightTrigger: { material: "MAT_6", centre: [0.608, 0.513, -0.107], tolerance: 0.04, motion: "trigger" },
};

export const DUALSHOCK4_SPEC: ModelSpec = {
  model: "dualShock4",
  parts: DS4_PARTS,
  normalise: DS4_NORMALISE,
  // The stick island includes its shaft, so it tilts from the shaft's base.
  stickPivotZ: (min) => min[2],
  // The model has its own (black) colours; the white/black recolouring is for the DualSense textures.
  finishes: false,
};

/** Credit required by the model's licence (CC BY 4.0). */
export const DS4_MODEL_CREDIT = {
  title: "DualShock 4 PlayStation Controller",
  author: "shaielwolf",
  source: "https://sketchfab.com/3d-models/dualshock-4-playstation-controller-e3c2f0dc16524fc19cdde45bad1de1a9",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  changes: "split into separate controls, glow and motion added by NEXUS",
} as const;
