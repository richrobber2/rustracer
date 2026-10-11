// CPU-only comparison. No browser, WebGL, frame-rate or phone-performance claim.
// Reference surface update: full-vertex / full-normal loop from commit 0e852a9.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TissueSystem } from '../src/tissue-physics.js';
import { SurfaceDeformer } from '../src/surface-deformer.js';
globalThis.self = globalThis;
function legacy(g, rest, offset, recalculate, sums) {
  const a = g.attributes, ids = a._cage_index.array, weights = a._cage_weight.array, p = a.position.array;
  for (let i = 0; i < a.position.count; i++) {
    let dx = 0, dy = 0, dz = 0;
    for (let k = 0; k < 4; k++) { const at = i * 4 + k, j = ids[at] * 3, w = weights[at]; dx += offset[j] * w; dy += offset[j + 1] * w; dz += offset[j + 2] * w; }
    const j = i * 3; p[j] = rest[j] + dx; p[j + 1] = rest[j + 1] + dy; p[j + 2] = rest[j + 2] + dz;
  }
  if (!recalculate) return;
  g.computeVertexNormals();
  const weld = a._weld_index.array, n = a.normal.array; sums.fill(0);
  for (let i = 0; i < weld.length; i++) for (let axis = 0; axis < 3; axis++) sums[weld[i] * 3 + axis] += n[i * 3 + axis];
  for (let i = 0; i < weld.length; i++) {
    const at = weld[i] * 3, length = Math.hypot(sums[at], sums[at + 1], sums[at + 2]) || 1;
    for (let axis = 0; axis < 3; axis++) n[i * 3 + axis] = sums[at + axis] / length;
  }
}
const report = { environment: `Node ${process.version}, ${process.platform}/${process.arch}; cloud CPU only`, samples: 600, normalRate: 'Reference 20 Hz; selective update 30 Hz', results: [] };
for (const sex of ['female', 'male']) {
  const data = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  const bytes = fs.readFileSync(new URL(`../public/bodies/${sex}.glb`, import.meta.url));
  const loader = new GLTFLoader(); loader.register(() => ({ name: 'HeadlessTextureCheck', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  let base; gltf.scene.traverse(node => { if (node.geometry?.attributes._cage_index) base = node.geometry; });
  for (const workload of ['regional vibration', 'whole-body vibration', 'settled']) {
    const result = { sex, workload };
    for (const implementation of ['reference', 'optimized']) {
      const g = base.clone(), rest = g.attributes.position.array.slice(), s = new TissueSystem(data);
      s.configure({ gravity: 0, region: workload === 'regional vibration' ? 8 : -1 });
      s.vibration = workload !== 'settled';
      const deformer = new SurfaceDeformer(g, s.count);
      deformer.update(s.offset, { normals: true });
      const sums = new Float32Array(deformer.count * 3);
      const samples = []; let touched = 0;
      for (let i = 0; i < 780; i++) {
        const start = performance.now();
        if (implementation === 'reference') { s.wake(); s.step(1 / 60); legacy(g, rest, s.offset, i % 3 === 0, sums); }
        else if (s.step(1 / 60) || deformer.normalsPending) deformer.update(s.offset, { normals: i % 2 === 0 || s.sleeping });
        if (i >= 180) { samples.push(performance.now() - start); touched += implementation === 'reference' ? deformer.count : s.sleeping ? 0 : deformer.lastUpdatedVertices; }
      }
      samples.sort((a, b) => a - b);
      result[implementation] = { medianMs: +samples[300].toFixed(4), p95Ms: +samples[570].toFixed(4), meanMs: +(samples.reduce((a, b) => a + b) / samples.length).toFixed(4), meanVerticesUpdated: Math.round(touched / samples.length) };
      g.dispose();
    }
    report.results.push(result);
  }
}
console.log(JSON.stringify(report, null, 2));
