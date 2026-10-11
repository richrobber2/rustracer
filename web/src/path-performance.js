export const PATH_PRESETS = Object.freeze({
  fast: { label: 'Fast', quality: 0.5, bounces: 2, pixels: 200_000, transmission: 2, glossy: 0.5 },
  balanced: { label: 'Balanced', quality: 0.75, bounces: 3, pixels: 500_000, transmission: 4, glossy: 0.25 },
  detail: { label: 'Detail', quality: 1, bounces: 5, pixels: 1_500_000, transmission: 10, glossy: 0 },
});

// Path tracing uses CSS-pixel resolution, independent of a phone's high-DPI screen.
// The pixel budget also prevents fullscreen/large displays from multiplying the work.
export function renderPixelRatio({ width, height, dpr = 1, quality, path, pixelBudget }) {
  const requested = Math.min(dpr, path ? 1 : 2) * quality;
  if (!path) return requested;
  return Math.min(requested, Math.sqrt(pixelBudget / (Math.max(1, width) * Math.max(1, height))));
}

// Delay expensive samples until orbit/zoom (including damping) has settled.
export class PathTraceScheduler {
  constructor(settleMs = 180) {
    this.settleMs = settleMs;
    this.reset();
  }

  reset() {
    this.interacting = false;
    this.settleAt = 0;
    this.cameraDirty = true;
  }

  cameraChanged(now) {
    this.cameraDirty = true;
    this.settleAt = now + this.settleMs;
  }

  begin(now) { this.interacting = true; this.cameraChanged(now); }
  end(now) { this.interacting = false; this.cameraChanged(now); }

  render({ now, tracer, rasterize, paused, sampleLimit, hidden }) {
    if (hidden) return 'hidden';
    if (this.interacting || now < this.settleAt) {
      rasterize();
      return 'preview';
    }
    if (this.cameraDirty) {
      tracer.updateCamera();
      this.cameraDirty = false;
    }
    if (paused) {
      if (tracer.samples === 0) rasterize();
      return 'paused';
    }
    if (tracer.samples >= sampleLimit) return 'complete';
    tracer.renderSample();
    return tracer.samples >= sampleLimit ? 'complete' : 'tracing';
  }
}
