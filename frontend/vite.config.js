import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
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
