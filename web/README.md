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
- Presets: save/load slots A and B on the current device, or export/import a versioned JSON preset with proportions, tissue settings and muscle excitations. Imported excitations require Run muscles; autoplay and transient joint angles are not saved. Numeric fields are clamped and unsupported versions rejected.
- Physics: genital tissue is a separate selectable force region with its own compliance and damping. Larger proportional geometry changes support and permitted displacement. Press, pull, pulse, and vibration work on the selected region. Parameters are illustrative, not measurements of human tissue.
- Proportion edits transform the rest surface, eye meshes, simulation cage and joint pivots together; skin/eyes are rebound at the edited rest shape. Bilateral edits reset deformation; unilateral muscle/fat edits preserve motion on an unchanged opposite side. **Download base GLB** preserves the neutral asset; **Export preset** preserves creator and actuator settings.

## Controls

- The body lab starts with a detailed adult female body; choose **Male** or **Female** to switch. Select **Press** or **Pull**, touch the surface, drag, and release to observe recovery. Empty-space dragging still orbits the camera. **Studio** returns to the original demonstration scene.
- Adjust stiffness, damping, gravity, touch radius/strength, and muscle support. Target individual body regions, apply a pulse, enable vibration, or pause/reset the tissue. View textured skin, clay, displacement colors (0–50 mm), or wireframe. Path tracing pauses physics and renders the held shape; resume physics to return to interactive rendering.
- In **Physics → Muscle-driven movement**, play an arm/elbow, core, or wrist/finger loop. Select a muscle pair and adjust its two excitation sliders for manual movement. Hold freezes joints, Relax removes excitation, and Reset pose restores neutral joints. Pause physics and path tracing hold both joint and tissue dynamics.
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

