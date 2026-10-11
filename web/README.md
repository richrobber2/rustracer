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

## Controls

- Orbit with left drag, pan with right drag, and zoom with the wheel or touch gestures. Frame the model, choose camera presets, change field of view, or enable auto orbit.
- Switch between interactive rendering and progressive path tracing. Control resolution, light bounces, and pause/resume accumulation. Moving the camera resets accumulation. Animation and auto orbit switch to interactive rendering.
- Adjust exposure, environment intensity, key light strength/direction, background color, ground visibility, and tone mapping.
- Select individual materials and edit base color, roughness, and metallic response. Restore original materials; rotate or scale the model.
- Import a `.glb`, or choose a folder containing one `.gltf` plus its relative `.bin` and texture files. Multiple loose companion files can also be selected or dropped. Directory imports preserve nested paths. Models are normalized to the studio and automatically framed. Files stay in memory on the user's device; external resource URLs are rejected.
- Play/pause animation clips, and toggle a skeleton overlay on any rigged model. Export the current viewport as a PNG; resolution follows the resolution slider and viewport size.

The built-in studio demo needs no downloaded models. It is a procedural mannequin: one skinned mesh on a 19-bone hierarchy, with vertices near each joint weighted across the bones on both sides so limbs bend continuously. Its walk, wave and idle clips drive every bone from one shared phase (opposite arm and leg swing together, the chest counter-rotates against the hips, the head holds its gaze), and the hips height is solved each frame so the lowest foot stays on the pedestal. Pause a clip and switch to path tracing to render that pose. Imports support uncompressed glTF/GLB, with a 250 MB total file limit. Draco, Meshopt, and KTX2 assets need decoding before import. Material controls apply to standard/physical PBR materials. glTF extension and animation parity with the original Vulkan renderer is not guaranteed. Large models and complex path-traced scenes may be slow or exceed browser GPU limits.

## Validate

```sh
npm test
```

Tests use the system Chromium at `/usr/bin/chromium` (override with `CHROMIUM_PATH`) and software WebGL through SwiftShader, so they run in this cloud environment without a GPU. They validate actual rendered pixels, material/camera controls, PNG output, local glTF companions, binary GLB imports, missing/remote resource handling, progressive sample accumulation, and mobile layout. The existing native Rust tests are independent and retain their known missing-asset/path failures.

In the managed cloud environment, use `npm --cache /workspace/tooling/npm-cache ci` because the default npm cache directory is not writable. The environment draft includes installation and startup instructions for both workflows. No secret values are required.
