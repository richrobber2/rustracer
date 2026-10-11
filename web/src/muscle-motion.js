import * as THREE from 'three';
import { BodyMorph } from './body-proportions.js';

// Illustrative antagonist actuators, not measured muscle/tendon mechanics.
export const MUSCLE_GROUPS = [
  { id: 'core', label: 'Core flexion', agonist: 'Abs / flexors', antagonist: 'Back / extensors' },
  { id: 'shoulder', label: 'Arm raise', agonist: 'Deltoid / abductors', antagonist: 'Arm adductors' },
  { id: 'elbow', label: 'Elbow bend', agonist: 'Biceps / flexors', antagonist: 'Triceps / extensors' },
  { id: 'wrist', label: 'Wrist flexion', agonist: 'Wrist flexors', antagonist: 'Wrist extensors' },
  { id: 'grip', label: 'Finger curl', agonist: 'Finger flexors', antagonist: 'Finger extensors' },
];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback, lo, hi) => Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
const DT = 1 / 120;
const SPECS = {
  core: { min: -.18, max: .5, torque: 7, stiffness: 10, inertia: 1, damping: 5 },
  shoulder: { min: -.2, max: 1.15, torque: 18, stiffness: 13, inertia: 1, damping: 6 },
  elbow: { min: 0, max: 1.6, torque: 15, stiffness: 7, inertia: .6, damping: 3 },
  wrist: { min: -.45, max: .65, torque: 4, stiffness: 6, inertia: .15, damping: 1.3 },
  grip: { min: 0, max: 1.1, torque: 5, stiffness: 2, inertia: .07, damping: .65 },
};

