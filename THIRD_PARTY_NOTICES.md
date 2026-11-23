# Third-party notices

NEXUS's own code is under the [MIT License](LICENSE). These parts are not
NEXUS's and keep their own licences:

| What | Where | Licence |
|---|---|---|
| 3D controller model "Playstation 5 Dualsense" by [AHarmlessPotato](https://sketchfab.com/AHarmlessPotato) ([source](https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936)) | `apps/desktop/src/assets/models/dualsense.glb` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The file is unchanged; NEXUS splits it into separate controls and recolours it when it loads. Reusing the model requires the same credit. |
| 3D controller model "DualShock 4 PlayStation Controller" by [shaielwolf](https://sketchfab.com/shaielwolf) ([source](https://sketchfab.com/3d-models/dualshock-4-playstation-controller-e3c2f0dc16524fc19cdde45bad1de1a9)) | `apps/desktop/src/assets/models/dualshock4.glb` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The file is unchanged; NEXUS splits it into separate controls when it loads. Shown when a DualShock 4 is connected. Reusing the model requires the same credit. |
| npm packages (React, three.js, React Three Fiber, Tauri API, …) | `apps/desktop/package.json` | Each package's own licence (see `node_modules/<package>/LICENSE`). |
| Rust crates (Tauri, rusqlite, hidapi, vigem-client, …) | `Cargo.toml`, `Cargo.lock` | Each crate's own licence. |

**Not included:** ViGEmBus and HidHide are separate products you install
yourself from their official pages. NEXUS does not bundle or redistribute them.

**Trademarks:** PlayStation, DualSense and the PlayStation button symbols are
trademarks of Sony Interactive Entertainment. Xbox is a trademark of
Microsoft. NEXUS is an independent project, not affiliated with or endorsed
by either.
