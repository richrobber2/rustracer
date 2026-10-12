import * as THREE from 'three';

const smooth = (lo, hi, x) => { const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
const bell = (x, center, width) => Math.exp(-(((x - center) / width) ** 2));
const wrap = (x, size) => (x % size + size) % size;
function noise3(x, y, z) {
  const a = Math.floor(x), b = Math.floor(y), c = Math.floor(z);
  const u = smooth(0, 1, x - a), v = smooth(0, 1, y - b), w = smooth(0, 1, z - c);
  const hash = (i, j, k) => {
    let n = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n ^= n >>> 16;
    return (n >>> 0) / 4294967295;
  };
  let value = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    value += hash(a + i, b + j, c + k) * (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? w : 1 - w);
  }
  return value;
}

// Rest-space fields follow proportions and skeletal/tissue deformation through
// existing vertices and UVs. Soft support boundaries avoid a painted-on patch.
export function buttockSkinField(point, height, exclusion = 0) {
  const [x, y, z] = point.map(v => v / height), ax = Math.abs(x);
  const weight = smooth(.405, .455, y) * (1 - smooth(.535, .585, y))
    * smooth(.008, .032, -z) * (1 - smooth(.095, .125, ax)) * smooth(.001, .012, ax)
    * (1 - Math.max(0, Math.min(1, exclusion)));
  const grain = noise3(x * 135 + 17, y * 135, z * 135 - 11);
  const broad = noise3(x * 42, y * 42 + 13, z * 42);
  const warmth = bell(y, .47, .045) * bell(ax, .035, .04);
  const variation = (grain - .5) * .018 + (broad - .5) * .025;
  return {
    weight,
    tint: [weight * variation, weight * variation, weight * variation],
    matte: weight * (.032 + grain * .036 + warmth * .02),
  };
}

function sampleGreen(texture, u, v) {
  const { data, width, height } = texture.image;
  const x = u * texture.repeat.x * width - .5, y = v * texture.repeat.y * height - .5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const at = (a, b) => data[(wrap(b, height) * width + wrap(a, width)) * 4 + 1];
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy)
    + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}

function bakeRoughness(geometry, matte, source, size = 512) {
  const base = new Uint8Array(size * size), delta = new Float32Array(base.length), covered = new Uint8Array(base.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) base[y * size + x] = Math.round(sampleGreen(source, (x + .5) / size, (y + .5) / size));
  const uv = geometry.attributes.uv, index = geometry.index.array;
  // Rasterize every island so edge padding cannot spill onto unrelated skin.
  for (let at = 0; at < index.length; at += 3) {
    const a = index[at], b = index[at + 1], c = index[at + 2];
    const ax = uv.getX(a) * size - .5, ay = uv.getY(a) * size - .5;
    const bx = uv.getX(b) * size - .5, by = uv.getY(b) * size - .5;
    const cx = uv.getX(c) * size - .5, cy = uv.getY(c) * size - .5;
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-9) continue;
    const loX = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), hiX = Math.min(size - 1, Math.floor(Math.max(ax, bx, cx)));
    const loY = Math.max(0, Math.ceil(Math.min(ay, by, cy))), hiY = Math.min(size - 1, Math.floor(Math.max(ay, by, cy)));
    for (let y = loY; y <= hiY; y++) for (let x = loX; x <= hiX; x++) {
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom, w = 1 - u - v;
      if (u < -1e-5 || v < -1e-5 || w < -1e-5) continue;
      const j = y * size + x, value = u * matte[a] + v * matte[b] + w * matte[c];
      // Overlapping islands get the lower value; preserve non-buttock surfaces.
      delta[j] = covered[j] ? Math.min(delta[j], value) : value; covered[j] = 1;
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = delta.slice(), filled = covered.slice();
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const j = y * size + x; if (covered[j]) continue;
      let sum = 0, count = 0;
      for (const k of [j - 1, j + 1, j - size, j + size]) if (covered[k]) { sum += delta[k]; count++; }
      if (count) { next[j] = sum / count; filled[j] = 1; }
    }
    delta.set(next); covered.set(filled);
  }
  const texture = new THREE.DataTexture(new Uint8Array(base.length * 4), size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace; texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  return { texture, base, delta };
}

export class ButtockSkin {
  constructor(geometry, data, sourceRoughness) {
    this.geometry = geometry;
    const { position, _genital_weight: genital, _anal_weight: anal, _weld_index: weld } = geometry.attributes;
    this.tint = new Float32Array(position.count * 3); this.weights = new Float32Array(position.count);
    const matte = new Float32Array(position.count), fields = new Map();
    for (let i = 0; i < position.count; i++) {
      const id = weld?.getX(i) ?? i;
      if (!fields.has(id)) fields.set(id, buttockSkinField([position.getX(i), position.getY(i), position.getZ(i)], data.height, Math.max(genital?.getX(i) || 0, anal?.getX(i) || 0)));
      const field = fields.get(id); this.weights[i] = field.weight; matte[i] = field.matte; this.tint.set(field.tint, i * 3);
    }
    const baked = bakeRoughness(geometry, matte, sourceRoughness);
    this.roughness = baked.texture; this.base = baked.base; this.delta = baked.delta; this.amount = -1;
  }
  apply(amount) {
    if (amount !== this.amount) {
      const pixels = this.roughness.image.data;
      for (let i = 0; i < this.base.length; i++) {
        const value = Math.min(255, Math.round(this.base[i] + this.delta[i] * amount * 255)), j = i * 4;
        pixels[j] = pixels[j + 1] = pixels[j + 2] = value; pixels[j + 3] = 255;
      }
      this.roughness.needsUpdate = true; this.amount = amount;
    }
    // Heat uses this same attribute. Restore the skin colors on every return.
    const colors = this.geometry.attributes.color;
    if (colors) {
      for (let i = 0; i < this.tint.length; i++) colors.array[i] = 1 + this.tint[i] * amount;
      colors.needsUpdate = true;
    }
  }
  dispose() { this.roughness.dispose(); }
}
