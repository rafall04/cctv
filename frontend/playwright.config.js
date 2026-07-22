/*
 * Purpose: Configure the real-browser overflow smoke suite (e2e/) against the built frontend.
 * Caller: `npm run test:e2e` locally and the e2e job in .github/workflows/ci.yml.
 * Deps: @playwright/test, a completed `npm run build` (webServer serves dist via vite preview).
 * MainFuncs: defineConfig export.
 * SideEffects: Starts/stops a vite preview server on 127.0.0.1:4173 for the test run.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    // Retry once in CI: a genuine layout regression fails twice; a slow runner doesn't.
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:4173',
        // Real mobile geometry — a Pixel-class viewport with mobile UA and touch.
        // This is the class of environment jsdom can never emulate and where every
        // 2026-07 layout bug actually lived.
        ...devices['Pixel 5'],
    },
    webServer: {
        command: 'npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
});
