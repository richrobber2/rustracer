import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TissueSystem } from '../src/tissue-physics.js';
import { BodyMorph, DEFAULT_PROPORTIONS, readCharacter } from '../src/body-proportions.js';
const run = (s, n = 120) => { for (let f = 0; f < n; f++) s.step(1 / 60); };
const magnitude = (s, i) => Math.hypot(...s.offset.slice(i * 3, i * 3 + 3));
function peaks(s) {
  const out = {}; let opposite = 0;
  for (let f = 0; f < 120; f++) {
    s.step(1 / 60);
    for (let i = 0; i < s.count; i++) {
      if (![4, 9, 10, 11, 12, 13].includes(s.regions[i])) continue;
      const mm = magnitude(s, i) * 1000;
      if (s.rest[i * 3] * s.parameters.buttSide < 0) opposite = Math.max(opposite, mm);
      else out[s.regions[i]] = Math.max(out[s.regions[i]] || 0, mm);
    }
  }
  return { out, opposite };
}
for (const sex of ['female', 'male']) {
  const data = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  test(`${sex} upper chain transfers region-only pulses in both directions without mirroring or moving feet`, () => {
    for (const side of [-1, 1]) for (const region of [10, 11, 12, 4, 13]) {
      const s = new TissueSystem(data); s.configure({ region, buttSide: side, gravity: 0 }); s.impulse();
      for (let i = 0; i < s.count; i++) if (s.regions[i] !== region) assert.equal(Math.hypot(...s.velocity.slice(i * 3, i * 3 + 3)), 0);
      const { out, opposite } = peaks(s); assert.ok(opposite < .05);
      for (const neighbor of ({ 10: [11], 11: [10, 12, 13], 12: [11, 4, 13], 4: [12, 13], 13: [4, 12, 11] })[region]) assert.ok(out[neighbor] > (neighbor === 11 && region === 13 ? .003 : neighbor === 13 && region === 11 ? .02 : .05), `${region} → ${neighbor}: ${out[neighbor]} mm`);
      for (let i = 0; i < s.count; i++) if (s.regions[i] === 7) assert.ok(magnitude(s, i) < .000001, 'Hands pulse must not stimulate feet');
      run(s, 240); assert.ok(s.offset.every(v => Math.abs(v) < .00005));
    }
  });
  test(`${sex} each upper-chain off switch removes its added load path and support reduces motion`, () => {
    for (const [parameter, source, target] of [['upperCoupling', 10, 11], ['shoulderCoupling', 12, 11], ['handCoupling', 13, 4]]) {
      const responses = [];
      for (const value of [0, .65]) {
        const s = new TissueSystem(data); s.configure({ region: source, buttSide: 1, gravity: 0, [parameter]: value }); s.impulse(); responses.push(peaks(s).out[target]);
      }
      assert.ok(responses[0] < responses[1] * .02, `${parameter}: ${responses}`);
    }
    for (const [region, parameter] of [[11, 'upperSupport'], [12, 'shoulderSupport'], [13, 'handSupport']]) {
      const responses = [];
      for (const value of [0, 1]) { const s = new TissueSystem(data); s.configure({ region, buttSide: 1, gravity: 0, [parameter]: value }); s.impulse(); responses.push(peaks(s).out[region]); }
      assert.ok(responses[1] < responses[0] * .8, `${parameter}: ${responses}`);
    }
  });
  test(`${sex} widest upper-region grabs, extreme shapes and settings remain bounded and saved`, () => {
    for (const side of [-1, 1]) for (const region of [11, 12, 13]) {
      const s = new TissueSystem(data); s.configure({ region, radius: .25, gravity: 0 });
      const id = Array.from(s.regions.keys()).find(i => s.regions[i] === region && s.rest[i * 3] * side > .02);
      const point = Array.from(s.rest.slice(id * 3, id * 3 + 3));
      assert.ok(s.beginGrab(point, Array.from(s.normals.slice(id * 3, id * 3 + 3)), 'pull', id) > 0);
      assert.equal(s.lastButtSide, side); assert.ok(s.grab.ids.every(i => s.regions[i] === region && s.rest[i * 3] * side > 0));
      s.moveGrab([side * 2, -2, -2]); run(s, 60);
      for (let i = 0; i < s.count; i++) if ([4, 9, 10, 11, 12, 13].includes(s.regions[i]) && s.rest[i * 3] * side < 0) assert.ok(magnitude(s, i) < .00005);
    }
    const morph = new BodyMorph(data.positions, data.genitalWeights, data);
    for (const stiffness of [1, 100]) {
      const s = new TissueSystem(data); s.setRest(morph.apply({ ...DEFAULT_PROPORTIONS, height: 1.16, shoulders: 1.25, chest: 1.35, gluteMuscleLeft: 1.4, buttFatRight: 1.75 }));
      s.configure({ region: 13, buttSide: 2, stiffness, damping: 0, tension: 1, gravity: 2, strength: 3, upperCoupling: 1, shoulderCoupling: 1, handCoupling: 1, upperSupport: 1, shoulderSupport: 1, handSupport: 1 }); s.vibration = true; s.impulse();
      for (let f = 0; f < 120; f++) s.step(f % 3 ? 1 / 60 : 2);
      assert.ok(s.offset.every(Number.isFinite)); assert.ok(s.velocity.every(Number.isFinite));
      for (let i = 0; i < s.count; i++) assert.ok(magnitude(s, i) <= s.limits[i] + 1e-6);
      assert.ok(s.regions.some(r => r === 13)); for (let i = 0; i < s.count; i++) if (s.regions[i] === 13) assert.ok(s.limits[i] <= .012 + 1e-6);
      const preset = readCharacter({ version: 1, sex, proportions: DEFAULT_PROPORTIONS, tissue: s.parameters });
      const restored = new TissueSystem(data); restored.configure(readCharacter(JSON.parse(JSON.stringify(preset))).tissue);
      for (const key of ['region', 'upperCoupling', 'upperSupport', 'shoulderCoupling', 'shoulderSupport', 'handCoupling', 'handSupport']) assert.equal(restored.parameters[key], s.parameters[key]);
    }
  });
}
