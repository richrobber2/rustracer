# Rustracer body creator and browser studio

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

## Character creator

Use the **Create**, **Physics**, and **Render** tabs to move between body proportions, deformation experiments, and lighting/rendering. All character inputs describe adult bodies.

- Create: female/male base; height, shoulders, chest, waist, hips, thighs, genital length and width. Sliders describe percentages of the base shape. Randomize/reset the proportions, or focus the camera on the pelvis.
- Presets: save/load slots A and B on the current device, or export/import a versioned JSON preset with proportions and tissue settings. Import validation clamps numeric fields and rejects unsupported versions. These presets do not contain personal images or uploaded models.
- Physics: genital tissue is a separate selectable force region with its own compliance and damping. Larger proportional geometry changes support and permitted displacement. Press, pull, pulse, and vibration work on the selected region. Parameters are illustrative, not measurements of human tissue.
- Proportion edits transform the rest surface, eye meshes, and simulation cage together. Bilateral edits reset deformation; unilateral muscle/fat edits preserve motion on an unchanged opposite side. The fixed-pose skeleton remains a base rig. **Download base GLB** preserves that base; **Export preset** preserves creator changes.

## Controls

- The body lab starts with a detailed adult female body; choose **Male** or **Female** to switch. Select **Press** or **Pull**, touch the surface, drag, and release to observe recovery. Empty-space dragging still orbits the camera. **Studio** returns to the original demonstration scene.
- Adjust stiffness, damping, gravity, touch radius/strength, and muscle support. Target individual body regions, apply a pulse, enable vibration, or pause/reset the tissue. View textured skin, clay, displacement colors (0–50 mm), or wireframe. Path tracing pauses physics and renders the held shape; resume physics to return to interactive rendering.
- Download either rigged body as a GLB. Downloads contain the original neutral body, embedded textures, skeletal rig, and cage influence attributes; they do not bake the current simulated deformation.
- Orbit with left drag, pan with right drag, and zoom with the wheel or touch gestures. Frame the model, choose camera presets, change field of view, or enable auto orbit.
- Switch between interactive rendering and progressive path tracing. Path tracing starts with **Fast**: 50% CSS-pixel resolution, a 200,000-pixel ceiling, and two light bounces. High-DPI scaling is disabled in path mode; **Balanced** and **Detail** increase quality and the pixel budget. Interactive resolution is remembered separately. The resolution slider can reduce either mode to 12.5%.
- Orbit/zoom shows a raster preview and resumes path tracing 180 ms after camera motion, including damping, stops. Path tracing stops after 64 samples by default; choose a different sample limit or **Refine further** to continue. Moving the camera or editing the scene restarts accumulation. Hidden tabs skip rendering. Animation and auto orbit switch to interactive rendering.
- Adjust exposure, environment intensity, key light strength/direction, background color, ground visibility, and tone mapping.
- Select individual materials and edit base color, roughness, and metallic response. Restore original materials; rotate or scale the model.
- Import a `.glb`, or choose a folder containing one `.gltf` plus its relative `.bin` and texture files. Multiple loose companion files can also be selected or dropped. Directory imports preserve nested paths. Models are normalized to the studio and automatically framed. Files stay in memory on the user's device; external resource URLs are rejected.
- Play/pause imported animation clips. Export the current viewport as a PNG; resolution follows the resolution slider and viewport size.

The built-in studio demo needs no downloaded models. Imports support uncompressed glTF/GLB, with a 250 MB total file limit. Draco, Meshopt, and KTX2 assets need decoding before import. Material controls apply to standard/physical PBR materials. glTF extension and animation parity with the original Vulkan renderer is not guaranteed. Large models and complex path-traced scenes may be slow or exceed browser GPU limits.

## Bodies and simulation

The adult female and male bodies derive from the CC0 MakeHuman/MPFB base mesh, adult shape targets, default rig, weights, and system textures. The female body has 108,080 surface triangles; the male body has 108,624. Both include a 163-bone skeleton and an embedded 2K skin texture. External anatomical surfaces from the MHX2 assets are welded into the main body before subdivision. The source and license clarification are recorded in the attribution file. Files and attribution are in `public/bodies/`; the manifest records the source commit and generated model hashes. Assets are approximately 10 MB per body and load on demand.

The simulation uses a fixed-step spring cage (1,532 particles for female; 1,867 for male, including 101/171 genital particles) to deform the detailed surface. Regional support, damping, gravity, and touch forces provide an interactive visual approximation. The skeleton stays in its neutral pose. Muscle support changes restoring stiffness and a small shape offset; there are no separate anatomical muscle/fat layers, volumetric tissue mechanics, tissue self-collision, or calibrated biological properties. This is a visual experimentation tool, not a source of biomechanical ground truth or medical predictions.