The simulation uses a fixed-step spring cage (1,532 particles for female; 1,867 for male, including 101/171 genital particles) to deform the detailed surface. Regional support, damping, gravity, and touch forces provide an interactive visual approximation. A separate antagonist-actuator layer articulates the trunk and upper limbs through the existing rig; the pelvis and legs stay supported. Muscle support/activation changes restoring stiffness and a small shape offset. There are no separate anatomical muscle/fat layers, volumetric tissue mechanics, tissue self-collision, or calibrated biological properties. This is a visual experimentation tool, not a source of biomechanical ground truth or medical predictions.

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
npm run check
```

Full browser/rendering checks when Chromium is available:

```sh
npm test
```

Browser tests use `CHROMIUM_PATH` when set, then `/usr/bin/chromium` or `/opt/pw-browsers/chromium` if present, and otherwise Playwright's own Chromium (`npx playwright install chromium`), and software WebGL through SwiftShader. When a supported browser environment is available, they validate the studio's rendered pixels, material/camera controls, PNG output, local glTF companions, binary GLB imports, missing/remote resource handling, progressive sample accumulation, and mobile layout. Device performance and body-lab interaction still require a browser check. The existing native Rust tests are independent and retain their known missing-asset/path failures.

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

The Physics tab shows rear 2D projections for **Upper back → shoulders → hands** and **Buttocks & lower back**, plus a front projection for **Abs & obliques**, colored by displacement magnitude from the edited rest shape. Dots follow current displaced positions; labeled regions have separate peak readings. It uses the 3D heat view's numerical palette and 0–50 mm scale. Each dot is a sampled simulation point, not a continuous anatomical UV map. Peak/mean readings update during touch, pulses, settling, pause, and reset. Drawing is throttled to 10 Hz and skipped when the Physics tab is hidden. It does not display strain, stress, pressure, activation, or local volume error; those require additional model components.

Three composition/map checks cover both body models, combined slider extremes, reversible rest shape, unaffected front geometry, bounded response, legacy preset round trips, paused-state synchronization, reset, and update throttling. Browser/touch visual QA remains unavailable.

## Independent buttock sides

In Create, **Muscle / fat edits** chooses rear-view left (+X), rear-view right (−X), or both. The muscle/fat sliders default to editing rear-view left; selecting a side displays its saved value. Both sides overwrites both side overrides. Other proportions remain bilateral. Version-1 JSON presets retain separate side overrides and the Physics-side selection. A unilateral rest edit resets the edited side and preserves offsets/velocities on opposite-side particles whose rest positions did not change.

In Physics, **Interaction side** defaults to Auto, which follows the last abdominal, pelvic, buttock, back, shoulder, arm, or hand side touched. The brush stays on the initial side even at maximum radius; dragging does not switch sides. Explicit side options show both camera orientations: front right / rear left (+X), or front left / rear right (−X). Choose a side for pulses, vibration, and muscle support, or explicitly select both. When any of these lateral regions is selected, Auto requires touching a side before a pulse or vibration. Gravity still acts independently on both sides.

Cross-center coupling involving hip and connected lateral regions is removed, and runtime skin weights that include those particles are normalized onto the vertex's own side. The shared skeleton, rest surface, and UV seam welding remain intact; base GLB assets are unchanged. Regression checks use both real GLBs, maximum-radius press/pull, explicit pulses/vibration/both mode, asymmetric presets/shapes, preserved opposite-side settling, normalized skin weights, and welded seams. A headless check also invokes the actual creator slider handlers to verify side selection and explicit Both overwrites. These changes isolate this illustrative surface model, not a calibrated model of pelvic force transmission. Browser/touch visual testing remains unavailable.

## Pelvis-to-lower-back coupling

Posterior abdominal cage samples form a firmer **Lower back** region. Sparse passive links connect upper gluteal samples to nearby lumbar samples on the same side (92 links on the female cage, 112 on the male cage). Existing glute/lumbar boundary springs are replaced by these adjustable links, so the connection is not counted twice. Each link applies equal and opposite forces based on displacement difference, with degree normalization. A touch or pulse confined to one region therefore loads the neighboring region mechanically; its offsets and stimulation are not copied. Fixed rest topology is retained when proportions change.

**Pelvis-to-back coupling** (0–100%, default 65%) controls those links. Zero removes the added links; other ordinary surface paths can still transmit tiny movements. **Lower-back support** (default 35%) increases lumbar restoring stiffness, representing the stabilizing role of erector spinae/multifidus as a lumped support proxy. **Lower-back damping** (default 65%) controls settling independently. These settings are exported in character presets; older presets use the defaults. To inspect the connection, use Rear view, choose Buttocks, select a side, and pulse. The map shows lower back above buttocks and reports both peaks. Selecting Lower back demonstrates the reverse response.

The anatomical motivation is force transmission through the thoracolumbar fascia, not direct attachment of every gluteal point to a lumbar muscle. [Barker, Briggs & Bogeski (2004)](https://pubmed.ncbi.nlm.nih.gov/14722403/) measured lumbar fascial tension and displacement under muscle traction in eight unembalmed cadavers, including gluteus maximus; gluteal effects occurred below L3 and could be bilateral. This implementation deliberately limits its added links to the stimulated side. The links do not reproduce the full contralateral fascial sling, separate erector/multifidus anatomy, neural coactivation, fiber anisotropy, or physiological mass. The actuator extension below adds simplified spine movement separately. Link strengths and support settings are visual tuning values, not measurements from that study.

Regression checks cover reciprocal transfer with the neighboring region unstimulated, coupling disabled, unilateral and explicit bilateral interactions, wide lower-back touches, recovery, support response, extreme settings and proportions, preset compatibility, actual GLB skin/seam isolation, and combined-map readings. Production build and Node checks are available; browser/touch/GPU QA remains unavailable in the managed environment.

CPU spot check before the upper-body extension (commit 8098a95): Node 24.19.0, Linux x64; one-sided buttock vibration at 60 Hz with two fixed 120 Hz substeps, zero gravity, 180 warmup updates and three runs of 600 measured updates. Mean solver time was 0.186 ms (female) and 0.230 ms (male); p95 was 0.258 ms and 0.311 ms. This excludes the surface deformer, 2D map, browser, and GPU and establishes no device FPS.

## Upper back, shoulders, arms and hands

Runtime regions add **Upper back** (11), **Shoulders** (12) and **Hands / wrists** (13). Region 7 now labels the remaining feet; hands no longer share a response selector with feet. Upper back uses rear-facing chest samples; shoulders use a lateral height band around the existing shoulder rig, and distal-arm samples previously grouped with feet become hands/wrists. These are rest-cage regions, not segmented internal anatomy. Lower back → upper back → shoulders → arms → hands is a reciprocal mechanical chain. Sparse, same-side, degree-normalized displacement bridges replace their ordinary boundary springs; region-only pulses do not directly stimulate the neighboring region.

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

The passive upper-chain links carry local tissue deformation. The actuator extension below moves the existing rig separately, including wrists and four fingers per hand. There is no free-body ragdoll, scapular articulation, anatomical tendon excursion, measured segment mass/inertia, or body collision. Upper-chain tests cover unilateral reciprocal transfer, chain reach to the hands and back, off switches, support response, recovery, foot isolation, widest grabs, extreme shape/response settings, presets, and actual GLB seam/side isolation.

CPU spot check after this extension: Node 24.19.0, Linux x64; unilateral upper-back/hand vibration, 60 Hz updates with two fixed substeps, zero gravity, 180 warmup updates and 600 measured updates per workload. Means ranged from 0.204 to 0.262 ms; p95 ranged from 0.286 to 0.364 ms. These solver-only timings exclude skin deformation, map drawing, browser and GPU and establish no device FPS.

## Displacement-aware grab points

The map shares current cage coordinates with its picker. **Press** or **Pull** a dot to grab its exact sample; Orbit switches to Press for map grabs. Dragging uses the active front or rear projection's X/Y scale, keeping the initial sample, side, and depth. A white ring follows the selected displaced sample. Points outside the chosen region or explicit side are dimmed and cannot be picked. A map-mode change clears an incompatible region filter. Empty map space does not grab. Pointer capture prevents release outside the canvas from leaving a grab active; cancellation, panel changes, blur and document hiding also release it.

3D picking now computes barycentric coverage of the hit triangle's cage weights and chooses among those driving samples using their live displaced positions. It cannot jump to a nearby unrelated body part merely because that part has a closer cage sample. Before raycasting, the surface receives the latest offsets. The brush centers on the mapped sample. Every grabbed particle stores its initial offset, so subsequent force targets are relative to the shape at grab time instead of snapping toward an absolute target around rest. Current surface limits still bound movement.

Node checks cover displaced-dot picking, selection filters, map drag direction, anchor locking, invalid anchors, current-offset press behavior, unrelated nearby samples, real GLB triangle/cage mapping, and the actual map pointer handlers including capture, cancel and panel release. The control fixture stubs DOM and texture decoding and performs no browser rendering. Visual browser/touch/GPU QA remains unavailable in this environment.

## Abs, obliques and core response

Use **Create → Abs view & physics** to focus the front abdominal wall and open its map. The central strip becomes **Abs / rectus** (14); the remaining lateral abdominal surface becomes **Obliques / lateral abdomen** (15). Central anterior hip samples above 50% of body height extend the rectus strip downward. The original **Abdomen** selector (2) remains a combined selector for both regions, including older presets. These geometric cage partitions are not anatomical segmentations: the oblique region lumps external/internal obliques, and no deep transversus layer is added. Female/male cages have 30/28 rectus samples and 46/50 lateral samples.

| Control | Default | Behavior |
| --- | --- | --- |
| Rectus support | 35% | Increases restoring stiffness of the central abs |
| Oblique support | 45% | Increases restoring stiffness of the lateral abdominal wall |
| Abs-to-oblique coupling | 65% | Reciprocal central ↔ lateral displacement transfer |
| Abdomen / back / pelvis coupling | 65% | Lateral abdomen ↔ lower back, central/lateral abdomen ↔ anterior pelvis |
| Core bracing | 0% | Adds restoring support to both abdominal regions and the lower back |
| Abdominal damping | 60% | Controls abdominal settling independently |

All six controls span 0–100% and are saved in character presets. Sparse, same-side links retain real boundary edges and add nearby bridges in both directions, applying equal/opposite forces with degree normalization. Ordinary springs at these controlled boundaries are replaced to avoid double counting. The female cage has 134 abs/oblique links and 594 core links; the male cage has 140 and 652. Zero removes the corresponding added links, but indirect paths remain: with abs coupling off, some central-to-lateral transfer can still travel through the pelvis. The original rest topology is retained when proportions change. Opposite-side interactions and skin influences remain isolated unless Both is selected explicitly; passive gravity and bilateral support changes still affect both sides.

The abs map faces forward, so +X appears on screen right and a rightward drag moves +X. Rear maps retain their opposite X convention. When samples overlap, the front map picks the higher-Z point. It follows live displacement, honors the combined abdomen or individual muscle-region filter, and reports abs/oblique peaks plus linked lower-back and anterior-pelvis peaks; those linked regions are readings rather than front-map dots. The shared 3D triangle/cage picker also handles both new regions. No six-pack geometry or muscle volume is inferred from these dots.

Research informs this separation and bracing behavior, not the numerical coefficients. [Brown et al. (2011)](https://muscle.ucsd.edu/pubs/2011/spine3-11.shtml) studied human abdominal muscle architecture, distinguishing the rectus from the layered lateral wall. [Tran et al. (2016)](https://pubmed.ncbi.nlm.nih.gov/26994992/) measured activity-dependent local stiffness in 11 healthy volunteers, with distinct anterior/lateral responses at rest and increased stiffness during a Valsalva maneuver. [Barker et al. (2004)](https://pubmed.ncbi.nlm.nih.gov/14722403/) measured lumbar fascial tension transmission under abdominal muscle traction. These motivate separate support and a connected brace proxy. The model does not simulate intra-abdominal pressure, separate rectus sheaths/linea alba, anisotropic fibers, physiologically calibrated activation, tissue mass, measured bone inertia, volume preservation, full spinal biomechanics or ragdoll motion. Real fascial transfer can be bilateral; same-side links here deliberately preserve independent interaction.

Abdominal checks cover reciprocal load paths, unstimulated neighbors, off switches, support/bracing response, release recovery, widest front grabs, correct projection and depth ordering, side/region filters, legacy combined selection, extreme proportions/parameters and presets. Actual GLB checks verify side isolation, normalized skin weights and welded seams for abdominal/pelvic regions too. The DOM fixture exercises the view button, region-to-map routing, front capture/drag, map-switch cancellation and slider handlers. The production build provides packaging validation; browser/touch visual QA remains unavailable.

## Muscle-driven joint motion

In Physics, open **Muscle-driven movement** and choose **Play muscle loop**. The three demonstrations drive excitation envelopes for arm raising/elbow bending, core flexion/release, or wrist/finger curling. They do not assign animated joint angles directly. Manual activation controls stop the loop and let opposing muscle groups compete; other manually driven joints keep their existing excitation. Motion side chooses front-view right (+X), left (−X), or explicitly both limbs. Core flexion always uses the shared spine. Starting a loop resets previous excitations and frames the full body.

| Actuator pair | Driven bones | Relative angle limits |
| --- | --- | --- |
| Abs vs back extensors | spine03 / spine02 / spine01, distributed 35/35/30% | −10.3° to +28.6° total |
| Deltoid/abductors vs adductors | upperarm01, selected side | −11.5° to +65.9° |
| Biceps/flexors vs triceps/extensors | lowerarm01, selected side | 0° to +91.7° |
| Wrist flexors vs extensors | wrist, selected side | −25.8° to +37.2° |
| Finger flexors vs extensors | fingers 2–5, three joints each | 0° to +63.0° actuator coordinate, scaled per joint |

Excitation is clamped to 0–1 and filtered into activation with illustrative 60 ms rising / 120 ms falling time constants. Net actuator moment is a tuned capacity times strength times the activation difference. An angular inertia proxy, passive rest spring, damping and increased stiffness under coactivation determine angular acceleration; fixed 1/120 s integration advances velocity and angle. Joint limits and a 3 rad/s velocity cap bound the result. Strength spans 0.25–1.5× and loop speed 0.5–1.5×. Muscle activation also adds regional tissue support and a small bulge. No anatomical muscle mesh is created.

**Hold pose** freezes joint state while tissue can settle. **Relax muscles** removes excitation and lets passive support return the joints toward rest. **Reset pose** clears joint state, excitation and tissue displacement while retaining proportions. A grab holds joint integration until release, while tissue still responds. **Pause physics**, hidden-page suspension and path tracing hold both systems. Joint pivots follow edited proportions; skin and eye bindings are recalculated at the neutral edited shape, then current joint angles are reapplied. Exported version-1 presets retain actuator settings and per-pair excitations; imported active presets are held until **Run muscles**. Angles, velocities, activation transients and autoplay are not exported.

The cage inherits skinning weights from the nearest mesh vertex each particle influences. This is an approximate skeletal attachment, especially near region boundaries. Map dots and framing use its current posed coordinates. At 10 Hz, a moving map picks the displayed dot and resolves its anchor to the latest posed position; it cannot miss solely because the rig advanced since the last map draw. 3D picking compares the live triangle's cage influences in posed space; both map and 3D drag targets are converted back to the selected anchor's material frame. Front/rear drag conventions and side restrictions remain intact. Gravity is rotated into each particle's frame using the blended inverse bone rotations; Studio rotation also refreshes sibling bone transforms. Colors and millimeter readings continue to measure material-frame tissue displacement, excluding rigid skeletal travel. Passive tissue links still operate on material-frame offsets: articulated volumetric dynamics and inertial flesh lag are not simulated.

The conceptual excitation → activation → moment → joint acceleration sequence follows the distinction described in the [OpenSim forward-dynamics guide](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim33/pages/53674174/How%2BForward%2BDynamics%2BWorks). This implementation is a reduced visual actuator model, not an OpenSim muscle simulation. Moment capacities, inertia, damping, support and limits are uncalibrated tuning values; there are no anatomical moment-arm paths, muscle force-length/velocity curves, compliant tendons, physiological mass, coupled multibody inertia, gravity moments on joints, ground contact, balance, ragdoll or locomotion. Pelvis/legs stay supported, shoulder motion is a single axis, and thumbs retain their local rest pose.

All 72 Node checks pass. New checks load both actual body rigs and verify real skin/landmark motion, antagonist reversal, coactivation, independent arms/hands, supported feet, relaxation/reset, frame-rate consistency, holds, bounded joint/tissue extremes, preset restoration, edited-pivot neutral skinning, gravity under Studio rotation, posed-map grabs and material-frame round trips. The actual DOM handlers are exercised for loop play, manual opposite-side activation, grabbing during motion, release, hold, pause and reset. These checks stub texture decoding and perform no browser rendering; visual browser/touch/GPU QA remains unavailable.

CPU review (`node checks/muscle-performance.mjs`): Node 24.19.0, Linux x64; unilateral reach loop at 60 Hz with gravity 0.3 and skin-normal updates at 30 Hz; 180 warmup updates and 600 measured updates in each of three runs. Entries below average each run's mean/p95. No other test workload ran concurrently. The surface column includes actual CPU vertex and normal updates, but excludes map drawing, browser, GPU and path tracing; these are not device FPS measurements.

| Body | Actuator + posed cage + tissue, mean / p95 | Including CPU skin updates, mean / p95 |
| --- | --- | --- |
| Female | 0.582 / 0.700 ms | 1.603 / 2.160 ms |
| Male | 0.706 / 0.902 ms | 1.752 / 2.392 ms |

CPU review: Node 24.19.0, Linux x64; 60 Hz updates with two fixed 120 Hz substeps, zero gravity, unilateral vibration, 180 warmup updates and three runs of 600 measured updates per workload. For the same upper-back workload, mean solver time changed from 0.201 to 0.215 ms (female) and 0.257 to 0.266 ms (male). Abs vibration averaged 0.216 ms (female, p95 0.295 ms) and 0.280 ms (male, p95 0.425 ms). These exclude surface deformation, map drawing, browser and GPU and establish no device FPS.
