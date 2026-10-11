// Cage samples in a rear orthographic projection. No anatomical UV or stress inference.
export function buttockSamples(system) {
  return posteriorSamples(system).filter(p => p.region === 9);
}
export function posteriorSamples(system) {
  const points = [];
  for (let i = 0; i < system.count; i++) {
    if (system.regions[i] !== 9 && system.regions[i] !== 10) continue;
    const j = i * 3;
    points.push({ id: i, region: system.regions[i], x: system.rest[j], y: system.rest[j + 1],
      mm: Math.hypot(system.offset[j], system.offset[j + 1], system.offset[j + 2]) * 1000 });
  }
  return points;
}
export class ButtockMap {
  constructor(canvas, status) {
    this.canvas = canvas; this.context = canvas.getContext('2d'); this.status = status;
    this.next = 0; this.system = null; this.clear();
  }
  clear() {
    this.system = null;
    const c = this.context; if (c) { c.fillStyle = '#101820'; c.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    this.status.textContent = 'Choose a body to see tissue samples.';
  }
  setSystem(system) {
    this.system = system; this.next = 0;
    const points = posteriorSamples(system);
    if (!points.length) { this.clear(); return; }
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    this.minX = Math.min(...xs); this.maxX = Math.max(...xs);
    this.minY = Math.min(...ys); this.maxY = Math.max(...ys);
    this.update(Infinity); this.next = 0;
  }
  update(now) {
    if (!this.system || !this.context || now < this.next) return;
    this.next = now + 100;
    const c = this.context, w = this.canvas.width, h = this.canvas.height, points = posteriorSamples(this.system);
    c.fillStyle = '#101820'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2b3c48'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(w / 2, 16); c.lineTo(w / 2, h - 24); c.stroke();
    c.fillStyle = '#a7b7c3'; c.font = '11px system-ui'; c.textAlign = 'center';
    c.fillText('Screen left', w * .25, h - 7); c.fillText('Screen right', w * .75, h - 7);
    // Flip X to match the rear camera: +X appears on screen left.
    let maximum = 0, sum = 0, glutePeak = 0, backPeak = 0;
    for (const p of points) {
      const x = 16 + (this.maxX - p.x) / Math.max(1e-6, this.maxX - this.minX) * (w - 32);
      const y = 16 + (this.maxY - p.y) / Math.max(1e-6, this.maxY - this.minY) * (h - 46);
      const t = Math.min(1, p.mm / 50);
      // Match the 3D displacement palette and its 50 mm saturation scale.
      c.fillStyle = `rgb(${Math.round(Math.min(1, t * 2) * 255)} ${Math.round((.35 + .55 * (1 - Math.abs(t * 2 - 1))) * 255)} ${Math.round((1 - t) * 255)})`;
      c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
      maximum = Math.max(maximum, p.mm); sum += p.mm;
      if (p.region === 10) backPeak = Math.max(backPeak, p.mm); else glutePeak = Math.max(glutePeak, p.mm);
    }
    c.textAlign = 'left'; c.fillStyle = '#a7b7c3';
    c.fillText('Lower back', 6, 11);
    const back = points.filter(p => p.region === 10), glutes = points.filter(p => p.region === 9);
    if (back.length && glutes.length) {
      const boundary = (Math.min(...back.map(p => p.y)) + Math.max(...glutes.map(p => p.y))) / 2;
      const y = 16 + (this.maxY - boundary) / Math.max(1e-6, this.maxY - this.minY) * (h - 46);
      c.strokeStyle = '#2b3c48'; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      c.fillText('Buttocks', 6, y + 12);
    }
    this.canvas.setAttribute('aria-label', `Rear pelvis and lower-back displacement: peak ${maximum.toFixed(1)} millimeters, mean ${(sum / points.length).toFixed(1)} millimeters across ${points.length} samples; buttocks ${glutePeak.toFixed(2)} millimeters, lower back ${backPeak.toFixed(2)} millimeters`);
    this.status.textContent = `${this.system.paused ? 'Paused · ' : this.system.sleeping ? 'Settled · ' : ''}${points.length} samples · peak ${maximum.toFixed(1)} mm · mean ${(sum / points.length).toFixed(1)} mm · buttocks ${glutePeak.toFixed(2)} mm · back ${backPeak.toFixed(2)} mm`;
  }
}
