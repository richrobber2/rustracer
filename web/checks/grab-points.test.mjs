import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TissueSystem } from '../src/tissue-physics.js';
import { surfaceGrabAnchor } from '../src/grab-points.js';
import { ButtockMap, mapSamples, MAP_REGIONS } from '../src/buttock-map.js';
import { isolateButtockWeights } from '../src/buttock-sides.js';
const makeMap = (s, mode = 'upper') => {
  const context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {}, fill() {} };
  const status = { textContent: '' }, canvas = { width: 320, height: 240, getContext: () => context, setAttribute() {} };
  const map = new ButtockMap(canvas, status, mode); map.setSystem(s); return { map, status };
};
test('grabbing an already displaced point starts from its current position', () => {
  const s = new TissueSystem({ positions: [.1, 1.3, -.05], normals: [0, 0, -1], regions: [1], edges: [], height: 2, sex: 'female', regionNames: [] });
  s.configure({ region: 11, gravity: 0, stiffness: 1, strength: .1 }); s.offset[2] = .008;
  const point = [.1, 1.3, -.042]; assert.equal(s.beginGrab(point, [0, 0, -1], 'press', 0), 1);
  s.step(1 / 120); assert.ok(s.velocity[2] > 0, 'Press should continue inward from the current offset, not snap toward rest');
  assert.equal(s.grab.anchorId, 0); s.endGrab();
  assert.equal(s.beginGrab(point, [0, 0, -1], 'press', 100), 0); assert.equal(s.grab, null);
});
test('a 3D grab stays on the hit triangle mapping even with a closer unrelated cage point', () => {
  const s = new TissueSystem({ positions: [.1, 1.3, -.05, .11, 1.3, -.05], normals: [0, 0, -1, 0, 0, -1], regions: [1, 1], edges: [], height: 2, sex: 'female', regionNames: [] });
  const geometry = { attributes: { _cage_index: { array: new Uint16Array(12) }, _cage_weight: { array: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) } } };
  assert.equal(surfaceGrabAnchor(s, geometry, { a: 0, b: 1, c: 2 }, [1 / 3, 1 / 3, 1 / 3], [.11, 1.3, -.05]), 0);
  s.configure({ region: 13 }); assert.equal(surfaceGrabAnchor(s, geometry, { a: 0, b: 1, c: 2 }, [1, 0, 0], [.11, 1.3, -.05]), -1);
});
for (const sex of ['female', 'male']) {
  const data = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  test(`${sex} map picking follows displacement, locks the sample during a drag, and honors side/region`, () => {
    const s = new TissueSystem(data); s.configure({ region: 13, buttSide: 1, gravity: 0, radius: .03 });
    const ids = Array.from(s.regions.keys()).filter(i => s.regions[i] === 13 && s.rest[i * 3] > 0);
    const id = ids.reduce((a, b) => s.rest[a * 3] > s.rest[b * 3] ? a : b);
    const { map, status } = makeMap(s); const rest = mapSamples(s, MAP_REGIONS.upper).find(p => p.id === id), oldPixel = map.project(rest);
    s.offset[id * 3] = .015; s.offset[id * 3 + 1] = .004;
    const moved = mapSamples(s, MAP_REGIONS.upper).find(p => p.id === id), pixel = map.project(moved);
    assert.equal(map.pick(pixel.x, pixel.y, .01).id, id);
    assert.notEqual(map.pick(oldPixel.x, oldPixel.y, .01)?.id, id);
    assert.equal(s.beginGrab([moved.x, moved.y, moved.z], Array.from(s.normals.slice(id * 3, id * 3 + 3)), 'pull', id) > 0, true);
    map.select(id); assert.match(status.textContent, /grab anchor: Hands/);
    const delta = map.worldDelta(12, -10); assert.ok(delta[0] < 0 && delta[1] > 0);
    s.moveGrab([moved.x + delta[0], moved.y + delta[1], moved.z]);
    for (let f = 0; f < 30; f++) s.step(1 / 60); assert.equal(s.grab.anchorId, id);
    assert.ok(s.grab.ids.every(i => s.regions[i] === 13 && s.rest[i * 3] > 0));
    s.endGrab(); s.configure({ buttSide: -1 }); const now = mapSamples(s, MAP_REGIONS.upper).find(p => p.id === id), at = map.project(now);
    assert.equal(map.pick(at.x, at.y, .01), null); assert.equal(s.beginGrab([now.x, now.y, now.z], [0, 0, -1], 'press', id), 0);
    assert.equal(map.pick(-100, -100), null);
  });
  test(`${sex} actual deformed GLB hit anchors come from its live weighted cage mapping`, async () => {
    globalThis.self = globalThis;
    const bytes = fs.readFileSync(new URL(`../public/bodies/${sex}.glb`, import.meta.url));
    const loader = new GLTFLoader(); loader.register(() => ({ name: 'HeadlessTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); let g;
    gltf.scene.traverse(n => { if (n.geometry?.attributes._cage_index) g = n.geometry; });
    const s = new TissueSystem(data); isolateButtockWeights(g, s); s.configure({ buttSide: 1 });
    for (let i = 0; i < s.count; i++) if (s.rest[i * 3] > 0) s.offset[i * 3] = .004;
    let tested = 0;
    for (let faceIndex = 0; faceIndex < g.index.count && tested < 100; faceIndex += 33) {
      const vertices = Array.from(g.index.array.slice(faceIndex, faceIndex + 3));
      const point = [0, 0, 0], candidates = new Set();
      for (const v of vertices) {
        for (let axis = 0; axis < 3; axis++) point[axis] += g.attributes.position.array[v * 3 + axis] / 3;
        for (let k = 0; k < 4; k++) { const at = v * 4 + k, id = g.attributes._cage_index.array[at], w = g.attributes._cage_weight.array[at]; if (w > 0) candidates.add(id); for (let axis = 0; axis < 3; axis++) point[axis] += s.offset[id * 3 + axis] * w / 3; }
      }
      if (point[0] <= .01 || ![...candidates].some(id => [4, 11, 12, 13].includes(s.regions[id]))) continue;
      const id = surfaceGrabAnchor(s, g, { a: vertices[0], b: vertices[1], c: vertices[2] }, [1 / 3, 1 / 3, 1 / 3], point);
      assert.ok(candidates.has(id)); assert.ok(s.rest[id * 3] > 0); tested++;
    }
    assert.ok(tested > 10);
  });
}
