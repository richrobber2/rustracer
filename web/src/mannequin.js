import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A procedural, skinned studio mannequin. The whole body is one SkinnedMesh driven by a single
// bone hierarchy: vertices near a joint are shared between the bones on either side of it, so
// limbs bend continuously instead of moving as separate rigid pieces, and every pose is produced
// by parents carrying their children. The clips derive all limbs from one shared phase, so arms,
// legs, hips and spine stay coordinated (opposite arm and leg swing together, the chest counter-
// rotates against the hips and the head stabilises against both).

const BASE = 0.32; // Top of the studio pedestal.

// name, parent, bind-pose world position (y is relative to BASE), blend radius at this joint.
const BONES = [
  ['hips', null, [0, 0.95, 0], 0.09],
  ['spine', 'hips', [0, 1.12, 0], 0.07],
  ['chest', 'spine', [0, 1.3, 0], 0.07],
  ['neck', 'chest', [0, 1.5, 0], 0.035],
  ['head', 'neck', [0, 1.6, 0], 0.035],
];
for (const [side, x] of [['L', 1], ['R', -1]]) {
  BONES.push(
    [`shoulder_${side}`, 'chest', [0.05 * x, 1.45, 0], 0.04],
    [`upperArm_${side}`, `shoulder_${side}`, [0.19 * x, 1.44, 0], 0.055],
    [`forearm_${side}`, `upperArm_${side}`, [0.25 * x, 1.17, -0.01], 0.045],
    [`hand_${side}`, `forearm_${side}`, [0.29 * x, 0.93, 0.02], 0.03],
    [`thigh_${side}`, 'hips', [0.1 * x, 0.92, 0], 0.08],
    [`shin_${side}`, `thigh_${side}`, [0.1 * x, 0.5, 0.01], 0.06],
    [`foot_${side}`, `shin_${side}`, [0.1 * x, 0.08, 0], 0.045],
  );
}

const v3 = (p) => new THREE.Vector3(p[0], p[1] + BASE, p[2]);
const joint = Object.fromEntries(BONES.map(([name, , position, blend]) => [name, { position: v3(position), blend }]));

// Body segments: from, to, start radius, end radius, owning bone, bone blended in at each end.
function segments() {
  const list = [
    { from: [0, 0.86, 0], to: [0, 1.06, 0], r: [0.13, 0.12], bone: 'hips', end: 'spine', scale: [1.35, 0.85] },
    { from: [0, 1.1, 0], to: [0, 1.26, 0], r: [0.105, 0.11], bone: 'spine', start: 'hips', end: 'chest', scale: [1.25, 0.78] },
    { from: [0, 1.3, 0], to: [0, 1.42, 0], r: [0.14, 0.12], bone: 'chest', start: 'spine', scale: [1.4, 0.78] },
    { from: [0, 1.48, 0], to: [0, 1.6, 0], r: [0.045, 0.04], bone: 'neck', start: 'chest', end: 'head' },
    { from: [0, 1.67, 0.005], to: [0, 1.73, 0], r: [0.085, 0.095], bone: 'head', start: 'neck', scale: [0.92, 1.02] },
  ];
  for (const [side, x] of [['L', 1], ['R', -1]]) {
    const p = (name) => BONES.find((b) => b[0] === `${name}_${side}`)[2];
    list.push(
      { from: p('shoulder'), to: p('upperArm'), r: [0.05, 0.05], bone: `shoulder_${side}`, start: 'chest', end: `upperArm_${side}` },
      { from: p('upperArm'), to: p('forearm'), r: [0.05, 0.042], bone: `upperArm_${side}`, start: `shoulder_${side}`, end: `forearm_${side}` },
      { from: p('forearm'), to: p('hand'), r: [0.04, 0.03], bone: `forearm_${side}`, start: `upperArm_${side}`, end: `hand_${side}` },
      { from: p('hand'), to: [0.305 * x, 0.84, 0.03], r: [0.03, 0.026], bone: `hand_${side}`, start: `forearm_${side}`, scale: [0.7, 1.2] },
      { from: p('thigh'), to: p('shin'), r: [0.075, 0.052], bone: `thigh_${side}`, start: 'hips', end: `shin_${side}` },
      { from: p('shin'), to: p('foot'), r: [0.05, 0.036], bone: `shin_${side}`, start: `thigh_${side}`, end: `foot_${side}` },
      { from: [0.1 * x, 0.045, -0.035], to: [0.1 * x, 0.04, 0.15], r: [0.042, 0.036], bone: `foot_${side}`, start: `shin_${side}`, scale: [1.05, 0.85] },
    );
  }
  return list;
}

