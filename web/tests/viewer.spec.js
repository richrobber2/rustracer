import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function fixture(uri = 'mesh.bin') {
  // A real triangle plus a two-keyframe translation animation.
  const floats = new Float32Array([
    -1, 0, 0, 1, 0, 0, 0, 2, 0,
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 1,
    0, 0, 0, 0, 0.5, 0,
  ]);
  const model = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ uri, byteLength: floats.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 8 },
      { buffer: 0, byteOffset: 80, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 2, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    materials: [{ name: 'Fixture copper', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.7, 0.3, 0.1, 1], metallicFactor: 0.3, roughnessFactor: 0.4 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    animations: [{ name: 'Float', samplers: [{ input: 2, output: 3 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }],
  };
  return { model, buffer: Buffer.from(floats.buffer) };
}
async function open(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#scene-stats')).toContainText('4 meshes');
  await expect.poll(() => page.locator('canvas').getAttribute('data-frames')).not.toBeNull();
  return errors;
}
async function pixels(page) {
  return page.locator('canvas').evaluate((canvas) => {
    const copy = document.createElement('canvas'); copy.width = 160; copy.height = 120;
    const context = copy.getContext('2d'); context.drawImage(canvas, 0, 0, 160, 120);
    const data = context.getImageData(0, 0, 160, 120).data;
    let bright = 0; const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
      if (data[i] + data[i + 1] + data[i + 2] > 300) bright++;
    }
    return { bright, colors: colors.size, width: canvas.width, height: canvas.height };
  });
}
async function slider(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, v) => { element.value = v; element.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
}

test('renders actual geometry, edits materials/camera and exports a valid PNG', async ({ page }) => {
  const errors = await open(page);
  await expect.poll(async () => (await pixels(page)).colors).toBeGreaterThan(30);
  const before = await pixels(page);
  expect(before.bright).toBeGreaterThan(50);
  await page.locator('#color').fill('#ff0000');
  await slider(page, 'roughness', 0.85);
  await expect(page.locator('#roughness-value')).toHaveText('0.85');
  await page.getByRole('button', { name: 'Restore original materials' }).click();
  await expect(page.locator('#color')).toHaveValue('#d8a957');
  await slider(page, 'fov', 70);
  await expect(page.locator('#fov-value')).toHaveText('70°');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.locator('#fov')).toHaveValue('45');
  await slider(page, 'quality', 0.5);
  await expect.poll(async () => (await pixels(page)).width).toBeLessThan(before.width);
  await page.locator('#ground').uncheck();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: false }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('rustracer.png');
  const data = await readFile(await download.path());
  expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(data.length).toBeGreaterThan(1000);
  await page.screenshot({ path: 'test-results/studio.png' });
  expect(errors).toEqual([]);
});

test('imports local glTF companions, plays animation and keeps demo available after invalid imports', async ({ page }) => {
  const errors = await open(page);
  const { model, buffer } = fixture();
  await page.locator('#files').setInputFiles([
    { name: 'triangle.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify(model)) },
    { name: 'mesh.bin', mimeType: 'application/octet-stream', buffer },
  ]);
  await expect(page.locator('#model-name')).toHaveText('triangle.gltf');
  await expect(page.locator('#scene-stats')).toHaveText('1 meshes · 1 triangles');
  await expect(page.locator('#skeleton')).toBeDisabled();
  await expect(page.locator('#material')).toContainText('Fixture copper');
  await page.getByRole('button', { name: 'Play animation' }).click();
  await expect(page.getByRole('button', { name: 'Pause animation' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await page.locator('#files').setInputFiles({ name: 'missing.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('#notice')).toContainText('Missing companion file');
  await expect(page.locator('#model-name')).toHaveText('triangle.gltf');
  await page.getByRole('button', { name: 'Studio demo', exact: false }).click();
  await expect(page.locator('#scene-stats')).toContainText('4 meshes');
  expect(errors).toEqual([]);
});

test('demo mannequin is a skinned rig whose animation deforms the mesh', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#scene-stats')).toContainText('19 bones');
  await expect(page.getByRole('button', { name: 'Pause animation' })).toBeVisible();
  await expect(page.locator('#animation option')).toHaveText(['Walk cycle', 'Wave', 'Idle']);
  await page.locator('#skeleton').check();
  await page.getByRole('button', { name: 'Pause animation' }).click();
  const still = await pixels(page);
  await page.locator('#animation').selectOption('1');
  await expect.poll(async () => (await pixels(page)).bright).not.toBe(still.bright);
  expect(errors).toEqual([]);
});

test('GLB files load without a companion file', async ({ page }) => {
  const errors = await open(page);
  const { model, buffer } = fixture();
  delete model.buffers[0].uri;
  const jsonText = JSON.stringify(model);
  const json = Buffer.from(jsonText.padEnd(Math.ceil(Buffer.byteLength(jsonText) / 4) * 4, ' '));
  const glb = Buffer.alloc(12 + 8 + json.length + 8 + buffer.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
  const offset = 20 + json.length;
  glb.writeUInt32LE(buffer.length, offset); glb.writeUInt32LE(0x004e4942, offset + 4); buffer.copy(glb, offset + 8);
  await page.locator('#files').setInputFiles({ name: 'triangle.glb', mimeType: 'model/gltf-binary', buffer: glb });
  await expect(page.locator('#model-name')).toHaveText('triangle.glb');
  expect(errors).toEqual([]);
});

test('rejects remote model resources without making network requests', async ({ page }) => {
  await open(page);
  const requests = [];
  page.on('request', (r) => { if (r.url().startsWith('https://example.com')) requests.push(r.url()); });
  const { model } = fixture('https://example.com/mesh.bin');
  await page.locator('#files').setInputFiles({ name: 'external.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('#notice')).toContainText('External model resources are not fetched');
  expect(requests).toEqual([]);
});

test('path tracer accumulates real samples, pauses and resumes', async ({ page }) => {
  const errors = await open(page);
  await slider(page, 'quality', 0.25);
  await slider(page, 'bounces', 2);
  await page.getByRole('button', { name: 'Path traced', exact: true }).click();
  await expect(page.locator('#mode-path')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#render-status')).toHaveText(/[1-9]\d* samples · Path traced/, { timeout: 70_000 });
  await expect.poll(async () => (await pixels(page)).colors).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Pause accumulation' }).click();
  await expect(page.locator('#render-status')).toContainText('Paused');
  const pausedSamples = await page.locator('#render-status').textContent();
  await page.waitForTimeout(700);
  await expect(page.locator('#render-status')).toHaveText(pausedSamples);
  await page.getByRole('button', { name: 'Resume accumulation' }).click();
  await expect.poll(async () => Number((await page.locator('#render-status').textContent()).match(/(\d+) samples/)?.[1] || 0)).toBeGreaterThan(Number(pausedSamples.match(/(\d+) samples/)[1]));
  await page.getByRole('button', { name: 'Interactive', exact: true }).click();
  await expect(page.locator('#mode-realtime')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('mobile viewport renders and controls remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByRole('button', { name: 'Import model', exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Import model', exact: false }).click();
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#roughness').scrollIntoViewIfNeeded();
  await expect(page.locator('#roughness')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
