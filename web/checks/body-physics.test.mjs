import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TissueSystem } from '../src/tissue-physics.js';

const data = Object.fromEntries(['female', 'male'].map(sex => [sex, JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)))]));
const maximum = values => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
function run(system, seconds, hz = 60) { for (let i = 0; i < seconds * hz; i++) system.step(1 / hz); }
function abdomen(body) {
  let best = -Infinity, id = 0;
  for (let i = 0; i < body.regions.length; i++) {
    if (body.regions[i] !== 2) continue;
    const j = i * 3, score = body.positions[j + 2] - Math.abs(body.positions[j]) * 3;
    if (score > best) { best = score; id = i; }
  }
  return { point: body.positions.slice(id * 3, id * 3 + 3), normal: body.normals.slice(id * 3, id * 3 + 3) };
}

test('both complete body GLBs load with valid rigs, normalized weights, and tissue mapping', async () => {
  globalThis.self = globalThis;
  for (const sex of ['female', 'male']) {
    const raw = fs.readFileSync(new URL(`../public/bodies/${sex}.glb`, import.meta.url));
    const loader = new GLTFLoader();
    // Exercise the real GLTF parser. Decode embedded image files separately in asset QA.
    loader.register(() => ({ name: 'HeadlessTextureCheck', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    const gltf = await loader.parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
    gltf.scene.updateMatrixWorld(true);
    let meshes = 0;
    gltf.scene.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      meshes++;
      assert.equal(mesh.skeleton.bones.length, 163);
      mesh.skeleton.update();
      const a = mesh.geometry.attributes;
      for (let i = 0; i < a.position.count; i += 19) {
        const rest = new THREE.Vector3().fromBufferAttribute(a.position, i);
        const actual = mesh.getVertexPosition(i, new THREE.Vector3());
        assert.ok(rest.distanceTo(actual) < 1e-5, 'Rest-pose skinning changed body shape');
        const skinSum = a.skinWeight.getX(i) + a.skinWeight.getY(i) + a.skinWeight.getZ(i) + a.skinWeight.getW(i);
        assert.ok(Math.abs(skinSum - 1) < 1e-5);
        if (a._cage_weight) {
          const w = a._cage_weight, sum = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
          assert.ok(Math.abs(sum - 1) < 1e-5);
          for (let k = 0; k < 4; k++) assert.ok(a._cage_index.array[i * 4 + k] < data[sex].regions.length);
        }
      }
    });
    assert.equal(meshes, 2, 'Both skin and eyes must be present');
  }
});

test('press and pull deform real body cages and recover after release', () => {
  for (const sex of ['female', 'male']) for (const tool of ['press', 'pull']) {
    const system = new TissueSystem(data[sex]); system.configure({ gravity: 0 });
    const { point, normal } = abdomen(data[sex]);
    assert.ok(system.beginGrab(point, normal, tool) > 0);
    run(system, .5);
    const peak = maximum(system.offset);
    assert.ok(peak > .001, 'Touch must produce visible, millimeter-scale displacement');
    system.endGrab(); run(system, 3);
    assert.ok(maximum(system.offset) < peak * .01, 'Tissue did not return to rest');
  }
});

test('higher stiffness reduces static gravitational sag', () => {
  const soft = new TissueSystem(data.female), firm = new TissueSystem(data.female);
  soft.configure({ stiffness: 10, gravity: 1 }); firm.configure({ stiffness: 90, gravity: 1 });
  run(soft, 2); run(firm, 2);
  assert.ok(maximum(firm.offset) < maximum(soft.offset) * .6);
});

test('fixed time steps are consistent across frame rates and paused state holds', () => {
  const a = new TissueSystem(data.male), b = new TissueSystem(data.male);
  a.impulse(); b.impulse(); run(a, 1, 30); run(b, 1, 60);
  assert.deepEqual(a.offset, b.offset);
  const snapshot = a.offset.slice(); a.paused = true; run(a, 1);
  assert.deepEqual(a.offset, snapshot);
  a.reset(); assert.equal(maximum(a.offset), 0); assert.equal(maximum(a.velocity), 0);
});

test('region selection restricts direct touch forces and pulses', () => {
  const body = data.female, system = new TissueSystem(body), { point, normal } = abdomen(body);
  system.configure({ region: 0, gravity: 0 }); // Head selected, abdomen touched.
  assert.equal(system.beginGrab(point, normal, 'press'), 0);
  system.endGrab(); system.impulse();
  for (let i = 0; i < system.count; i++) if (body.regions[i] !== 0) assert.equal(maximum(system.velocity.slice(i * 3, i * 3 + 3)), 0);
});

test('extreme settings, large pointer drags and delayed frames stay finite and bounded', () => {
  for (const sex of ['female', 'male']) for (const stiffness of [1, 100]) {
    const system = new TissueSystem(data[sex]), { point, normal } = abdomen(data[sex]);
    system.configure({ stiffness, damping: 0, gravity: 2, strength: 3, tension: 1, radius: .25 });
    system.vibration = true;
    system.beginGrab(point, normal, 'pull'); system.moveGrab([100, -100, 100]);
    for (let i = 0; i < 120; i++) system.step(i % 3 ? 1 / 60 : 2);
    assert.ok(system.offset.every(Number.isFinite));
    assert.ok(system.velocity.every(Number.isFinite));
    for (let i = 0; i < system.count; i++) {
      assert.ok(Math.hypot(...system.offset.slice(i * 3, i * 3 + 3)) <= .006 + .055 * system.softness[i] + 1e-6);
      assert.ok(system.rest[i * 3 + 1] + system.offset[i * 3 + 1] >= .001 - 1e-6);
    }
  }
});