export class MuscleMotion {
  constructor(object, mesh, data) {
    this.object = object; this.mesh = mesh; this.bones = mesh.skeleton.bones;
    object.updateMatrixWorld(true);
    this.base = this.bones.map(bone => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
    this.byName = new Map(this.bones.map(bone => [bone.name, bone]));
    this.skinned = []; object.traverse(n => { if (n.isSkinnedMesh) { this.skinned.push(n); n.frustumCulled = false; } });
    const heads = this.bones.flatMap(bone => mesh.worldToLocal(bone.getWorldPosition(new THREE.Vector3())).toArray());
    this.headMorph = new BodyMorph(heads, null, data);
    const depth = bone => { let n = 0; for (let p = bone.parent; p; p = p.parent) n++; return n; };
    this.order = this.bones.map((bone, i) => ({ bone, i, depth: depth(bone) })).sort((a, b) => a.depth - b.depth);
    this.joints = [];
    const add = (group, side, bindings) => {
      const joints = bindings.map(([name, axis, scale]) => {
        const bone = this.byName.get(name);
        if (!bone) throw new Error(`Motion rig is missing ${name}`);
        return { bone, axis: new THREE.Vector3(...axis), scale, rest: bone.quaternion.clone() };
      });
      this.joints.push({ id: `${group}:${side}`, group, side, ...SPECS[group], bindings: joints, excitation: [0, 0], activation: [0, 0], angle: 0, velocity: 0, moment: 0 });
    };
    add('core', 0, [['spine03', [1, 0, 0], .35], ['spine02', [1, 0, 0], .35], ['spine01', [1, 0, 0], .3]]);
    for (const side of [1, -1]) {
      const suffix = side === 1 ? 'L' : 'R'; // Asset L/R; +X is front-view right.
      add('shoulder', side, [[`upperarm01${suffix}`, [0, 0, side], 1]]);
      add('elbow', side, [[`lowerarm01${suffix}`, [-1, 0, 0], 1]]);
      add('wrist', side, [[`wrist${suffix}`, [-1, 0, 0], 1]]);
      const fingers = [];
      for (let finger = 2; finger <= 5; finger++) for (let segment = 1; segment <= 3; segment++) fingers.push([`finger${finger}-${segment}${suffix}`, [-1, 0, 0], [.7, .9, .8][segment - 1]]);
      add('grip', side, fingers);
    }
    this.strength = 1; this.speed = 1; this.side = 1; this.demo = 'reach';
    this.running = false; this.held = false; this.time = 0; this.accumulator = 0;
    this.rotation = new THREE.Quaternion(); this.version = 0;
    this.regionActivation = new Float32Array(17 * 3);
  }
  selected(group, side = this.side) { return this.joints.filter(j => j.group === group && (!j.side || side === 2 || j.side === side)); }
  setExcitation(group, side, values) {
    this.running = false; this.held = false;
    for (const j of this.selected(group, side)) j.excitation = values.map(v => finite(v, 0, 0, 1));
  }
  configure(value = {}) {
    this.strength = finite(value.strength, this.strength, .25, 1.5);
    this.speed = finite(value.speed, this.speed, .5, 1.5);
    if ([1, -1, 2].includes(value.side)) this.side = value.side;
    if (['reach', 'core', 'hands'].includes(value.demo)) this.demo = value.demo;
  }
  restore(value = {}) {
    this.configure(value);
    for (const j of this.joints) if (Array.isArray(value.targets?.[j.id])) j.excitation = [0, 1].map(k => finite(value.targets[j.id][k], 0, 0, 1));
    // Imported excitations require Run muscles; never restore autoplay.
    this.held = this.joints.some(j => j.excitation.some(v => v > 0));
  }
  snapshot() { return { strength: this.strength, speed: this.speed, side: this.side, demo: this.demo, targets: Object.fromEntries(this.joints.map(j => [j.id, [...j.excitation]])) }; }
  play() { this.relax(); this.time = 0; this.running = true; }
  relax() { this.running = false; this.held = false; for (const j of this.joints) j.excitation.fill(0); }
  reset() {
    this.relax(); this.time = 0; this.accumulator = 0;
    for (const j of this.joints) { j.activation.fill(0); j.angle = j.velocity = j.moment = 0; }
    this.apply();
  }
  setShape(shape) {
    // Move joint pivots with the edited rest body and rebind skin/eyes there.
    // Skin rotations then act around the new pivots instead of the base height.
    for (const entry of this.base) { entry.bone.position.copy(entry.position); entry.bone.quaternion.copy(entry.quaternion); }
    this.object.updateMatrixWorld(true);
    const heads = this.headMorph.apply(shape), desired = new THREE.Vector3();
    for (const { bone, i } of this.order) {
      desired.fromArray(heads, i * 3); this.mesh.localToWorld(desired);
      bone.position.copy(bone.parent.worldToLocal(desired)); bone.updateWorldMatrix(false, false);
    }
    this.object.updateMatrixWorld(true);
    for (const mesh of this.skinned) {
      mesh.skeleton.calculateInverses(); mesh.bind(mesh.skeleton, mesh.matrixWorld.clone());
    }
    this.apply();
  }
  step(delta) {
    if (this.held || !Number.isFinite(delta) || delta <= 0) return false;
    this.accumulator += Math.min(delta, .05); let changed = false, steps = 0;
    while (this.accumulator + 1e-9 >= DT && steps++ < 6) {
      this.accumulator -= DT; this.time += DT;
      if (this.running) {
        const wave = .5 - .5 * Math.cos(this.time * Math.PI * .5 * this.speed);
        for (const j of this.joints) {
          const side = !j.side || this.side === 2 || this.side === j.side;
          const amount = this.demo === 'core' ? (j.group === 'core' ? .8 : 0)
            : this.demo === 'hands' ? ({ wrist: .25, grip: 1 }[j.group] || 0)
              : ({ shoulder: .9, elbow: .85, wrist: .2, grip: .65 }[j.group] || 0);
          j.excitation[0] = side ? wave * amount : 0; j.excitation[1] = 0;
        }
      }
      for (const j of this.joints) {
        for (let k = 0; k < 2; k++) {
          const tau = j.excitation[k] > j.activation[k] ? .06 : .12;
          j.activation[k] += (j.excitation[k] - j.activation[k]) * (1 - Math.exp(-DT / tau));
          if (Math.abs(j.excitation[k] - j.activation[k]) < 1e-6) j.activation[k] = j.excitation[k];
        }
        // Excitation → activation → opposing moments → angular acceleration.
        // Inertia and moment capacities are visual tuning values, not body mass.
        const [a, b] = j.activation;
        j.moment = j.torque * this.strength * (a - b);
        const passive = j.stiffness * (1 + .8 * (a + b)) * j.angle;
        j.velocity += (j.moment - passive - j.damping * j.velocity) / j.inertia * DT;
        j.velocity = clamp(j.velocity, -3, 3);
        const old = j.angle; j.angle = clamp(old + j.velocity * DT, j.min, j.max);
        if ((j.angle === j.min && j.velocity < 0) || (j.angle === j.max && j.velocity > 0)) j.velocity = 0;
        // Snap onto the static equilibrium once activation has settled, so a
        // held pose stops reporting sub-visible creep that keeps tissue awake.
        const settled = j.activation[0] === j.excitation[0] && j.activation[1] === j.excitation[1];
        const rest = clamp(j.moment / (j.stiffness * (1 + .8 * (a + b))), j.min, j.max);
        if (settled && Math.abs(j.angle - rest) < 1e-5 && Math.abs(j.velocity) < 1e-4) { j.angle = rest; j.velocity = 0; }
        changed ||= Math.abs(old - j.angle) > 1e-9;
      }
    }
    if (changed) this.apply();
    return changed;
  }
  apply() {
    for (const j of this.joints) for (const binding of j.bindings) binding.bone.quaternion.copy(binding.rest).multiply(this.rotation.setFromAxisAngle(binding.axis, j.angle * binding.scale));
    this.object.updateMatrixWorld(true);
    for (const mesh of this.skinned) { mesh.skeleton.update(); mesh.boundingBox = null; mesh.boundingSphere = null; }
    this.version++;
  }
  tissueActivation(system) {
    system.activation ||= new Float32Array(system.count);
    const values = this.regionActivation; values.fill(0);
    const core = this.joints[0].activation;
    for (let side = 0; side < 3; side++) {
      values[14 * 3 + side] = core[0]; values[10 * 3 + side] = values[11 * 3 + side] = core[1]; values[15 * 3 + side] = (core[0] + core[1]) * .5;
    }
    for (const j of this.joints) {
      const region = j.group === 'shoulder' ? 12 : j.group === 'elbow' ? 4 : j.group === 'wrist' || j.group === 'grip' ? 13 : -1;
      if (region < 0) continue;
      const at = region * 3 + j.side + 1; values[at] = Math.max(values[at], j.activation[0], j.activation[1]);
    }
    let changed = false;
    for (let i = 0; i < system.count; i++) {
      const active = values[system.regions[i] * 3 + Math.sign(system.rest[i * 3]) + 1];
      if (Math.abs(system.activation[i] - active) > 1e-5) changed = true;
      system.activation[i] = active;
    }
    return changed;
  }
}

export class CagePose {
  constructor(mesh, system, data) {
    this.mesh = mesh; this.system = system;
    const a = mesh.geometry.attributes, nearest = new Int32Array(system.count).fill(-1), distance = new Float64Array(system.count).fill(Infinity);
    // Associate each cage particle with the closest skin vertex it influences.
    // These inherited skin weights approximate the cage's skeletal attachment.
    for (let vertex = 0; vertex < a.position.count; vertex++) for (let k = 0; k < 4; k++) {
      const at = vertex * 4 + k; if (a._cage_weight.array[at] <= 0) continue;
      const id = a._cage_index.array[at], j = id * 3;
      const d = (a.position.array[vertex * 3] - data.positions[j]) ** 2 + (a.position.array[vertex * 3 + 1] - data.positions[j + 1]) ** 2 + (a.position.array[vertex * 3 + 2] - data.positions[j + 2]) ** 2;
      if (d < distance[id]) { distance[id] = d; nearest[id] = vertex; }
    }
    if (nearest.some(v => v < 0)) throw new Error('Motion cage has an unmapped skin attachment');
    this.ids = new Uint16Array(system.count * 4); this.weights = new Float32Array(system.count * 4);
    for (let i = 0; i < system.count; i++) for (let k = 0; k < 4; k++) {
      this.ids[i * 4 + k] = a.skinIndex.array[nearest[i] * 4 + k]; this.weights[i * 4 + k] = a.skinWeight.array[nearest[i] * 4 + k];
    }
    this.transforms = Array.from(mesh.skeleton.bones, () => new THREE.Matrix4());
    this.directions = Array.from(mesh.skeleton.bones, () => new THREE.Vector3());
    this.gravity = new Float32Array(system.count * 3);
    this.vector = new THREE.Vector3(); this.matrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4(); this.down = new THREE.Vector3();
    this.version = -1; this.world = new THREE.Matrix4(); this.refresh(0);
  }
  refresh(version) {
    this.mesh.updateWorldMatrix(true, false);
    const worldChanged = !this.world.equals(this.mesh.matrixWorld);
    if (version === this.version && !worldChanged) return false;
    // Studio rotation/scale can change an ancestor without a motor step.
    // Refresh the sibling bone hierarchy before using its skin transforms.
    if (worldChanged) this.mesh.parent.updateWorldMatrix(true, true);
    this.mesh.updateMatrixWorld(true);
    this.version = version; this.world.copy(this.mesh.matrixWorld); this.mesh.skeleton.update();
    const directions = this.directions;
    this.down.set(0, -1, 0).transformDirection(this.inverse.copy(this.mesh.matrixWorld).invert());
    for (let i = 0; i < this.transforms.length; i++) {
      const transform = this.transforms[i].fromArray(this.mesh.skeleton.boneMatrices, i * 16).premultiply(this.mesh.bindMatrixInverse).multiply(this.mesh.bindMatrix);
      directions[i].copy(this.down).transformDirection(this.inverse.copy(transform).invert());
    }
    for (let i = 0; i < this.system.count; i++) {
      this.vector.set(0, 0, 0);
      for (let k = 0; k < 4; k++) this.vector.addScaledVector(directions[this.ids[i * 4 + k]], this.weights[i * 4 + k]);
      this.vector.normalize().toArray(this.gravity, i * 3);
    }
    return true;
  }
  blend(id) {
    const elements = this.matrix.elements; elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const at = id * 4 + k, transform = this.transforms[this.ids[at]].elements, weight = this.weights[at];
      for (let n = 0; n < 16; n++) elements[n] += transform[n] * weight;
    }
    return this.matrix;
  }
  point(id, point) { return this.vector.fromArray(point).applyMatrix4(this.blend(id)).toArray(); }
  toMaterial(id, point) { return this.vector.fromArray(point).applyMatrix4(this.blend(id).invert()).toArray(); }
  directionToMaterial(id, direction) { return this.vector.fromArray(direction).transformDirection(this.blend(id).invert()).toArray(); }
}
