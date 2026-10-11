// Smooth rest-shape edits for adult character proportions. No change of age.
import { analField } from './anal-surface.js';
import { sanitizeSkin } from './skin-material.js';
export const PROPORTIONS = [
  { id: 'height', label: 'Height', min: .88, max: 1.16 },
  { id: 'shoulders', label: 'Shoulder breadth', min: .8, max: 1.25 },
  { id: 'chest', label: 'Chest volume', min: .75, max: 1.35 },
  { id: 'waist', label: 'Waist', min: .72, max: 1.4 },
  { id: 'hips', label: 'Hip breadth', min: .8, max: 1.35 },
  { id: 'gluteMuscle', label: 'Gluteal muscle bulk · proxy', min: .75, max: 1.4 },
  { id: 'buttFat', label: 'Buttock fat padding · proxy', min: .5, max: 1.75 },
  { id: 'thighs', label: 'Thigh volume', min: .8, max: 1.3 },
  { id: 'genitalLength', label: 'Genital length', min: .65, max: 1.5 },
  { id: 'genitalWidth', label: 'Genital width', min: .65, max: 1.5 },
  { id: 'analSize', label: 'Anal surface size', min: .75, max: 1.25 },
  { id: 'analDepth', label: 'Anal recess depth', min: .5, max: 1.5 },
];
export const DEFAULT_PROPORTIONS = { buttocks: 1, ...Object.fromEntries(PROPORTIONS.map(p => [p.id, 1])) };
export function sanitizeProportions(value = {}) {
  // Keep legacy fullness from existing presets; new controls start neutral.
  const result = { buttocks: Number.isFinite(value.buttocks) ? Math.max(.75, Math.min(1.4, value.buttocks)) : 1,
    ...Object.fromEntries(PROPORTIONS.map(p => [p.id, Number.isFinite(value[p.id]) ? Math.max(p.min, Math.min(p.max, value[p.id])) : 1])) };
  for (const side of ['Left', 'Right']) for (const id of ['gluteMuscle', 'buttFat']) {
    const spec = PROPORTIONS.find(p => p.id === id), key = id + side;
    if (Number.isFinite(value[key])) result[key] = Math.max(spec.min, Math.min(spec.max, value[key]));
  }
  return result;
}
const bell = (x, center, width) => Math.exp(-(((x - center) / width) ** 2));
export class BodyMorph {
  constructor(positions, genitalWeights, data, analWeights = null) {
    this.base = new Float32Array(positions); this.result = this.base.slice();
    this.genital = new Float32Array(genitalWeights || positions.length / 3);
    this.anchor = data.genitalAnchor;
    this.anal = analWeights;
    this.analFrame = data.analFrame;
    this.fields = new Float32Array(this.base.length / 3 * 7);
    for (let i = 0; i < this.base.length / 3; i++) {
      const y = this.base[i * 3 + 1] / data.height, x = Math.abs(this.base[i * 3]) / data.height, at = i * 7;
      this.fields[at] = bell(y, .76, .10);
      this.fields[at + 1] = bell(y, .69, .065) * bell(x, 0, .15);
      this.fields[at + 2] = bell(y, .59, .065) * bell(x, 0, .15);
      this.fields[at + 3] = bell(y, .49, .075);
      this.fields[at + 4] = bell(y, .35, .095);
      const z = this.base[i * 3 + 2] / data.height;
      const rear = Math.max(0, Math.min(1, -z / .035));
      const midline = 1 - Math.exp(-((x / .025) ** 2));
      this.fields[at + 5] = bell(y, .48, .055) * rear * midline * (1 - this.genital[i]);
      this.fields[at + 6] = bell(y, .48, .070) * rear * midline * (1 - this.genital[i]);
    }
  }
  apply(input) {
    const p = sanitizeProportions(input), b = this.base, o = this.result, f = this.fields;
    for (let i = 0; i < b.length / 3; i++) {
      const j = i * 3, k = i * 7, g = this.genital[i];
      const side = b[j] > 0 ? 'Left' : 'Right';
      const muscle = p['gluteMuscle' + side] ?? p.gluteMuscle, fat = p['buttFat' + side] ?? p.buttFat;
      const breadth = 1 + (p.shoulders - 1) * f[k] + (p.chest - 1) * .35 * f[k + 1] + (p.waist - 1) * f[k + 2] + (p.hips - 1) * f[k + 3] + (p.thighs - 1) * .35 * f[k + 4];
      const depth = 1 + (p.chest - 1) * f[k + 1] + (p.waist - 1) * f[k + 2] + (p.hips - 1) * .45 * f[k + 3] + (p.thighs - 1) * f[k + 4];
      let x = b[j], y = b[j + 1], z = b[j + 2];
      if (this.anal?.[i] && this.analFrame && (p.analSize !== 1 || p.analDepth !== 1)) {
        const field = analField([x, y, z], this.analFrame), scale = (p.analSize - 1) * this.anal[i];
        const shift = (p.analDepth - 1) * field.depth;
        x += field.u * scale;
        y += this.analFrame.tangent[1] * field.v * scale + this.analFrame.normal[1] * shift;
        z += this.analFrame.tangent[2] * field.v * scale + this.analFrame.normal[2] * shift;
      }
      o[j] = x * breadth * (1 + (p.genitalWidth - 1) * g);
      o[j + 1] = (y + (y - this.anchor[1]) * (p.genitalLength - 1) * g) * p.height;
      o[j + 2] = (z + (z - this.anchor[2]) * (p.genitalWidth - 1) * g) * depth * (1 + (p.buttocks - 1) * f[k + 5]) * (1 + .65 * (muscle - 1) * f[k + 5] + .35 * (fat - 1) * f[k + 6]);
    }
    return o;
  }
}
export function readCharacter(value) {
  if (!value || value.version !== 1 || !['male', 'female'].includes(value.sex)) throw new Error('Unsupported character preset');
  const result = { version: 1, sex: value.sex, proportions: sanitizeProportions(value.proportions), tissue: value.tissue && typeof value.tissue === 'object' ? value.tissue : {} };
  if (value.motion && typeof value.motion === 'object') result.motion = value.motion;
  if (value.appearance && typeof value.appearance === 'object') result.appearance = sanitizeSkin(value.appearance);
  return result;
}
