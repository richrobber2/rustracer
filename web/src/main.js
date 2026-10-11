import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const host = $('canvas-host');
let noticeTimer;
function notify(message, error = false, persistent = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').style.display = 'block';
  if (!persistent) noticeTimer = setTimeout(() => { $('notice').style.display = 'none'; }, 6000);
}

try { await init(); } catch (error) {
  console.error(error);
  $('render-status').textContent = 'Renderer unavailable';
  notify(`Cannot start 3D rendering: ${error.message}. Try a browser with WebGL 2 enabled.`, true, true);
}

async function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor('#161d25');
  renderer.domElement.setAttribute('aria-label', 'Rendered 3D scene');
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#161d25');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.2;
  controls.maxDistance = 60;
  controls.target.set(0, 1, 0);
  camera.position.set(4.5, 2.7, 5.5);

  // A small, self-contained equirectangular studio sky; no remote asset requests.
  const width = 128, height = 64;
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const sky = Math.max(0, Math.cos(y / height * Math.PI));
      const softbox = Math.exp(-((x / width - 0.3) ** 2 / 0.006 + (y / height - 0.3) ** 2 / 0.015)) * 5;
      pixels[i] = 0.12 + sky * 0.7 + softbox;
      pixels[i + 1] = 0.15 + sky * 0.8 + softbox;
      pixels[i + 2] = 0.21 + sky + softbox;
      pixels[i + 3] = 1;
    }
  }
  const environment = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  environment.mapping = THREE.EquirectangularReflectionMapping;
  environment.needsUpdate = true;
  scene.environment = environment;
  scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight('#ffe7c5', 5);
  key.position.set(4, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 25 });
  key.shadow.bias = -0.0005;
  key.target.position.set(0, 0.8, 0);
  const fill = new THREE.DirectionalLight('#9cc6ff', 1.5);
  fill.position.set(-4, 3, -2);
  scene.add(key, key.target, fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#323d47', roughness: 0.48, metalness: 0.12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  floor.receiveShadow = true;
  scene.add(floor);

  let model = null, materials = [], originalMaterials = new Map();
  let mixer = null, animations = [], playing = false, action = null, skeletonHelper = null;
  let pathTracer = null, mode = 'realtime', modeLoading = false, paused = false;
  let importSerial = 0, savedBaseScale = 1, materialTimer;
  let pendingExport = false, contextLost = false, disposed = false;
  const clock = new THREE.Clock();
  const pathButton = $('mode-path');
  let frames = 0, framesThisSecond = 0, lastStatus = performance.now();
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * Number($('quality').value));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (pathTracer) pathTracer.updateCamera();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); contextLost = true;
    notify('The graphics context was lost. Reload this page to restore rendering.', true, true);
    $('render-status').textContent = 'Graphics context lost';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());
  controls.addEventListener('change', () => { if (mode === 'path') pathTracer?.updateCamera(); });
  function updatePath(kind = 'scene') {
    if (!pathTracer || mode !== 'path') return;
    try {
      if (kind === 'materials') pathTracer.updateMaterials();
      else if (kind === 'lights') pathTracer.updateLights();
      else if (kind === 'environment') pathTracer.updateEnvironment();
      else pathTracer.setScene(scene, camera);
    } catch (error) { pathFailure(error); }
  }
  function pathFailure(error) {
    console.error(error);
    setRealtime();
    notify(`Path tracing is unavailable for this scene/browser: ${error.message}. Interactive rendering remains available.`, true);
  }
  function setRealtime() {
    mode = 'realtime';
    $('mode-realtime').classList.add('active');
    pathButton.classList.remove('active');
    $('mode-realtime').setAttribute('aria-pressed', 'true');
    pathButton.setAttribute('aria-pressed', 'false');
    $('path-controls').hidden = true;
    $('mode-description').textContent = 'Instant feedback for exploring and editing.';
    $('render-status').textContent = 'Interactive rendering';
  }
  async function setPath() {
    if (modeLoading || mode === 'path') return;
    modeLoading = true; pathButton.disabled = true;
    notify('Preparing path tracing…', false, true);
    try {
      const { WebGLPathTracer } = await import('three-gpu-pathtracer');
      if (!pathTracer) {
        pathTracer = new WebGLPathTracer(renderer);
        pathTracer.textureSize.set(512, 512);
        pathTracer.tiles.set(2, 2);
        pathTracer.renderDelay = 150;
        pathTracer.fadeDuration = 250;
        pathTracer.minSamples = 1;
      }
      playing = false;
      $('play').textContent = 'Play animation';
      controls.autoRotate = false; $('orbit').checked = false;
      pathTracer.bounces = Number($('bounces').value);
      pathTracer.pausePathTracing = false; paused = false;
      $('pause').textContent = 'Pause accumulation';
      pathTracer.setScene(scene, camera);
      mode = 'path';
      $('mode-realtime').classList.remove('active');
      pathButton.classList.add('active');
      $('mode-realtime').setAttribute('aria-pressed', 'false');
      pathButton.setAttribute('aria-pressed', 'true');
      $('path-controls').hidden = false;
      $('mode-description').textContent = 'Progressive lighting. Hold the camera still to refine.';
      notify('Path tracing enabled. The first sample may take a moment.');
    } catch (error) { pathFailure(error); }
    finally { modeLoading = false; pathButton.disabled = false; }
  }
  $('mode-realtime').onclick = setRealtime;
  pathButton.onclick = setPath;
  $('pause').onclick = () => {
    paused = !paused; pathTracer.pausePathTracing = paused;
    $('pause').textContent = paused ? 'Resume accumulation' : 'Pause accumulation';
  };

  function release(object) {
    if (!object) return;
    const geometries = new Set(), mats = new Set(), textures = new Set();
    object.traverse((node) => {
      if (node.isSkinnedMesh) node.skeleton.dispose();
      if (node.geometry) geometries.add(node.geometry);
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!mat) continue;
        mats.add(mat);
        Object.values(mat).forEach((value) => { if (value?.isTexture) textures.add(value); });
      }
    });
    geometries.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }
  function updateMaterialUI() {
    const material = materials[Number($('material').value)];
    const supported = Boolean(material?.isMeshStandardMaterial);
    for (const id of ['color', 'roughness', 'metalness']) $(id).disabled = !supported;
    if (!supported) return;
    $('color').value = `#${material.color.getHexString()}`;
    $('roughness').value = material.roughness;
    $('metalness').value = material.metalness;
    $('roughness-value').value = material.roughness.toFixed(2);
    $('metalness-value').value = material.metalness.toFixed(2);
  }
  function collectMaterials() {
    materials = []; originalMaterials = new Map();
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = node.receiveShadow = true;
      const clone = (mat) => {
        if (!originalMaterials.has(mat)) {
          originalMaterials.set(mat, { color: mat.color?.clone(), roughness: mat.roughness, metalness: mat.metalness });
          materials.push(mat);
        }
      };
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(clone);
    });
    $('material').replaceChildren(...materials.map((mat, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = mat.name || `Material ${index + 1}`;
      return option;
    }));
    updateMaterialUI();
  }
  function sceneStats() {
    let meshes = 0, triangles = 0, bones = 0;
    model.traverse((node) => {
      if (node.isBone) bones++;
      if (!node.isMesh || !node.geometry) return;
      meshes++;
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3;
    });
    $('scene-stats').textContent = `${meshes} meshes · ${Math.round(triangles).toLocaleString()} triangles${bones ? ` · ${bones} bones` : ''}`;
  }
  function frame(view = 'iso') {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.2) * 0.5;
    // Fit both portrait and landscape viewports.
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.7 / Math.min(camera.aspect, 1);
    const direction = view === 'front' ? new THREE.Vector3(0, 0.1, 1) : view === 'top' ? new THREE.Vector3(0.001, 1, 0.001) : new THREE.Vector3(1, 0.5, 1.4);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    controls.target.copy(center); camera.lookAt(center); controls.update();
    if (mode === 'path') pathTracer.updateCamera();
  }
  function replaceModel(object, name, clips = []) {
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(model); }
    const old = model;
    if (old) scene.remove(old);
    model = object; scene.add(model);
    savedBaseScale = model.scale.x;
    $('rotation').value = 0; $('rotation-value').value = '0°';
    $('scale').value = 1; $('scale-value').value = '1.00×';
    $('model-name').textContent = name;
    collectMaterials(); sceneStats(); frame(); attachSkeleton();
    animations = clips; playing = false; action = null;
    mixer = clips.length ? new THREE.AnimationMixer(model) : null;
    $('animation-controls').hidden = !clips.length;
    $('animation').replaceChildren(...clips.map((clip, i) => {
      const option = document.createElement('option'); option.value = i;
      option.textContent = clip.name || `Animation ${i + 1}`; return option;
    }));
    $('play').textContent = 'Play animation';
    updatePath();
    release(old);
  }
  function attachSkeleton() {
    if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper.dispose(); skeletonHelper = null; }
    const hasBones = model.getObjectByProperty('isBone', true) !== undefined;
    $('skeleton').disabled = !hasBones;
    if (!hasBones) return;
    // Drawn over the surface so the rig stays readable inside the body.
    skeletonHelper = new THREE.SkeletonHelper(model);
    const colors = skeletonHelper.geometry.attributes.color;
    const joint = new THREE.Color('#dfb578'), bone = new THREE.Color('#74bfa1');
    for (let i = 0; i < colors.count; i++) (i % 2 ? joint : bone).toArray(colors.array, i * 3);
    colors.needsUpdate = true;
    skeletonHelper.visible = $('skeleton').checked;
    scene.add(skeletonHelper);
  }
  $('skeleton').onchange = () => { if (skeletonHelper) skeletonHelper.visible = $('skeleton').checked; };
  function makeDemo() {
    const group = new THREE.Group();
    const gold = new THREE.MeshPhysicalMaterial({ color: '#d8a957', metalness: 1, roughness: 0.25, clearcoat: 0.4 });
    gold.name = 'Brushed gold';
    const porcelain = new THREE.MeshPhysicalMaterial({ color: '#e1e9ed', roughness: 0.16, clearcoat: 0.7 });
    porcelain.name = 'Porcelain';
    const teal = new THREE.MeshPhysicalMaterial({ color: '#347c78', metalness: 0.35, roughness: 0.22 });
    teal.name = 'Petrol green';
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.62, 0.22, 120, 20), gold);
    knot.position.set(0, 1.26, 0); knot.rotation.set(0.25, 0.15, 0.1);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.53, 48, 32), porcelain);
    sphere.position.set(-1.28, 0.53, 0.35);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.38, 48, 32), teal);
    orb.position.set(1.25, 0.38, 0.55);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.32, 64), new THREE.MeshStandardMaterial({ color: '#52606b', roughness: 0.62 }));
    pedestal.material.name = 'Slate pedestal'; pedestal.position.set(0, 0.16, 0);
    group.add(knot, sphere, orb, pedestal);
    replaceModel(group, 'Studio collection');
  }
  makeDemo();
  $('demo').onclick = () => { ++importSerial; makeDemo(); notify('Studio scene restored.'); };
  $('frame').onclick = () => frame();
  $('reset').onclick = () => {
    controls.autoRotate = false; $('orbit').checked = false;
    camera.fov = 45; camera.updateProjectionMatrix();
    $('fov').value = 45; $('fov-value').value = '45°';
    frame();
  };
  document.querySelectorAll('[data-view]').forEach((button) => { button.onclick = () => frame(button.dataset.view); });
  $('fullscreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('viewport').requestFullscreen(); }
    catch { notify('Fullscreen is unavailable in this browser.', true); }
  };
  function slider(id, format, fn) {
    $(id).addEventListener('input', () => {
      const value = Number($(id).value); $(`${id}-value`).value = format(value); fn(value);
    });
  }
  slider('quality', (v) => `${Math.round(v * 100)}%`, resize);
  slider('fov', (v) => `${v}°`, (v) => { camera.fov = v; camera.updateProjectionMatrix(); if (mode === 'path') pathTracer.updateCamera(); });
  slider('bounces', String, (v) => { if (pathTracer) { pathTracer.bounces = v; pathTracer.reset(); } });
  slider('exposure', (v) => v.toFixed(1), (v) => { renderer.toneMappingExposure = v; pathTracer?.reset(); });
  slider('environment', (v) => v.toFixed(1), (v) => { scene.environmentIntensity = v; updatePath('environment'); });
  slider('light', (v) => v.toFixed(1), (v) => { key.intensity = v; updatePath('lights'); });
  slider('light-angle', (v) => `${v}°`, (v) => {
    const angle = THREE.MathUtils.degToRad(v); key.position.set(Math.sin(angle) * 6, 5, Math.cos(angle) * 6);
    key.updateMatrixWorld(); updatePath('lights');
  });
  slider('rotation', (v) => `${v}°`, (v) => { model.rotation.y = THREE.MathUtils.degToRad(v); updatePath(); });
  slider('scale', (v) => `${v.toFixed(2)}×`, (v) => { model.scale.setScalar(savedBaseScale * v); updatePath(); });
  $('background').oninput = () => { scene.background.set($('background').value); updatePath('environment'); };
  $('ground').onchange = () => { floor.visible = $('ground').checked; updatePath(); };
  $('tonemap').onchange = () => {
    renderer.toneMapping = { aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, linear: THREE.LinearToneMapping }[$('tonemap').value];
    pathTracer?.reset();
  };
  $('orbit').onchange = () => { if ($('orbit').checked) setRealtime(); controls.autoRotate = $('orbit').checked; };
  $('material').onchange = updateMaterialUI;
  function updateMaterial() {
    const mat = materials[Number($('material').value)];
    if (!mat?.isMeshStandardMaterial) return;
    mat.color.set($('color').value); mat.roughness = Number($('roughness').value); mat.metalness = Number($('metalness').value);
    clearTimeout(materialTimer);
    // Texture-array uploads are expensive: defer them until a slider stops moving.
    materialTimer = setTimeout(() => updatePath('materials'), 100);
  }
  $('color').oninput = updateMaterial;
  slider('roughness', (v) => v.toFixed(2), updateMaterial);
  slider('metalness', (v) => v.toFixed(2), updateMaterial);
  $('restore-materials').onclick = () => {
    originalMaterials.forEach((original, mat) => {
      if (original.color) mat.color.copy(original.color);
      if (original.roughness !== undefined) mat.roughness = original.roughness;
      if (original.metalness !== undefined) mat.metalness = original.metalness;
    });
    updateMaterialUI(); updatePath('materials');
  };
  function playClip() {
    if (!mixer) return;
    mixer.stopAllAction(); action = mixer.clipAction(animations[Number($('animation').value)]); action.play();
  }
  $('play').onclick = () => {
    playing = !playing;
    if (playing) { setRealtime(); if (!action) playClip(); }
    $('play').textContent = playing ? 'Pause animation' : 'Play animation';
  };
  $('animation').onchange = () => { playClip(); if (!playing) mixer.update(0); };

  const dialog = $('import-dialog');
  $('open').onclick = () => dialog.showModal();
  $('cancel-import').onclick = () => dialog.close();
  $('choose-files').onclick = () => { dialog.close(); $('files').click(); };
  $('choose-folder').onclick = () => { dialog.close(); $('folder').click(); };
  for (const id of ['files', 'folder']) $(id).onchange = async () => { await loadFiles([...$(id).files]); $(id).value = ''; };
  let dragDepth = 0;
  $('viewport').addEventListener('dragenter', (event) => { event.preventDefault(); dragDepth++; $('viewport').classList.add('dragging'); });
  $('viewport').addEventListener('dragover', (event) => event.preventDefault());
  $('viewport').addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('viewport').classList.remove('dragging'); } });
  $('viewport').addEventListener('drop', async (event) => {
    event.preventDefault(); dragDepth = 0; $('viewport').classList.remove('dragging');
    await loadFiles([...event.dataTransfer.files]);
  });
  async function loadFiles(files) {
    if (!files.length) return;
    const serial = ++importSerial;
    const roots = files.filter((f) => /\.(gltf|glb)$/i.test(f.name));
    if (roots.length !== 1) { notify('Choose one .glb or .gltf model with its supporting files.', true); return; }
    if (files.reduce((sum, f) => sum + f.size, 0) > 250 * 1024 * 1024) { notify('Choose a model and textures smaller than 250 MB in total.', true); return; }
    const root = roots[0];
    const urls = [];
    notify(`Opening ${root.name}…`, false, true);
    try {
      const normalize = (path) => {
        const out = [];
        for (const segment of path.replaceAll('\\', '/').split('/')) {
          if (segment === '..') out.pop(); else if (segment && segment !== '.') out.push(segment);
        }
        return out.join('/');
      };
      const paths = new Map(files.map((file) => [normalize(file.webkitRelativePath || file.name), file]));
      const rootPath = normalize(root.webkitRelativePath || root.name);
      const base = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return url;
        // Only local companion files are allowed. Imported models never fetch remote URLs.
        const prefix = '/local-model/';
        if (!url.startsWith(prefix)) throw new Error('External model resources are not fetched. Include textures and binary files locally.');
        const path = normalize(decodeURIComponent(url.slice(prefix.length)));
        const file = paths.get(path);
        if (!file) throw new Error(`Missing companion file: ${path}. Select its folder or include it with the model.`);
        const objectURL = URL.createObjectURL(file); urls.push(objectURL); return objectURL;
      });
      const loader = new GLTFLoader(manager);
      const data = await root.arrayBuffer();
      const gltf = await new Promise((resolve, reject) => loader.parse(data, `/local-model/${base}`, resolve, reject));
      if (serial !== importSerial) { release(gltf.scene); return; }
      const box = new THREE.Box3().setFromObject(gltf.scene);
      if (box.isEmpty()) { release(gltf.scene); throw new Error('This model has no visible geometry.'); }
      const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
      const factor = 3 / Math.max(size.x, size.y, size.z);
      const group = new THREE.Group();
      gltf.scene.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
      group.add(gltf.scene); group.scale.setScalar(factor);
      replaceModel(group, root.name, gltf.animations);
      notify(`${root.name} is ready. All files were loaded locally.`);
    } catch (error) {
      if (serial === importSerial) notify(`Could not open model: ${error.message}`, true);
    } finally { urls.forEach((url) => URL.revokeObjectURL(url)); }
  }
  $('export').onclick = () => { pendingExport = true; };
  function exportImage() {
    renderer.domElement.toBlob((blob) => {
      if (!blob) { notify('Could not create an image.', true); return; }
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'rustracer.png'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('PNG exported at the current viewport resolution.');
    }, 'image/png');
  }
  function animate(now) {
    if (disposed) return;
    requestAnimationFrame(animate);
    if (contextLost) return;
    const delta = Math.min(clock.getDelta(), 0.1);
    controls.update(delta);
    if (playing && mixer) mixer.update(delta);
    try {
      if (mode === 'path') pathTracer.renderSample(); else renderer.render(scene, camera);
    } catch (error) {
      if (mode === 'path') pathFailure(error); else { contextLost = true; notify(`Rendering failed: ${error.message}`, true, true); }
    }
    renderer.domElement.dataset.frames = ++frames;
    framesThisSecond++;
    if (now - lastStatus > 500) {
      $('render-status').textContent = mode === 'path'
        ? (pathTracer.isCompiling ? 'Compiling path tracer…' : `${paused ? 'Paused · ' : ''}${Math.floor(pathTracer.samples)} samples · Path traced`)
        : `Interactive · ${Math.round(framesThisSecond * 1000 / (now - lastStatus))} fps`;
      framesThisSecond = 0; lastStatus = now;
    }
    if (pendingExport) { pendingExport = false; exportImage(); }
  }
  requestAnimationFrame(animate);
  // Pause GPU work when the page is being closed.
  window.addEventListener('pagehide', () => { disposed = true; }, { once: true });
}
