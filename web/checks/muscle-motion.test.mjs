import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TissueSystem } from '../src/tissue-physics.js';
import { MuscleMotion, CagePose } from '../src/muscle-motion.js';
import { BodyMorph, DEFAULT_PROPORTIONS, readCharacter } from '../src/body-proportions.js';
import { isolateButtockWeights } from '../src/buttock-sides.js';
import { ButtockMap, MAP_REGIONS, mapSamples } from '../src/buttock-map.js';
import { surfaceGrabAnchor } from '../src/grab-points.js';

async function body(sex) {
  globalThis.self = globalThis;
  const bytes = fs.readFileSync(new URL(`../public/bodies/${sex}.glb`, import.meta.url));
  const data = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  const loader = new GLTFLoader(); loader.register(() => ({ name: 'HeadlessTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true); let mesh;
  gltf.scene.traverse(n => { if (n.geometry?.attributes._cage_index) mesh = n; });
  const system = new TissueSystem(data); isolateButtockWeights(mesh.geometry, system);
  const motion = new MuscleMotion(gltf.scene, mesh, data), pose = new CagePose(mesh, system, data); system.pose = pose;
  motion.setShape(DEFAULT_PROPORTIONS); pose.refresh(motion.version);
  return { data, mesh, system, motion, pose };
}
const run = (motion, frames = 120, hz = 60) => { for (let f = 0; f < frames; f++) motion.step(1 / hz); };
const position = (motion, name) => motion.byName.get(name).getWorldPosition(new THREE.Vector3());

for (const sex of ['female', 'male']) {
  test(`${sex} antagonist activation drives real joint/skin motion, isolates the other arm, and relaxes`, async () => {
    const { motion, mesh, system, pose } = await body(sex);
    const old = position(motion, 'wristL'), opposite = position(motion, 'wristR');
    const base = mesh.geometry.attributes.position;
    const handVertex = Array.from({ length: base.count }, (_, i) => i).find(i => base.getX(i) > .4 && base.getY(i) > .7);
    const restVertex = mesh.getVertexPosition(handVertex, new THREE.Vector3());
    motion.setExcitation('shoulder', 1, [1, 0]); motion.setExcitation('elbow', 1, [1, 0]); run(motion);
    assert.ok(position(motion, 'wristL').distanceTo(old) > .15);
    assert.ok(position(motion, 'wristR').distanceTo(opposite) < 1e-6);
    assert.ok(mesh.getVertexPosition(handVertex, new THREE.Vector3()).distanceTo(restVertex) > .10);
    const elbow = motion.selected('elbow', 1)[0], flexed = elbow.angle;
    assert.ok(elbow.activation[0] > .99 && elbow.moment > 0);
    motion.setExcitation('elbow', 1, [0, 1]); run(motion); assert.ok(elbow.angle < flexed * .1);
    motion.setExcitation('elbow', 1, [.6, .6]); run(motion); assert.ok(Math.abs(elbow.moment) < .001);
    motion.tissueActivation(system); assert.ok(system.activation.some(a => a > .5));
    pose.refresh(motion.version); assert.ok(pose.gravity.every(Number.isFinite));
    motion.relax(); run(motion, 600);
    assert.ok(motion.joints.every(j => Math.abs(j.angle) < .00001)); assert.ok(position(motion, 'wristL').distanceTo(old) < .00001);
  });
  test(`${sex} core and finger actuators animate their rig while legs and the opposite hand remain supported`, async () => {
    const { motion } = await body(sex);
    const foot = position(motion, 'footL'), head = position(motion, 'neck03'), fingertip = position(motion, 'finger3-3L'), opposite = position(motion, 'finger3-3R');
    motion.setExcitation('core', 2, [1, 0]); run(motion);
    assert.ok(position(motion, 'neck03').distanceTo(head) > .10); assert.ok(position(motion, 'footL').distanceTo(foot) < 1e-6);
    motion.reset(); motion.setExcitation('grip', 1, [1, 0]); run(motion);
    assert.ok(position(motion, 'finger3-3L').distanceTo(fingertip) > .01);
    assert.ok(position(motion, 'finger3-3R').distanceTo(opposite) < 1e-6);
    motion.reset(); assert.ok(position(motion, 'neck03').distanceTo(head) < 1e-6);
  });
  test(`${sex} joint integration is frame-rate consistent, bounded, holdable, and presets cannot autoplay`, async () => {
    const a = await body(sex), b = await body(sex);
    a.motion.configure({ side: 2, strength: 1.5, speed: 1.5 }); b.motion.configure({ side: 2, strength: 1.5, speed: 1.5 });
    a.motion.play(); b.motion.play(); run(a.motion, 120, 30); run(b.motion, 240, 60);
    assert.deepEqual(a.motion.joints.map(j => [j.angle, j.velocity, ...j.activation]), b.motion.joints.map(j => [j.angle, j.velocity, ...j.activation]));
    a.motion.held = true; const angles = a.motion.joints.map(j => j.angle), clock = a.motion.time; run(a.motion); assert.deepEqual(a.motion.joints.map(j => j.angle), angles); assert.equal(a.motion.time, clock);
    a.motion.held = false; a.system.configure({ stiffness: 100, gravity: 2, tension: 1, strength: 3 });
    for (let i = 0; i < 180; i++) { const delta = i % 3 ? 1 / 60 : 5; a.motion.step(delta); a.pose.refresh(a.motion.version); a.motion.tissueActivation(a.system); a.system.wake(); a.system.step(delta); }
    for (const j of a.motion.joints) { assert.ok(Number.isFinite(j.angle) && Number.isFinite(j.velocity)); assert.ok(j.angle >= j.min && j.angle <= j.max); }
    assert.ok(a.system.offset.every(Number.isFinite));
    for (let i = 0; i < a.system.count; i++) assert.ok(Math.hypot(...a.system.offset.slice(i * 3, i * 3 + 3)) <= a.system.limits[i] + 1e-6);
    a.motion.setExcitation('elbow', -1, [.8, .2]);
    const preset = readCharacter({ version: 1, sex, proportions: DEFAULT_PROPORTIONS, motion: a.motion.snapshot() });
    b.motion.reset(); b.motion.restore(JSON.parse(JSON.stringify(preset)).motion); assert.deepEqual(b.motion.snapshot(), a.motion.snapshot());
    assert.equal(b.motion.running, false); assert.equal(b.motion.held, true);
    b.motion.configure({ strength: Infinity, speed: -10, side: 99 }); assert.equal(b.motion.strength, 1.5); assert.equal(b.motion.speed, .5); assert.equal(b.motion.side, 2);
  });
  test(`${sex} edited joint pivots preserve neutral skinning and pose-aware map/3D grabs use the current frame`, async () => {
    const { data, mesh, motion, system, pose } = await body(sex);
    motion.object.rotation.z = Math.PI / 2; pose.refresh(motion.version);
    assert.ok(Math.abs(pose.gravity[0] + 1) < 1e-6 && Math.abs(pose.gravity[1]) < 1e-6, 'World gravity must be transformed into the material frame');
    motion.object.rotation.z = 0; pose.refresh(motion.version);
    const shape = { ...DEFAULT_PROPORTIONS, height: 1.16, shoulders: 1.25, waist: 1.4, hips: 1.35 };
    const morph = new BodyMorph(mesh.geometry.attributes.position.array, mesh.geometry.attributes._genital_weight.array, data);
    mesh.geometry.attributes.position.array.set(morph.apply(shape)); system.setRest(new BodyMorph(data.positions, data.genitalWeights, data).apply(shape));
    motion.setShape(shape); pose.refresh(motion.version);
    for (let i = 0; i < mesh.geometry.attributes.position.count; i += 47) assert.ok(mesh.getVertexPosition(i, new THREE.Vector3()).distanceTo(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i)) < 1e-6);
    motion.setExcitation('shoulder', 1, [.9, 0]); motion.setExcitation('elbow', 1, [.8, 0]); run(motion); pose.refresh(motion.version);
    const id = Array.from(system.regions.keys()).find(i => system.regions[i] === 13 && system.rest[i * 3] > .2);
    system.configure({ region: 13, buttSide: 1, gravity: 0 }); system.offset[id * 3 + 2] = .005;
    const material = Array.from(system.rest.slice(id * 3, id * 3 + 3), (v, k) => v + system.offset[id * 3 + k]);
    const point = pose.point(id, material), recovered = pose.toMaterial(id, point);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(material[k] - recovered[k]) < 1e-6);
    assert.ok(new THREE.Vector3(...point).distanceTo(new THREE.Vector3(...material)) > .1);
    const context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {}, fill() {} };
    const map = new ButtockMap({ width: 320, height: 240, getContext: () => context, setAttribute() {} }, { textContent: '' }, 'upper'); map.setSystem(system);
    const sample = mapSamples(system, MAP_REGIONS.upper).find(p => p.id === id), pixel = map.project(sample);
    assert.equal(map.pick(pixel.x, pixel.y, .01)?.id, id);
    assert.ok(system.beginGrab(recovered, Array.from(system.normals.slice(id * 3, id * 3 + 3)), 'pull', id) > 0);
    const target = point.map((v, k) => v + map.worldDelta(12, -8)[k]); system.moveGrab(pose.toMaterial(id, target));
    for (let f = 0; f < 30; f++) system.step(1 / 60); assert.equal(system.grab.anchorId, id); assert.ok(system.offset.every(Number.isFinite));
    // A triangle driven by this hand sample must choose it in posed space.
    const geometry = { attributes: { _cage_index: { array: new Uint16Array(12).fill(id) }, _cage_weight: { array: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) } } };
    assert.equal(surfaceGrabAnchor(system, geometry, { a: 0, b: 1, c: 2 }, [1 / 3, 1 / 3, 1 / 3], point), id);
    // A throttled map must still hit its displayed dot if the rig advances.
    system.endGrab(); motion.setExcitation('shoulder', 1, [0, 1]); run(motion, 45); pose.refresh(motion.version);
    const picked = map.pick(pixel.x, pixel.y, .01); assert.equal(picked?.id, id);
    const latest = mapSamples(system, MAP_REGIONS.upper).find(p => p.id === id);
    assert.deepEqual([picked.x, picked.y, picked.z], [latest.x, latest.y, latest.z]);
    // Real posed skin triangles still restrict anchors to their own influences.
    system.configure({ region: -1 }); const attributes = mesh.geometry.attributes;
    let tested = 0;
    for (let at = 0; at < mesh.geometry.index.count && tested < 20; at += 3) {
      const vertices = Array.from(mesh.geometry.index.array.slice(at, at + 3)), candidates = new Set();
      for (const vertex of vertices) for (let k = 0; k < 4; k++) if (attributes._cage_weight.array[vertex * 4 + k] > 0) candidates.add(attributes._cage_index.array[vertex * 4 + k]);
      if (![...candidates].some(i => system.regions[i] === 13 && system.rest[i * 3] > 0)) continue;
      const hit = new THREE.Vector3(); for (const vertex of vertices) hit.add(mesh.getVertexPosition(vertex, new THREE.Vector3()).multiplyScalar(1 / 3));
      const anchor = surfaceGrabAnchor(system, mesh.geometry, { a: vertices[0], b: vertices[1], c: vertices[2] }, [1 / 3, 1 / 3, 1 / 3], hit.toArray());
      assert.ok(candidates.has(anchor)); assert.ok(system.rest[anchor * 3] > 0); tested++;
    }
    assert.equal(tested, 20);
  });
}
