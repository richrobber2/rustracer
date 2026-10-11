import * as THREE from 'three';

// A closed, recessed external surface, not a rectum or a calibrated sphincter.
// Refine the existing perineum in place; keep its UVs, skinning and welded seams.
export const ANAL_REGION = 16;
const RADIUS = .022;
const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
export function analField(point, frame) {
  const delta = point.map((v, k) => v - frame.anchor[k]);
  const u = delta[0], v = dot(delta, frame.tangent), r = Math.hypot(u, v);
  const t = Math.max(0, 1 - (r / RADIUS) ** 2), weight = t * t;
  const depth = weight * (-.0045 * Math.exp(-((r / .004) ** 2))
    + .0012 * Math.exp(-(((r - .0075) / .0025) ** 2))
    + .00025 * Math.cos(10 * Math.atan2(v, u)) * Math.exp(-(((r - .007) / .004) ** 2)));
  return { u, v, weight, depth };
}

function refine(geometry, anchor) {
  let attrs = Object.fromEntries(Object.entries(geometry.attributes).map(([name, a]) => [name, { array: a.array, size: a.itemSize, normalized: a.normalized }]));
  let index = geometry.index.array;
  let nextWeld = attrs._weld_index.array.reduce((n, v) => Math.max(n, v + 1), 0);
  for (let pass = 0; pass < 2; pass++) {
    const position = attrs.position.array, weld = attrs._weld_index.array, split = new Map();
    const near = new Uint8Array(position.length / 3);
    for (let i = 0; i < near.length; i++) near[i] = Math.hypot(position[i * 3] - anchor[0], position[i * 3 + 1] - anchor[1], position[i * 3 + 2] - anchor[2]) < RADIUS * 1.7;
    for (let at = 0; at < index.length; at += 3) for (let k = 0; k < 3; k++) {
      const a = index[at + k], b = index[at + (k + 1) % 3];
      if ((!near[a] && !near[b]) || attrs._genital_weight.array[a] > .01 || attrs._genital_weight.array[b] > .01) continue;
      const distance = Math.hypot((position[a * 3] + position[b * 3]) * .5 - anchor[0], (position[a * 3 + 1] + position[b * 3 + 1]) * .5 - anchor[1], (position[a * 3 + 2] + position[b * 3 + 2]) * .5 - anchor[2]);
      if (distance < RADIUS * 1.3) split.set(edgeKey(weld[a], weld[b]), -1);
    }
    for (const key of split.keys()) split.set(key, nextWeld++);
    const tails = Object.fromEntries(Object.keys(attrs).map(name => [name, []]));
    const midpoints = new Map(); let count = position.length / 3;
    const midpoint = (a, b) => {
      const canonical = split.get(edgeKey(weld[a], weld[b]));
      if (canonical === undefined) return -1;
      const key = edgeKey(a, b); if (midpoints.has(key)) return midpoints.get(key);
      const id = count++; midpoints.set(key, id);
      for (const [name, attr] of Object.entries(attrs)) {
        if (['_cage_index', '_cage_weight', 'skinIndex', 'skinWeight'].includes(name)) continue;
        for (let k = 0; k < attr.size; k++) tails[name].push(name === '_weld_index' ? canonical : (attr.array[a * attr.size + k] + attr.array[b * attr.size + k]) * .5);
      }
      for (const [ids, weights] of [['_cage_index', '_cage_weight'], ['skinIndex', 'skinWeight']]) {
        const blend = new Map();
        for (const v of [a, b]) for (let k = 0; k < 4; k++) {
          const i = attrs[ids].array[v * 4 + k], w = attrs[weights].array[v * 4 + k] * .5;
          blend.set(i, (blend.get(i) || 0) + w);
        }
        const best = [...blend].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = best.reduce((s, a) => s + a[1], 0);
        for (let k = 0; k < 4; k++) { tails[ids].push(best[k]?.[0] || 0); tails[weights].push((best[k]?.[1] || 0) / sum); }
      }
      return id;
    };
    const faces = [];
    for (let at = 0; at < index.length; at += 3) {
      if (!near[index[at]] && !near[index[at + 1]] && !near[index[at + 2]]) { faces.push(index[at], index[at + 1], index[at + 2]); continue; }
      const vs = Array.from(index.slice(at, at + 3)), ms = vs.map((a, k) => midpoint(a, vs[(k + 1) % 3]));
      const n = ms.filter(i => i >= 0).length;
      if (!n) { faces.push(...vs); continue; }
      if (n === 3) { const [a, b, c] = vs, [ab, bc, ca] = ms; faces.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca); continue; }
      const start = n === 1 ? ms.findIndex(i => i >= 0) : ms.findIndex((i, k) => i >= 0 && ms[(k + 1) % 3] >= 0);
      const [a, b, c] = [0, 1, 2].map(k => vs[(start + k) % 3]), ab = ms[start], bc = ms[(start + 1) % 3];
      if (n === 1) faces.push(a, ab, c, ab, b, c);
      else faces.push(ab, b, bc, a, ab, c, ab, bc, c);
    }
    attrs = Object.fromEntries(Object.entries(attrs).map(([name, a]) => {
      const array = new a.array.constructor(a.array.length + tails[name].length); array.set(a.array); array.set(tails[name], a.array.length);
      return [name, { ...a, array }];
    }));
    index = Uint32Array.from(faces);
  }
  for (const [name, a] of Object.entries(attrs)) geometry.setAttribute(name, new THREE.BufferAttribute(a.array, a.size, a.normalized));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
}

