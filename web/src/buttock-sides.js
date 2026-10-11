import { isSideRegion } from './upper-body.js';
// Keep connected back, shoulder, arm and hand skin on its own side.
// The fixed skeleton remains shared. UV duplicates receive identical weights.
export function isolateButtockWeights(geometry, system) {
  const { position, _cage_index: ids, _cage_weight: weights } = geometry.attributes;
  let changed = 0;
  for (let v = 0; v < position.count; v++) {
    const j = v * 3, at = v * 4, x = position.array[j];
    if (Math.abs(x) < 1e-6) continue;
    let posteriorRegion = -1;
    for (let k = 0; k < 4; k++) {
      const region = system.regions[ids.array[at + k]];
      if (isSideRegion(region)) posteriorRegion = region;
    }
    if (posteriorRegion < 0) continue;
    let sum = 0;
    for (let k = 0; k < 4; k++) if (system.rest[ids.array[at + k] * 3] * x > 0) sum += weights.array[at + k];
    if (sum <= 1e-8) {
      let nearest = -1, distance = Infinity;
      for (let i = 0; i < system.count; i++) if (system.regions[i] === posteriorRegion && system.rest[i * 3] * x > 0) {
        const d = (system.rest[i * 3] - x) ** 2 + (system.rest[i * 3 + 1] - position.array[j + 1]) ** 2 + (system.rest[i * 3 + 2] - position.array[j + 2]) ** 2;
        if (d < distance) { nearest = i; distance = d; }
      }
      if (nearest >= 0) for (let k = 0; k < 4; k++) { ids.array[at + k] = nearest; weights.array[at + k] = k === 0 ? 1 : 0; }
    } else {
      for (let k = 0; k < 4; k++) weights.array[at + k] = system.rest[ids.array[at + k] * 3] * x > 0 ? weights.array[at + k] / sum : 0;
    }
    changed++;
  }
  ids.needsUpdate = true; weights.needsUpdate = true;
  return changed;
}
