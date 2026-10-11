// Smooth rest-shape edits for adult character proportions. No change of age.
export const PROPORTIONS = [
  { id: 'height', label: 'Height', min: .88, max: 1.16 },
  { id: 'shoulders', label: 'Shoulder breadth', min: .8, max: 1.25 },
  { id: 'chest', label: 'Chest volume', min: .75, max: 1.35 },
  { id: 'waist', label: 'Waist', min: .72, max: 1.4 },
  { id: 'hips', label: 'Hip breadth', min: .8, max: 1.35 },
  { id: 'thighs', label: 'Thigh volume', min: .8, max: 1.3 },
  { id: 'genitalLength', label: 'Genital length', min: .65, max: 1.5 },
  { id: 'genitalWidth', label: 'Genital width', min: .65, max: 1.5 },
];
export const DEFAULT_PROPORTIONS = Object.fromEntries(PROPORTIONS.map(p => [p.id, 1]));
export function sanitizeProportions(value = {}) {
  return Object.fromEntries(PROPORTIONS.map(p => [p.id, Number.isFinite(value[p.id]) ? Math.max(p.min, Math.min(p.max, value[p.id])) : 1]));
}
const bell = (x, center, width) => Math.exp(-(((x - center) / width) ** 2));
export class BodyMorph {
  constructor(positions, genitalWeights, data) {
    this.base = new Float32Array(positions); this.result = this.base.slice();
    this.genital = new Float32Array(genitalWeights || positions.length / 3);
    this.anchor = data.genitalAnchor;
    this.fields = new Float32Array(this.base.length / 3 * 5);
    for (let i = 0; i < this.base.length / 3; i++) {
      const y = this.base[i * 3 + 1] / data.height, x = Math.abs(this.base[i * 3]) / data.height, at = i * 5;
      this.fields[at] = bell(y, .76, .10);
      this.fields[at + 1] = bell(y, .69, .065) * bell(x, 0, .15);
      this.fields[at + 2] = bell(y, .59, .065) * bell(x, 0, .15);
      this.fields[at + 3] = bell(y, .49, .075);
      this.fields[at + 4] = bell(y, .35, .095);
    }
  }
  apply(input) {
    const p = sanitizeProportions(input), b = this.base, o = this.result, f = this.fields;
    for (let i = 0; i < b.length / 3; i++) {
      const j = i * 3, k = i * 5, g = this.genital[i];
      const breadth = 1 + (p.shoulders - 1) * f[k] + (p.chest - 1) * .35 * f[k + 1] + (p.waist - 1) * f[k + 2] + (p.hips - 1) * f[k + 3] + (p.thighs - 1) * .35 * f[k + 4];
      const depth = 1 + (p.chest - 1) * f[k + 1] + (p.waist - 1) * f[k + 2] + (p.hips - 1) * .45 * f[k + 3] + (p.thighs - 1) * f[k + 4];
      o[j] = b[j] * breadth * (1 + (p.genitalWidth - 1) * g);
      o[j + 1] = (b[j + 1] + (b[j + 1] - this.anchor[1]) * (p.genitalLength - 1) * g) * p.height;
      o[j + 2] = (b[j + 2] + (b[j + 2] - this.anchor[2]) * (p.genitalWidth - 1) * g) * depth;
    }
    return o;
  }
}
export function readCharacter(value) {
  if (!value || value.version !== 1 || !['male', 'female'].includes(value.sex)) throw new Error('Unsupported character preset');
  return { version: 1, sex: value.sex, proportions: sanitizeProportions(value.proportions), tissue: value.tissue && typeof value.tissue === 'object' ? value.tissue : {} };
}
