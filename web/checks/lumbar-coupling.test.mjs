import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TissueSystem } from '../src/tissue-physics.js';
import { BodyMorph, DEFAULT_PROPORTIONS, readCharacter } from '../src/body-proportions.js';
import { posteriorSamples, ButtockMap } from '../src/buttock-map.js';

const magnitude = (s, i) => Math.hypot(s.offset[i * 3], s.offset[i * 3 + 1], s.offset[i * 3 + 2]);
function peaks(s, region, side) {
  const result = { active: 0, transmitted: 0, opposite: 0 };
  for (let frame = 0; frame < 120; frame++) {
    s.step(1 / 60);
    for (let i = 0; i < s.count; i++) if (s.regions[i] === 9 || s.regions[i] === 10) {
      const key = s.rest[i * 3] * side < 0 ? 'opposite' : s.regions[i] === region ? 'active' : 'transmitted';
      result[key] = Math.max(result[key], magnitude(s, i));
    }
  }
  return result;
}
for (const sex of ['female', 'male']) {
  const data = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  test(`${sex} glute/lumbar transfer is reciprocal, switchable, and stays on the stimulated side`, () => {
    for (const region of [9, 10]) for (const side of [-1, 1]) {
      const responses = [];
      for (const lumbarCoupling of [0, .65]) {
        const s = new TissueSystem(data); s.configure({ region, buttSide: side, gravity: 0, lumbarCoupling }); s.impulse();
        for (let i = 0; i < s.count; i++) if (s.regions[i] !== region) assert.equal(Math.hypot(...s.velocity.slice(i * 3, i * 3 + 3)), 0, 'Neighbor must respond through mechanics, not a copied pulse');
        const p = peaks(s, region, side); assert.ok(p.active > .003); assert.ok(p.opposite < .00005); responses.push(p);
        s.endGrab(); for (let frame = 0; frame < 240; frame++) s.step(1 / 60);
        assert.ok(s.offset.every(v => Math.abs(v) < .00005), 'Linked regions should recover');
      }
      assert.ok(responses[1].transmitted > .0002, 'Enabled coupling must move the neighboring region');
      assert.ok(responses[0].transmitted < responses[1].transmitted * .01, 'Off should remove the added transfer');
    }
  });
  test(`${sex} lower-back auto touches and vibration keep the opposite side independent`, () => {
    for (const side of [-1, 1]) for (const tool of ['press', 'pull']) {
      const s = new TissueSystem(data); s.configure({ region: 10, radius: .25, gravity: 0 });
      const ids = Array.from(s.regions.keys()).filter(i => s.regions[i] === 10 && s.rest[i * 3] * side > .02);
      const id = ids.reduce((a, b) => Math.abs(s.rest[a * 3]) < Math.abs(s.rest[b * 3]) ? a : b);
      assert.ok(s.beginGrab(Array.from(s.rest.slice(id * 3, id * 3 + 3)), Array.from(s.normals.slice(id * 3, id * 3 + 3)), tool) > 0);
      assert.equal(s.lastButtSide, side); assert.ok(s.grab.ids.every(i => s.regions[i] === 10 && s.rest[i * 3] * side > 0));
      s.moveGrab([side * 2, -2, -2]); s.vibration = true;
      const p = peaks(s, 10, side); assert.ok(p.active > .005); assert.ok(p.transmitted > .0002); assert.ok(p.opposite < .00005);
    }
    const both = new TissueSystem(data); both.configure({ region: 10, buttSide: 2 }); both.impulse();
    for (const side of [-1, 1]) assert.ok(Array.from(both.regions.keys()).some(i => both.regions[i] === 10 && both.rest[i * 3] * side > 0 && both.velocity[i * 3] !== 0));
  });
  test(`${sex} lumbar support reduces transfer and extreme edited shapes stay bounded`, () => {
    const response = [];
    for (const lumbarSupport of [0, 1]) {
      const s = new TissueSystem(data); s.configure({ region: 9, buttSide: 1, gravity: 0, lumbarSupport }); s.impulse();
      response.push(peaks(s, 9, 1).transmitted);
    }
    assert.ok(response[1] < response[0] * .65);
    const morph = new BodyMorph(data.positions, data.genitalWeights, data);
    for (const stiffness of [1, 100]) for (const lumbarSupport of [0, 1]) {
      const s = new TissueSystem(data); s.setRest(morph.apply({ ...DEFAULT_PROPORTIONS, height: 1.16, hips: 1.35, gluteMuscleLeft: 1.4, buttFatRight: 1.75 }));
      s.configure({ stiffness, lumbarSupport, lumbarCoupling: 1, lumbarDamping: 0, gravity: 2, region: 10, buttSide: 2, tension: 1, strength: 3 }); s.vibration = true; s.impulse();
      for (let frame = 0; frame < 120; frame++) s.step(frame % 3 ? 1 / 60 : 2);
      assert.ok(s.offset.every(Number.isFinite)); assert.ok(s.velocity.every(Number.isFinite));
      for (let i = 0; i < s.count; i++) assert.ok(magnitude(s, i) <= s.limits[i] + 1e-6);
      const preset = readCharacter({ version: 1, sex, proportions: DEFAULT_PROPORTIONS, tissue: s.parameters });
      const restored = new TissueSystem(data); restored.configure(readCharacter(JSON.parse(JSON.stringify(preset))).tissue);
      for (const key of ['region', 'lumbarSupport', 'lumbarCoupling', 'lumbarDamping']) assert.equal(restored.parameters[key], s.parameters[key]);
    }
    const legacy = new TissueSystem(data); legacy.configure(readCharacter({ version: 1, sex, proportions: {} }).tissue || {});
    assert.equal(legacy.parameters.lumbarCoupling, .65);
  });
}
test('combined map exposes real lower-back transfer while keeping regions distinguishable', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/bodies/female-cage.json', import.meta.url)));
  const s = new TissueSystem(data); s.configure({ region: 9, buttSide: 1, gravity: 0 }); s.impulse();
  for (let f = 0; f < 10; f++) s.step(1 / 60);
  const samples = posteriorSamples(s); assert.ok(samples.some(p => p.region === 10 && p.mm > .1)); assert.ok(samples.some(p => p.region === 9 && p.mm > .1));
  for (const p of samples) assert.equal(p.mm, magnitude(s, p.id) * 1000);
  const labels = []; let aria = '';
  const context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText(text) { labels.push(text); }, arc() {}, fill() {} };
  const status = { textContent: '' }, canvas = { width: 320, height: 240, getContext: () => context, setAttribute(name, value) { aria = value; } };
  const map = new ButtockMap(canvas, status); map.setSystem(s);
  assert.ok(labels.includes('Lower back')); assert.ok(labels.includes('Buttocks')); assert.match(status.textContent, /back \d+\.\d{2} mm/); assert.match(aria, /lower back/);
  s.reset(); map.update(101); assert.match(status.textContent, /back 0.00 mm/);
});
