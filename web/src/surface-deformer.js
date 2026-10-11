// Update only vertices driven by changed cage particles, and only adjacent face normals.
// Welding makes UV seam duplicates share the same position and area-weighted normal.
function adjacency(count, links) {
  const starts = new Uint32Array(count + 1);
  for (const [a] of links) starts[a + 1]++;
  for (let i = 1; i <= count; i++) starts[i] += starts[i - 1];
  const items = new Uint32Array(links.length), cursor = starts.slice();
  for (const [a, b] of links) items[cursor[a]++] = b;
  return { starts, items };
}
export class SurfaceDeformer {
  constructor(geometry, particleCount) {
    this.geometry = geometry;
    const a = geometry.attributes;
    this.weld = a._weld_index.array;
    this.count = this.weld.reduce((max, n) => Math.max(max, n + 1), 0);
    this.first = new Uint32Array(this.count).fill(0xffffffff);
    const renderLinks = [];
    for (let i = 0; i < this.weld.length; i++) { this.first[this.weld[i]] = i; renderLinks.push([this.weld[i], i]); }
    this.render = adjacency(this.count, renderLinks);
    this.rest = a.position.array.slice();
    this.position = new Float32Array(this.count * 3);
    this.sum = new Float32Array(this.position.length);
    this.ids = a._cage_index.array; this.weights = a._cage_weight.array;
    this.previous = new Float32Array(particleCount * 3).fill(NaN);
    this.faces = Uint32Array.from(geometry.index.array, i => this.weld[i]);
    this.cross = new Float32Array(this.faces.length);
    const faceLinks = [], cageLinks = [];
    for (let i = 0; i < this.faces.length; i++) faceLinks.push([this.faces[i], Math.floor(i / 3)]);
    for (let c = 0; c < this.count; c++) {
      const at = this.first[c] * 4;
      for (let k = 0; k < 4; k++) if (this.weights[at + k] > 0) cageLinks.push([this.ids[at + k], c]);
    }
    this.neighbors = adjacency(this.count, faceLinks); this.particles = adjacency(particleCount, cageLinks);
    this.vertexMarks = new Uint8Array(this.count); this.faceMarks = new Uint8Array(this.faces.length / 3);
    this.normalMarks = new Uint8Array(this.count);
    this.vertexQueue = []; this.faceQueue = []; this.normalQueue = [];
    this.lastUpdatedVertices = 0; this.allNormalsDirty = false; this.changedParticles = [];
  }
  get normalsPending() { return this.allNormalsDirty || this.faceQueue.length > 0; }
  setRest(positions) { this.rest.set(positions); this.previous.fill(NaN); }
  update(offset, { normals = false, heat = false, force = false } = {}) {
    const { geometry, particles, previous, vertexQueue, vertexMarks, first, ids, weights, rest, position, render, neighbors } = this;
    for (let p = 0; p < offset.length / 3; p++) {
      const j = p * 3;
      if (!force && Math.abs(offset[j] - previous[j]) < 1e-7 && Math.abs(offset[j + 1] - previous[j + 1]) < 1e-7 && Math.abs(offset[j + 2] - previous[j + 2]) < 1e-7) continue;
      previous[j] = offset[j]; previous[j + 1] = offset[j + 1]; previous[j + 2] = offset[j + 2];
      this.changedParticles.push(p);
    }
    if (force || this.changedParticles.length > offset.length / 15) {
      this.changedParticles.length = 0;
      return this.updateFull(offset, normals, heat);
    }
    for (const p of this.changedParticles) {
      for (let k = particles.starts[p]; k < particles.starts[p + 1]; k++) {
        const c = particles.items[k]; if (!vertexMarks[c]) { vertexMarks[c] = 1; vertexQueue.push(c); }
      }
    }
    this.changedParticles.length = 0;
    const out = geometry.attributes.position.array, colors = geometry.attributes.color?.array;
    for (const c of vertexQueue) {
      const v = first[c], at = v * 4, j = c * 3, r = v * 3;
      let dx = 0, dy = 0, dz = 0;
      for (let k = 0; k < 4; k++) { const p = ids[at + k] * 3, w = weights[at + k]; dx += offset[p] * w; dy += offset[p + 1] * w; dz += offset[p + 2] * w; }
      position[j] = rest[r] + dx; position[j + 1] = rest[r + 1] + dy; position[j + 2] = rest[r + 2] + dz;
      const t = heat ? Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / .05) : 0;
      for (let k = render.starts[c]; k < render.starts[c + 1]; k++) {
        const i = render.items[k] * 3;
        out[i] = position[j]; out[i + 1] = position[j + 1]; out[i + 2] = position[j + 2];
        if (heat && colors) { colors[i] = Math.min(1, t * 2); colors[i + 1] = .35 + .55 * (1 - Math.abs(t * 2 - 1)); colors[i + 2] = 1 - t; }
      }
      if (!this.allNormalsDirty) for (let k = neighbors.starts[c]; k < neighbors.starts[c + 1]; k++) {
        const f = neighbors.items[k]; if (!this.faceMarks[f]) { this.faceMarks[f] = 1; this.faceQueue.push(f); }
      }
      vertexMarks[c] = 0;
    }
    this.lastUpdatedVertices = vertexQueue.length;
    if (vertexQueue.length) {
      geometry.attributes.position.needsUpdate = true;
      if (heat && colors) geometry.attributes.color.needsUpdate = true;
    }
    vertexQueue.length = 0;
    if (normals && this.normalsPending) this.updateNormals();
    return this.lastUpdatedVertices > 0;
  }
  updateFull(offset, normals, heat) {
    const { first, ids, weights, rest, position: p, geometry, weld } = this;
    const out = geometry.attributes.position.array, colors = geometry.attributes.color?.array;
    for (let c = 0; c < this.count; c++) {
      const v = first[c], at = v * 4, j = c * 3, r = v * 3;
      let dx = 0, dy = 0, dz = 0;
      for (let k = 0; k < 4; k++) { const id = ids[at + k] * 3, w = weights[at + k]; dx += offset[id] * w; dy += offset[id + 1] * w; dz += offset[id + 2] * w; }
      p[j] = rest[r] + dx; p[j + 1] = rest[r + 1] + dy; p[j + 2] = rest[r + 2] + dz;
    }
    for (let v = 0; v < weld.length; v++) {
      const j = v * 3, c = weld[v] * 3;
      out[j] = p[c]; out[j + 1] = p[c + 1]; out[j + 2] = p[c + 2];
      if (heat && colors) {
        const dx = out[j] - rest[j], dy = out[j + 1] - rest[j + 1], dz = out[j + 2] - rest[j + 2];
        const t = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / .05);
        colors[j] = Math.min(1, t * 2); colors[j + 1] = .35 + .55 * (1 - Math.abs(t * 2 - 1)); colors[j + 2] = 1 - t;
      }
    }
    this.allNormalsDirty = true;
    geometry.attributes.position.needsUpdate = true;
    if (heat && colors) geometry.attributes.color.needsUpdate = true;
    this.lastUpdatedVertices = this.count;
    if (normals) this.updateNormals();
    return true;
  }
  rebuildNormals() {
    const { faces, position: p, cross, sum, geometry, weld } = this;
    sum.fill(0);
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
      const ax = p[c] - p[b], ay = p[c + 1] - p[b + 1], az = p[c + 2] - p[b + 2];
      const bx = p[a] - p[b], by = p[a + 1] - p[b + 1], bz = p[a + 2] - p[b + 2];
      const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
      cross[f] = x; cross[f + 1] = y; cross[f + 2] = z;
      sum[a] += x; sum[a + 1] += y; sum[a + 2] += z;
      sum[b] += x; sum[b + 1] += y; sum[b + 2] += z;
      sum[c] += x; sum[c + 1] += y; sum[c + 2] += z;
    }
    const out = geometry.attributes.normal.array;
    // Cache normalized values once per canonical vertex; keep sum unnormalized for incremental updates.
    const normalized = this.normalized || (this.normalized = new Float32Array(sum.length));
    for (let c = 0; c < sum.length; c += 3) {
      const length = Math.sqrt(sum[c] ** 2 + sum[c + 1] ** 2 + sum[c + 2] ** 2) || 1;
      normalized[c] = sum[c] / length; normalized[c + 1] = sum[c + 1] / length; normalized[c + 2] = sum[c + 2] / length;
    }
    for (let v = 0; v < weld.length; v++) {
      const j = v * 3, c = weld[v] * 3;
      out[j] = normalized[c]; out[j + 1] = normalized[c + 1]; out[j + 2] = normalized[c + 2];
    }
    geometry.attributes.normal.needsUpdate = true;
    this.allNormalsDirty = false; this.faceQueue.length = 0; this.faceMarks.fill(0);
  }
  updateNormals() {
    if (this.allNormalsDirty) { this.rebuildNormals(); return; }
    const { faces, position: p, cross, sum, faceQueue, faceMarks, normalMarks, normalQueue, render } = this;
    for (const face of faceQueue) {
      const f = face * 3, a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
      const ax = p[c] - p[b], ay = p[c + 1] - p[b + 1], az = p[c + 2] - p[b + 2];
      const bx = p[a] - p[b], by = p[a + 1] - p[b + 1], bz = p[a + 2] - p[b + 2];
      const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
      const dx = x - cross[f], dy = y - cross[f + 1], dz = z - cross[f + 2];
      cross[f] = x; cross[f + 1] = y; cross[f + 2] = z;
      for (let k = 0; k < 3; k++) {
        const v = faces[f + k], j = v * 3;
        sum[j] += dx; sum[j + 1] += dy; sum[j + 2] += dz;
        if (!normalMarks[v]) { normalMarks[v] = 1; normalQueue.push(v); }
      }
      faceMarks[face] = 0;
    }
    const out = this.geometry.attributes.normal.array;
    for (const v of normalQueue) {
      const j = v * 3, length = Math.sqrt(sum[j] ** 2 + sum[j + 1] ** 2 + sum[j + 2] ** 2) || 1;
      for (let k = render.starts[v]; k < render.starts[v + 1]; k++) {
        const i = render.items[k] * 3; out[i] = sum[j] / length; out[i + 1] = sum[j + 1] / length; out[i + 2] = sum[j + 2] / length;
      }
      normalMarks[v] = 0;
    }
    this.geometry.attributes.normal.needsUpdate = true;
    faceQueue.length = 0; normalQueue.length = 0;
  }
}
