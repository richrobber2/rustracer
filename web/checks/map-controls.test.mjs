// Exercise actual app pointer handlers with DOM/texture decoding stubs; no WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createBodyLab } from '../src/body-lab.js';
import { TissueSystem } from '../src/tissue-physics.js';
import { ButtockMap, mapSamples, MAP_REGIONS } from '../src/buttock-map.js';

test('actual map controls capture a displaced sample, cancel, and release on panel change', async t => {
  const original = Object.fromEntries(['document', 'window', 'self', 'fetch', 'createImageBitmap'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of Object.entries(original)) globalThis[key] = value; });
  const elements = new Map(), context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {}, fill() {} };
  class Element {
    constructor() { this.style = {}; this.listeners = new Map(); this.captures = new Set(); this.classList = { toggle() {} }; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    append() {}
    replaceChildren() {}
    setAttribute() {}
    getContext() { return context; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    hasPointerCapture(id) { return this.captures.has(id); }
    setPointerCapture(id) { this.captures.add(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 240 }; }
    emit(type, event) { this.listeners.get(type)(event); }
  }
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [, tag, id] of html.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(); element.id = id; element.value = tag.match(/\bvalue="([^"]+)"/)?.[1] || '';
  }
  // Read the same defaults as the native controls.
  for (const match of html.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*>/g)) elements.get(match[1]).value = match[0].match(/\bvalue="([^"]+)"/)?.[1] || '';
  for (const [, id, options] of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) elements.get(id).value = (options.match(/<option\b[^>]*value="([^"]+)"[^>]*\bselected\b/) || options.match(/<option\b[^>]*value="([^"]+)"/))?.[1] || '';
  const mapCanvas = elements.get('buttock-map'); mapCanvas.width = 320; mapCanvas.height = 240;
  globalThis.document = { baseURI: 'https://rustracer.hihihihi-mr.chatgpt.site/', hidden: false, getElementById: id => elements.get(id), createElement: () => new Element(), querySelectorAll: () => [], addEventListener() {} };
  globalThis.window = { addEventListener() {} }; globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });
  globalThis.fetch = async (url, options) => {
    const value = String(url);
    if (value.includes('female-cage.json')) return new Response(fs.readFileSync(new URL('../public/bodies/female-cage.json', import.meta.url)), { headers: { 'content-type': 'application/json' } });
    if (value.includes('female.glb')) return new Response(fs.readFileSync(new URL('../public/bodies/female.glb', import.meta.url)));
    return original.fetch(url, options); // Embedded texture blob URL only.
  };
  const controls = { enabled: true }, renderer = { domElement: new Element() }, notifications = [];
  const lab = createBodyLab({ renderer, camera: new THREE.PerspectiveCamera(), controls, onReady() {}, requestRealtime() {}, notify(message) { notifications.push(message); } });
  await lab.load('female'); assert.ok(lab.active, notifications.join('; '));
  const data = JSON.parse(fs.readFileSync(new URL('../public/bodies/female-cage.json', import.meta.url))), system = new TissueSystem(data);
  for (let f = 0; f < 20; f++) { lab.update(1 / 60, f * 1000 / 60); system.step(1 / 60); }
  const projection = new ButtockMap(mapCanvas, { textContent: '' }, 'upper'); projection.setSystem(system);
  const sample = mapSamples(system, MAP_REGIONS.upper).filter(p => p.region === 13 && p.x > 0).reduce((a, b) => a.x > b.x ? a : b), pixel = projection.project(sample);
  let defaultsBlocked = 0;
  const event = { pointerId: 7, button: 0, clientX: pixel.x, clientY: pixel.y, cancelable: true, preventDefault() { defaultsBlocked++; }, stopImmediatePropagation() {} };
  mapCanvas.emit('pointerdown', event); assert.equal(controls.enabled, false); assert.ok(mapCanvas.hasPointerCapture(7));
  assert.match(elements.get('buttock-map-status').textContent, /grab anchor: Hands/);
  mapCanvas.emit('pointermove', { ...event, clientX: pixel.x + 10 }); lab.update(1 / 60, 500);
  mapCanvas.emit('pointercancel', event); assert.equal(controls.enabled, true); assert.equal(mapCanvas.hasPointerCapture(7), false); assert.ok(defaultsBlocked >= 3);
  // After cancel, selecting a different map view and leaving the panel release the new grab.
  elements.get('tissue-mapRegion').value = 'pelvis'; elements.get('tissue-mapRegion').onchange();
  projection.setMode('pelvis'); const glute = mapSamples(system, MAP_REGIONS.pelvis).find(p => p.region === 9 && p.x > .03), at = projection.project(glute);
  mapCanvas.emit('pointerdown', { ...event, pointerId: 8, clientX: at.x, clientY: at.y }); assert.equal(controls.enabled, false);
  lab.setPanel('studio'); assert.equal(controls.enabled, true); assert.equal(mapCanvas.hasPointerCapture(8), false);
});