export function addAnalSurface(geometry, source) {
  if (geometry.attributes._anal_weight) return source;
  const { position, normal, uv, _genital_weight: genital } = geometry.attributes;
  // Shared MakeHuman atlas landmark on the posterior perineum. Atlas location
  // is stable across these two assets; do not infer anatomy from body height.
  let landmark = -1, best = Infinity;
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getX(i)) > 1e-6 || genital.getX(i) > .01) continue;
    const error = (uv.getX(i) - .1256) ** 2 + (uv.getY(i) - .5336) ** 2;
    if (error < best) { best = error; landmark = i; }
  }
  if (landmark < 0 || best > 1e-6) throw new Error('Anal surface landmark is unavailable in this body');
  const anchor = [position.getX(landmark), position.getY(landmark), position.getZ(landmark)];
  const n = new THREE.Vector3(0, normal.getY(landmark), normal.getZ(landmark)).normalize().toArray();
  const frame = { anchor, normal: n, tangent: [0, -n[2], n[1]] };
  refine(geometry, anchor);
  const p = geometry.attributes.position.array, weld = geometry.attributes._weld_index.array;
  const mask = new Float32Array(p.length / 3), patch = [], seen = new Set();
  for (let i = 0; i < mask.length; i++) {
    const point = Array.from(p.slice(i * 3, i * 3 + 3)), f = analField(point, frame);
    // Exclude adjacent inner-thigh or genital surfaces that project onto the disk.
    if (Math.abs(dot(point.map((v, k) => v - anchor[k]), n)) > .009 || geometry.attributes._genital_weight.getX(i) > .01) continue;
    mask[i] = f.weight;
    if (!f.weight) continue;
    for (let k = 0; k < 3; k++) p[i * 3 + k] += n[k] * f.depth;
    if (!seen.has(weld[i])) { seen.add(weld[i]); patch.push({ id: i, point: Array.from(p.slice(i * 3, i * 3 + 3)), ...f }); }
  }
  geometry.setAttribute('_anal_weight', new THREE.BufferAttribute(mask, 1));
  // A small local cage follows the refined surface. Sample actual welded
  // vertices so the cage and rendered surface have the same resting shape.
  const sampleIds = new Set();
  for (const radius of [0, .006, .013, .019]) for (let k = 0; k < (radius ? 8 : 1); k++) {
    const u = radius * Math.cos(k * Math.PI / 4), v = radius * Math.sin(k * Math.PI / 4);
    const nearest = patch.reduce((a, b) => (a.u - u) ** 2 + (a.v - v) ** 2 < (b.u - u) ** 2 + (b.v - v) ** 2 ? a : b);
    sampleIds.add(nearest.id);
  }
  const data = { ...source, analFrame: frame, positions: [...source.positions], normals: [...source.normals], edges: [...source.edges], regions: [...source.regions], genitalWeights: [...source.genitalWeights], analWeights: new Array(source.regions.length).fill(0), regionNames: [...source.regionNames] };
  data.regionNames[ANAL_REGION] = 'Anus / perianal tissue';
  // Fill names reserved for runtime-derived regions; TissueSystem supplies them.
  for (let i = 9; i < ANAL_REGION; i++) data.regionNames[i] = '';
  const oldCount = source.regions.length, samples = [];
  for (const vertex of sampleIds) {
    const point = Array.from(p.slice(vertex * 3, vertex * 3 + 3));
    samples.push({ vertex, point, id: data.regions.length });
    data.positions.push(...point); data.normals.push(...n); data.regions.push(ANAL_REGION); data.genitalWeights.push(0); data.analWeights.push(mask[vertex]);
  }
  const edgeSet = new Set();
  const addEdge = (a, b) => { const key = edgeKey(a, b); if (!edgeSet.has(key)) { data.edges.push(a, b); edgeSet.add(key); } };
  for (const a of samples) {
    const nearby = samples.filter(b => b !== a).sort((b, c) => Math.hypot(...a.point.map((v, k) => v - b.point[k])) - Math.hypot(...a.point.map((v, k) => v - c.point[k])));
    for (const b of nearby.slice(0, 4)) addEdge(a.id, b.id);
    if (data.analWeights[a.id] < .2) {
      let closest = -1, distance = Infinity;
      for (let b = 0; b < oldCount; b++) {
        if (![3, 5].includes(source.regions[b]) || source.positions[b * 3] * a.point[0] < 0) continue;
        const d = Math.hypot(...a.point.map((v, k) => v - source.positions[b * 3 + k]));
        if (d < distance) { closest = b; distance = d; }
      }
      if (closest >= 0) addEdge(a.id, closest);
    }
  }
  const ids = geometry.attributes._cage_index.array, weights = geometry.attributes._cage_weight.array;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const point = Array.from(p.slice(i * 3, i * 3 + 3));
    const nearest = samples.map(s => ({ ...s, distance: Math.hypot(...point.map((v, k) => v - s.point[k])) })).sort((a, b) => a.distance - b.distance).slice(0, 3);
    let old = 0; for (let k = 1; k < 4; k++) if (weights[i * 4 + k] > weights[i * 4 + old]) old = k;
    const oldId = ids[i * 4 + old], sum = nearest.reduce((s, a) => s + 1 / Math.max(.001, a.distance) ** 3, 0);
    for (let k = 0; k < 3; k++) { ids[i * 4 + k] = nearest[k].id; weights[i * 4 + k] = mask[i] / (Math.max(.001, nearest[k].distance) ** 3 * sum); }
    ids[i * 4 + 3] = oldId; weights[i * 4 + 3] = 1 - mask[i];
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return data;
}
