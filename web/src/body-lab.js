import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TissueSystem } from './tissue-physics.js';
import { isolateButtockWeights } from './buttock-sides.js';
import { ButtockMap, MAP_REGIONS, mapModeForRegion } from './buttock-map.js';
import { isSideRegion } from './upper-body.js';
import { surfaceGrabAnchor } from './grab-points.js';
import { MuscleMotion, CagePose, MUSCLE_GROUPS } from './muscle-motion.js';
import { SurfaceDeformer } from './surface-deformer.js';
import { BodyMorph, PROPORTIONS, DEFAULT_PROPORTIONS, sanitizeProportions, readCharacter } from './body-proportions.js';
import { addAnalSurface } from './anal-surface.js';
import { SkinAppearance, DEFAULT_SKIN, sanitizeSkin } from './skin-material.js';

const $ = id => document.getElementById(id);
const PRESETS = {
  balanced: { stiffness: 45, damping: .5, gravity: .3, tension: 0 },
  soft: { stiffness: 14, damping: .3, gravity: .3, tension: 0 },
  firm: { stiffness: 80, damping: .6, gravity: .3, tension: .45 },
};

function disposeObject(object) {
  object.traverse(node => {
    node.geometry?.dispose();
    node.skeleton?.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue;
      Object.values(material).forEach(v => { if (v?.isTexture) v.dispose(); });
      material.dispose();
    }
  });
}