// A lathed capsule along +Y whose two caps can have different radii.
function taperedCapsule(r0, r1, length) {
  const points = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.max(0, r0 * Math.cos(a)), r0 * Math.sin(a)));
  }
  for (let i = 1; i <= 12; i++) points.push(new THREE.Vector2(THREE.MathUtils.lerp(r0, r1, i / 12), (i / 12) * length));
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.max(0, r1 * Math.cos(a)), length + r1 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(points, 28);
}

function place(geometry, from, to, scale = [1, 1]) {
  const direction = to.clone().sub(from);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(scale[0], 1, scale[1]));
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rotation));
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(from.x, from.y, from.z));
}

function setSkin(geometry, weightsFor) {
  const position = geometry.attributes.position;
  const indices = new Uint16Array(position.count * 4);
  const weights = new Float32Array(position.count * 4);
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const influences = weightsFor(vertex.fromBufferAttribute(position, i)).filter(([, w]) => w > 1e-4).slice(0, 4);
    const total = influences.reduce((sum, [, w]) => sum + w, 0);
    influences.forEach(([bone, w], k) => { indices[i * 4 + k] = bone; weights[i * 4 + k] = w / total; });
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}

function buildBones() {
  const bones = new Map();
  for (const [name, parent] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const local = joint[name].position.clone();
    if (parent) local.sub(joint[parent].position);
    bone.position.copy(local);
    bones.get(parent)?.add(bone);
    bones.set(name, bone);
  }
  return bones;
}

function buildGeometry(boneIndex) {
  const smooth = (edge, x) => THREE.MathUtils.smoothstep(x, -edge, edge);
  const body = segments().map((segment) => {
    const from = v3(segment.from), to = v3(segment.to);
    const geometry = taperedCapsule(segment.r[0], segment.r[1], from.distanceTo(to));
    place(geometry, from, to, segment.scale);
    const axis = to.clone().sub(from).normalize();
    const offset = new THREE.Vector3();
    return setSkin(geometry, (vertex) => {
      // Signed distances along the limb from each joint decide how much of the neighbouring
      // bone a vertex follows. Both sides of a joint use the same blend, so the skin is seamless.
      let parentWeight = 0, childWeight = 0;
      if (segment.start) {
        const j = joint[segment.bone];
        parentWeight = 1 - smooth(j.blend, offset.subVectors(vertex, j.position).dot(axis));
      }
      if (segment.end) {
        const j = joint[segment.end];
        childWeight = smooth(j.blend, offset.subVectors(vertex, j.position).dot(axis));
      }
      return [
        [boneIndex.get(segment.bone), Math.max(0, 1 - parentWeight - childWeight)],
        ...(segment.start ? [[boneIndex.get(segment.start), parentWeight]] : []),
        ...(segment.end ? [[boneIndex.get(segment.end), childWeight]] : []),
      ].sort((a, b) => b[1] - a[1]);
    });
  });
  // Gold ball joints sit at each articulation and follow the bone that rotates there.
  const balls = [
    ['neck', 0.05], ['shoulder_L', 0.058], ['shoulder_R', 0.058], ['upperArm_L', 0.056], ['upperArm_R', 0.056],
    ['forearm_L', 0.047], ['forearm_R', 0.047], ['hand_L', 0.034], ['hand_R', 0.034],
    ['thigh_L', 0.074], ['thigh_R', 0.074], ['shin_L', 0.058], ['shin_R', 0.058], ['foot_L', 0.042], ['foot_R', 0.042],
  ].map(([name, radius]) => {
    const geometry = new THREE.SphereGeometry(radius, 24, 16);
    const p = joint[name].position;
    geometry.translate(p.x, p.y, p.z);
    return setSkin(geometry, () => [[boneIndex.get(name), 1]]);
  });
  return mergeGeometries([mergeGeometries(balls), mergeGeometries(body)], true);
}

