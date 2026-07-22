import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Stamp dist/sw.js's `__SW_VERSION__` with a short hash of the built asset
// filenames. The asset names are content-hashed by Vite, so this version changes
// IFF the app output changes — an unchanged rebuild does not churn the SW, but a
// real deploy ships a byte-different sw.js that the browser detects as an update
// (drives the PWA auto-reload; see public/sw.js + utils/registerServiceWorker.js).
function stampServiceWorkerVersion() {
    const root = fileURLToPath(new URL('.', import.meta.url));
    return {
        name: 'stamp-sw-version',
        apply: 'build',
        closeBundle() {
            const swPath = `${root}dist/sw.js`;
            let sw;
            try {
                sw = readFileSync(swPath, 'utf8');
            } catch {
                return; // no sw.js in this build output — nothing to stamp
            }
            let assetNames = [];
            try {
                assetNames = readdirSync(`${root}dist/assets`).sort();
            } catch {
                // assets dir missing (unexpected) — fall through with empty list
            }
            const version = createHash('sha256').update(assetNames.join('|')).digest('hex').slice(0, 12);
            writeFileSync(swPath, sw.replace(/__SW_VERSION__/g, version));
        },
    };
}

export default defineConfig({
    plugins: [react(), stampServiceWorkerVersion()],
    resolve: {
        // Live CCTV needs only core MSE playback, so alias hls.js to its LIGHT build (no subtitles /
        // alt-audio / EME-DRM / CMCD). Every importer (MultiViewVideoItem, preloadManager,
        // CustomerLivePlayer) keeps `import 'hls.js'` — and test vi.mock('hls.js') keeps intercepting —
        // while the bundled/lazy video-player chunk shrinks (~512 KB -> ~333 KB raw). Exact regex so it
        // never rewrites the light subpath itself.
        alias: [
            { find: /^hls\.js$/, replacement: 'hls.js/dist/hls.light.mjs' },
        ],
    },
    server: {
        port: parseInt(process.env.VITE_PORT || '5173', 10),
        host: true,
        proxy: {
            '/api': {
                target: (process.env.VITE_API_URL && process.env.VITE_API_URL.startsWith('http'))
                    ? process.env.VITE_API_URL
                    : 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            output: {
                manualChunks: {
                    // React core
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],

                    // Video player — HLS.js is large; resolve.alias above maps 'hls.js' to the light build.
                    'video-player': ['hls.js'],

                    // Map libraries (Leaflet is large)
                    'map-vendor': ['leaflet', 'react-leaflet'],
                },
            },
        },
    },
});
