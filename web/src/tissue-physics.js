// An illustrative anchored surface spring network, not calibrated biomechanics.
// Material-frame displacements are in meters; the rig carries the rest surface.
import { upperRegion, isSideRegion, sideOf, upperBoundary, buildUpperLinks } from './upper-body.js';
import { eligibleGrabAnchor } from './grab-points.js';
import { abdominalRegion, abdominalBoundary, buildAbdominalLinks, regionMatches } from './abdomen.js';
const SOFTNESS = [0.12, 0.8, 0.95, 0.9, 0.5, 0.7, 0.4, 0.06, 1, .9, .45, .5, .55, .16, .65, .55, .18];
const DT = 1 / 120;
// Semi-implicit Euler with per-step decay c is stable while k·dt² < 2(1 + c) / c.
// Keep the stiffest coupled mode below this fraction of that limit.
const STABILITY_MARGIN = .8;
const GRAB_STIFFNESS = 1800;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class TissueSystem {
  constructor(data) {
    this.rest = new Float32Array(data.positions);
    this.normals = new Float32Array(data.normals);
    this.edges = new Uint32Array(data.edges);
    this.regions = new Uint8Array(data.regions);
    this.count = this.rest.length / 3;
    // Posterior hip particles retain their original surface mapping, but gain a
    // separate response region. +Z is the front in these MakeHuman assets.
    this.regionNames = [...(data.regionNames || [])];
    this.regionNames[9] = 'Buttocks';
    this.regionNames[10] = 'Lower back';
    this.regionNames[7] = 'Feet';
    this.regionNames[11] = 'Upper back';
    this.regionNames[12] = 'Shoulders';
    this.regionNames[13] = 'Hands / wrists';
    this.regionNames[2] = 'Abdomen · abs & obliques';
    this.regionNames[14] = 'Abs / rectus';
    this.regionNames[15] = 'Obliques / lateral abdomen';
    if (data.analFrame) this.regionNames[16] = 'Anus / perianal tissue';
    this.lastButtSide = 0;
    this.buttAttachment = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      if (this.regions[i] === 3 && this.rest[j + 2] < 0 && this.normals[j + 2] < -.2) {
        this.regions[i] = 9;
        const midline = Math.exp(-((this.rest[j] / (data.height * .035)) ** 2));
        const upper = Math.max(0, Math.min(1, (this.rest[j + 1] / data.height - .49) / .05));
        this.buttAttachment[i] = Math.max(midline, upper);
      }
      if (this.regions[i] === 2 && this.rest[j + 2] < 0 && this.normals[j + 2] < -.2) this.regions[i] = 10;
      this.regions[i] = upperRegion(this.regions[i], this.rest[j], this.rest[j + 1], this.rest[j + 2], this.normals[j + 2], data.height);
      this.regions[i] = abdominalRegion(this.regions[i], this.rest[j], this.rest[j + 1], this.rest[j + 2], this.normals[j + 2], data.height);
    }
    this.offset = new Float32Array(this.rest.length);
    this.velocity = new Float32Array(this.rest.length);
    this.force = new Float32Array(this.rest.length);
    this.softness = Float32Array.from(this.regions, r => SOFTNESS[r] ?? .5);
    this.sex = data.sex;
    this.analFrame = data.analFrame;
    this.support = new Float32Array(this.count);
    this.bulge = new Float32Array(this.count);
    this.decay = new Float32Array(this.count);
    this.limits = new Float32Array(this.count);
    this.edgeFactors = new Float32Array(this.edges.length / 2);
    // 0: reciprocal; 1 or 2: only end a or b (a centre-line sample) receives
    // the force, so it follows both sides without carrying load across.
    this.edgeFollower = new Uint8Array(this.edges.length / 2);
    this.degree = new Uint16Array(this.count);
    for (const id of this.edges) this.degree[id]++;
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e], b = this.edges[e + 1];
      const sa = sideOf(this.rest[a * 3]), sb = sideOf(this.rest[b * 3]);
      const sided = data.regions[a] === 3 || data.regions[b] === 3 || isSideRegion(this.regions[a]) || isSideRegion(this.regions[b]);
      const crossesPosterior = sided && sa * sb < 0;
      if (sided && (sa === 0) !== (sb === 0)) this.edgeFollower[e / 2] = sa === 0 ? 1 : 2;
      const lumbarBoundary = (this.regions[a] === 9 && this.regions[b] === 10) || (this.regions[b] === 9 && this.regions[a] === 10);
      // Regional bridges below own the pelvis-to-back connection, including its off switch.
      this.edgeFactors[e / 2] = crossesPosterior || lumbarBoundary || upperBoundary(this.regions[a], this.regions[b]) || abdominalBoundary(this.regions[a], this.regions[b]) ? 0 : 1 / Math.sqrt(Math.max(1, this.degree[a] * this.degree[b]));
    }
    this.buildLumbarLinks(data.height);
    this.upperLinks = buildUpperLinks(this, data.height);
    this.abdominalLinks = buildAbdominalLinks(this, data.height);
    this.regionalLinks = [...this.upperLinks, ...this.abdominalLinks];
    this.parameters = { stiffness: 45, damping: 0.5, gravity: 0.3, tension: 0, strength: 1, radius: 0.10, region: -1, genitalCompliance: 1, genitalDamping: .5, genitalScale: 1, buttCompliance: 1, buttDamping: .5, buttMuscle: 1, buttFat: 1, buttSide: 0, buttMuscleLeft: 1, buttMuscleRight: 1, buttFatLeft: 1, buttFatRight: 1, lumbarCoupling: .65, lumbarSupport: .35, lumbarDamping: .65, upperCoupling: .65, upperSupport: .25, shoulderCoupling: .65, shoulderSupport: .35, handCoupling: .65, handSupport: .4 };
    this.paused = false;
    Object.assign(this.parameters, { absSupport: .35, obliqueSupport: .45, absCoupling: .65, coreCoupling: .65, coreBracing: 0, absDamping: .6 });
    Object.assign(this.parameters, { analCompliance: 1, analDamping: .65 });
    this._vibration = false;
    this.sleeping = false; this.quietTime = 0;
    this.grab = null;
    this.time = 0;
    this.accumulator = 0;
    this.maxDisplacement = 0;
    this.refreshCoefficients();
  }

  buildLumbarLinks(height) {
    // Sparse, same-side displacement bridges approximate posterior fascial load
    // transfer. They are passive surface links, not anatomical muscle fibers.
    const pairs = new Map(), degree = new Uint16Array(this.count);
    const add = (a, b) => {
      if (this.rest[a * 3] * this.rest[b * 3] <= 0) return;
      const key = `${a}:${b}`;
      if (pairs.has(key)) return;
      pairs.set(key, [a, b]); degree[a]++; degree[b]++;
    };
    for (let e = 0; e < this.edges.length; e += 2) {
      let a = this.edges[e], b = this.edges[e + 1];
      if (this.regions[b] === 9) [a, b] = [b, a];
      if (this.regions[a] === 9 && this.regions[b] === 10) add(a, b);
    }
    const glutes = Array.from(this.regions.keys()).filter(i => this.regions[i] === 9 && this.rest[i * 3 + 1] >= height * .49);
    for (let b = 0; b < this.count; b++) if (this.regions[b] === 10) {
      const nearby = glutes.filter(a => this.rest[a * 3] * this.rest[b * 3] > 0).map(a => ({ a,
        distance: Math.hypot(this.rest[a * 3] - this.rest[b * 3], this.rest[a * 3 + 1] - this.rest[b * 3 + 1], this.rest[a * 3 + 2] - this.rest[b * 3 + 2])
      })).filter(p => p.distance <= height * .16).sort((a, b) => a.distance - b.distance);
      for (const { a } of nearby.slice(0, 2)) add(a, b);
    }
    this.lumbarLinks = Uint32Array.from([...pairs.values()].flat());
    this.lumbarFactors = Float32Array.from(pairs.values(), ([a, b]) => 1 / Math.sqrt(degree[a] * degree[b]));
  }

  get vibration() { return this._vibration; }
  set vibration(value) { this._vibration = Boolean(value); this.wake(); }
  wake() { this.sleeping = false; this.quietTime = 0; }
  selected(i) {
    const { region, buttSide } = this.parameters;
    if (!regionMatches(region, this.regions[i])) return false;
    if (!isSideRegion(this.regions[i]) || buttSide === 2) return true;
    const side = buttSide || this.lastButtSide;
    return side !== 0 && Math.sign(this.rest[i * 3]) === side;
  }
  refreshCoefficients() {
    const p = this.parameters;
    for (let i = 0; i < this.count; i++) {
      const genital = this.regions[i] === 8, soft = this.softness[i];
      const tension = this.selected(i) && this.regions[i] > 0 && (this.regions[i] < 7 || this.regions[i] >= 9) ? p.tension : 0;
      this.support[i] = (100 + p.stiffness * 8) * (1 + tension * 2) / ((.2 + soft) * (genital ? p.genitalCompliance * p.genitalScale ** 2 : 1));
      const side = this.rest[i * 3] > 0 ? 'Left' : 'Right';
      const muscle = p.buttMuscle * p['buttMuscle' + side], fat = p.buttFat * p['buttFat' + side];
      if (this.regions[i] === 9) this.support[i] *= (1 + this.buttAttachment[i] * 2.5) / p.buttCompliance * Math.sqrt(muscle) / Math.sqrt(fat);
      if (this.regions[i] === 10) this.support[i] *= 1 + p.lumbarSupport * 3;
      if (this.regions[i] === 11) this.support[i] *= 1 + p.upperSupport * 3;
      if (this.regions[i] === 12) this.support[i] *= 1 + p.shoulderSupport * 3;
      if (this.regions[i] === 13) this.support[i] *= 1 + p.handSupport * 3;
      if (this.regions[i] === 14) this.support[i] *= 1 + p.absSupport * 3;
      if (this.regions[i] === 15) this.support[i] *= 1 + p.obliqueSupport * 3;
      if (this.regions[i] === 16) this.support[i] /= p.analCompliance;
      if (this.regions[i] === 10 || this.regions[i] === 14 || this.regions[i] === 15) this.support[i] *= 1 + p.coreBracing * 2.5;
      this.bulge[i] = .006 * tension * soft * (this.regions[i] === 9 ? 1 - this.buttAttachment[i] : 1);
      this.decay[i] = Math.exp(-(2 + (genital ? p.genitalDamping : this.regions[i] === 9 ? p.buttDamping : this.regions[i] === 10 ? p.lumbarDamping : p.damping) * 36) * DT);
      if (this.regions[i] === 14 || this.regions[i] === 15) this.decay[i] = Math.exp(-(2 + p.absDamping * 36) * DT);
      if (this.regions[i] === 16) this.decay[i] = Math.exp(-(2 + p.analDamping * 36) * DT);
      this.limits[i] = genital ? Math.min(.06, (this.sex === 'female' ? .010 : .035) * p.genitalScale) : (.006 + .055 * soft) * (this.regions[i] === 9 ? (1 - .65 * this.buttAttachment[i]) * Math.sqrt(fat) : 1);
      if (this.regions[i] === 13) this.limits[i] = Math.min(.012, this.limits[i]);
      if (this.regions[i] === 16) this.limits[i] = .006;
    }
    this.refreshStiffnessCaps();
  }
  refreshStiffnessCaps() {
    // Bound each particle's largest stiffness (Gershgorin: support + 2·Σ links
    // + grab spring) and cap the support spring so muscle activation and slider
    // extremes cannot exceed the integrator's stability limit.
    const p = this.parameters, links = this.linkStiffness ||= new Float32Array(this.count);
    this.edgeK = 18 + p.stiffness * .5;
    this.lumbarK = (120 + p.stiffness * 5) * p.lumbarCoupling;
    this.regionalK = 400 + p.stiffness * 20;
    links.fill(0);
    for (let e = 0; e < this.edges.length; e += 2) {
      const k = this.edgeK * this.edgeFactors[e / 2], follower = this.edgeFollower[e / 2];
      if (follower !== 2) links[this.edges[e]] += k;
      if (follower !== 1) links[this.edges[e + 1]] += k;
    }
    for (let e = 0; e < this.lumbarLinks.length; e += 2) {
      const k = this.lumbarK * this.lumbarFactors[e / 2];
      links[this.lumbarLinks[e]] += k; links[this.lumbarLinks[e + 1]] += k;
    }
    for (const group of this.regionalLinks) {
      const baseK = this.regionalK * p[group.parameter];
      for (let e = 0; e < group.ids.length; e += 2) {
        const k = baseK * group.factors[e / 2];
        links[group.ids[e]] += k; links[group.ids[e + 1]] += k;
      }
    }
    const caps = this.stiffnessCap ||= new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const c = this.decay[i], limit = STABILITY_MARGIN * 2 * (1 + c) / (c * DT * DT);
      caps[i] = Math.max(0, limit - 2 * links[i] - GRAB_STIFFNESS * this.softness[i]);
    }
  }
  configure(values) {
    const ranges = { stiffness: [1, 100], damping: [0, 1], gravity: [0, 2], tension: [0, 1], strength: [0.1, 3], radius: [0.03, 0.25], region: [-1, 13], genitalCompliance: [.5, 2], genitalDamping: [0, 1], genitalScale: [.55, 1.75], buttCompliance: [.5, 2], buttDamping: [0, 1], buttMuscle: [.75, 1.4], buttFat: [.5, 1.75], buttSide: [-1, 2], buttMuscleLeft: [.75, 1.4], buttMuscleRight: [.75, 1.4], buttFatLeft: [.5, 1.75], buttFatRight: [.5, 1.75], lumbarCoupling: [0, 1], lumbarSupport: [0, 1], lumbarDamping: [0, 1], upperCoupling: [0, 1], upperSupport: [0, 1], shoulderCoupling: [0, 1], shoulderSupport: [0, 1], handCoupling: [0, 1], handSupport: [0, 1] };
    ranges.region[1] = this.regions.includes(16) ? 16 : 15;
    ranges.analCompliance = [.5, 2]; ranges.analDamping = [0, 1];
    for (const key of ['absSupport', 'obliqueSupport', 'absCoupling', 'coreCoupling', 'coreBracing', 'absDamping']) ranges[key] = [0, 1];
    let changed = false;
    for (const [key, value] of Object.entries(values)) {
      if (!ranges[key] || !Number.isFinite(value)) continue;
      const next = ['region', 'buttSide'].includes(key) ? Math.round(clamp(value, ...ranges[key])) : clamp(value, ...ranges[key]);
      if (this.parameters[key] !== next) { this.parameters[key] = next; changed = true; }
    }
    if (changed) { this.refreshCoefficients(); this.wake(); }
  }
  setRest(positions, scale = 1, changedSide = 0) {
    if (positions.length !== this.rest.length || !positions.every(Number.isFinite)) throw new Error('Invalid cage rest shape');
    const preserve = Math.abs(changedSide) === 1;
    const oldRest = preserve ? this.rest.slice() : null, oldOffset = preserve ? this.offset.slice() : null, oldVelocity = preserve ? this.velocity.slice() : null;
    const time = this.time;
    this.rest.set(positions); this.configure({ genitalScale: scale }); this.reset();
    if (preserve) {
      this.time = time;
      for (let i = 0; i < this.count; i++) {
        const j = i * 3;
        if (this.rest[j] * changedSide >= 0 || [0, 1, 2].some(k => this.rest[j + k] !== oldRest[j + k])) continue;
        this.offset.set(oldOffset.subarray(j, j + 3), j); this.velocity.set(oldVelocity.subarray(j, j + 3), j);
      }
    }
  }

  reset() {
    this.wake();
    this.offset.fill(0); this.velocity.fill(0); this.force.fill(0);
    this.grab = null; this.accumulator = 0; this.time = 0; this.maxDisplacement = 0;
  }

  beginGrab(point, normal, tool = 'press', anchorId = -1) {
    this.wake();
    const { radius, region, strength } = this.parameters;
    const ids = [], weights = [];
    if (anchorId !== -1 && !eligibleGrabAnchor(this, anchorId)) { this.grab = null; return 0; }
    // Infer the touched side from the nearest sample, before the brush
    // radius can include the other side. Dragging keeps the initial side.
    let closest = Infinity, nearest = anchorId;
    for (let i = 0; anchorId === -1 && i < this.count; i++) {
      const j = i * 3, distance = Math.hypot(this.rest[j] + this.offset[j] - point[0], this.rest[j + 1] + this.offset[j + 1] - point[1], this.rest[j + 2] + this.offset[j + 2] - point[2]);
      if (distance < closest) { closest = distance; nearest = i; }
    }
    const center = anchorId >= 0 ? Array.from(this.rest.slice(anchorId * 3, anchorId * 3 + 3), (v, k) => v + this.offset[anchorId * 3 + k]) : point;
    if (nearest >= 0 && isSideRegion(this.regions[nearest]) && Math.abs(center[0]) > 1e-6) {
      this.lastButtSide = Math.sign(center[0]); this.refreshCoefficients();
    }
    const touchedPosterior = nearest >= 0 && isSideRegion(this.regions[nearest]);
    const brushSide = this.parameters.buttSide === 2 ? 0 : this.parameters.buttSide || this.lastButtSide;
    for (let i = 0; i < this.count; i++) {
      if (!this.selected(i)) continue;
      const j = 3 * i;
      if (touchedPosterior && brushSide && this.rest[j] * brushSide <= 0) continue;
      const distance = Math.hypot(this.rest[j] + this.offset[j] - center[0], this.rest[j + 1] + this.offset[j + 1] - center[1], this.rest[j + 2] + this.offset[j + 2] - center[2]);
      if (distance < radius) {
        ids.push(i); weights.push((1 - (distance / radius) ** 2) ** 2);
      }
    }
    const startOffset = Float32Array.from(ids.flatMap(i => Array.from(this.offset.slice(i * 3, i * 3 + 3))));
    this.grab = { origin: [...point], target: [...point], normal: [...normal], direction: tool === 'pull' ? 1 : -1, strength, ids, weights, startOffset, anchorId: nearest };
    return ids.length;
  }

  moveGrab(point) { if (this.grab) this.grab.target = [...point]; }
  endGrab() { this.grab = null; this.wake(); }

  impulse() {
    this.wake();
    const { region, strength } = this.parameters;
    for (let i = 0; i < this.count; i++) {
      if (!this.selected(i)) continue;
      const j = i * 3, scale = this.softness[i] * strength * 0.55;
      this.velocity[j] += this.normals[j] * scale;
      this.velocity[j + 1] += this.normals[j + 1] * scale;
      this.velocity[j + 2] += this.normals[j + 2] * scale;
    }
  }

  step(delta) {
    if (this.paused || (this.sleeping && !this.grab && !this.vibration) || !Number.isFinite(delta) || delta <= 0) return false;
    this.accumulator += Math.min(delta, 0.05);
    let steps = 0;
    while (this.accumulator + 1e-9 >= DT && steps < 6) {
      this.integrate(DT); this.accumulator -= DT; steps++;
    }
    return steps > 0;
  }

  integrate(dt) {
    const { gravity, strength } = this.parameters;
    const d = this.offset, v = this.velocity, f = this.force;
    this.time += dt;
    const oscillation = this.vibration ? Math.sin(this.time * 2 * Math.PI * 2.5) * 8 * strength : 0;
    // The support spring provides restoring force; tension adds support and a small bulge.
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, soft = this.softness[i];
      const selected = this.selected(i);
      const activation = this.activation?.[i] || 0;
      const k = Math.min(this.support[i] * (1 + activation * 1.5), this.stiffnessCap[i]), bulge = this.bulge[i] + .003 * activation * soft;
      for (let axis = 0; axis < 3; axis++) f[j + axis] = -k * (d[j + axis] - this.normals[j + axis] * bulge);
      if (this.pose) for (let axis = 0; axis < 3; axis++) f[j + axis] += 9.81 * gravity * soft * this.pose.gravity[j + axis];
      else f[j + 1] -= 9.81 * gravity * soft;
      if (this.vibration && selected) f[j] += oscillation * soft;
    }
    // Neighbor coupling transmits a local deformation through the tissue surface.
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e], b = this.edges[e + 1];
      const k = this.edgeK * this.edgeFactors[e / 2], follower = this.edgeFollower[e / 2];
      for (let axis = 0; axis < 3; axis++) {
        const ia = a * 3 + axis, ib = b * 3 + axis;
        const force = (d[ib] - d[ia]) * k;
        if (follower !== 2) f[ia] += force;
        if (follower !== 1) f[ib] -= force;
      }
    }
    // Reciprocal force transfer: pulling either end loads the other. No mirrored
    // offsets or direct stimulation of the unselected region is involved.
    const lumbarK = this.lumbarK;
    for (let e = 0; e < this.lumbarLinks.length; e += 2) {
      const a = this.lumbarLinks[e], b = this.lumbarLinks[e + 1], k = lumbarK * this.lumbarFactors[e / 2];
      for (let axis = 0; axis < 3; axis++) {
        const ia = a * 3 + axis, ib = b * 3 + axis, force = (d[ib] - d[ia]) * k;
        f[ia] += force; f[ib] -= force;
      }
    }
    for (const group of this.regionalLinks) {
      const baseK = this.regionalK * this.parameters[group.parameter];
      for (let e = 0; e < group.ids.length; e += 2) {
        const a = group.ids[e], b = group.ids[e + 1], k = baseK * group.factors[e / 2];
        for (let axis = 0; axis < 3; axis++) {
          const ia = a * 3 + axis, ib = b * 3 + axis, force = (d[ib] - d[ia]) * k;
          f[ia] += force; f[ib] -= force;
        }
      }
    }
    if (this.grab) {
      const g = this.grab;
      for (let t = 0; t < g.ids.length; t++) {
        const i = g.ids[t], soft = this.softness[i], j = i * 3;
        for (let axis = 0; axis < 3; axis++) {
          const goal = g.startOffset[t * 3 + axis] + clamp(g.target[axis] - g.origin[axis] + g.normal[axis] * g.direction * .025 * g.strength, -.08, .08);
          f[j + axis] += (goal - d[j + axis]) * GRAB_STIFFNESS * g.weights[t] * soft;
        }
      }
    }
    let maximum = 0, speedSquared = 0;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, maxOffset = this.limits[i], decay = this.decay[i];
      for (let axis = 0; axis < 3; axis++) {
        v[j + axis] = (v[j + axis] + f[j + axis] * dt) * decay;
        d[j + axis] += v[j + axis] * dt;
      }
      const length = Math.hypot(d[j], d[j + 1], d[j + 2]);
      if (length > maxOffset) {
        for (let axis = 0; axis < 3; axis++) { d[j + axis] *= maxOffset / length; v[j + axis] *= .3; }
      }
      if (this.rest[j + 1] + d[j + 1] < .001) { d[j + 1] = .001 - this.rest[j + 1]; v[j + 1] = Math.max(0, v[j + 1]); }
      maximum = Math.max(maximum, Math.min(length, maxOffset));
      speedSquared = Math.max(speedSquared, v[j] ** 2 + v[j + 1] ** 2 + v[j + 2] ** 2);
    }
    this.maxDisplacement = maximum;
    this.quietTime = !this.grab && !this.vibration && speedSquared < 1e-8 ? this.quietTime + dt : 0;
    if (this.quietTime > .4) { this.sleeping = true; this.velocity.fill(0); }
  }
}
