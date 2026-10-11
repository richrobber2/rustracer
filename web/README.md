# Rustracer browser studio

A self-contained browser renderer alongside the original Rust/Vulkan application. It uses Three.js for interactive rendering and `three-gpu-pathtracer` for progressive WebGL 2 path tracing. It does not run the Vulkan executable or reproduce every original shader or glTF extension.

## Run

Use Node 20.19+ or 22.12+ and npm. From this directory:

```sh
npm ci
npm run dev
```

The server listens on port 5173 on all interfaces. To build and serve the production bundle:

```sh
npm run build
npm run preview -- --port 5173 --strictPort
```

Deploy the contents of `dist/` to any static web host. Asset paths are relative, so subdirectory hosting works. No server-side renderer, API, account, or cloud GPU is required; the user's browser must support WebGL 2. Hardware acceleration is recommended, especially for path tracing.

## Tests

`npm test` runs the browser tests and `tests/skin.spec.js`, a Node-only check of the mannequin's skin deformation. It verifies skin weights and the bind pose, checks that limbs move rigidly away from joints, then bends each joint to the end of a human range of motion and plays every clip. Throughout, every bone must stay under the soft skin (gold ball joints excluded) at no less than half its rest depth, no skin edge may stretch past 2.5×, and a foot must stay on the pedestal. Each muscle must swell by at least an eighth of the limb's radius on its own side at full flexion, grow steadily with the bend, never pull skin inward, and relax completely when the joint straightens.

## Controls

- Orbit with left drag, pan with right drag, and zoom with the wheel or touch gestures. Frame the model, choose camera presets, change field of view, or enable auto orbit.
- Switch between interactive rendering and progressive path tracing. Control resolution, light bounces, and pause/resume accumulation. Moving the camera resets accumulation. Animation and auto orbit switch to interactive rendering.
- Adjust exposure, environment intensity, key light strength/direction, background color, ground visibility, and tone mapping.
- Select individual materials and edit base color, roughness, and metallic response. Restore original materials; rotate or scale the model.
- Import a `.glb`, or choose a folder containing one `.gltf` plus its relative `.bin` and texture files. Multiple loose companion files can also be selected or dropped. Directory imports preserve nested paths. Models are normalized to the studio and automatically framed. Files stay in memory on the user's device; external resource URLs are rejected.
- Play/pause animation clips, and toggle a skeleton overlay on any rigged model. Export the current viewport as a PNG; resolution follows the resolution slider and viewport size.

The built-in studio demo needs no downloaded models. It is a procedural mannequin: one skinned mesh on a 19-bone hierarchy, with vertices near each joint weighted across the bones on both sides so limbs bend continuously. Each joint also has a helper bone that turns half as far as the bone below it, and the skin over the joint follows it. This keeps elbows, knees and shoulders from collapsing toward the bone when bent. Muscles bulge as their joint works: the biceps with elbow flexion, and the hamstrings and calves with knee flexion. Each has a bulge bone in its belly that swells across the limb and shortens along it, so the effect goes through ordinary skinning and shows in the path tracer too (43 bones in total). The Biceps curl and Squat clips show it off. Its walk, wave and idle clips drive every bone from one shared phase (opposite arm and leg swing together, the chest counter-rotates against the hips, the head holds its gaze), and the hips height is solved each frame so the lowest foot stays on the pedestal. Pause a clip and switch to path tracing to render that pose. Imports support uncompressed glTF/GLB, with a 250 MB total file limit. Draco, Meshopt, and KTX2 assets need decoding before import. Material controls apply to standard/physical PBR materials. glTF extension and animation parity with the original Vulkan renderer is not guaranteed. Large models and complex path-traced scenes may be slow or exceed browser GPU limits.

## Validate

```sh
npm test
```

Tests use the system Chromium at `/usr/bin/chromium` (override with `CHROMIUM_PATH`) and software WebGL through SwiftShader, so they run in this cloud environment without a GPU. They validate actual rendered pixels, material/camera controls, PNG output, local glTF companions, binary GLB imports, missing/remote resource handling, progressive sample accumulation, and mobile layout. The existing native Rust tests are independent and retain their known missing-asset/path failures.

In the managed cloud environment, use `npm --cache /workspace/tooling/npm-cache ci` because the default npm cache directory is not writable. The environment draft includes installation and startup instructions for both workflows. No secret values are required.
