import { isSideRegion } from './upper-body.js';
import { regionMatches } from './abdomen.js';

export function eligibleGrabAnchor(system, id) {
  if (!Number.isInteger(id) || id < 0 || id >= system.count) return false;
  const { region, buttSide } = system.parameters, actual = system.regions[id];
  if (!regionMatches(region, actual)) return false;
  if (isSideRegion(actual)) {
    const side = Math.sign(system.rest[id * 3]);
    if (buttSide !== 2 && (side === 0 || (buttSide !== 0 && side !== buttSide))) return false;
  }
  return true;
}

export function surfaceGrabAnchor(system, geometry, face, barycentric, point) {
  // Pick only from the cage samples that actually drive the hit triangle.
  // Current displacement participates in the distance check, just as in the map.
  const ids = geometry.attributes._cage_index.array, weights = geometry.attributes._cage_weight.array;
  const candidates = new Map(), vertices = [face.a, face.b, face.c];
  for (let vertex = 0; vertex < 3; vertex++) for (let k = 0; k < 4; k++) {
    const at = vertices[vertex] * 4 + k, weight = weights[at] * Math.max(0, barycentric[vertex]);
    if (weight > 1e-8) candidates.set(ids[at], (candidates.get(ids[at]) || 0) + weight);
  }
  let nearest = -1, score = Infinity;
  for (const [id, weight] of candidates) {
    if (!eligibleGrabAnchor(system, id)) continue;
    const j = id * 3;
    const distance = (system.rest[j] + system.offset[j] - point[0]) ** 2 + (system.rest[j + 1] + system.offset[j + 1] - point[1]) ** 2 + (system.rest[j + 2] + system.offset[j + 2] - point[2]) ** 2;
    const candidateScore = distance / (.25 + weight);
    if (candidateScore < score) { nearest = id; score = candidateScore; }
  }
  return nearest;
}
