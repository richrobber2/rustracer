import test from 'node:test';
import assert from 'node:assert/strict';
import { PATH_PRESETS, PathTraceScheduler, renderPixelRatio } from '../src/path-performance.js';

test('Fast mode removes the phone high-DPI multiplier and reduces the pixel workload', () => {
  const viewport = { width: 390, height: 550, dpr: 3 };
  const before = renderPixelRatio({ ...viewport, quality: 1, path: false });
  const after = renderPixelRatio({ ...viewport, quality: PATH_PRESETS.fast.quality, path: true, pixelBudget: PATH_PRESETS.fast.pixels });
  assert.equal((before / after) ** 2, 16);
  assert.equal(PATH_PRESETS.fast.bounces, 2);
  assert.equal(renderPixelRatio({ ...viewport, dpr: 1, quality: 0.5, path: true, pixelBudget: PATH_PRESETS.fast.pixels }), after);
});

test('fullscreen rendering respects the pixel budget and manual quality can reduce it further', () => {
  const viewport = { width: 3840, height: 2160, dpr: 2, path: true };
  for (const preset of Object.values(PATH_PRESETS)) {
    const scale = renderPixelRatio({ ...viewport, quality: preset.quality, pixelBudget: preset.pixels });
    assert.ok(Math.floor(viewport.width * scale) * Math.floor(viewport.height * scale) <= preset.pixels);
  }
  const smaller = renderPixelRatio({ ...viewport, quality: 0.125, pixelBudget: PATH_PRESETS.fast.pixels });
  const fast = renderPixelRatio({ ...viewport, quality: 0.5, pixelBudget: PATH_PRESETS.fast.pixels });
  assert.ok(smaller < fast);
});

function harness() {
  const calls = [];
  const scheduler = new PathTraceScheduler();
  const tracer = {
    samples: 0,
    updateCamera() { calls.push('camera'); this.samples = 0; },
    renderSample() { calls.push('trace'); this.samples += 0.25; },
  };
  const frame = (now, options = {}) => scheduler.render({
    now, tracer, rasterize: () => calls.push('preview'), paused: false, sampleLimit: 64, hidden: false, ...options,
  });
  return { calls, scheduler, tracer, frame };
}

test('dragging and damping produce only previews, then sync the camera once and accumulate', () => {
  const { calls, scheduler, tracer, frame } = harness();
  scheduler.begin(0);
  assert.equal(frame(1000), 'preview'); // Holding still with the pointer down must not trace.
  scheduler.end(1000);
  scheduler.cameraChanged(1050); // OrbitControls damping continues after pointer release.
  assert.equal(frame(1220), 'preview');
  assert.deepEqual(calls, ['preview', 'preview']);
  assert.equal(frame(1231), 'tracing');
  frame(1250);
  assert.equal(calls.filter(c => c === 'camera').length, 1);
  assert.equal(tracer.samples, 0.5);
});

test('paused and hidden tabs submit no new path samples; resume retains accumulated samples', () => {
  const { calls, tracer, frame } = harness();
  frame(0);
  const before = calls.length;
  assert.equal(frame(20, { paused: true }), 'paused');
  assert.equal(frame(40, { hidden: true }), 'hidden');
  assert.equal(calls.length, before);
  assert.equal(tracer.samples, 0.25);
  frame(60);
  assert.equal(tracer.samples, 0.5);
});

test('sample limit stops GPU work, can be extended, and camera/scene edits restart accumulation', () => {
  const { calls, scheduler, tracer, frame } = harness();
  frame(0);
  tracer.samples = 63.75;
  assert.equal(frame(20), 'complete');
  const doneCalls = calls.length;
  for (let i = 0; i < 10; i++) assert.equal(frame(40 + i), 'complete');
  assert.equal(calls.length, doneCalls);
  assert.equal(frame(70, { sampleLimit: Infinity }), 'tracing');
  assert.equal(tracer.samples, 64.25);
  scheduler.cameraChanged(100);
  assert.equal(frame(290), 'tracing');
  assert.equal(tracer.samples, 0.25);
  tracer.samples = 0; // Library resets accumulation after a material or scene change.
  assert.equal(frame(310), 'tracing');
  assert.equal(tracer.samples, 0.25);
});

test('moving while paused updates the preview without accumulating stale camera samples', () => {
  const { calls, scheduler, tracer, frame } = harness();
  frame(0);
  scheduler.cameraChanged(20);
  assert.equal(frame(40, { paused: true }), 'preview');
  assert.equal(frame(220, { paused: true }), 'paused');
  assert.equal(tracer.samples, 0);
  assert.equal(calls.filter(c => c === 'trace').length, 1);
  frame(240);
  assert.equal(tracer.samples, 0.25);
});