`scripts/prepare-human-models.py` regenerates the assets with Python, NumPy, and SciPy:

```sh
python scripts/prepare-human-models.py /path/to/mpfb2 /path/to/makehuman-system-assets /path/to/mhx2-makehuman-exchange
```

The MPFB checkout must include `src/mpfb/data/3dobjs`, `targets/macrodetails`, and `rigs/standard`. The system-assets directory supplies the female/male young light-skin diffuse textures and low-poly eyes. The MHX2 checkout supplies `import_runtime_mhx2/data/hm8/genitalia/{penis,vulva}.mxa`; their exact source revision is in the manifest. See `public/bodies/ATTRIBUTION.txt` for the upstream sources and `CC0-1.0.txt` for the asset license. No Blender installation is needed.

## Performance

The simulation caches spring coefficients and sleeps once its velocity stays below the settling threshold. Grabs, pulses, vibration, parameter changes, and proportion edits wake it. Surface updates visit the vertices affected by changed cage particles; face normals are updated only where needed, with a linear whole-body path when many particles change. Normals are welded across texture seams and can refresh at 15/30/60 Hz independently of the 120 Hz solver. Shape-slider events coalesce to one rest-shape rebuild per animation frame. Superseded body downloads are cancelled.

The Physics tab reports CPU update time separately from the viewport frame rate. `PERFORMANCE.md` records the CPU benchmark and its limits. Reproduce it with:

```sh
node checks/body-performance.mjs
```

## Validate

Model loading, rig binding, cage weights, welded anatomy, reversible proportions, preset validation, selective normals, sleep/wake behavior, simulation recovery/stability, and rendering scheduler checks without a browser:

```sh
node --test checks/*.test.mjs
```

Full browser/rendering checks when Chromium is available:

```sh
npm test
```

Browser tests use Chromium at `/usr/bin/chromium` (override with `CHROMIUM_PATH`) and software WebGL through SwiftShader. When a supported browser environment is available, they validate the studio's rendered pixels, material/camera controls, PNG output, local glTF companions, binary GLB imports, missing/remote resource handling, progressive sample accumulation, and mobile layout. Device performance and body-lab interaction still require a browser check. The existing native Rust tests are independent and retain their known missing-asset/path failures.

In the managed cloud environment, use `npm --cache /workspace/tooling/npm-cache ci` because the default npm cache directory is not writable. The environment draft includes installation and startup instructions for both workflows. No secret values are required.

## Skin patch research prototype

Open **Skin study** from the header (`skin.html`). This isolated experiment leaves the body solver unchanged. A 100-particle, 288-tetrahedron patch has an anchored base, three layers of interior cells, compliant edge constraints, a stiffer top surface, and optional total-volume XPBD preservation. Signed top-surface load supports press/pull; release removes the load and reset restores rest geometry. Fixed 1/240 s substeps with four iterations update displacement, volume change, and inverted-cell readouts.

Global volume preservation allows local compression and surrounding expansion. It does not enforce cell-wise incompressibility or prevent inversion. No collision, sliding, bending-specific energy, anisotropy, or biological stress relaxation is implemented. Parameters are illustrative and uncalibrated; this is not anatomical training ground truth.

