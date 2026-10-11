// CPU-only review; no map drawing, browser, GPU, or device frame-rate claim.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TissueSystem } from '../src/tissue-physics.js';
import { MuscleMotion, CagePose } from '../src/muscle-motion.js';
import { SurfaceDeformer } from '../src/surface-deformer.js';
import { isolateButtockWeights } from '../src/buttock-sides.js';
import { DEFAULT_PROPORTIONS } from '../src/body-proportions.js';
globalThis.self = globalThis;
const stats = values => {
  values.sort((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b) / values.length, p95: values[Math.floor(values.length * .95)] };
};
for (const sex of ['female', 'male']) {
  const data = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  const bytes = fs.readFileSync(new URL(`../public/bodies/${sex}.glb`, import.meta.url));
  const loader = new GLTFLoader(); loader.register(() => ({ name: 'HeadlessTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true); let mesh;
  gltf.scene.traverse(n => { if (n.geometry?.attributes._cage_index) mesh = n; });
  const system = new TissueSystem(data); isolateButtockWeights(mesh.geometry, system);
  const motion = new MuscleMotion(gltf.scene, mesh, data), pose = new CagePose(mesh, system, data); system.pose = pose;
  motion.setShape(DEFAULT_PROPORTIONS); pose.refresh(motion.version);
  const deformer = new SurfaceDeformer(mesh.geometry, system.count); motion.play();
  const results = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    const dynamics = [], surface = [];
    for (let frame = 0; frame < 780; frame++) {
      const start = performance.now(), moved = motion.step(1 / 60);
      const posed = pose.refresh(motion.version), activated = motion.tissueActivation(system);
      if (moved || posed || activated) system.wake();
      system.step(1 / 60); const dynamic = performance.now() - start;
      deformer.update(system.offset, { normals: frame % 2 === 0 });
      if (frame >= 180) { dynamics.push(dynamic); surface.push(performance.now() - start); }
    }
    results.push({ dynamics: stats(dynamics), withSurface: stats(surface) });
  }
  console.log(JSON.stringify({ sex, workload: 'unilateral reach loop, gravity 0.3, 60 Hz, normals 30 Hz', results }));
}