export function createBodyLab({ renderer, camera, controls, onReady, onMotionView = () => {}, requestRealtime, notify }) {
  let pendingSide = 0;
  let serial = 0, current = null, pointer = null, tool = 'orbit', pendingShape = false, shape = { ...DEFAULT_PROPORTIONS }, loadController = null, nextNormals = 0, averageCpu = 0;
  const raycaster = new THREE.Raycaster(), screen = new THREE.Vector2();
  const plane = new THREE.Plane(), worldPoint = new THREE.Vector3(), localPoint = new THREE.Vector3(), normal = new THREE.Vector3();
  const canvas = renderer.domElement;
  const mapCanvas = $('buttock-map');
  let grabCanvas = canvas, mapDrag = null;
  const buttockMap = new ButtockMap(mapCanvas, $('buttock-map-status'), $('tissue-mapRegion').value);
  const settings = ['stiffness', 'damping', 'gravity', 'tension', 'radius', 'strength', 'genitalCompliance', 'genitalDamping', 'buttCompliance', 'buttDamping', 'lumbarCoupling', 'lumbarSupport', 'lumbarDamping', 'upperCoupling', 'upperSupport', 'shoulderCoupling', 'shoulderSupport', 'handCoupling', 'handSupport'];
  settings.push('absSupport', 'obliqueSupport', 'absCoupling', 'coreCoupling', 'coreBracing', 'absDamping');
  settings.push('analCompliance', 'analDamping');
  const parameterValues = () => ({ ...Object.fromEntries(settings.map(id => [id, Number($(`tissue-${id}`).value)])), buttSide: Number($('tissue-buttSide').value) });
  function setButtons() {
    $('tissue-pause').textContent = current?.system.paused ? 'Resume physics' : 'Pause physics';
    $('tissue-vibrate').setAttribute('aria-pressed', String(Boolean(current?.system.vibration)));
    $('motion-hold').textContent = current?.motion.held ? 'Run muscles' : 'Hold pose';
    $('motion-play').textContent = current?.motion.running ? 'Restart muscle loop' : 'Play muscle loop';
  }
  function resume() {
    if (!current) return;
    requestRealtime(); current.system.paused = false; setButtons();
  }
  function pause() {
    if (!current) return;
    if (pendingShape) applyShape();
    endPointer(); current.system.paused = true; setButtons();
    updateSurface(true);
    $('tissue-status').textContent = 'Physics paused · current shape held';
  }
  function endPointer(event) {
    if (pointer === null) return;
    if (event && event.pointerId !== pointer) return;
    const id = pointer; pointer = null; mapDrag = null;
    current?.system.endGrab(); controls.enabled = true;
    if (grabCanvas.hasPointerCapture(id)) grabCanvas.releasePointerCapture(id);
    grabCanvas = canvas;
  }
  function detach() {
    serial++; endPointer();
    if (current) { current.mesh.material.map = current.skinMap; current.skin.dispose(); }
    current = null; pendingShape = false; buttockMap.clear();
    $('tissue-fields').disabled = true; $('creator-fields').disabled = true; loadController?.abort();
    $('body-model').value = '';
    $('tissue-status').textContent = 'Choose a body to start the tissue experiment.';
    canvas.style.cursor = '';
    setPanel('studio');
    for (const button of document.querySelectorAll('[data-body]')) button.setAttribute('aria-pressed', 'false');
  }
  function setTool(value) {
    endPointer(); tool = value;
    for (const button of document.querySelectorAll('[data-tissue-tool]')) {
      const active = button.dataset.tissueTool === value;
      button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active);
    }
    canvas.style.cursor = tool === 'orbit' || !current ? '' : 'crosshair';
    $('tissue-instructions').textContent = tool === 'orbit' ? 'Drag to orbit. Select Press or Pull to touch the body.'
      : `${tool === 'press' ? 'Press into' : 'Pull'} the surface, then drag. Release to watch it recover. Empty space still rotates the view.`;
  }
  function applyView() {
    if (!current) return;
    const view = $('tissue-view').value, material = current.mesh.material;
    current.skin.setView(view);
    material.needsUpdate = true;
    updateSurface(true, true);
  }
  function displaySkin() {
    const skin = current?.skin.settings || DEFAULT_SKIN;
    $('skin-finish').value = skin.finish;
    $('skin-detail').value = skin.detail; $('skin-detail-value').value = `${Math.round(skin.detail * 100)}%`;
    $('skin-roughness').value = skin.roughness; $('skin-roughness-value').value = skin.roughness.toFixed(2);
    $('skin-buttockTexture').value = skin.buttockTexture; $('skin-buttockTexture-value').value = `${Math.round(skin.buttockTexture * 100)}%`;
    $('skin-detail').disabled = $('skin-roughness').disabled = $('skin-buttockTexture').disabled = skin.finish === 'original';
  }
  function showSkin() { if ($('tissue-view').value !== 'skin') { $('tissue-view').value = 'skin'; applyView(); } }
  for (const id of ['detail', 'roughness', 'buttockTexture']) $(`skin-${id}`).oninput = () => {
    if (!current) return;
    requestRealtime(); current.skin.configure({ [id]: Number($(`skin-${id}`).value) }); showSkin(); displaySkin();
  };
  $('skin-finish').onchange = () => {
    if (!current) return;
    requestRealtime(); current.skin.configure({ finish: $('skin-finish').value }); showSkin(); displaySkin();
  };
  $('skin-reset').onclick = () => { if (current) { requestRealtime(); current.skin.configure(DEFAULT_SKIN); showSkin(); displaySkin(); } };
  function updateSurface(normals = false, force = false) {
    if (!current) return false;
    return current.deformer.update(current.system.offset, { normals, force, heat: $('tissue-view').value === 'heat' });
  }
  function shapeValue(id) {
    const side = $('shape-buttSide').value;
    return ['gluteMuscle', 'buttFat'].includes(id) && side !== 'Both' ? shape[id + side] ?? shape[id] : shape[id];
  }
  function displayShape() {
    for (const p of PROPORTIONS) {
      $(`shape-${p.id}`).value = shapeValue(p.id);
      $(`shape-${p.id}-value`).value = `${Math.round(shapeValue(p.id) * 100)}%`;
    }
  }
  function applyShape() {
    if (!current) return;
    const changedSide = pendingSide; pendingSide = 0;
    endPointer(); pendingShape = false;
    current.deformer.setRest(current.morph.apply(shape));
    current.system.configure({ buttMuscle: 1, buttFat: 1,
      buttMuscleLeft: shape.gluteMuscleLeft ?? shape.gluteMuscle, buttMuscleRight: shape.gluteMuscleRight ?? shape.gluteMuscle,
      buttFatLeft: shape.buttFatLeft ?? shape.buttFat, buttFatRight: shape.buttFatRight ?? shape.buttFat });
    current.system.setRest(current.cageMorph.apply(shape), shape.height * Math.cbrt(shape.genitalLength * shape.genitalWidth ** 2), changedSide);
    for (const { mesh, morph } of current.accessories) {
      mesh.geometry.attributes.position.array.set(morph.apply(shape));
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.boundingBox = null; mesh.boundingSphere = null;
    }
    current.motion.setShape(shape); current.pose.refresh(current.motion.version);
    updateSurface(true, true);
    buttockMap.setSystem(current.system);
    current.mesh.geometry.computeBoundingBox(); current.mesh.geometry.computeBoundingSphere();
    current.mesh.geometry.boundingSphere.radius += .15;
    current.mesh.boundingBox = null; current.mesh.boundingSphere = null;
    current.mesh.computeBoundingSphere(); current.mesh.boundingSphere.radius += .15;
    current.mesh.computeBoundingBox(); current.mesh.boundingBox.expandByScalar(.15);
    $('creator-status').textContent = `${current.sex === 'female' ? 'Female' : 'Male'} · ${(current.data.height * shape.height).toFixed(2)} m · proportions applied`;
  }
  function setPanel(name) {
    endPointer();
    for (const section of document.querySelectorAll('[data-panel]')) section.hidden = section.dataset.panel !== name;
    for (const button of document.querySelectorAll('[data-panel-tab]')) {
      const selected = button.dataset.panelTab === name;
      button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
  }
  for (const button of document.querySelectorAll('[data-panel-tab]')) {
    button.onclick = () => setPanel(button.dataset.panelTab);
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const tabs = [...document.querySelectorAll('[data-panel-tab]')];
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[index].click(); tabs[index].focus();
    };
  }
  for (const p of PROPORTIONS) {
    const row = document.createElement('div'); row.className = 'proportion-control';
    const label = document.createElement('label'); label.className = 'slider-label'; label.htmlFor = `shape-${p.id}`; label.textContent = p.label;
    const output = document.createElement('output'); output.id = `shape-${p.id}-value`; output.value = '100%'; label.append(output);
    const input = document.createElement('input'); input.id = `shape-${p.id}`; input.type = 'range'; input.min = p.min; input.max = p.max; input.step = '.01'; input.value = '1';
    input.oninput = () => {
      const side = $('shape-buttSide').value;
      const bilateral = !['gluteMuscle', 'buttFat'].includes(p.id) || side === 'Both';
      const changedSide = bilateral ? 0 : side === 'Left' ? 1 : -1;
      pendingSide = pendingShape && pendingSide !== changedSide ? 0 : changedSide;
      if (bilateral) {
        shape[p.id] = Number(input.value);
        delete shape[p.id + 'Left']; delete shape[p.id + 'Right'];
      } else shape[p.id + side] = Number(input.value);
      output.value = `${Math.round(shapeValue(p.id) * 100)}%`;
      pendingShape = true; requestRealtime();
    };
    row.append(label, input); $('proportion-controls').append(row);
  }
  $('shape-buttSide').onchange = displayShape;
  $('proportions-reset').onclick = () => { pendingSide = 0; shape = { ...DEFAULT_PROPORTIONS }; displayShape(); pendingShape = true; requestRealtime(); };
  $('proportions-random').onclick = () => { pendingSide = 0; shape = Object.fromEntries(PROPORTIONS.map(p => [p.id, Math.round((p.min + Math.random() * (p.max - p.min)) * 100) / 100])); displayShape(); pendingShape = true; requestRealtime(); };
  function focusRegion(region, rear = false) {
    if (!current) return;
    if (pendingShape) applyShape();
    const p = new THREE.Vector3(), a = current.system.rest; let count = 0;
    for (let i = 0; i < current.system.count; i++) if (current.system.regions[i] === region) {
      const point = current.pose.point(i, Array.from(a.slice(i * 3, i * 3 + 3))); p.x += point[0]; p.y += point[1]; p.z += point[2]; count++;
    }
    p.multiplyScalar(1 / Math.max(1, count)); current.mesh.localToWorld(p);
    const direction = new THREE.Vector3(0, .08, rear ? -.55 : .55).transformDirection(current.mesh.matrixWorld).multiplyScalar(.55 * shape.height * current.object.scale.x);
    controls.target.copy(p); camera.position.copy(p).add(direction); camera.lookAt(p); controls.update();
  }
  $('focus-pelvis').onclick = () => focusRegion(8);
  $('focus-anal').onclick = () => {
    if (!current) return;
    endPointer(); if (pendingShape) applyShape();
    const center = new THREE.Vector3(), a = current.system.rest; let count = 0;
    for (let i = 0; i < current.system.count; i++) if (current.system.regions[i] === 16) {
      center.add(new THREE.Vector3(...current.pose.point(i, Array.from(a.slice(i * 3, i * 3 + 3))))); count++;
    }
    if (!count) return;
    center.multiplyScalar(1 / count); current.mesh.localToWorld(center);
    const direction = new THREE.Vector3(...current.data.analFrame.normal).transformDirection(current.mesh.matrixWorld).multiplyScalar(.18 * shape.height * current.object.scale.x);
    controls.target.copy(center); camera.position.copy(center).add(direction); camera.lookAt(center); controls.update();
    current.system.configure({ region: 16 }); $('tissue-region').value = '16'; setMapMode('anal');
    buttockMap.next = 0; setPanel('physics');
  };
  $('focus-buttocks').onclick = () => focusRegion(9, true);
  $('focus-upper').onclick = () => focusRegion(11, true);
  $('focus-abs').onclick = () => {
    if (!current) return;
    endPointer(); focusRegion(14); setMapMode('abs');
    current.system.configure({ region: 2 }); $('tissue-region').value = '2';
    buttockMap.next = 0; setPanel('physics');
  };
  const snapshot = () => ({ version: 1, sex: current.sex, proportions: { ...shape }, tissue: { ...current.system.parameters, ...parameterValues() }, motion: current.motion.snapshot(), appearance: { ...current.skin.settings } });
  const restoreCharacter = value => { const character = readCharacter(value); load(character.sex, character); };
  for (const button of document.querySelectorAll('[data-save-character]')) button.onclick = () => {
    if (!current) return;
    try { localStorage.setItem(`rustracer-character-${button.dataset.saveCharacter}`, JSON.stringify(snapshot())); $('creator-status').textContent = `Saved character ${button.dataset.saveCharacter.toUpperCase()} on this device`; }
    catch { notify('Device storage is unavailable. Use Export preset to save a file.', true); }
  };
  for (const button of document.querySelectorAll('[data-load-character]')) button.onclick = () => {
    try { const value = localStorage.getItem(`rustracer-character-${button.dataset.loadCharacter}`); if (!value) { notify('This preset slot is empty.'); return; } restoreCharacter(JSON.parse(value)); }
    catch (error) { notify(`Could not load preset: ${error.message}`, true); }
  };
  $('character-export').onclick = () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `rustracer-${current.sex}-character.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('character-import').onclick = () => $('character-file').click();
  $('character-file').onchange = async () => {
    const file = $('character-file').files[0]; if (!file) return;
    try { if (file.size > 65536) throw new Error('Preset file is too large'); restoreCharacter(JSON.parse(await file.text())); }
    catch (error) { notify(`Could not import preset: ${error.message}`, true); }
    $('character-file').value = '';
  };
  async function load(sex, character = null) {
    if (!['female', 'male'].includes(sex)) return;
    if (!current) setPanel('creator');
    const request = ++serial;
    loadController?.abort(); loadController = new AbortController();
    const signal = loadController.signal;
    $('tissue-fields').disabled = true; $('creator-fields').disabled = true;
    $('tissue-status').textContent = `Loading ${sex} body…`;
    $('creator-status').textContent = `Loading ${sex} anatomy…`;
    $('body-model').value = sex;
    let gltf, skinAppearance, cleanBitmap, cleanTexture;
    try {
      const modelUrl = new URL(`./bodies/${sex}.glb?v=2`, document.baseURI).href;
      const cageUrl = new URL(`./bodies/${sex}-cage.json?v=2`, document.baseURI).href;
      const skinUrl = new URL(`./bodies/${sex}-skin-clean.webp?v=1`, document.baseURI).href;
      const responses = await Promise.all([fetch(cageUrl, { signal }), fetch(modelUrl, { signal }), fetch(skinUrl, { signal })]);
      if (responses.some(r => !r.ok)) throw new Error('Body data could not load');
      const [sourceData, bytes] = await Promise.all([responses[0].json(), responses[1].arrayBuffer()]);
      if (request !== serial) return;
      gltf = await new GLTFLoader().parseAsync(bytes, new URL('./bodies/', document.baseURI).href);
      if (request !== serial) { disposeObject(gltf.scene); return; }
      cleanBitmap = await createImageBitmap(await responses[2].blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      if (request !== serial) { cleanBitmap.close?.(); disposeObject(gltf.scene); return; }
      let mesh;
      gltf.scene.traverse(node => { if (node.geometry?.attributes._cage_index) mesh = node; });
      if (!mesh) throw new Error('This body has no tissue controls.');
      const data = addAnalSurface(mesh.geometry, sourceData);
      const geometry = mesh.geometry;
      const color = new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3);
      geometry.setAttribute('color', color);
      const sourceMaterial = mesh.material;
      cleanTexture = sourceMaterial.map.clone(); cleanTexture.source = new THREE.Source(cleanBitmap);
      cleanTexture.colorSpace = THREE.SRGBColorSpace; cleanTexture.flipY = false; cleanTexture.needsUpdate = true;
      skinAppearance = new SkinAppearance(sourceMaterial, renderer, geometry, data, cleanTexture);
      skinAppearance.configure(sanitizeSkin(character?.appearance));
      mesh.material = skinAppearance.material; sourceMaterial.dispose();
      endPointer(); requestRealtime();
      const system = new TissueSystem(data);
      system.configure(character?.tissue || parameterValues());
      if (character) for (const id of settings) {
        const value = system.parameters[id]; $(`tissue-${id}`).value = value;
        $(`tissue-${id}-value`).value = formatParameter(id, value);
      }
      $('tissue-buttSide').value = String(system.parameters.buttSide);
      shape = sanitizeProportions(character?.proportions); displayShape();
      isolateButtockWeights(geometry, system);
      const motion = new MuscleMotion(gltf.scene, mesh, data);
      motion.restore(character?.motion);
      const pose = new CagePose(mesh, system, data); system.pose = pose;
      geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
      color.setUsage(THREE.DynamicDrawUsage);
      geometry.computeBoundingSphere(); geometry.boundingSphere.radius += .15;
      if (mesh.isSkinnedMesh) { mesh.computeBoundingSphere(); mesh.boundingSphere.radius += .15; }
      if (current) { current.mesh.material.map = current.skinMap; current.skin.dispose(); }
      const accessories = [];
      gltf.scene.traverse(node => { if (node.isMesh && node !== mesh) accessories.push({ mesh: node, morph: new BodyMorph(node.geometry.attributes.position.array, null, data) }); });
      current = { object: gltf.scene, mesh, system, data, sex, motion, pose, skin: skinAppearance, skinMap: skinAppearance.sourceMap,
        deformer: new SurfaceDeformer(geometry, system.count),
        morph: new BodyMorph(geometry.attributes.position.array, geometry.attributes._genital_weight.array, data, geometry.attributes._anal_weight.array),
        cageMorph: new BodyMorph(data.positions, data.genitalWeights, data, data.analWeights), accessories };
      applyShape();
      displaySkin();
      $('motion-side').value = String(motion.side); $('motion-demo').value = motion.demo;
      $('motion-strength').value = motion.strength; $('motion-speed').value = motion.speed;
      displayMotionControls();

      onReady(gltf.scene, `${sex === 'female' ? 'Female' : 'Male'} · soft-tissue study`);
      $('tissue-fields').disabled = false; $('creator-fields').disabled = false;
      $('tissue-region').replaceChildren(...['Whole body', ...system.regionNames].map((label, index) => {
        const option = document.createElement('option'); option.value = String(index - 1); option.textContent = label; return option;
      }));
      $('tissue-region').value = String(system.parameters.region);
      setMapMode(mapModeForRegion(system.parameters.region, buttockMap.mode));
      for (const button of document.querySelectorAll('[data-body]')) button.setAttribute('aria-pressed', String(button.dataset.body === sex));
      $('body-download').href = modelUrl; $('body-download').download = `${sex}-body.glb`;
      $('body-download').textContent = `Download source ${sex} GLB`;
      $('tissue-mesh-info').textContent = `${Math.round(geometry.index.count / 3000)}k triangles · external anatomy included`;
      $('tissue-status').textContent = 'Ready · choose Press or Pull to touch the surface';
      setButtons(); setTool(tool); applyView();
    } catch (error) {
      if (gltf && current?.object !== gltf.scene) {
        if (skinAppearance) skinAppearance.dispose(); else { cleanTexture?.dispose(); cleanBitmap?.close?.(); }
        disposeObject(gltf.scene);
      }
      if (request !== serial || error.name === 'AbortError') return;
      $('tissue-fields').disabled = !current; $('creator-fields').disabled = !current;
      $('body-model').value = current?.sex || '';
      $('tissue-status').textContent = `Could not load body: ${error.message}`;
      $('creator-status').textContent = `Could not load body: ${error.message}`;
      notify(`Could not load the ${sex} body: ${error.message}`, true);
    }
  }
  $('body-model').onchange = () => load($('body-model').value);
  for (const button of document.querySelectorAll('[data-body]')) button.onclick = () => load(button.dataset.body);
  for (const button of document.querySelectorAll('[data-tissue-tool]')) button.onclick = () => setTool(button.dataset.tissueTool);
  function formatParameter(id, value) {
    return id === 'radius' ? `${Math.round(value * 100)} cm` : id === 'stiffness' ? String(value) : ['damping', 'tension', 'genitalDamping', 'analDamping', 'buttDamping', 'lumbarCoupling', 'lumbarSupport', 'lumbarDamping', 'upperCoupling', 'upperSupport', 'shoulderCoupling', 'shoulderSupport', 'handCoupling', 'handSupport', 'absSupport', 'obliqueSupport', 'absCoupling', 'coreCoupling', 'coreBracing', 'absDamping'].includes(id) ? `${Math.round(value * 100)}%` : `${value.toFixed(1)}×`;
  }
  for (const id of settings) {
    $(`tissue-${id}`).oninput = () => {
      const value = Number($(`tissue-${id}`).value);
      $(`tissue-${id}-value`).value = formatParameter(id, value);
      current?.system.configure({ [id]: value });
      $('tissue-preset').value = 'custom'; resume();
    };
  }
  $('tissue-preset').onchange = () => {
    const name = $('tissue-preset').value, preset = PRESETS[name]; if (!preset) return;
    for (const [id, value] of Object.entries(preset)) { $(`tissue-${id}`).value = value; $(`tissue-${id}`).oninput(); }
    $('tissue-preset').value = name;
  };
  function setMapMode(mode) { $('tissue-mapRegion').value = mode; buttockMap.setMode(mode); }
  function showAnchor(id) {
    const region = current.system.regions[id];
    setMapMode(mapModeForRegion(region, buttockMap.mode));
    buttockMap.select(id);
  }
  $('tissue-mapRegion').onchange = () => {
    endPointer(); setMapMode($('tissue-mapRegion').value);
    if (current && current.system.parameters.region >= 0 && !MAP_REGIONS[buttockMap.mode].includes(current.system.parameters.region)) {
      current.system.configure({ region: -1 }); $('tissue-region').value = '-1';
    }
    buttockMap.next = 0; buttockMap.update(Infinity); buttockMap.next = 0;
  };
  $('tissue-buttSide').onchange = () => { endPointer(); current?.system.configure({ buttSide: Number($('tissue-buttSide').value) }); buttockMap.next = 0; resume(); };
  $('tissue-region').onchange = () => {
    endPointer(); const region = Number($('tissue-region').value); current?.system.configure({ region });
    setMapMode(mapModeForRegion(region, buttockMap.mode));
    buttockMap.next = 0; resume();
  };
  $('tissue-pause').onclick = () => current?.system.paused ? resume() : pause();
  $('tissue-reset').onclick = () => { if (current) { endPointer(); current.system.reset(); current.system.vibration = false; setButtons(); updateSurface(true); requestRealtime(); } };
  $('tissue-impulse').onclick = () => {
    if (current && isSideRegion(current.system.parameters.region) && !current.system.parameters.buttSide && !current.system.lastButtSide) { notify('Touch a side first, or choose a side for the pulse.'); return; }
    resume(); current?.system.impulse();
  };
  $('tissue-vibrate').onclick = () => { if (current) {
    if (!current.system.vibration && isSideRegion(current.system.parameters.region) && !current.system.parameters.buttSide && !current.system.lastButtSide) { notify('Touch a side first, or choose a side for vibration.'); return; }
    resume(); current.system.vibration = !current.system.vibration; setButtons(); } };
  $('tissue-view').onchange = () => { requestRealtime(); applyView(); };
  function displayMotionControls() {
    const group = MUSCLE_GROUPS.find(g => g.id === $('motion-group').value) || MUSCLE_GROUPS[1];
    $('motion-agonist-name').textContent = group.agonist; $('motion-antagonist-name').textContent = group.antagonist;
    const joints = current?.motion.selected(group.id, Number($('motion-side').value)) || [];
    for (const [key, k] of [['agonist', 0], ['antagonist', 1]]) {
      const value = joints.length ? joints.reduce((sum, j) => sum + j.excitation[k], 0) / joints.length : 0;
      $(`motion-${key}`).value = value; $(`motion-${key}-value`).value = `${Math.round(value * 100)}%`;
    }
    for (const key of ['strength', 'speed']) $(`motion-${key}-value`).value = `${Number($(`motion-${key}`).value).toFixed(2)}×`;
    setButtons();
  }
  $('motion-group').onchange = displayMotionControls;
  $('motion-side').onchange = () => { current?.motion.configure({ side: Number($('motion-side').value) }); displayMotionControls(); };
  for (const key of ['agonist', 'antagonist']) $(`motion-${key}`).oninput = () => {
    if (!current) return;
    endPointer(); current.motion.setExcitation($('motion-group').value, Number($('motion-side').value), [Number($('motion-agonist').value), Number($('motion-antagonist').value)]);
    displayMotionControls(); resume();
  };
  for (const key of ['strength', 'speed']) $(`motion-${key}`).oninput = () => {
    current?.motion.configure({ [key]: Number($(`motion-${key}`).value) }); displayMotionControls(); resume();
  };
  $('motion-demo').onchange = () => { current?.motion.configure({ demo: $('motion-demo').value }); };
  $('motion-play').onclick = () => {
    if (!current) return;
    endPointer(); current.motion.configure({ demo: $('motion-demo').value, side: Number($('motion-side').value) }); current.motion.play();
    $('motion-group').value = current.motion.demo === 'core' ? 'core' : current.motion.demo === 'hands' ? 'grip' : 'shoulder';
    setMapMode(current.motion.demo === 'core' ? 'abs' : 'upper'); current.system.configure({ region: -1 }); $('tissue-region').value = '-1';
    onMotionView();
    resume(); displayMotionControls();
  };
  $('motion-hold').onclick = () => { if (current) { endPointer(); current.motion.held = !current.motion.held; resume(); setButtons(); } };
  $('motion-relax').onclick = () => { if (current) { endPointer(); current.motion.relax(); resume(); displayMotionControls(); } };
  $('motion-reset').onclick = () => {
    if (!current) return;
    endPointer(); current.motion.reset(); current.pose.refresh(current.motion.version); current.system.reset(); current.motion.tissueActivation(current.system);
    buttockMap.setSystem(current.system); updateSurface(true, true); resume(); displayMotionControls();
  };
  function updateRay(event) {
    const r = canvas.getBoundingClientRect();
    screen.set((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1);
    raycaster.setFromCamera(screen, camera);
  }
  canvas.addEventListener('pointerdown', event => {
    if (!current || tool === 'orbit' || event.button !== 0 || pointer !== null) return;
    if (pendingShape) applyShape(); updateSurface();
    current.pose.refresh(current.motion.version);
    updateRay(event); current.mesh.updateWorldMatrix(true, false);
    const hit = raycaster.intersectObject(current.mesh, false)[0];
    if (!hit) return;
    const point = current.mesh.worldToLocal(hit.point.clone());
    const n = hit.face.normal.clone().normalize();
    const triangle = new THREE.Triangle(...[hit.face.a, hit.face.b, hit.face.c].map(id => current.mesh.getVertexPosition(id, new THREE.Vector3())));
    const barycentric = triangle.getBarycoord(point, new THREE.Vector3());
    const anchor = barycentric ? surfaceGrabAnchor(current.system, current.mesh.geometry, hit.face, barycentric.toArray(), point.toArray()) : -1;
    if (anchor < 0) { notify('Touch the selected region and side, or choose Whole body.'); return; }
    const affected = current.system.beginGrab(current.pose.toMaterial(anchor, point.toArray()), current.pose.directionToMaterial(anchor, n.toArray()), tool, anchor);
    if (!affected) { notify('Choose Whole body, or touch the selected region.'); current.system.endGrab(); return; }
    event.preventDefault(); event.stopImmediatePropagation(); resume();
    pointer = event.pointerId; grabCanvas = canvas; controls.enabled = false; showAnchor(anchor);
    canvas.setPointerCapture(pointer);
    camera.getWorldDirection(normal); plane.setFromNormalAndCoplanarPoint(normal, hit.point);
  }, true);
  canvas.addEventListener('pointermove', event => {
    if (pointer !== event.pointerId || grabCanvas !== canvas || !current) return;
    event.preventDefault(); event.stopImmediatePropagation(); updateRay(event);
    if (raycaster.ray.intersectPlane(plane, worldPoint)) {
      localPoint.copy(worldPoint); current.mesh.worldToLocal(localPoint); current.system.moveGrab(current.pose.toMaterial(current.system.grab.anchorId, localPoint.toArray()));
    }
  }, true);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (pointer !== event.pointerId || grabCanvas !== canvas) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation(); endPointer(event);
  }, true);
  const mapPixel = event => {
    const r = mapCanvas.getBoundingClientRect();
    return { x: (event.clientX - r.left) * mapCanvas.width / r.width, y: (event.clientY - r.top) * mapCanvas.height / r.height };
  };
  mapCanvas.addEventListener('pointerdown', event => {
    if (!current || event.button !== 0 || pointer !== null) return;
    if (pendingShape) applyShape();
    const pixel = mapPixel(event), sample = buttockMap.pick(pixel.x, pixel.y);
    if (!sample) return;
    if (tool === 'orbit') setTool('press');
    const point = [sample.x, sample.y, sample.z], normal = Array.from(current.system.normals.slice(sample.id * 3, sample.id * 3 + 3));
    if (!current.system.beginGrab(current.pose.toMaterial(sample.id, point), normal, tool, sample.id)) return;
    event.preventDefault(); event.stopImmediatePropagation(); resume();
    pointer = event.pointerId; grabCanvas = mapCanvas; controls.enabled = false;
    mapDrag = { pixel, point, anchor: sample.id }; buttockMap.select(sample.id); mapCanvas.setPointerCapture(pointer);
  }, true);
  mapCanvas.addEventListener('pointermove', event => {
    if (pointer !== event.pointerId || grabCanvas !== mapCanvas || !mapDrag || !current) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const pixel = mapPixel(event), delta = buttockMap.worldDelta(pixel.x - mapDrag.pixel.x, pixel.y - mapDrag.pixel.y);
    current.system.moveGrab(current.pose.toMaterial(mapDrag.anchor, mapDrag.point.map((v, k) => v + delta[k])));
  }, true);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) mapCanvas.addEventListener(type, event => {
    if (pointer !== event.pointerId || grabCanvas !== mapCanvas) return;
    if (event.cancelable) event.preventDefault(); event.stopImmediatePropagation(); endPointer(event);
  }, true);
  window.addEventListener('blur', () => endPointer());
  document.addEventListener('visibilitychange', () => { if (document.hidden) endPointer(); });
  let lastStatus = 0;
  return {
    load, pause, detach, setPanel,
    get active() { return Boolean(current); },
    update(delta, now) {
      if (!current || document.hidden) return false;
      const start = performance.now();
      if (pendingShape) applyShape();
      const moved = !current.system.paused && pointer === null && current.motion.step(delta);
      const posed = current.pose.refresh(current.motion.version);
      if (!current.system.paused && pointer === null && (current.motion.tissueActivation(current.system) || moved || posed)) current.system.wake();
      const stepped = current.system.step(delta);
      if (!$('physics-panel').hidden) buttockMap.update(now);
      const normals = now >= nextNormals || current.system.sleeping;
      let changed = false;
      if (stepped || (normals && current.deformer.normalsPending)) changed = updateSurface(normals);
      if (normals) nextNormals = now + 1000 / Number($('tissue-rate').value);
      averageCpu = averageCpu * .95 + (performance.now() - start) * .05;
      if (now - lastStatus > 350) {
        $('tissue-status').textContent = `${current.system.paused ? 'Paused' : current.system.sleeping ? 'Settled · sleeping' : current.system.grab ? 'Touching surface' : 'Simulating'} · ${(current.system.maxDisplacement * 1000).toFixed(1)} mm · CPU update ${averageCpu.toFixed(2)} ms`;
        lastStatus = now;
        if (current.motion.running) displayMotionControls();
        const joints = current.motion.selected($('motion-group').value, Number($('motion-side').value));
        $('motion-status').textContent = `${pointer !== null ? 'Pose held during grab' : current.system.paused || current.motion.held ? 'Pose held' : current.motion.running ? 'Muscle loop' : 'Manual activation'} · ${joints.map(j => `${j.side === 1 ? 'Front right ' : j.side === -1 ? 'Front left ' : ''}${(j.angle * 180 / Math.PI).toFixed(1)}° · activation ${Math.round(j.activation[0] * 100)}/${Math.round(j.activation[1] * 100)}%`).join(' · ')}`;
      }
      return changed || moved;

    },
  };
}
