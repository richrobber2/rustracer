import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Prefer an explicit or system Chromium; otherwise use Playwright's own build.
const chromium = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/opt/pw-browsers/chromium'].find(path => existsSync(path));
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 960 },
    launchOptions: {
      executablePath: chromium,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
