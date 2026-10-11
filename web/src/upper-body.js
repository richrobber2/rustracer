// Region and bridge approximations for the supplied, fixed-pose adult cages.
// +Z faces forward; +X appears on the left when viewed from behind.
export function isSideRegion(region) { return region === 2 || region === 3 || region === 4 || (region >= 9 && region <= 15); }
// Cage samples on the centre line belong to neither side: 0, otherwise ±1.
export const sideOf = x => Math.abs(x) < 1e-6 ? 0 : Math.sign(x);

export function upperRegion(original, x, y, z, normalZ, height) {
  const lateral = Math.abs(x) / height, level = y / height;
  if ((original === 0 || original === 1 || original === 4) && level >= .73 && level <= .815 && lateral >= .07 && lateral <= .175) return 12;
  if (original === 1 && z < 0 && normalZ < -.2) return 11;
  // Feet remain region 7; the existing distal-arm samples become hands/wrists.
  if (original === 7 && level > .4) return 13;
  return original;
}

const GROUPS = [
  { parameter: 'upperCoupling', pairs: [[10, 11]], reach: .16 },
  { parameter: 'shoulderCoupling', pairs: [[11, 12], [12, 4]], reach: .20 },
  { parameter: 'handCoupling', pairs: [[4, 13]], reach: .22 },
];
export function upperBoundary(a, b) {
  return GROUPS.some(g => g.pairs.some(([ra, rb]) => (a === ra && b === rb) || (a === rb && b === ra)));
}

export function buildUpperLinks(system, height) {
  return buildRegionalLinks(system, height, GROUPS);
}

export function buildRegionalLinks(system, height, groups) {
  const { regions, rest, edges, count } = system;
  return groups.map(group => {
    const pairs = new Map(), degree = new Uint16Array(count);
    const add = (a, b) => {
      if (rest[a * 3] * rest[b * 3] <= 0) return;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (pairs.has(key)) return;
      pairs.set(key, [a, b]); degree[a]++; degree[b]++;
    };
    for (const [ra, rb] of group.pairs) {
      const aIds = Array.from(regions.keys()).filter(i => regions[i] === ra);
      const bIds = Array.from(regions.keys()).filter(i => regions[i] === rb);
      // Retain real boundary edges, then add sparse bridges in both directions
      // so isolated patches can take part. This is a lumped surface load path,
      // not a reconstruction of articulated joints or muscle/tendon fibers.
      for (let e = 0; e < edges.length; e += 2) {
        const a = edges[e], b = edges[e + 1];
        if ((regions[a] === ra && regions[b] === rb) || (regions[a] === rb && regions[b] === ra)) add(a, b);
      }
      for (const [sources, targets] of [[aIds, bIds], [bIds, aIds]]) for (const a of sources) {
        const nearby = targets.filter(b => rest[a * 3] * rest[b * 3] > 0).map(b => ({ b,
          distance: Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2])
        })).filter(p => p.distance <= height * group.reach).sort((a, b) => a.distance - b.distance);
        for (const { b } of nearby.slice(0, 2)) add(a, b);
      }
    }
    return { parameter: group.parameter, ids: Uint32Array.from([...pairs.values()].flat()),
      factors: Float32Array.from(pairs.values(), ([a, b]) => 1 / Math.sqrt(degree[a] * degree[b])) };
  });
}
