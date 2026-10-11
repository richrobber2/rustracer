import * as THREE from 'three';

// Geometry helpers for checking how the mannequin's skin deforms over its skeleton. The body is a
// union of closed shells (one per segment and ball joint) that overlap at the joints, so "under the
// skin" means inside at least one shell, and skin thickness is measured to the outer surface only.

// No limb is thicker than this, so the visible surface is always closer to a bone.
const NEAR = 0.25 ** 2;

export function skinProbe(mesh) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index.array;
  const rest = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));

  // Shells are connected components. Lathe seams duplicate vertices, so join by rest position too.
  const parent = rest.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const join = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < index.length; i += 3) { join(index[i], index[i + 1]); join(index[i], index[i + 2]); }
  const byPosition = new Map();
  rest.forEach((v, i) => {
    const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
    if (byPosition.has(key)) join(i, byPosition.get(key)); else byPosition.set(key, i);
  });
  // Material group 1 is the soft body; group 0 holds the rigid ball joints.
  const body = geometry.groups.find((group) => group.materialIndex === 1);
  const shellOf = new Map();
  const shells = [];
  for (let i = 0; i < index.length; i += 3) {
    const root = find(index[i]);
    if (!shellOf.has(root)) {
      shellOf.set(root, shells.length);
      shells.push({ triangles: [], vertices: new Set(), soft: i >= body.start && i < body.start + body.count });
    }
    const shell = shells[shellOf.get(root)];
    shell.triangles.push(index[i], index[i + 1], index[i + 2]);
    shell.vertices.add(index[i]).add(index[i + 1]).add(index[i + 2]);
  }
  const vertexShell = new Int32Array(rest.length);
  shells.forEach((shell, s) => shell.vertices.forEach((v) => { vertexShell[v] = s; }));

  function pose() {
    mesh.updateMatrixWorld(true);
    const points = rest.map((v, i) => mesh.applyBoneTransform(i, v.clone()));
    const boxes = shells.map((shell) => {
      const box = new THREE.Box3();
      shell.vertices.forEach((v) => box.expandByPoint(points[v]));
      return box;
    });
    return { points, boxes };
  }

  const ray = new THREE.Vector3(0.5773, 0.5774, 0.5775).normalize();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), h = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Vector3();
  // Ray-crossing parity against one closed shell.
  function insideShell(posed, shellIndex, p) {
    if (!posed.boxes[shellIndex].containsPoint(p)) return false;
    const { triangles } = shells[shellIndex];
    const pts = posed.points;
    let crossings = 0;
    for (let t = 0; t < triangles.length; t += 3) {
      const a = pts[triangles[t]], b = pts[triangles[t + 1]], c = pts[triangles[t + 2]];
      e1.subVectors(b, a); e2.subVectors(c, a); h.crossVectors(ray, e2);
      const det = e1.dot(h);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      s.subVectors(p, a);
      const u = s.dot(h) * inv;
      if (u < 0 || u > 1) continue;
      q.crossVectors(s, e1);
      const v = ray.dot(q) * inv;
      if (v < 0 || u + v > 1) continue;
      if (e2.dot(q) * inv > 1e-9) crossings++;
    }
    return crossings % 2 === 1;
  }
  const inside = (posed, p, except = -1, softOnly = false) =>
    shells.some((shell, i) => i !== except && (!softOnly || shell.soft) && insideShell(posed, i, p));

  // Points along every bone, from its joint to each child joint.
  function bonePoints(samples = 8) {
    const out = [];
    for (const bone of mesh.skeleton.bones) {
      for (const child of bone.children) {
        if (!child.isBone || child.name.endsWith('_half')) continue;
        const a = bone.getWorldPosition(new THREE.Vector3()), b = child.getWorldPosition(new THREE.Vector3());
        for (let k = 0; k <= samples; k++) out.push({ bone: `${bone.name}→${child.name}`, point: a.clone().lerp(b, k / samples) });
      }
    }
    return out;
  }

  // How deep each bone sample lies beneath the visible skin: the distance to the nearest vertex
  // that is not buried inside another shell in this pose. Negative when the bone is exposed.
  // With softOnly, the ball joints are ignored so the result reflects the deforming skin alone.
  function boneDepths({ softOnly = false } = {}) {
    const posed = pose();
    const buried = new Map();
    const isBuried = (i) => {
      if (!buried.has(i)) buried.set(i, inside(posed, posed.points[i], vertexShell[i], softOnly));
      return buried.get(i);
    };
    const candidates = posed.points.map((_, i) => i).filter((i) => !softOnly || shells[vertexShell[i]].soft);
    return bonePoints().map(({ bone, point }) => {
      const order = [];
      for (const i of candidates) {
        const d = posed.points[i].distanceToSquared(point);
        if (d < NEAR) order.push([d, i]);
      }
      order.sort((a, b) => a[0] - b[0]);
      const nearest = order.find(([, i]) => !isBuried(i));
      const depth = nearest ? Math.sqrt(nearest[0]) : Math.sqrt(NEAR);
      return { bone, depth: inside(posed, point, -1, softOnly) ? depth : -depth };
    });
  }

  // A bone's joint position in the bind pose.
  const restJoint = (bone) => {
    const k = mesh.skeleton.bones.findIndex((b) => b.name === bone);
    return new THREE.Vector3().applyMatrix4(mesh.skeleton.boneInverses[k].clone().invert());
  };

  return { rest, shells, pose, inside, boneDepths, restJoint };
}
