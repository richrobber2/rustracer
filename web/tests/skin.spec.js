import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { createMannequin } from '../src/mannequin.js';
import { skinProbe } from './support/skin.js';

// Skin deformation checks for the demo mannequin. These run in Node against the same skinning
// maths the renderer and path tracer use (SkinnedMesh.applyBoneTransform), so no browser is needed.

function rig() {
  const { mesh, clips } = createMannequin([new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
  const bones = Object.fromEntries(mesh.skeleton.bones.map((bone) => [bone.name, bone]));
  return { mesh, clips, bones, probe: skinProbe(mesh) };
}

function skinned(mesh, rest) {
  mesh.updateMatrixWorld(true);
  return rest.map((v, i) => mesh.applyBoneTransform(i, v.clone()));
}

// Bends at the end of a comfortable human range of motion for each joint.
const RANGE = [
  ['elbow flexion', 'forearm_L', 'x', -2.3],
  ['knee flexion', 'shin_R', 'x', 2.3],
  ['shoulder abduction', 'upperArm_L', 'z', 1.57],
  ['hip flexion', 'thigh_L', 'x', -1.57],
  ['wrist flexion', 'hand_R', 'x', 1.2],
  ['spine flexion', 'spine', 'x', 0.6],
  ['neck flexion', 'neck', 'x', 0.6],
];

// Skin over a bone may thin on the inside of a bend, but never below this share of its rest depth.
const MIN_DEPTH = 0.5;

function expectBonesUnderSkin(probe, rest, label) {
  const depths = probe.boneDepths({ softOnly: true });
  const worst = depths.map(({ bone, depth }, i) => ({ bone, depth, ratio: depth / rest[i].depth })).sort((a, b) => a.ratio - b.ratio)[0];
  expect(worst.ratio, `${label}: ${worst.bone} is ${worst.depth.toFixed(3)} under the skin`).toBeGreaterThan(MIN_DEPTH);
  return worst.ratio;
}

test.describe('mannequin skin deformation', () => {
  test('every vertex is fully weighted to at most four real bones', () => {
    const { mesh } = rig();
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    const count = mesh.skeleton.bones.length;
    const used = new Set();
    let worstSum = 0, negative = 0, outOfRange = 0;
    for (let i = 0; i < skinIndex.count; i++) {
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k), bone = skinIndex.getComponent(i, k);
        if (w < 0) negative++;
        if (w > 0) { if (bone >= count) outOfRange++; used.add(bone); }
        total += w;
      }
      worstSum = Math.max(worstSum, Math.abs(total - 1));
    }
    expect(negative).toBe(0);
    expect(outOfRange).toBe(0);
    expect(worstSum).toBeLessThan(1e-5);
    // Every bone except the root moves some skin.
    expect(used.size).toBeGreaterThanOrEqual(count - 1);
  });

  test('bind pose reproduces the modelled surface exactly', () => {
    const { mesh, probe } = rig();
    const posed = skinned(mesh, probe.rest);
    const error = Math.max(...posed.map((v, i) => v.distanceTo(probe.rest[i])));
    expect(error).toBeLessThan(1e-5);
  });

  test('limbs away from joints move rigidly with their bone', () => {
    const { mesh, bones, probe } = rig();
    const forearm = mesh.skeleton.bones.indexOf(bones.forearm_L);
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    const rigid = probe.rest.map((_, i) => i).filter((i) => skinIndex.getX(i) === forearm && skinWeight.getX(i) === 1);
    expect(rigid.length).toBeGreaterThan(100);
    const elbow = bones.forearm_L.getWorldPosition(new THREE.Vector3());
    bones.forearm_L.rotation.x = -1.4;
    const posed = skinned(mesh, probe.rest);
    const drift = Math.max(...rigid.map((i) => Math.abs(posed[i].distanceTo(elbow) - probe.rest[i].distanceTo(elbow))));
    expect(drift).toBeLessThan(1e-5);
  });

  test('joint helper bones turn half as far as the bone below them', () => {
    const { mesh, bones } = rig();
    bones.shin_L.rotation.x = 1.8;
    mesh.updateMatrixWorld(true);
    const helper = bones.shin_L_half.quaternion;
    expect(helper.angleTo(new THREE.Quaternion())).toBeCloseTo(0.9, 5);
    expect(helper.angleTo(bones.shin_L.quaternion)).toBeCloseTo(0.9, 5);
  });

  // Muscle, the limb it lies on (from joint to end joint), the bone whose bend works it, and the
  // side of the limb it sits on.
  const MUSCLE_CASES = [
    ['biceps_L', 'upperArm_L', 'forearm_L', 'forearm_L', -2.0, [0, 0, 1]],
    ['hamstring_R', 'thigh_R', 'shin_R', 'shin_R', 2.0, [0, 0, -1]],
    ['calf_L', 'shin_L', 'foot_L', 'shin_L', 2.0, [0, 0, -1]],
  ];

  // Moves posed skin back into the limb's rest frame, so only deformation relative to the limb
  // remains, and measures how far each muscle vertex sits from the limb's axis on the muscle side.
  function bellyProfile(mesh, probe, bones, muscle, limb, end, facing) {
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    const k = mesh.skeleton.bones.indexOf(bones[muscle]);
    const limbIndex = mesh.skeleton.bones.indexOf(bones[limb]);
    // Only skin carried by the limb and its muscle alone; near a joint the neighbouring bones move it too.
    const carried = (i) => [0, 1, 2, 3].filter((c) => skinWeight.getComponent(i, c) > 0).map((c) => skinIndex.getComponent(i, c));
    const belly = probe.rest.map((_, i) => i).filter((i) => carried(i).includes(k) && carried(i).every((b) => b === k || b === limbIndex));
    const posed = skinned(mesh, probe.rest);
    const toRest = new THREE.Matrix4().multiplyMatrices(bones[limb].matrixWorld, mesh.skeleton.boneInverses[limbIndex]).invert();
    const a = probe.restJoint(limb), axis = probe.restJoint(end).sub(a).normalize(), side = new THREE.Vector3(...facing);
    const radial = (p) => { const o = p.clone().sub(a); return o.addScaledVector(axis, -o.dot(axis)); };
    return belly.map((i) => {
      const before = radial(probe.rest[i]), after = radial(posed[i].clone().applyMatrix4(toRest));
      return { swell: after.length() - before.length(), outward: before.dot(side), radius: before.length() };
    });
  }

  for (const [muscle, limb, end, driver, angle, facing] of MUSCLE_CASES) {
    test(`${muscle} bulges on its own side as ${driver} bends, and grows with the bend`, () => {
      const { mesh, bones, probe } = rig();
      const atRest = bellyProfile(mesh, probe, bones, muscle, limb, end, facing);
      expect(atRest.length).toBeGreaterThan(50);
      expect(Math.max(...atRest.map((v) => Math.abs(v.swell)))).toBeLessThan(1e-5);
      bones[driver].rotation.x = angle / 2;
      const halfway = Math.max(...bellyProfile(mesh, probe, bones, muscle, limb, end, facing).map((v) => v.swell));
      bones[driver].rotation.x = angle;
      const profile = bellyProfile(mesh, probe, bones, muscle, limb, end, facing);
      const peak = profile.reduce((best, v) => (v.swell > best.swell ? v : best));
      // A visible swell of at least an eighth of the limb's radius, centred on the muscle's side.
      expect(peak.swell / peak.radius).toBeGreaterThan(0.125);
      expect(peak.outward / peak.radius).toBeGreaterThan(0.7);
      expect(halfway).toBeGreaterThan(0);
      expect(halfway).toBeLessThan(peak.swell);
      // Muscle swells push skin out; no part of the belly is pulled in toward the bone.
      expect(Math.min(...profile.map((v) => v.swell))).toBeGreaterThan(-0.002);
      // Straightening the joint lets the muscle relax completely.
      bones[driver].rotation.x = 0;
      expect(Math.max(...bellyProfile(mesh, probe, bones, muscle, limb, end, facing).map((v) => Math.abs(v.swell)))).toBeLessThan(1e-5);
    });
  }

  for (const [label, bone, axis, angle] of RANGE) {
    test(`${label}: bones stay under the skin and the surface bends without tearing`, () => {
      const { mesh, bones, probe } = rig();
      const rest = probe.boneDepths({ softOnly: true });
      bones[bone].rotation[axis] = angle;
      expectBonesUnderSkin(probe, rest, label);
      // Neighbouring vertices stay neighbours. Skin over the outside of a fully bent elbow or knee
      // stretches to a little over twice its length, as real skin does; a tear would be far larger.
      const posed = skinned(mesh, probe.rest);
      const index = mesh.geometry.index.array;
      let worst = 0;
      for (let i = 0; i < index.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const a = index[i + k], b = index[i + (k + 1) % 3];
          const length = probe.rest[a].distanceTo(probe.rest[b]);
          if (length > 1e-5) worst = Math.max(worst, posed[a].distanceTo(posed[b]) / length);
        }
      }
      expect(worst, `${label}: worst edge stretch`).toBeLessThan(2.5);
    });
  }

  test('every animation keeps bones under the skin and a foot on the pedestal', () => {
    const { mesh, clips, probe } = rig();
    const rest = probe.boneDepths({ softOnly: true });
    const restSole = Math.min(...probe.rest.map((v) => v.y));
    const mixer = new THREE.AnimationMixer(mesh);
    for (const clip of clips) {
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
      for (let f = 0; f < 8; f++) {
        mixer.setTime((clip.duration * f) / 8);
        const label = `${clip.name} at ${f}/8`;
        expectBonesUnderSkin(probe, rest, label);
        const sole = Math.min(...skinned(mesh, probe.rest).map((v) => v.y));
        expect(Math.abs(sole - restSole), `${label}: lowest foot height`).toBeLessThan(0.01);
      }
    }
  });
});
