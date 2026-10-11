import { eligibleGrabAnchor } from './grab-points.js';
// Current cage samples, shared by projection, drawing and picking.
export const MAP_REGIONS = { pelvis: [9, 10], upper: [4, 10, 11, 12, 13], abs: [2, 14, 15], anal: [16] };
export function mapModeForRegion(region, current = 'upper') {
  if (region === 16) return 'anal';
  if (MAP_REGIONS.abs.includes(region)) return 'abs';
  if (region === 9) return 'pelvis';
  if (region === 10) return current === 'upper' ? 'upper' : 'pelvis';
  if ([4, 11, 12, 13].includes(region)) return 'upper';
  return current;
}
export function buttockSamples(system) {
  return posteriorSamples(system).filter(p => p.region === 9);
}
export function posteriorSamples(system) {
  return mapSamples(system, MAP_REGIONS.pelvis);
}
export function mapSamples(system, regions) {
  const points = [];
  for (let i = 0; i < system.count; i++) {
    if (!regions.includes(system.regions[i])) continue;
    const j = i * 3;
    const rest = Array.from(system.rest.slice(j, j + 3)), material = rest.map((v, k) => v + system.offset[j + k]);
    const current = system.pose ? system.pose.point(i, material) : material, posedRest = system.pose ? system.pose.point(i, rest) : rest;
    points.push({ id: i, region: system.regions[i], x: current[0], y: current[1], z: current[2], restX: posedRest[0], restY: posedRest[1], restZ: posedRest[2],
      mm: Math.hypot(system.offset[j], system.offset[j + 1], system.offset[j + 2]) * 1000 });
  }
  return points;
}
export class ButtockMap {
  constructor(canvas, status, mode = 'pelvis') {
    this.canvas = canvas; this.context = canvas.getContext('2d'); this.status = status;
    this.mode = MAP_REGIONS[mode] ? mode : 'pelvis'; this.selectedId = -1;
    this.next = 0; this.system = null; this.clear();
  }
  clear() {
    this.system = null;
    this.drawnPoints = null;
    this.selectedId = -1;
    const c = this.context; if (c) { c.fillStyle = '#101820'; c.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    this.status.textContent = 'Choose a body to see tissue samples.';
  }
  setSystem(system) {
    this.system = system; this.next = 0;
    const points = mapSamples(system, MAP_REGIONS[this.mode]);
    if (!points.length) { this.clear(); return; }
    this.fit(points);
    this.update(Infinity); this.next = 0;
  }
  fit(points) {
    const system = this.system;
    const xs = points.map(p => p.restX), ys = points.map(p => this.mapY(p, true));
    this.minX = Math.min(...xs); this.maxX = Math.max(...xs);
    this.minY = Math.min(...ys); this.maxY = Math.max(...ys);
    const margin = Math.max(...points.map(p => system.limits[p.id])) + .01;
    this.scale = Math.min((this.canvas.width - 32) / (this.maxX - this.minX + margin * 2), (this.canvas.height - 46) / (this.maxY - this.minY + margin * 2));
    this.centerX = (this.minX + this.maxX) / 2; this.centerY = (this.minY + this.maxY) / 2;
  }
  setMode(mode) {
    if (!MAP_REGIONS[mode]) return;
    this.mode = mode;
    if (this.system) this.setSystem(this.system);
  }
  mapY(point, rest = false) {
    if (this.mode !== 'anal' || !this.system?.analFrame) return rest ? point.restY : point.y;
    const t = this.system.analFrame.tangent;
    return t[1] * (rest ? point.restY : point.y) + t[2] * (rest ? point.restZ : point.z);
  }
  project(point) { return { x: this.canvas.width / 2 + (this.mode === 'abs' ? 1 : -1) * (point.x - this.centerX) * this.scale, y: (this.canvas.height - 30) / 2 - (this.mapY(point) - this.centerY) * this.scale }; }
  worldDelta(dx, dy) {
    const t = this.mode === 'anal' ? this.system?.analFrame?.tangent || [0, 1, 0] : [0, 1, 0];
    return [(this.mode === 'abs' ? 1 : -1) * dx / this.scale, -dy / this.scale * t[1], -dy / this.scale * t[2]];
  }
  pick(x, y, radius = 11) {
    if (!this.system || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    let nearest = null, best = radius * radius;
    // During animation, hit the dots the user actually sees at 10 Hz, then
    // resolve that anchor to its latest posed position before holding the rig.
    const points = this.system.pose && this.drawnPoints ? this.drawnPoints : mapSamples(this.system, MAP_REGIONS[this.mode]);
    for (const point of points) {
      if (!eligibleGrabAnchor(this.system, point.id)) continue;
      const pixel = this.project(point), distance = (pixel.x - x) ** 2 + (pixel.y - y) ** 2;
      if (distance < best || (nearest && Math.abs(distance - best) < 1e-8 && (this.mode === 'abs' ? point.z > nearest.z : point.z < nearest.z))) { nearest = point; best = distance; }
    }
    return nearest && this.system.pose ? mapSamples(this.system, MAP_REGIONS[this.mode]).find(p => p.id === nearest.id) : nearest;
  }
  select(id) { this.selectedId = id; this.next = 0; this.update(Infinity); this.next = 0; }
  update(now) {
    if (!this.system || !this.context || now < this.next) return;
    this.next = now + 100;
    const c = this.context, w = this.canvas.width, h = this.canvas.height, points = mapSamples(this.system, MAP_REGIONS[this.mode]).sort((a, b) => this.mode === 'abs' ? a.z - b.z : b.z - a.z);
    if (this.system.pose) this.fit(points);
    this.drawnPoints = points;
    c.fillStyle = '#101820'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2b3c48'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(w / 2, 16); c.lineTo(w / 2, h - 24); c.stroke();
    c.fillStyle = '#a7b7c3'; c.font = '11px system-ui'; c.textAlign = 'center';
    c.fillText('Screen left', w * .25, h - 7); c.fillText('Screen right', w * .75, h - 7);
    // Rear maps flip X; the front abs map follows the front camera.
    let maximum = 0, sum = 0, glutePeak = 0, backPeak = 0;
    const peaks = {};
    for (const p of points) {
      const { x, y } = this.project(p);
      const t = Math.min(1, p.mm / 50);
      // Match the 3D displacement palette and its 50 mm saturation scale.
      c.fillStyle = `rgb(${Math.round(Math.min(1, t * 2) * 255)} ${Math.round((.35 + .55 * (1 - Math.abs(t * 2 - 1))) * 255)} ${Math.round((1 - t) * 255)})`;
      c.globalAlpha = eligibleGrabAnchor(this.system, p.id) ? 1 : .3;
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
      maximum = Math.max(maximum, p.mm); sum += p.mm;
      if (p.region === 10) backPeak = Math.max(backPeak, p.mm); else glutePeak = Math.max(glutePeak, p.mm);
      peaks[p.region] = Math.max(peaks[p.region] || 0, p.mm);
    }
    c.textAlign = 'left'; c.fillStyle = '#a7b7c3';
    c.fillText(this.mode === 'anal' ? 'Rear / underside · anal surface' : this.mode === 'abs' ? 'Front · abs / obliques' : this.mode === 'pelvis' ? 'Lower back' : 'Upper back / shoulders', 6, 11);
    const back = points.filter(p => p.region === 10), glutes = points.filter(p => p.region === 9);
    if (this.mode === 'pelvis' && back.length && glutes.length) {
      const boundary = (Math.min(...back.map(p => p.y)) + Math.max(...glutes.map(p => p.y))) / 2;
      const y = this.project({ x: 0, y: boundary }).y;
      c.strokeStyle = '#2b3c48'; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      c.fillText('Buttocks', 6, y + 12);
    }
    const selected = points.find(p => p.id === this.selectedId);
    if (selected) {
      const { x, y } = this.project(selected);
      c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.stroke(); c.lineWidth = 1;
    }
    if (this.mode === 'abs') for (const p of mapSamples(this.system, [3, 10])) peaks[p.region] = Math.max(peaks[p.region] || 0, p.mm);
    const readings = this.mode === 'anal' ? `anal tissue ${(peaks[16] || 0).toFixed(2)} mm` : this.mode === 'abs' ? `abs ${(peaks[14] || 0).toFixed(2)} mm · obliques ${(peaks[15] || 0).toFixed(2)} mm · linked back ${(peaks[10] || 0).toFixed(2)} mm · pelvis ${(peaks[3] || 0).toFixed(2)} mm` : this.mode === 'pelvis' ? `buttocks ${glutePeak.toFixed(2)} mm · back ${backPeak.toFixed(2)} mm` : `upper back ${(peaks[11] || 0).toFixed(2)} mm · shoulders ${(peaks[12] || 0).toFixed(2)} mm · hands ${(peaks[13] || 0).toFixed(2)} mm`;
    const anchor = selected ? ` · grab anchor: ${this.system.regionNames[selected.region]}` : '';
    this.canvas.setAttribute('aria-label', `${this.mode === 'abs' ? 'Front' : 'Rear'} tissue displacement: peak ${maximum.toFixed(1)} millimeters, mean ${(sum / points.length).toFixed(1)} millimeters across ${points.length} samples; ${this.mode === 'abs' ? '' : `lower back ${backPeak.toFixed(2)} millimeters; `}${readings}${anchor}`);
    this.status.textContent = `${this.system.paused ? 'Paused · ' : this.system.sleeping ? 'Settled · ' : ''}${points.length} samples · peak ${maximum.toFixed(1)} mm · mean ${(sum / points.length).toFixed(1)} mm · ${readings}${anchor}`;
  }
}
