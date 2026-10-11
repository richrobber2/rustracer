import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBodyLab } from '../src/body-lab.js';

test('real creator slider handlers retain independent sides and Both overwrites them', t => {
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  t.after(() => { globalThis.document = priorDocument; globalThis.window = priorWindow; });
  const elements = new Map();
  class Element {
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    append() {}
    addEventListener() {}
    getContext() { return null; }
  }
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) { const element = new Element(); element.id = id; }
  globalThis.document = { getElementById: id => elements.get(id), createElement: () => new Element(), querySelectorAll: () => [], addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  elements.get('shape-buttSide').value = 'Left';
  createBodyLab({ renderer: { domElement: new Element() }, camera: {}, controls: {}, requestRealtime() {}, notify() {} });
  const choose = side => { elements.get('shape-buttSide').value = side; elements.get('shape-buttSide').onchange(); };
  const edit = (id, value) => { const slider = elements.get(`shape-${id}`); slider.value = value; slider.oninput(); };
  edit('gluteMuscle', 1.35); edit('buttFat', 1.6);
  choose('Right'); assert.equal(elements.get('shape-gluteMuscle').value, '1'); assert.equal(elements.get('shape-buttFat').value, '1');
  edit('gluteMuscle', .8); edit('buttFat', .6);
  choose('Left'); assert.equal(elements.get('shape-gluteMuscle').value, '1.35'); assert.equal(elements.get('shape-buttFat').value, '1.6');
  assert.equal(elements.get('shape-gluteMuscle-value').value, '135%');
  choose('Both'); edit('gluteMuscle', 1.1); edit('buttFat', 1.2);
  for (const side of ['Left', 'Right']) { choose(side); assert.equal(elements.get('shape-gluteMuscle').value, '1.1'); assert.equal(elements.get('shape-buttFat').value, '1.2'); }
  elements.get('proportions-reset').onclick();
  for (const side of ['Left', 'Right']) { choose(side); assert.equal(elements.get('shape-gluteMuscle').value, '1'); assert.equal(elements.get('shape-buttFat').value, '1'); }
});
