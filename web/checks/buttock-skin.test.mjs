import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MaterialsTexture } from '../node_modules/three-gpu-pathtracer/src/uniforms/MaterialsTexture.js';
import { addAnalSurface } from '../src/anal-surface.js';
import { BodyMorph } from '../src/body-proportions.js';
import { SurfaceDeformer } from '../src/surface-deformer.js';
import { SkinAppearance, DEFAULT_SKIN } from '../src/skin-material.js';
import { buttockSkinField } from '../src/buttock-skin.js';

async function body(sex) {
  globalThis.self = globalThis;
  const raw = fs.readFileSync(new URL(`../public/bodies/${sex}.glb`, import.meta.url));
  const loader = new GLTFLoader(); loader.register(() => ({ name: 'NoTextureDecode', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const object = (await loader.parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '')).scene;
  let mesh; object.traverse(n => { if (n.geometry?.attributes._cage_index) mesh = n; });
  const source = JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`, import.meta.url)));
  const data = addAnalSurface(mesh.geometry, source), g = mesh.geometry;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  const skin = new SkinAppearance(mesh.material, null, g, data);
  return { mesh, g, data, skin };
}

test('buttock skin fades smoothly at its boundaries and excludes front and central tissue', () => {
  for (const point of [[.05, .49, .04], [.05, .7, -.05], [.14, .49, -.05], [0, .49, -.05]]) {
    assert.equal(buttockSkinField(point, 1).weight, 0);
  }
  assert.equal(buttockSkinField([.05, .49, -.05], 1, 1).weight, 0);
  const point = [.05, .55, -.05], a = buttockSkinField(point, 1), b = buttockSkinField([point[0], point[1] + 1e-5, point[2]], 1);
  assert.ok(a.weight > 0 && a.weight < 1);
  assert.ok(Math.abs(a.weight - b.weight) < .001);
  assert.ok(a.tint.every((v, i) => Math.abs(v - b.tint[i]) < .0001));
});

for (const sex of ['female', 'male']) {
  test(`${sex} buttock tone is local, welded, stable under shape/physics edits, and restores after heat`, async () => {
    const { g, data, skin } = await body(sex), a = g.attributes, b = skin.buttocks;
    const colors = a.color.array.slice(), uv = a.uv.array.slice(), base = a.position.array.slice();
    const seams = new Map(); let left = 0, right = 0, neutral = 0;
    for (let i = 0; i < a.position.count; i++) {
      const rgb = Array.from(colors.slice(i * 3, i * 3 + 3)), point = base.slice(i * 3, i * 3 + 3);
      assert.ok(rgb.every(v => Number.isFinite(v) && v > .96 && v < 1.03));
      if (b.weights[i] > .001) {
        assert.ok(point[2] < 0 && point[1] / data.height > .405 && point[1] / data.height < .585);
        if (point[0] < 0) left++; else right++;
      } else if (b.weights[i] === 0) { assert.deepEqual(rgb, [1, 1, 1]); neutral++; }
      const id = a._weld_index.getX(i);
      if (seams.has(id)) assert.deepEqual(rgb, seams.get(id), `Tint breaks welded seam ${id}`);
      else seams.set(id, rgb);
    }
    assert.ok(left > 500 && right > 500 && Math.abs(left - right) < 30);
    assert.ok(neutral > a.position.count * .9, 'Detail must remain local');
    const morph = new BodyMorph(base, a._genital_weight.array, data, a._anal_weight.array);
    const deformer = new SurfaceDeformer(g, data.regions.length);
    deformer.setRest(morph.apply({ hips: 1.3, buttFatLeft: 1.6, gluteMuscleRight: 1.35, height: 1.1 }));
    const offset = new Float32Array(data.positions.length); offset.fill(.001);
    deformer.update(offset, { force: true, normals: true });
    assert.notDeepEqual(a.position.array, base); assert.deepEqual(a.uv.array, uv); assert.deepEqual(a.color.array, colors);
    skin.setView('heat'); deformer.update(offset, { force: true, heat: true });
    assert.notDeepEqual(a.color.array, colors); assert.equal(skin.material.roughnessMap, null);
    skin.setView('skin'); assert.deepEqual(a.color.array, colors); assert.ok(skin.material.vertexColors);
    skin.configure({ finish: 'original' }); assert.equal(skin.material.vertexColors, false); assert.equal(skin.material.roughnessMap, null);
    skin.configure({ finish: 'detailed', buttockTexture: 0 }); assert.equal(skin.material.roughnessMap, skin.maps.roughness); assert.equal(skin.material.vertexColors, false);
    skin.configure(DEFAULT_SKIN); assert.deepEqual(a.color.array, colors);
    let disposed = 0; b.roughness.addEventListener('dispose', () => disposed++);
    skin.setView('clay'); skin.dispose(); assert.equal(disposed, 1);
  });

  test(`${sex} regional roughness changes only its masked texels and reaches the path tracer`, async () => {
    const { skin } = await body(sex), b = skin.buttocks, m = skin.material;
    const texture = b.roughness, pixels = texture.image.data, initial = pixels.slice();
    assert.equal(texture.image.width, 512); assert.equal(pixels.byteLength, 1024 * 1024);
    assert.equal(texture.colorSpace, THREE.NoColorSpace); assert.ok(texture.generateMipmaps);
    assert.deepEqual(texture.repeat.toArray(), [1, 1]);
    let affected = 0, unchanged = 0;
    for (let i = 0; i < b.base.length; i++) {
      if (b.delta[i] === 0) { assert.equal(pixels[i * 4 + 1], b.base[i]); unchanged++; }
      else { assert.ok(pixels[i * 4 + 1] >= b.base[i]); affected++; }
      assert.equal(pixels[i * 4], pixels[i * 4 + 1]); assert.equal(pixels[i * 4 + 3], 255);
    }
    assert.ok(affected > 2000 && affected < b.base.length * .05); assert.ok(unchanged > b.base.length * .95);
    skin.configure({ buttockTexture: 1 }); assert.notDeepEqual(pixels, initial);
    skin.configure(DEFAULT_SKIN); assert.deepEqual(pixels, initial);
    const table = new MaterialsTexture(); table.updateFrom([m], [m.map, m.normalMap, m.roughnessMap]);
    assert.equal(table.image.data[7], 2); assert.equal(table.image.data[58] & 1, 1, 'Skin vertex tint flag missing');
    assert.equal(table.image.data[76], 1); assert.equal(table.image.data[81], 1, 'Atlas UV transform must remain unscaled');
    skin.dispose(); table.dispose();
  });
}
