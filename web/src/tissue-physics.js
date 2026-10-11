// An illustrative anchored surface spring network, not calibrated biomechanics.
// Displacements are in meters. A fixed skeleton supports the rest surface.
const SOFTNESS = [0.12, 0.8, 0.95, 0.9, 0.5, 0.7, 0.4, 0.06, 1, .9];
const DT = 1 / 120;
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
    }
    this.offset = new Float32Array(this.rest.length);
    this.velocity = new Float32Array(this.rest.length);
    this.force = new Float32Array(this.rest.length);
    this.softness = Float32Array.from(this.regions, r => SOFTNESS[r] ?? .5);
    this.sex = data.sex;
    this.support = new Float32Array(this.count);
    this.bulge = new Float32Array(this.count);
    this.decay = new Float32Array(this.count);
    this.limits = new Float32Array(this.count);
    this.edgeFactors = new Float32Array(this.edges.length / 2);
    this.degree = new Uint16Array(this.count);
    for (const id of this.edges) this.degree[id]++;
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e], b = this.edges[e + 1];
      const crossesPelvis = (data.regions[a] === 3 || data.regions[b] === 3) && this.rest[a * 3] * this.rest[b * 3] <= 0;
      this.edgeFactors[e / 2] = crossesPelvis ? 0 : 1 / Math.sqrt(Math.max(1, this.degree[a] * this.degree[b]));
    }
    this.parameters = { stiffness: 45, damping: 0.5, gravity: 0.3, tension: 0, strength: 1, radius: 0.10, region: -1, genitalCompliance: 1, genitalDamping: .5, genitalScale: 1, buttCompliance: 1, buttDamping: .5, buttMuscle: 1, buttFat: 1, buttSide: 0, buttMuscleLeft: 1, buttMuscleRight: 1, buttFatLeft: 1, buttFatRight: 1 };
    this.paused = false;
    this._vibration = false;
    this.sleeping = false; this.quietTime = 0;
    this.grab = null;
    this.time = 0;
    this.accumulator = 0;
    this.maxDisplacement = 0;
    this.refreshCoefficients();
  }

  get vibration() { return this._vibration; }
  set vibration(value) { this._vibration = Boolean(value); this.wake(); }
  wake() { this.sleeping = false; this.quietTime = 0; }
  selected(i) {
    const { region, buttSide } = this.parameters;
    if (region >= 0 && this.regions[i] !== region) return false;
    if (this.regions[i] !== 9 || buttSide === 2) return true;
    const side = buttSide || this.lastButtSide;
    return side !== 0 && Math.sign(this.rest[i * 3]) === side;
  }
  refreshCoefficients() {
    const p = this.parameters;
    for (let i = 0; i < this.count; i++) {
      const genital = this.regions[i] === 8, soft = this.softness[i];
      const tension = this.selected(i) && this.regions[i] > 0 && (this.regions[i] < 7 || this.regions[i] === 9) ? p.tension : 0;
      this.support[i] = (100 + p.stiffness * 8) * (1 + tension * 2) / ((.2 + soft) * (genital ? p.genitalCompliance * p.genitalScale ** 2 : 1));
      const side = this.rest[i * 3] > 0 ? 'Left' : 'Right';
      const muscle = p.buttMuscle * p['buttMuscle' + side], fat = p.buttFat * p['buttFat' + side];
      if (this.regions[i] === 9) this.support[i] *= (1 + this.buttAttachment[i] * 2.5) / p.buttCompliance * Math.sqrt(muscle) / Math.sqrt(fat);
      this.bulge[i] = .006 * tension * soft * (this.regions[i] === 9 ? 1 - this.buttAttachment[i] : 1);
      this.decay[i] = Math.exp(-(2 + (genital ? p.genitalDamping : this.regions[i] === 9 ? p.buttDamping : p.damping) * 36) * DT);
      this.limits[i] = genital ? Math.min(.06, (this.sex === 'female' ? .010 : .035) * p.genitalScale) : (.006 + .055 * soft) * (this.regions[i] === 9 ? (1 - .65 * this.buttAttachment[i]) * Math.sqrt(fat) : 1);
    }
  }
  configure(values) {
    const ranges = { stiffness: [1, 100], damping: [0, 1], gravity: [0, 2], tension: [0, 1], strength: [0.1, 3], radius: [0.03, 0.25], region: [-1, 9], genitalCompliance: [.5, 2], genitalDamping: [0, 1], genitalScale: [.55, 1.75], buttCompliance: [.5, 2], buttDamping: [0, 1], buttMuscle: [.75, 1.4], buttFat: [.5, 1.75], buttSide: [-1, 2], buttMuscleLeft: [.75, 1.4], buttMuscleRight: [.75, 1.4], buttFatLeft: [.5, 1.75], buttFatRight: [.5, 1.75] };
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

  beginGrab(point, normal, tool = 'press') {
    this.wake();
    const { radius, region, strength } = this.parameters;
    const ids = [], weights = [];
    // Infer the touched lobe from the nearest rear hip sample, before the brush
    // radius can include the other side. Dragging keeps the initial side.
    let closest = Infinity, nearest = -1;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, distance = Math.hypot(this.rest[j] + this.offset[j] - point[0], this.rest[j + 1] + this.offset[j + 1] - point[1], this.rest[j + 2] + this.offset[j + 2] - point[2]);
      if (distance < closest) { closest = distance; nearest = i; }
    }
    if (nearest >= 0 && this.regions[nearest] === 9 && Math.abs(point[0]) > 1e-6) {
      this.lastButtSide = Math.sign(point[0]); this.refreshCoefficients();
    }
    const touchedButtock = nearest >= 0 && this.regions[nearest] === 9;
    const brushSide = this.parameters.buttSide === 2 ? 0 : this.parameters.buttSide || this.lastButtSide;
    for (let i = 0; i < this.count; i++) {
      if (!this.selected(i)) continue;
      const j = 3 * i;
      if (touchedButtock && brushSide && this.rest[j] * brushSide <= 0) continue;
      const distance = Math.hypot(this.rest[j] + this.offset[j] - point[0], this.rest[j + 1] + this.offset[j + 1] - point[1], this.rest[j + 2] + this.offset[j + 2] - point[2]);
      if (distance < radius) {
        ids.push(i); weights.push((1 - (distance / radius) ** 2) ** 2);
      }
    }
    this.grab = { origin: [...point], target: [...point], normal: [...normal], direction: tool === 'pull' ? 1 : -1, strength, ids, weights };
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
    const { stiffness, damping, gravity, tension, strength, region } = this.parameters;
    const d = this.offset, v = this.velocity, f = this.force;
    this.time += dt;
    const oscillation = this.vibration ? Math.sin(this.time * 2 * Math.PI * 2.5) * 8 * strength : 0;
    // The support spring provides restoring force; tension adds support and a small bulge.
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, soft = this.softness[i];
      const selected = this.selected(i);
      const k = this.support[i], bulge = this.bulge[i];
      for (let axis = 0; axis < 3; axis++) f[j + axis] = -k * (d[j + axis] - this.normals[j + axis] * bulge);
      f[j + 1] -= 9.81 * gravity * soft;
      if (this.vibration && selected) f[j] += oscillation * soft;
    }
    // Neighbor coupling transmits a local deformation through the tissue surface.
    const coupling = 18 + stiffness * 0.5;
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e], b = this.edges[e + 1];
      const k = coupling * this.edgeFactors[e / 2];
      for (let axis = 0; axis < 3; axis++) {
        const ia = a * 3 + axis, ib = b * 3 + axis;
        const force = (d[ib] - d[ia]) * k;
        f[ia] += force; f[ib] -= force;
      }
    }
    if (this.grab) {
      const g = this.grab;
      for (let t = 0; t < g.ids.length; t++) {
        const i = g.ids[t], soft = this.softness[i], j = i * 3;
        for (let axis = 0; axis < 3; axis++) {
          const goal = clamp(g.target[axis] - g.origin[axis] + g.normal[axis] * g.direction * .025 * g.strength, -.08, .08);
          f[j + axis] += (goal - d[j + axis]) * 1800 * g.weights[t] * soft;
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
