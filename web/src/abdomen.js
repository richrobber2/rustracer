import { buildRegionalLinks } from './upper-body.js';

// Surface regions on the adult rest cages, not segmented internal muscles.
// The old abdomen selector (2) continues to select both new response regions.
export function regionMatches(selected, actual) {
  return selected < 0 || selected === actual || (selected === 2 && (actual === 14 || actual === 15));
}
export function abdominalRegion(original, x, y, z, normalZ, height) {
  const central = Math.abs(x) / height <= .045;
  if (original === 2) return central && z > 0 && normalZ > .2 ? 14 : 15;
  // Extend the central strip to the lower abdominal samples above the pelvis.
  if (original === 3 && central && y / height >= .50 && z > 0 && normalZ > .2) return 14;
  return original;
}

const GROUPS = [
  { parameter: 'absCoupling', pairs: [[14, 15]], reach: .13 },
  { parameter: 'coreCoupling', pairs: [[15, 10], [14, 3], [15, 3]], reach: .16 },
];
export function abdominalBoundary(a, b) {
  return GROUPS.some(g => g.pairs.some(([ra, rb]) => (a === ra && b === rb) || (a === rb && b === ra)));
}
export function buildAbdominalLinks(system, height) {
  // Reciprocal, same-side passive load paths through the abdominal surface.
  // Obliques lump EO/IO; bracing does not create a separate transversus layer.
  return buildRegionalLinks(system, height, GROUPS);
}
