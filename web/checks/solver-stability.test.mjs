import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TissueSystem } from '../src/tissue-physics.js';
import { isSideRegion } from '../src/upper-body.js';

const EXTREME = { stiffness: 100, tension: 1, buttSide: 2, buttCompliance: .5, lumbarSupport: 1, upperSupport: 1, shoulderSupport: 1, handSupport: 1, absSupport: 1, obliqueSupport: 1, coreBracing: 1, lumbarCoupling: 1, upperCoupling: 1, shoulderCoupling: 1, handCoupling: 1, absCoupling: 1, coreCoupling: 1 };
for (const sex of ['female', 'male']) {
  const data = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));

  test(`${sex} extreme supports with full muscle activation settle after a pulse`, () => {
    const s = new TissueSystem(data); s.configure(EXTREME);
    s.activation = new Float32Array(s.count).fill(1); s.impulse();
    for (let i = 0; i < 4 * 60 && !s.sleeping; i++) s.step(1 / 60);
    assert.ok(s.sleeping, `${sex} still moving after 4 s`);
    assert.ok(s.offset.every(Number.isFinite));
  });

  test(`${sex} stiffness caps leave default supports untouched`, () => {
    const s = new TissueSystem(data);
    for (let i = 0; i < s.count; i++) assert.ok(s.support[i] * 2.5 <= s.stiffnessCap[i], `particle ${i}`);
  });

  test(`${sex} centre-line samples follow both sides without carrying load across`, () => {
    const s = new TissueSystem(data), coupling = new Float32Array(s.count);
    for (let e = 0; e < s.edges.length; e += 2) {
      const factor = s.edgeFactors[e / 2], follower = s.edgeFollower[e / 2];
      if (follower !== 2) coupling[s.edges[e]] += factor;
      if (follower !== 1) coupling[s.edges[e + 1]] += factor;
      // A follower edge never pushes a sided sample.
      if (follower) assert.equal(s.rest[s.edges[e + (follower === 1 ? 0 : 1)] * 3], 0);
    }
    const midline = Array.from(s.regions.keys()).filter(i => isSideRegion(s.regions[i]) && s.rest[i * 3] === 0);
    assert.ok(midline.length > 0);
    for (const i of midline) assert.ok(coupling[i] > 0, `centre-line sample ${i} is disconnected`);
  });
}
