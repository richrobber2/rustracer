import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MaterialsTexture } from '../node_modules/three-gpu-pathtracer/src/uniforms/MaterialsTexture.js';
import { createSkinMaps, SkinAppearance, DEFAULT_SKIN, sanitizeSkin } from '../src/skin-material.js';
import { readCharacter } from '../src/body-proportions.js';

test('skin detail maps are deterministic, bounded, mipmapped and have no exceptional wrap seam', () => {
  const a = createSkinMaps(), b = createSkinMaps();
  let roughMin = 255, roughMax = 0, boundary = 0, interior = 0;
  for (const name of ['normal', 'roughness']) {
    assert.deepEqual(a[name].image.data, b[name].image.data);
    assert.equal(a[name].colorSpace, THREE.NoColorSpace); assert.ok(a[name].generateMipmaps);
    assert.equal(a[name].minFilter, THREE.LinearMipmapLinearFilter); assert.equal(a[name].wrapS, THREE.RepeatWrapping);
    assert.equal(a[name].image.width, 256); assert.equal(a[name].image.data.length, 256 * 256 * 4);
  }
  const n = a.normal.image.data, r = a.roughness.image.data, size = 256;
  for (let i = 0; i < n.length; i += 4) {
    const x = n[i] / 255 * 2 - 1, y = n[i + 1] / 255 * 2 - 1, z = n[i + 2] / 255 * 2 - 1;
    assert.ok(z > .65 && Math.abs(Math.hypot(x, y, z) - 1) < .012);
    assert.equal(n[i + 3], 255); assert.equal(r[i + 3], 255);
    roughMin = Math.min(roughMin, r[i + 1]); roughMax = Math.max(roughMax, r[i + 1]);
  }
  assert.ok(roughMin >= 219 && roughMax <= 255 && roughMax - roughMin > 10);
  const diff = (a, b) => Math.abs(n[a * 4] - n[b * 4]) + Math.abs(n[a * 4 + 1] - n[b * 4 + 1]);
  for (let y = 0; y < size; y++) {
    boundary += diff(y * size, y * size + size - 1);
    for (let x = 1; x < size; x++) interior += diff(y * size + x - 1, y * size + x) / (size - 1);
  }
  assert.ok(boundary < interior * 1.8, `Discontinuous normal-map wrap: ${boundary}/${interior}`);
  for (const maps of [a, b]) for (const t of Object.values(maps)) t.dispose();
});

test('skin retains the photo atlas, supports original/diagnostic views, and cleans up hidden maps', () => {
  const map = new THREE.Texture(); map.colorSpace = THREE.SRGBColorSpace;
  const source = new THREE.MeshStandardMaterial({ map, roughness: .65 });
  const skin = new SkinAppearance(source, { capabilities: { getMaxAnisotropy: () => 16 } }), m = skin.material;
  assert.equal(m.map, map); assert.equal(map.colorSpace, THREE.SRGBColorSpace); assert.equal(map.anisotropy, 4);
  assert.equal(m.normalMap, skin.maps.normal); assert.equal(m.roughnessMap, skin.maps.roughness);
  assert.ok(m.isMeshPhysicalMaterial && m.ior === 1.4 && m.metalness === 0);
  for (const view of ['clay', 'heat', 'wire']) {
    skin.setView(view); assert.equal(m.normalMap, null); assert.equal(m.roughnessMap, null); assert.equal(m.map, null);
    assert.equal(m.vertexColors, view === 'heat'); assert.equal(m.wireframe, view === 'wire');
  }
  skin.setView('skin'); skin.configure({ finish: 'original' });
  assert.equal(m.map, map); assert.equal(m.normalMap, null); assert.equal(m.roughness, .65); assert.equal(m.ior, 1.5);
  skin.configure({ finish: 'detailed', detail: 0 }); assert.equal(m.normalMap, null);
  skin.configure(DEFAULT_SKIN); assert.equal(m.normalMap, skin.maps.normal);
  skin.setView('heat'); let disposed = 0;
  for (const t of Object.values(skin.maps)) t.addEventListener('dispose', () => disposed++);
  skin.dispose(); assert.equal(disposed, 2); assert.equal(map.colorSpace, THREE.SRGBColorSpace);
  m.dispose(); source.dispose(); map.dispose();
});

test('the path-tracer material writer receives pore normals, roughness and the same detail scale', () => {
  const source = new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), skin = new SkinAppearance(source);
  const textures = [source.map, skin.maps.normal, skin.maps.roughness], table = new MaterialsTexture();
  table.updateFrom([skin.material], textures);
  const data = table.image.data;
  assert.equal(data[3], 0); assert.equal(data[7], 2); assert.equal(data[16], 1);
  assert.ok(Math.abs(data[8] - 1.4) < 1e-6);
  assert.ok(Math.abs(data[17] - DEFAULT_SKIN.detail * .3) < 1e-6 && data[17] === data[18]);
  // Infinite attenuation distance is Three's intentional non-transmitting default.
  assert.equal(data[51], Infinity);
  assert.ok(data.every((value, index) => index === 51 || Number.isFinite(value)));
  assert.equal(data[100], 72); assert.equal(data[105], 72);
  skin.dispose(); skin.material.dispose(); source.map.dispose(); source.dispose(); table.dispose();
});

test('appearance presets sanitize values and older characters keep neutral appearance defaults', () => {
  assert.deepEqual(sanitizeSkin(), DEFAULT_SKIN);
  assert.deepEqual(sanitizeSkin({ finish: 'bad', detail: Infinity, roughness: -5 }), { ...DEFAULT_SKIN, roughness: .4 });
  const appearance = { finish: 'original', detail: .3, roughness: .8 };
  const preset = readCharacter({ version: 1, sex: 'female', appearance });
  assert.deepEqual(preset.appearance, appearance); assert.deepEqual(readCharacter(JSON.parse(JSON.stringify(preset))).appearance, appearance);
  assert.equal(readCharacter({ version: 1, sex: 'male' }).appearance, undefined);
});
