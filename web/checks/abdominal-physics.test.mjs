import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TissueSystem } from '../src/tissue-physics.js';
import { BodyMorph, DEFAULT_PROPORTIONS, readCharacter } from '../src/body-proportions.js';
import { ButtockMap, mapSamples, MAP_REGIONS } from '../src/buttock-map.js';
import { eligibleGrabAnchor } from '../src/grab-points.js';
const magnitude = (s, i) => Math.hypot(...s.offset.slice(i * 3, i * 3 + 3));
function response(s, frames = 120) {
  const peaks = {}; let opposite = 0;
  for (let f = 0; f < frames; f++) {
    s.step(1 / 60);
    for (let i = 0; i < s.count; i++) if ([3, 10, 14, 15].includes(s.regions[i])) {
      const mm = magnitude(s, i) * 1000;
      if (s.rest[i * 3] * s.lastButtSide < 0 || (s.parameters.buttSide !== 2 && s.rest[i * 3] * s.parameters.buttSide < 0)) opposite = Math.max(opposite, mm);
      else peaks[s.regions[i]] = Math.max(peaks[s.regions[i]] || 0, mm);
    }
  }
  return { peaks, opposite };
}
function makeMap(s) {
  let aria = '';
  const context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {}, fill() {} };
  const status = { textContent: '' }, canvas = { width: 320, height: 240, getContext: () => context, setAttribute(name, value) { aria = value; } };
  const map = new ButtockMap(canvas, status, 'abs'); map.setSystem(s);
  return { map, status, aria: () => aria };
}
for (const sex of ['female', 'male']) {
  const data = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  test(`${sex} abdominal pulses load connected regions reciprocally without direct stimulation or opposite-side motion`, () => {
    for (const side of [-1, 1]) for (const region of [14, 15, 10, 3]) {
      const s = new TissueSystem(data); s.configure({ region, buttSide: side, gravity: 0 }); s.impulse();
      for (let i = 0; i < s.count; i++) if (s.regions[i] !== region || s.rest[i * 3] * side <= 0) assert.equal(Math.hypot(...s.velocity.slice(i * 3, i * 3 + 3)), 0);
      const { peaks, opposite } = response(s); assert.ok(opposite < .05, `${region}: ${opposite} mm on opposite side`);
      for (const neighbor of ({ 14: [15, 10, 3], 15: [14, 10, 3], 10: [14, 15], 3: [14, 15] })[region]) assert.ok(peaks[neighbor] > .1, `${region} → ${neighbor}: ${peaks[neighbor]} mm`);
      response(s, 240); assert.ok(s.offset.every(v => Math.abs(v) < .00005));
    }
  });
  test(`${sex} abdominal coupling switches, support and bracing change the mechanical response`, () => {
    for (const [parameter, source, target, ratio] of [['absCoupling', 14, 15, .35], ['absCoupling', 15, 14, .35], ['coreCoupling', 15, 10, .01], ['coreCoupling', 10, 15, .01], ['coreCoupling', 14, 3, .01]]) {
      const values = [];
      for (const value of [0, .65]) { const s = new TissueSystem(data); s.configure({ region: source, buttSide: 1, gravity: 0, [parameter]: value }); s.impulse(); values.push(response(s).peaks[target] || 0); }
      assert.ok(values[0] < values[1] * ratio, `${parameter}: ${values}`);
    }
    for (const [parameter, region] of [['absSupport', 14], ['obliqueSupport', 15], ['coreBracing', 14], ['coreBracing', 15], ['coreBracing', 10]]) {
      const values = [];
      for (const value of [0, 1]) { const s = new TissueSystem(data); s.configure({ region, buttSide: 1, gravity: 0, [parameter]: value }); s.impulse(); values.push(response(s).peaks[region]); }
      assert.ok(values[1] < values[0] * .8, `${parameter}/${region}: ${values}`);
    }
  });
  test(`${sex} front map grabs live abdominal points with correct drag direction and keeps the original side`, () => {
    for (const region of [14, 15]) for (const side of [-1, 1]) {
      const s = new TissueSystem(data); s.configure({ region, gravity: 0, radius: .25 });
      const id = Array.from(s.regions.keys()).find(i => s.regions[i] === region && s.rest[i * 3] * side > .02);
      s.offset[id * 3] = side * .008; s.offset[id * 3 + 1] = .004;
      const { map, status, aria } = makeMap(s), sample = mapSamples(s, MAP_REGIONS.abs).find(p => p.id === id), pixel = map.project(sample);
      assert.equal(map.pick(pixel.x, pixel.y, .01)?.id, id); assert.match(aria(), /^Front/);
      const delta = map.worldDelta(10, -12); assert.ok(delta[0] > 0 && delta[1] > 0);
      assert.ok(s.beginGrab([sample.x, sample.y, sample.z], Array.from(s.normals.slice(id * 3, id * 3 + 3)), 'pull', id) > 0);
      assert.equal(s.lastButtSide, side); assert.ok(s.grab.ids.every(i => s.regions[i] === region && s.rest[i * 3] * side > 0));
      map.select(id); assert.match(status.textContent, /grab anchor: (Abs|Obliques)/); assert.match(status.textContent, /linked back/);
      s.moveGrab([sample.x + delta[0], sample.y + delta[1], sample.z]); assert.ok(response(s, 60).opposite < .05); assert.equal(s.grab.anchorId, id);
      s.endGrab(); s.configure({ buttSide: -side }); const now = mapSamples(s, MAP_REGIONS.abs).find(p => p.id === id), at = map.project(now);
      assert.equal(map.pick(at.x, at.y, .01), null); assert.equal(eligibleGrabAnchor(s, id), false);
    }
    const group = new TissueSystem(data); group.configure({ region: 2, buttSide: 2, gravity: 0 }); group.impulse();
    for (const region of [14, 15]) for (const side of [-1, 1]) assert.ok(Array.from(group.regions.keys()).some(i => group.regions[i] === region && group.rest[i * 3] * side > 0 && group.velocity[i * 3 + 2] !== 0));
  });
  test(`${sex} abdominal presets retain new controls and extreme shapes remain finite and bounded`, () => {
    const morph = new BodyMorph(data.positions, data.genitalWeights, data);
    for (const stiffness of [1, 100]) {
      const s = new TissueSystem(data); s.setRest(morph.apply({ ...DEFAULT_PROPORTIONS, height: 1.16, waist: 1.4, hips: 1.35 }));
      s.configure({ region: 2, buttSide: 2, stiffness, damping: 0, absDamping: 0, gravity: 2, tension: 1, strength: 3, absCoupling: 1, coreCoupling: 1, absSupport: 1, obliqueSupport: 1, coreBracing: 1 }); s.vibration = true; s.impulse();
      for (let f = 0; f < 120; f++) s.step(f % 3 ? 1 / 60 : 2);
      assert.ok(s.offset.every(Number.isFinite)); assert.ok(s.velocity.every(Number.isFinite));
      for (let i = 0; i < s.count; i++) assert.ok(magnitude(s, i) <= s.limits[i] + 1e-6);
      const preset = readCharacter({ version: 1, sex, proportions: DEFAULT_PROPORTIONS, tissue: s.parameters });
      const restored = new TissueSystem(data); restored.configure(readCharacter(JSON.parse(JSON.stringify(preset))).tissue);
      for (const key of ['region', 'absSupport', 'obliqueSupport', 'absCoupling', 'coreCoupling', 'coreBracing', 'absDamping']) assert.equal(restored.parameters[key], s.parameters[key]);
    }
    const legacy = new TissueSystem(data); legacy.configure({ region: 2 });
    assert.equal(legacy.parameters.absCoupling, .65); assert.equal(legacy.parameters.absDamping, .6);
    legacy.configure({ absSupport: Infinity, coreCoupling: -10, coreBracing: 10 });
    assert.equal(legacy.parameters.absSupport, .35); assert.equal(legacy.parameters.coreCoupling, 0); assert.equal(legacy.parameters.coreBracing, 1);
  });
}
test('front map selects the nearer front sample when projection points overlap', () => {
  const s = new TissueSystem({ positions: [.04, 1, .05, .04, 1, .08], normals: [0, 0, 1, 0, 0, 1], regions: [2, 2], edges: [], height: 2, regionNames: [] });
  const { map } = makeMap(s), at = map.project(mapSamples(s, MAP_REGIONS.abs)[0]);
  assert.equal(map.pick(at.x, at.y)?.id, 1);
});