// Contact points under each foot, in bind-pose world space.
const SOLE = ['L', 'R'].flatMap((side) => {
  const x = side === 'L' ? 0.1 : -0.1;
  return [[`foot_${side}`, v3([x, 0.004, -0.035])], [`foot_${side}`, v3([x, 0.004, 0.15])]];
});

// Samples a pose function over one loop into keyframe tracks so playback stays seamless. Each
// sample is posed through the real hierarchy so the hips height can be solved from the legs:
// whichever foot is lowest rests on the pedestal, as the body's weight would put it.
function clip(bones, name, duration, pose, frames = 36) {
  const times = [], rotations = new Map(), hips = [];
  const euler = new THREE.Euler(), point = new THREE.Vector3();
  const root = bones.get('hips'), rest = joint.hips.position;
  for (let f = 0; f <= frames; f++) {
    times.push((f / frames) * duration);
    const { rotate, hips: offset = [0, 0, 0] } = pose((f / frames) * Math.PI * 2);
    for (const [name] of BONES) {
      const [x = 0, y = 0, z = 0] = rotate[name] || [];
      bones.get(name).quaternion.setFromEuler(euler.set(x, y, z, 'YXZ'));
      if (!rotations.has(name)) rotations.set(name, []);
      rotations.get(name).push(...bones.get(name).quaternion.toArray());
    }
    root.position.set(rest.x + offset[0], rest.y, rest.z + offset[2]);
    root.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const [name, sole] of SOLE) {
      point.subVectors(sole, joint[name].position).applyMatrix4(bones.get(name).matrixWorld);
      lowest = Math.min(lowest, point.y);
    }
    hips.push(root.position.x, root.position.y + SOLE[0][1].y - lowest, root.position.z);
  }
  for (const [name] of BONES) bones.get(name).quaternion.identity();
  root.position.copy(rest);
  root.updateMatrixWorld(true);
  const tracks = [...rotations].map(([bone, values]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, hips));
  return new THREE.AnimationClip(name, duration, tracks);
}

// Rest offsets that let the arms hang naturally beside the torso.
const ARMS_DOWN = { L: 0.06, R: -0.06 };

function walk(p) {
  const rotate = {};
  for (const [side, phase] of [['L', p], ['R', p + Math.PI]]) {
    const swing = Math.sin(phase);
    const thigh = -0.42 * swing; // Negative pitches the leg forward.
    const knee = 0.08 + 0.72 * Math.max(0, Math.cos(phase)) ** 1.6; // Knee flexes as the leg swings through.
    rotate[`thigh_${side}`] = [thigh, 0, 0];
    rotate[`shin_${side}`] = [knee, 0, 0];
    rotate[`foot_${side}`] = [-(thigh + knee) * 0.7 + 0.08 * Math.max(0, -swing), 0, 0];
    // Each arm swings with the opposite leg.
    const arm = 0.34 * swing;
    rotate[`upperArm_${side}`] = [arm, 0, ARMS_DOWN[side]];
    rotate[`forearm_${side}`] = [-(0.28 + 0.3 * Math.max(0, -swing)), 0, 0];
    rotate[`hand_${side}`] = [-0.1, 0, 0];
    rotate[`shoulder_${side}`] = [0, 0, (side === 'L' ? 1 : -1) * 0.03 * Math.cos(phase)];
  }
  const twist = 0.1 * Math.sin(p);
  rotate.hips = [0.04, twist, 0.05 * Math.sin(p)];
  rotate.spine = [-0.02, -0.7 * twist, -0.03 * Math.sin(p)];
  rotate.chest = [0.02 * Math.cos(2 * p), -0.9 * twist, -0.02 * Math.sin(p)];
  // The head cancels the accumulated torso twist and roll so the gaze stays forward.
  rotate.neck = [-0.02, 0.6 * twist, 0];
  rotate.head = [-0.03 - 0.02 * Math.cos(2 * p), 0.4 * twist, 0];
  return { rotate, hips: [0.018 * Math.sin(p), 0, 0] };
}

