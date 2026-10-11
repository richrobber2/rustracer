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
