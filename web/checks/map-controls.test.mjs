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
  const dots = [];
  const elements = new Map(), context = { fillRect() { dots.length = 0; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc(x, y, radius) { if (radius === 3.5) dots.push({ x, y }); }, fill() {} };
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
  const controls = { enabled: true, target: new THREE.Vector3(), update() {} }, renderer = { domElement: new Element() }, notifications = [];
  let bodyObject;
  const lab = createBodyLab({ renderer, camera: new THREE.PerspectiveCamera(), controls, onReady(object) { bodyObject = object; }, requestRealtime() {}, notify(message) { notifications.push(message); } });
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
  // The front abdominal view must use its own projection, including selection
  // by the new region IDs and the legacy combined abdomen selector.
  elements.get('focus-abs').onclick(); assert.equal(elements.get('tissue-mapRegion').value, 'abs'); assert.equal(elements.get('tissue-region').value, '2');
  elements.get('tissue-region').value = '14'; elements.get('tissue-region').onchange(); assert.equal(elements.get('tissue-mapRegion').value, 'abs');
  projection.setMode('abs'); const abs = mapSamples(system, MAP_REGIONS.abs).find(p => p.region === 14 && p.x > .03), front = projection.project(abs);
  mapCanvas.emit('pointerdown', { ...event, pointerId: 9, clientX: front.x, clientY: front.y }); assert.equal(controls.enabled, false); assert.ok(mapCanvas.hasPointerCapture(9));
  assert.match(elements.get('buttock-map-status').textContent, /grab anchor: Abs/);
  mapCanvas.emit('pointermove', { ...event, pointerId: 9, clientX: front.x + 10 });
  // A map-mode change cancels the grab and removes the incompatible abs filter.
  elements.get('tissue-mapRegion').value = 'upper'; elements.get('tissue-mapRegion').onchange();
  assert.equal(controls.enabled, true); assert.equal(mapCanvas.hasPointerCapture(9), false); assert.equal(elements.get('tissue-region').value, '-1');
  for (const key of ['absSupport', 'obliqueSupport', 'absCoupling', 'coreCoupling', 'coreBracing', 'absDamping']) {
    elements.get(`tissue-${key}`).value = '.8'; elements.get(`tissue-${key}`).oninput(); assert.equal(elements.get(`tissue-${key}-value`).value, '80%');
  }
  // Exercise muscle controls and a live posed-map grab against the actual rig.
  const shoulder = bodyObject.getObjectByName('upperarm01L'), other = bodyObject.getObjectByName('upperarm01R');
  const rest = shoulder.quaternion.clone(), opposite = other.quaternion.clone();
  elements.get('motion-play').onclick();
  for (let f = 0; f < 90; f++) lab.update(1 / 60, 1000 + f * 1000 / 60);
  assert.ok(shoulder.quaternion.angleTo(rest) > .1); assert.ok(other.quaternion.angleTo(opposite) < 1e-6); assert.match(elements.get('motion-status').textContent, /Muscle loop/);
  const live = dots.reduce((a, b) => a.x < b.x ? a : b), held = shoulder.quaternion.clone();
  mapCanvas.emit('pointerdown', { ...event, pointerId: 10, clientX: live.x, clientY: live.y }); assert.equal(controls.enabled, false);
  for (let f = 0; f < 30; f++) lab.update(1 / 60, 3000 + f * 1000 / 60);
  assert.deepEqual(shoulder.quaternion.toArray(), held.toArray()); assert.match(elements.get('motion-status').textContent, /held during grab/);
  mapCanvas.emit('pointermove', { ...event, pointerId: 10, clientX: live.x + 12 });
  mapCanvas.emit('pointerup', { ...event, pointerId: 10 }); assert.equal(controls.enabled, true);
  lab.pause(); const paused = shoulder.quaternion.clone(); lab.update(1 / 60, 4000); assert.deepEqual(shoulder.quaternion.toArray(), paused.toArray());
  elements.get('motion-reset').onclick(); assert.ok(shoulder.quaternion.angleTo(rest) < 1e-6);
  elements.get('motion-group').value = 'elbow'; elements.get('motion-side').value = '-1'; elements.get('motion-side').onchange();
  elements.get('motion-agonist').value = '.8'; elements.get('motion-agonist').oninput();
  for (let f = 0; f < 60; f++) lab.update(1 / 60, 5000 + f * 1000 / 60);
  assert.ok(bodyObject.getObjectByName('lowerarm01R').quaternion.angleTo(new THREE.Quaternion()) > .2);
  assert.ok(bodyObject.getObjectByName('lowerarm01L').quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
  elements.get('motion-hold').onclick(); const elbow = bodyObject.getObjectByName('lowerarm01R').quaternion.clone();
  lab.update(1 / 60, 6200); assert.deepEqual(bodyObject.getObjectByName('lowerarm01R').quaternion.toArray(), elbow.toArray());
  assert.equal(elements.get('motion-hold').textContent, 'Run muscles');
});
