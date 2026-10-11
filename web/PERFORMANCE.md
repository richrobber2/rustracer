# Body creator performance review

Measured on 2026-10-11. Node v24.19.0, linux/x64; cloud CPU only.

This is a headless CPU microbenchmark, not a browser FPS or GPU measurement. Each case runs 180 warm-up frames followed by 600 measured updates at a simulated 60 Hz. Both implementations use the same new anatomy meshes and current solver. The reference reproduces the previous full-surface/normal algorithm and keeps the solver awake; the optimized path sleeps and selectively updates geometry. Reference normals update at 20 Hz, optimized normals at 30 Hz. No browser, mobile hardware, input latency, GPU uploads, skinning, shadows, texture decoding, or path tracing are measured.

| Body / workload | Reference mean | Updated mean | Updated p95 | Mean updated vertices |
|---|---:|---:|---:|---:|
| Female / regional vibration | 4.258 ms | 0.303 ms | 0.484 ms | 1,120 |
| Female / whole-body vibration | 4.306 ms | 1.875 ms | 2.938 ms | 54,042 |
| Female / settled | 4.105 ms | 0.000 ms | 0.000 ms | 0 |
| Male / regional vibration | 4.320 ms | 0.400 ms | 0.604 ms | 1,588 |
| Male / whole-body vibration | 4.374 ms | 2.077 ms | 3.391 ms | 54,314 |
| Male / settled | 4.331 ms | 0.000 ms | 0.000 ms | 0 |

## Changes made after review

- Cached spring coefficients and edge normalization; stopped solver work after settling. All force, shape, and parameter changes wake the solver.
- Added particle-to-surface and vertex-to-face lookup tables for local deformation and area-weighted normals across UV seams.
- The first selective implementation regressed under whole-body motion. Added a linear full-surface/normal path when more than 20% of particles move; the table records that corrected version.
- Decoupled normal refresh from the fixed 120 Hz solver; offered 15/30/60 Hz choices.
- Coalesced proportion edits into one rebuild per animation frame, and cancelled superseded body downloads.
- Preserved conservative raycast bounds after shape changes. Cancelled pending path-tracer activation when interactive editing resumes.

## Verification and remaining limits

18 automated checks passed: anatomical mesh manifold edges, skin and cage weights, rig binding, reversible proportion edits, preset validation, genital compliance and regional forces, extreme settings, deformation recovery, sleep/wake, selective deformation/normal parity, and existing path scheduling behavior. Production build is checked during packaging.

Browser QA is unavailable in the managed environment. Phone/console GPU performance, actual touch usability, visual texture matching, and full-body self-contact remain unverified. The solver has no self-collision or internal anatomical layers and is not calibrated biomechanics. The 163-bone rig is retained in the neutral downloadable base; creator presets store runtime proportions rather than baking a newly fitted rig.

Reproduce: `node --test checks/*.test.mjs` and `node checks/body-performance.mjs`.
