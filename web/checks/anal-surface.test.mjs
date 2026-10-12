import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addAnalSurface, ANAL_REGION } from '../src/anal-surface.js';
import { BodyMorph, DEFAULT_PROPORTIONS, PROPORTIONS, readCharacter } from '../src/body-proportions.js';
import { TissueSystem } from '../src/tissue-physics.js';
import { isolateButtockWeights } from '../src/buttock-sides.js';
import { MuscleMotion, CagePose } from '../src/muscle-motion.js';
import { SurfaceDeformer } from '../src/surface-deformer.js';
import { ButtockMap, mapSamples, MAP_REGIONS } from '../src/buttock-map.js';
import { eligibleGrabAnchor, surfaceGrabAnchor } from '../src/grab-points.js';

async function body(sex) {
  globalThis.self = globalThis;
  const raw = fs.readFileSync(new URL(`../public/bodies/${sex}.glb`, import.meta.url));
  const loader = new GLTFLoader(); loader.register(() => ({ name: 'HeadlessTextureCheck', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
  let mesh; gltf.scene.traverse(n => { if (n.geometry?.attributes._cage_index) mesh = n; });
  const original = mesh.geometry.attributes.position.array.slice(), oldFaces = mesh.geometry.index.count;
  const source = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  const data = addAnalSurface(mesh.geometry, source), system = new TissueSystem(data);
  isolateButtockWeights(mesh.geometry, system);
  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count * 3), 3));
  return { object: gltf.scene, mesh, data, source, system, original, oldFaces };
}
for (const sex of ['female', 'male']) {
  test(`${sex} ring stretch expands locally, respects pause and limits, and recovers on release`, async () => {
    const { system } = await body(sex);
    system.configure({ gravity: 0, analStretch: 1 });
    assert.equal(system.parameters.analStretch, 1);
    for (let i = 0; i < system.count; i++) if (system.regions[i] !== ANAL_REGION) assert.deepEqual(Array.from(system.analStretchTarget.slice(i * 3, i * 3 + 3)), [0, 0, 0]);
    system.paused = true; system.step(1 / 60); assert.ok(system.offset.every(v => v === 0));
    system.paused = false; for (let f = 0; f < 240; f++) system.step(1 / 60);
    let radial = 0;
    for (let i = 0; i < system.count; i++) {
      const j = i * 3, target = system.analStretchTarget.slice(j, j + 3), length = Math.hypot(...target);
      assert.ok(Math.hypot(...system.offset.slice(j, j + 3)) <= system.limits[i] + 1e-6);
      if (length > .002) radial = Math.max(radial, target.reduce((sum, v, k) => sum + v * system.offset[j + k], 0) / length);
    }
    assert.ok(radial > .001, `Ring did not expand: ${radial}`);
    system.configure({ analStretch: 0 }); for (let f = 0; f < 480; f++) system.step(1 / 60);
    assert.ok(system.sleeping && system.maxDisplacement < .0001);
  });
  test(`${sex} anal surface is welded, local, closed and bound to the skeleton`, async () => {
    const { mesh, data, source, original, oldFaces, object, system } = await body(sex), g = mesh.geometry;
    assert.ok(g.index.count > oldFaces && g.index.count < oldFaces * 1.03);
    assert.ok(data.regions.length > source.regions.length && data.regions.length <= source.regions.length + 25);
    assert.deepEqual(source.regions.includes(16), false, 'Source data must stay reusable');
    const a = g.attributes, edges = new Map(); let affected = 0;
    for (let i = 0; i < original.length / 3; i++) {
      if (!a._anal_weight.getX(i)) assert.deepEqual(Array.from(a.position.array.slice(i * 3, i * 3 + 3)), Array.from(original.slice(i * 3, i * 3 + 3)));
      else affected++;
    }
    assert.ok(affected > 20 && affected < 1000);
    for (let at = 0; at < g.index.count; at += 3) {
      const vs = Array.from(g.index.array.slice(at, at + 3));
      const triangle = new THREE.Triangle(...vs.map(i => new THREE.Vector3().fromBufferAttribute(a.position, i)));
      assert.ok(triangle.getArea() > 1e-12, `Degenerate face ${at / 3}`);
      for (let k = 0; k < 3; k++) {
        const x = a._weld_index.getX(vs[k]), y = a._weld_index.getX(vs[(k + 1) % 3]), key = x < y ? `${x}:${y}` : `${y}:${x}`;
        const old = edges.get(key) || [0, 0]; old[0]++; old[1] += x < y ? 1 : -1; edges.set(key, old);
      }
    }
    for (const [key, [count, direction]] of edges) { assert.equal(count, 2, `Open/non-manifold edge ${key}`); assert.equal(direction, 0, `Incorrect winding ${key}`); }
    for (let i = 0; i < a.position.count; i++) for (const [ids, weights, limit] of [['_cage_index', '_cage_weight', system.count], ['skinIndex', 'skinWeight', mesh.skeleton.bones.length]]) {
      let sum = 0; for (let k = 0; k < 4; k++) { assert.ok(a[ids].array[i * 4 + k] < limit); sum += a[weights].array[i * 4 + k]; }
      assert.ok(Math.abs(sum - 1) < 2e-6);
    }
    const motion = new MuscleMotion(object, mesh, data), pose = new CagePose(mesh, system, data); system.pose = pose;
    motion.tissueActivation(system); assert.ok(system.activation.every(Number.isFinite));
    motion.setExcitation('core', 0, [.8, 0]);
    for (let f = 0; f < 90; f++) { motion.step(1 / 60); pose.refresh(motion.version); motion.tissueActivation(system); system.step(1 / 60); }
    assert.ok(system.offset.every(Number.isFinite));
    const deformer = new SurfaceDeformer(g, system.count); deformer.update(system.offset, { normals: true, force: true });
    assert.ok(a.normal.array.every(Number.isFinite));
    // Midline detail stays recessed rather than adding a protruding attachment.
    const center = data.positions.slice(source.regions.length * 3, source.regions.length * 3 + 3);
    const inward = center.reduce((s, v, k) => s + (v - data.analFrame.anchor[k]) * data.analFrame.normal[k], 0);
    assert.ok(inward < -.004 && inward > -.006);
  });

  test(`${sex} anal shape controls are local, reversible and preserve seams at limits`, async () => {
    const { mesh, data, system } = await body(sex), a = mesh.geometry.attributes, base = a.position.array.slice();
    const morph = new BodyMorph(base, a._genital_weight.array, data, a._anal_weight.array);
    const cage = new BodyMorph(data.positions, data.genitalWeights, data, data.analWeights);
    assert.deepEqual(morph.apply(DEFAULT_PROPORTIONS), base);
    for (const spec of PROPORTIONS.filter(p => p.id.startsWith('anal'))) for (const value of [spec.min, spec.max]) {
      const shape = { [spec.id]: value }, changed = morph.apply(shape).slice(); assert.notDeepEqual(changed, base);
      for (let i = 0; i < a.position.count; i++) if (!a._anal_weight.getX(i)) for (let k = 0; k < 3; k++) assert.equal(changed[i * 3 + k], base[i * 3 + k]);
      const seams = new Map();
      for (let i = 0; i < a.position.count; i++) { const id = a._weld_index.getX(i), p = Array.from(changed.slice(i * 3, i * 3 + 3)); if (seams.has(id)) assert.deepEqual(p, seams.get(id)); else seams.set(id, p); }
      assert.deepEqual(morph.apply(DEFAULT_PROPORTIONS), base);
    }
    for (const limit of ['min', 'max']) {
      const shape = Object.fromEntries(PROPORTIONS.map(p => [p.id, p[limit]]));
      assert.ok(morph.apply(shape).every(Number.isFinite)); system.setRest(cage.apply(shape));
      system.configure({ region: ANAL_REGION, buttSide: 1, gravity: 2, analCompliance: 2, analDamping: 0, stiffness: 100, tension: 1 });
      system.vibration = true; for (let f = 0; f < 180; f++) system.step(1 / 60);
      assert.ok(system.offset.every(Number.isFinite));
      for (let i = 0; i < system.count; i++) assert.ok(Math.hypot(...system.offset.slice(i * 3, i * 3 + 3)) <= system.limits[i] + 1e-6);
    }
    const preset = readCharacter({ version: 1, sex, proportions: { analSize: 1.2, analDepth: 1.4 }, tissue: { analCompliance: 1.5 } });
    assert.equal(preset.proportions.analSize, 1.2); assert.equal(preset.proportions.analDepth, 1.4);
    assert.equal(readCharacter({ version: 1, sex }).proportions.analSize, 1);
  });

  test(`${sex} anal region can be grabbed centrally and from its unfolded map and recovers`, async () => {
    const { mesh, data, system, object, source } = await body(sex), id = source.regions.length;
    const motion = new MuscleMotion(object, mesh, data); system.pose = new CagePose(mesh, system, data);
    system.configure({ region: ANAL_REGION, buttSide: 1, gravity: 0, analDamping: .8 });
    assert.ok(eligibleGrabAnchor(system, id), 'Central region must ignore the paired-body side selector');
    const context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {}, fill() {} };
    const map = new ButtockMap({ width: 320, height: 240, getContext: () => context, setAttribute() {} }, { textContent: '' }, 'anal'); map.setSystem(system);
    const sample = mapSamples(system, MAP_REGIONS.anal).find(p => p.id === id), pixel = map.project(sample);
    assert.equal(map.pick(pixel.x, pixel.y, .01)?.id, id);
    const delta = map.worldDelta(5, -5); assert.ok(delta[2] !== 0, 'Dragging follows the local perineal plane');
    const normal = data.normals.slice(id * 3, id * 3 + 3);
    assert.ok(system.beginGrab([sample.x, sample.y, sample.z], normal, 'press', id));
    assert.ok(system.grab.ids.every(i => system.regions[i] === ANAL_REGION));
    for (let f = 0; f < 30; f++) system.step(1 / 60); assert.ok(system.maxDisplacement > .001);
    system.endGrab(); for (let f = 0; f < 360; f++) system.step(1 / 60);
    assert.ok(system.sleeping); assert.ok(system.maxDisplacement < .0001);
    const g = mesh.geometry, at = Array.from(g.index.array).findIndex((v, i) => i % 3 === 0 && g.attributes._anal_weight.getX(v) > .5);
    const vs = Array.from(g.index.array.slice(at, at + 3)), point = new THREE.Vector3();
    for (const v of vs) point.add(new THREE.Vector3().fromBufferAttribute(g.attributes.position, v).multiplyScalar(1 / 3));
    const anchor = surfaceGrabAnchor(system, g, { a: vs[0], b: vs[1], c: vs[2] }, [1 / 3, 1 / 3, 1 / 3], point.toArray());
    assert.ok(anchor >= 0 && system.regions[anchor] === ANAL_REGION);
    motion.tissueActivation(system); assert.ok(system.activation.every(Number.isFinite));
  });
}
