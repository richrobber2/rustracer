import * as THREE from 'three';

export const DEFAULT_SKIN = { finish: 'detailed', detail: .65, roughness: .62 };
export function sanitizeSkin(value = {}) {
  const range = (v, fallback, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  return { finish: value.finish === 'original' ? 'original' : 'detailed', detail: range(value.detail, .65, 0, 1), roughness: range(value.roughness, .62, .4, .85) };
}

// Small, periodic material maps. No edits to the photographic color atlas or
// changes to UV placement. GPU mipmaps keep sub-pixel pores from shimmering.
export function createSkinMaps(size = 256) {
  const normalData = new Uint8Array(size * size * 4), roughnessData = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size), broad = new Float32Array(size * size);
  let seed = 0x741af9;
  const random = () => { seed = Math.imul(seed ^ (seed >>> 15), 1 | seed); seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed); return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296; };
  const bins = 32, cells = Array.from({ length: bins * bins }, () => []), wrap = (v, period) => (v % period + period) % period;
  for (let i = 0; i < 1250; i++) {
    const pore = { x: random() * size, y: random() * size, radius: (.65 + random() * .55) * size / 256, depth: .22 + random() * .22 };
    cells[Math.floor(pore.y / size * bins) * bins + Math.floor(pore.x / size * bins)].push(pore);
  }
  const values = Float32Array.from({ length: 64 }, () => random());
  const noise = (x, y) => {
    x = x / size * 8; y = y / size * 8;
    const ix = Math.floor(x), iy = Math.floor(y); let u = x - ix, v = y - iy;
    u *= u * (3 - 2 * u); v *= v * (3 - 2 * v);
    const sample = (a, b) => values[wrap(b, 8) * 8 + wrap(a, 8)];
    return (sample(ix, iy) * (1 - u) + sample(ix + 1, iy) * u) * (1 - v) + (sample(ix, iy + 1) * (1 - u) + sample(ix + 1, iy + 1) * u) * v;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cellX = Math.floor(x / size * bins), cellY = Math.floor(y / size * bins), at = y * size + x;
    let h = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const p of cells[wrap(cellY + dy, bins) * bins + wrap(cellX + dx, bins)]) {
        let px = Math.abs(x - p.x), py = Math.abs(y - p.y); px = Math.min(px, size - px); py = Math.min(py, size - py);
        const distance = (px * px + py * py) / (p.radius * p.radius);
        if (distance < 12) h -= p.depth * Math.exp(-distance * 1.8);
      }
    }
    broad[at] = noise(x, y);
    height[at] = h + (broad[at] - .5) * .035;
  }
  const sample = (x, y) => height[wrap(y, size) * size + wrap(x, size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = y * size + x, j = at * 4;
    const nx = -(sample(x + 1, y) - sample(x - 1, y)) * .8, ny = -(sample(x, y + 1) - sample(x, y - 1)) * .8;
    const inv = 1 / Math.hypot(nx, ny, 1);
    normalData[j] = Math.round((nx * inv * .5 + .5) * 255); normalData[j + 1] = Math.round((ny * inv * .5 + .5) * 255); normalData[j + 2] = Math.round((inv * .5 + .5) * 255); normalData[j + 3] = 255;
    const r = Math.round((.86 + broad[at] * .12 + Math.min(.02, -height[at] * .04)) * 255);
    roughnessData[j] = roughnessData[j + 1] = roughnessData[j + 2] = r; roughnessData[j + 3] = 255;
  }
  const texture = data => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(72, 72);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return t;
  };
  return { normal: texture(normalData), roughness: texture(roughnessData) };
}

export class SkinAppearance {
  constructor(source, renderer) {
    this.sourceMap = source.map; this.sourceRoughness = source.roughness; this.maps = createSkinMaps();
    const anisotropy = Math.max(1, Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() || 1));
    if (this.sourceMap) this.sourceMap.anisotropy = anisotropy;
    this.maps.normal.anisotropy = this.maps.roughness.anisotropy = anisotropy;
    this.material = new THREE.MeshPhysicalMaterial({ name: source.name || 'Skin', map: source.map, color: source.color, roughness: source.roughness, metalness: 0, side: source.side });
    this.settings = { ...DEFAULT_SKIN }; this.view = 'skin'; this.apply();
  }
  configure(value) { this.settings = sanitizeSkin({ ...this.settings, ...value }); this.apply(); }
  setView(view) { this.view = view; this.apply(); }
  apply() {
    const m = this.material, p = this.settings;
    const skin = this.view === 'skin', detailed = skin && p.finish === 'detailed';
    const hasNormal = Boolean(m.normalMap), hasRoughness = Boolean(m.roughnessMap), wasSkin = Boolean(m.map);
    const hadColors = m.vertexColors, wasWire = m.wireframe;
    m.map = skin ? this.sourceMap : null;
    m.normalMap = detailed && p.detail > 0 ? this.maps.normal : null;
    m.roughnessMap = detailed ? this.maps.roughness : null;
    m.normalScale.setScalar(p.detail * .3);
    m.roughness = detailed ? p.roughness : this.sourceRoughness;
    m.ior = detailed ? 1.4 : 1.5; m.specularIntensity = 1;
    m.color.set(skin || this.view === 'heat' ? '#ffffff' : '#bca58a');
    m.vertexColors = this.view === 'heat'; m.wireframe = this.view === 'wire';
    if (hasNormal !== Boolean(m.normalMap) || hasRoughness !== Boolean(m.roughnessMap) || wasSkin !== Boolean(m.map) || hadColors !== m.vertexColors || wasWire !== m.wireframe) m.needsUpdate = true;
  }
  // Maps can be temporarily removed in clay/heat/wire, so their owner disposes
  // them even when the generic scene cleanup cannot find them on the material.
  dispose() { this.maps.normal.dispose(); this.maps.roughness.dispose(); }
}