References: [XPBD](https://mmacklin.com/xpbd.pdf), [Small Steps](https://mmacklin.com/smallsteps.pdf), [Volume Preserving Simulation of Soft Tissue with Skin](https://arxiv.org/abs/2109.01170). The prototype uses compliant constraints and total volume preservation, not the tissue paper's full material model.

Tests cover rest volume, compression comparison, release recovery, pull, fixed base, timestep partitioning, and control extremes. Cloud Node CPU review: 60 warmup frames, 180 measured 60 Hz updates with load −0.04 N; mean 5.38 ms, p95 6.63 ms. These timings exclude rendering and establish no browser or phone FPS. Browser/touch/GPU validation remains unavailable.

## Buttock response

The creator adds separate gluteal muscle bulk and buttock fat padding proxies, plus a Rear view shortcut. Existing presets retain their legacy fullness values. Rear-facing hip cage particles gain a separate Buttocks interaction region, independent compliance and damping, and firmer illustrative attachment support near the midline and upper pelvis. Muscle support also affects this region. Saved presets include these controls; older version-1 presets default missing proportions to the base value. This remains an anchored surface approximation: no internal gluteal anatomy, bone inertia, volume preservation, or contact/self-collision is added to the body solver. Two body-specific checks verify regional selection, compliance response, recovery, bounded extremes, and reversible posterior shape edits.

## Composition controls and 2D displacement map

Gluteal muscle bulk (75–140%) and buttock fat padding (50–175%) are independent posterior rest-shape proxies. Their smooth profiles differ; muscle bulk also increases regional restoring support while fat padding reduces it and increases permitted movement. These illustrative mappings do not create tissue layers, infer PCSA or strength, estimate kilograms, or simulate active contraction. Values are ratios to the base shape, not measured muscle volume or fat thickness. The schema preserves prior version-1 `buttocks` fullness values as a hidden legacy multiplier. Reset shape removes all such multipliers.

The Physics tab shows rear 2D projections for **Upper back → shoulders → hands** and **Buttocks & lower back**, colored by displacement magnitude from the edited rest shape. Dots follow current displaced positions; labeled regions have separate peak readings. It uses the 3D heat view's numerical palette and 0–50 mm scale. Each dot is a sampled simulation point, not a continuous anatomical UV map. Peak/mean readings update during touch, pulses, settling, pause, and reset. Drawing is throttled to 10 Hz and skipped when the Physics tab is hidden. It does not display strain, stress, pressure, activation, or local volume error; those require additional model components.

Three composition/map checks cover both body models, combined slider extremes, reversible rest shape, unaffected front geometry, bounded response, legacy preset round trips, paused-state synchronization, reset, and update throttling. Browser/touch visual QA remains unavailable.

## Independent buttock sides

In Create, **Muscle / fat edits** chooses rear-view left (+X), rear-view right (−X), or both. The muscle/fat sliders default to editing rear-view left; selecting a side displays its saved value. Both sides overwrites both side overrides. Other proportions remain bilateral. Version-1 JSON presets retain separate side overrides and the Physics-side selection. A unilateral rest edit resets the edited side and preserves offsets/velocities on opposite-side particles whose rest positions did not change.

In Physics, **Interaction side** defaults to Auto, which follows the last buttock, back, shoulder, arm, or hand side touched. The brush stays on the initial side even at maximum radius; dragging does not switch sides. Select rear-view left/right for pulses, vibration, and muscle support, or explicitly select both. When any of these lateral regions is selected, Auto requires touching a side before a pulse or vibration. Gravity still acts independently on both sides.

Cross-center coupling involving hip and connected lateral regions is removed, and runtime skin weights that include those particles are normalized onto the vertex's own side. The shared skeleton, rest surface, and UV seam welding remain intact; base GLB assets are unchanged. Regression checks use both real GLBs, maximum-radius press/pull, explicit pulses/vibration/both mode, asymmetric presets/shapes, preserved opposite-side settling, normalized skin weights, and welded seams. A headless check also invokes the actual creator slider handlers to verify side selection and explicit Both overwrites. These changes isolate this illustrative surface model, not a calibrated model of pelvic force transmission. Browser/touch visual testing remains unavailable.

## Pelvis-to-lower-back coupling

Posterior abdominal cage samples form a firmer **Lower back** region. Sparse passive links connect upper gluteal samples to nearby lumbar samples on the same side (92 links on the female cage, 112 on the male cage). Existing glute/lumbar boundary springs are replaced by these adjustable links, so the connection is not counted twice. Each link applies equal and opposite forces based on displacement difference, with degree normalization. A touch or pulse confined to one region therefore loads the neighboring region mechanically; its offsets and stimulation are not copied. Fixed rest topology is retained when proportions change.

**Pelvis-to-back coupling** (0–100%, default 65%) controls those links. Zero removes the added links; other ordinary surface paths can still transmit tiny movements. **Lower-back support** (default 35%) increases lumbar restoring stiffness, representing the stabilizing role of erector spinae/multifidus as a lumped support proxy. **Lower-back damping** (default 65%) controls settling independently. These settings are exported in character presets; older presets use the defaults. To inspect the connection, use Rear view, choose Buttocks, select a side, and pulse. The map shows lower back above buttocks and reports both peaks. Selecting Lower back demonstrates the reverse response.

The anatomical motivation is force transmission through the thoracolumbar fascia, not direct attachment of every gluteal point to a lumbar muscle. [Barker, Briggs & Bogeski (2004)](https://pubmed.ncbi.nlm.nih.gov/14722403/) measured lumbar fascial tension and displacement under muscle traction in eight unembalmed cadavers, including gluteus maximus; gluteal effects occurred below L3 and could be bilateral. This implementation deliberately limits its added links to the stimulated side. It does not reproduce the full contralateral fascial sling, separate erector/multifidus anatomy, neural coactivation, fiber anisotropy, physiological mass, or spinal motion. Link strengths and support settings are visual tuning values, not measurements from that study.

Regression checks cover reciprocal transfer with the neighboring region unstimulated, coupling disabled, unilateral and explicit bilateral interactions, wide lower-back touches, recovery, support response, extreme settings and proportions, preset compatibility, actual GLB skin/seam isolation, and combined-map readings. Production build and Node checks are available; browser/touch/GPU QA remains unavailable in the managed environment.

CPU spot check before the upper-body extension (commit 8098a95): Node 24.19.0, Linux x64; one-sided buttock vibration at 60 Hz with two fixed 120 Hz substeps, zero gravity, 180 warmup updates and three runs of 600 measured updates. Mean solver time was 0.186 ms (female) and 0.230 ms (male); p95 was 0.258 ms and 0.311 ms. This excludes the surface deformer, 2D map, browser, and GPU and establishes no device FPS.

## Upper back, shoulders, arms and hands

Runtime regions add **Upper back** (11), **Shoulders** (12) and **Hands / wrists** (13). Region 7 now labels the remaining feet; hands no longer share a response selector with feet. Upper back uses rear-facing chest samples; shoulders use a lateral height band around the existing shoulder rig, and distal-arm samples previously grouped with feet become hands/wrists. These are fixed-pose cage regions, not segmented internal anatomy. Lower back → upper back → shoulders → arms → hands is a reciprocal mechanical chain. Sparse, same-side, degree-normalized displacement bridges replace their ordinary boundary springs; region-only pulses do not directly stimulate the neighboring region.

| Connection / support | Control | Default |
| --- | --- | --- |
| Lower ↔ upper back | `upperCoupling` | 65% |
| Upper back restoring support | `upperSupport` | 25% |
| Upper back ↔ shoulders ↔ arms | `shoulderCoupling` | 65% |
| Shoulder restoring support | `shoulderSupport` | 35% |
| Arms ↔ hands/wrists | `handCoupling` | 65% |
| Hand/wrist restoring support | `handSupport` | 40% |

Each coupling slider spans 0–100%; zero removes its added links, while other ordinary surface paths can carry tiny residual motion. Higher support increases restoring stiffness. Global damping applies to the added regions. Hands are firmer and limited to 12 mm of displacement. Missing controls in older presets use these defaults; exports save the settings. **Upper-back view** provides a rear close-up. Select a region and side, then pulse or use the map to inspect the neighbors.

The anatomical motivation includes trapezius/serratus scapular control, deltoid and rotator-cuff shoulder support, and forearm-to-hand tendon transmission. [Seth et al. (2019)](https://www.frontiersin.org/journals/neurorobotics/articles/10.3389/fnbot.2019.00090/full) modeled scapular muscle contributions separately from muscles crossing the shoulder joint. [Kang et al. (1996)](https://pubmed.ncbi.nlm.nih.gov/8969416/) measured finger-flexion mechanics under different wrist positions and fascial/ligament conditions in cadaver hands. These studies motivate distinct connected regions; their anatomical muscle paths, joint mechanics and calibrated parameters are not implemented here. The long bridges lump transmission into the anchored surface graph.

The 163-bone rig still holds its rest pose. There is no ragdoll joint motion, scapular articulation, tendon excursion, finger articulation, physical segment mass/inertia, or body collision. Upper-chain tests cover unilateral reciprocal transfer, chain reach to the hands and back, off switches, support response, recovery, foot isolation, widest grabs, extreme shape/response settings, presets, and actual GLB seam/side isolation.

CPU spot check after this extension: Node 24.19.0, Linux x64; unilateral upper-back/hand vibration, 60 Hz updates with two fixed substeps, zero gravity, 180 warmup updates and 600 measured updates per workload. Means ranged from 0.204 to 0.262 ms; p95 ranged from 0.286 to 0.364 ms. These solver-only timings exclude skin deformation, map drawing, browser and GPU and establish no device FPS.

## Displacement-aware grab points

The map shares current cage coordinates with its picker. **Press** or **Pull** a dot to grab its exact sample; Orbit switches to Press for map grabs. Dragging uses the rear projection's X/Y scale, keeping the initial sample, side, and depth. A white ring follows the selected displaced sample. Points outside the chosen region or explicit side are dimmed and cannot be picked. A map-mode change clears an incompatible region filter. Empty map space does not grab. Pointer capture prevents release outside the canvas from leaving a grab active; cancellation, panel changes, blur and document hiding also release it.

3D picking now computes barycentric coverage of the hit triangle's cage weights and chooses among those driving samples using their live displaced positions. It cannot jump to a nearby unrelated body part merely because that part has a closer cage sample. Before raycasting, the surface receives the latest offsets. The brush centers on the mapped sample. Every grabbed particle stores its initial offset, so subsequent force targets are relative to the shape at grab time instead of snapping toward an absolute target around rest. Current surface limits still bound movement.

Node checks cover displaced-dot picking, selection filters, map drag direction, anchor locking, invalid anchors, current-offset press behavior, unrelated nearby samples, real GLB triangle/cage mapping, and the actual map pointer handlers including capture, cancel and panel release. The control fixture stubs DOM and texture decoding and performs no browser rendering. All 55 Node checks and the production build are the available validation; visual browser/touch/GPU QA remains unavailable in this environment.