function wave(p) {
  const rotate = {};
  const shift = 0.025;
  rotate.hips = [0, 0.05, 0.04];
  rotate.spine = [0, -0.02, -0.03];
  rotate.chest = [0.02 * Math.sin(2 * p), -0.06, -0.05];
  rotate.neck = [0, -0.12, 0.05];
  rotate.head = [0.06, -0.18, 0.12 + 0.03 * Math.sin(p)];
  rotate.shoulder_R = [0, 0, -0.16];
  rotate.upperArm_R = [-0.25, 0, -2.25];
  // The forearm sweeps side to side while the hand trails it slightly.
  rotate.forearm_R = [-0.5, 0, -0.45 + 0.5 * Math.sin(2 * p)];
  rotate.hand_R = [0, 0, 0.22 * Math.sin(2 * p - 0.6)];
  rotate.upperArm_L = [0.05, 0, ARMS_DOWN.L + 0.04];
  rotate.forearm_L = [-0.2, 0, 0];
  rotate.thigh_L = [0.02, 0, -0.04];
  rotate.thigh_R = [-0.06, 0.12, 0.07];
  rotate.shin_R = [0.14, 0, 0];
  rotate.foot_R = [-0.08, 0, -0.04];
  rotate.foot_L = [-0.02, 0, 0.04];
  return { rotate, hips: [shift, 0, 0] };
}

function idle(p) {
  const breath = Math.sin(p * 2);
  const sway = Math.sin(p);
  const rotate = {
    hips: [0, 0.03 * sway, 0.025 * sway],
    spine: [-0.015 * breath, -0.02 * sway, -0.015 * sway],
    chest: [-0.025 * breath, -0.02 * sway, -0.01 * sway],
    neck: [0.01 * breath, 0.15 * Math.sin(p + 0.8), 0],
    head: [0.03, 0.22 * Math.sin(p + 0.8), 0.02 * sway],
  };
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    rotate[`shoulder_${side}`] = [0, 0, s * 0.02 * breath];
    rotate[`upperArm_${side}`] = [0.04 * Math.sin(p + s), 0, ARMS_DOWN[side] - s * 0.02 * breath];
    rotate[`forearm_${side}`] = [-0.18, 0, 0];
    rotate[`thigh_${side}`] = [0, 0, -0.025 * sway];
    rotate[`foot_${side}`] = [0, 0, 0.025 * sway];
  }
  return { rotate, hips: [0.02 * sway, 0, 0] };
}

export function createMannequin(materials) {
  const bones = buildBones();
  const ordered = [...bones.values()];
  const boneIndex = new Map(ordered.map((bone, i) => [bone.name, i]));
  const mesh = new THREE.SkinnedMesh(buildGeometry(boneIndex), materials);
  mesh.name = 'Mannequin';
  mesh.add(bones.get('hips'));
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(ordered));
  // Skinned bounds move with the pose; culling against the bind pose could clip raised arms.
  mesh.frustumCulled = false;
  const clips = [clip(bones, 'Walk cycle', 1.15, walk), clip(bones, 'Wave', 1.6, wave), clip(bones, 'Idle', 4, idle, 48)];
  return { mesh, clips };
}
