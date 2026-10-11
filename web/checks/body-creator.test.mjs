import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TissueSystem } from '../src/tissue-physics.js';
import { SurfaceDeformer } from '../src/surface-deformer.js';
import { BodyMorph, PROPORTIONS, DEFAULT_PROPORTIONS, sanitizeProportions, readCharacter } from '../src/body-proportions.js';

const data = Object.fromEntries(['female', 'male'].map(sex => [sex, JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)))]));
async function geometry(sex) {
  globalThis.self = globalThis;
  const buffer = fs.readFileSync(new URL(`../public/bodies/${sex}.glb`, import.meta.url));
  const loader = new GLTFLoader(); loader.register(() => ({ name: 'HeadlessTextureCheck', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  let result; gltf.scene.traverse(node => { if (node.geometry?.attributes._cage_index) result = node.geometry; });
  result.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(result.attributes.position.count * 3), 3));
  return result;
}
function run(s, seconds) { for (let i = 0; i < seconds * 60; i++) s.step(1 / 60); }
function genitalPoint(d) {
  let best = -Infinity, id = -1;
  for (let i = 0; i < d.regions.length; i++) if (d.regions[i] === 8 && d.positions[i * 3 + 2] > best) { best = d.positions[i * 3 + 2]; id = i; }
  return { point: d.positions.slice(id * 3, id * 3 + 3), normal: d.normals.slice(id * 3, id * 3 + 3) };
}

test('character presets sanitize external values and reject incompatible files', () => {
  assert.deepEqual(sanitizeProportions({}), DEFAULT_PROPORTIONS);
  assert.equal(sanitizeProportions({ height: Infinity, genitalLength: 500 }).height, 1);
  assert.equal(sanitizeProportions({ height: Infinity, genitalLength: 500 }).genitalLength, 1.5);
  assert.throws(() => readCharacter({ version: 3, sex: 'male' }));
  const preset = { version: 1, sex: 'female', proportions: { ...DEFAULT_PROPORTIONS, hips: 1.2 }, tissue: { genitalCompliance: 1.5 } };
  assert.deepEqual(readCharacter(JSON.parse(JSON.stringify(preset))), preset);
});

test('proportion edits retain neutral shape and are finite and reversible at every slider extreme', async () => {
  for (const sex of ['female', 'male']) {
    const g = await geometry(sex), base = g.attributes.position.array.slice();
    const morph = new BodyMorph(base, g.attributes._genital_weight.array, data[sex]);
    assert.deepEqual(morph.apply(DEFAULT_PROPORTIONS), base);
    for (const p of PROPORTIONS) for (const value of [p.min, p.max]) {
      const changed = morph.apply({ ...DEFAULT_PROPORTIONS, [p.id]: value }).slice();
      assert.ok(changed.every(Number.isFinite)); assert.notDeepEqual(changed, base);
      assert.deepEqual(morph.apply(DEFAULT_PROPORTIONS), base);
    }
    const mask = g.attributes._genital_weight.array;
    const genital = morph.apply({ genitalLength: 1.5, genitalWidth: 1.5 });
    for (let i = 0; i < mask.length; i++) if (!mask[i]) for (let a = 0; a < 3; a++) assert.equal(genital[i * 3 + a], base[i * 3 + a]);
  }
});

test('both anatomical additions are welded into a manifold body surface', async () => {
  for (const sex of ['female', 'male']) {
    const g = await geometry(sex), weld = g.attributes._weld_index.array, index = g.index.array, edges = new Map();
    for (let i = 0; i < index.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = weld[index[i + k]], b = weld[index[i + (k + 1) % 3]], key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    assert.ok([...edges.values()].every(n => n === 2), 'Body has an open seam or non-manifold edge');
    assert.ok(data[sex].regions.filter(r => r === 8).length > 80);
  }
});

test('genital controls affect the selected region and remain stable across extreme proportions', () => {
  for (const sex of ['female', 'male']) {
    const d = data[sex], morph = new BodyMorph(d.positions, d.genitalWeights, d);
    for (const limit of ['min', 'max']) {
      const shape = Object.fromEntries(PROPORTIONS.map(p => [p.id, p[limit]]));
      const s = new TissueSystem(d); s.setRest(morph.apply(shape), shape.height * Math.cbrt(shape.genitalLength * shape.genitalWidth ** 2));
      s.configure({ region: 8, gravity: 0, damping: .6, genitalDamping: .6, genitalCompliance: 2, strength: 3 });
      s.impulse();
      for (let i = 0; i < s.count; i++) if (s.regions[i] !== 8) assert.equal(Math.hypot(...s.velocity.slice(i * 3, i * 3 + 3)), 0);
      run(s, .2); assert.ok(s.maxDisplacement > .0001);
      run(s, 4); assert.ok(s.maxDisplacement < .0002);
      s.configure({ gravity: 2, genitalDamping: 0 }); s.vibration = true; run(s, 3);
      assert.ok(s.offset.every(Number.isFinite));
      for (let i = 0; i < s.count; i++) assert.ok(Math.hypot(...s.offset.slice(i * 3, i * 3 + 3)) <= s.limits[i] + 1e-6);
    }
    const a = new TissueSystem(d), b = new TissueSystem(d);
    a.configure({ genitalCompliance: .5 }); b.configure({ genitalCompliance: 2 }); run(a, 3); run(b, 3);
    let sumA = 0, sumB = 0;
    for (let i = 0; i < a.count; i++) if (a.regions[i] === 8) { sumA += Math.abs(a.offset[i * 3 + 1]); sumB += Math.abs(b.offset[i * 3 + 1]); }
    assert.ok(sumB > sumA * 1.5, 'Compliance must change physical response');
  }
});

test('settled physics sleeps, stays fixed, and wakes for interaction, parameters and shape edits', () => {
  const s = new TissueSystem(data.male); run(s, 5);
  assert.equal(s.sleeping, true);
  const before = s.offset.slice(); assert.equal(s.step(1 / 60), false); assert.deepEqual(s.offset, before);
  s.configure({ genitalCompliance: 1.5 }); assert.equal(s.sleeping, false); run(s, 5); assert.equal(s.sleeping, true);
  const { point, normal } = genitalPoint(data.male); s.beginGrab(point, normal); assert.equal(s.sleeping, false);
  s.endGrab(); run(s, 5); s.vibration = true; assert.equal(s.sleeping, false);
  s.vibration = false; s.setRest(data.male.positions); assert.equal(s.sleeping, false); assert.ok(s.offset.every(v => v === 0));
});

test('selective deformation matches full weighted deformation, preserves seams, and skips untouched vertices', async () => {
  for (const sex of ['female', 'male']) {
    const g = await geometry(sex), base = g.attributes.position.array.slice(), d = data[sex];
    const deform = new SurfaceDeformer(g, d.regions.length), offsets = new Float32Array(d.positions.length);
    deform.update(offsets, { normals: true, heat: true });
    const id = d.regions.findIndex(r => r === 8); offsets[id * 3] = .002; offsets[id * 3 + 1] = -.001;
    assert.equal(deform.update(offsets, { normals: true, heat: true }), true);
    assert.ok(deform.lastUpdatedVertices < deform.count * .1);
    const { _cage_index: ids, _cage_weight: weights, position, normal } = g.attributes;
    for (let i = 0; i < position.count; i++) {
      for (let a = 0; a < 3; a++) {
        let v = base[i * 3 + a];
        for (let k = 0; k < 4; k++) v += offsets[ids.array[i * 4 + k] * 3 + a] * weights.array[i * 4 + k];
        assert.ok(Math.abs(position.array[i * 3 + a] - v) < 2e-7);
      }
      assert.ok(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 1e-5);
    }
    assert.equal(deform.update(offsets, { normals: true }), false); assert.equal(deform.lastUpdatedVertices, 0);
    const canonical = new THREE.BufferGeometry(); canonical.setAttribute('position', new THREE.Float32BufferAttribute(deform.position, 3)); canonical.setIndex(new THREE.BufferAttribute(deform.faces, 1)); canonical.computeVertexNormals();
    for (let i = 0; i < position.count; i++) {
      const at = deform.weld[i] * 3;
      for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(normal.array[i * 3 + axis] - canonical.attributes.normal.array[at + axis]) < 3e-5, 'Incremental normals differ from full canonical normals');
    }
  }
});
