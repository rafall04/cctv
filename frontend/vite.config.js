import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: parseInt(process.env.VITE_PORT || '5173', 10),
        host: true,
        proxy: {
            '/api': {
                target: process.env.VITE_API_URL || 'http://localhost:3000',
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
                    
                    // Video player (HLS.js is large)
                    'video-player': ['hls.js'],
                    
                    // Map libraries (Leaflet is large)
                    'map-vendor': ['leaflet', 'react-leaflet'],
                    
                    // Admin pages (lazy loaded)
                    'admin-pages': [
                        './src/pages/Dashboard.jsx',
                        './src/pages/CameraManagement.jsx',
                        './src/pages/AreaManagement.jsx',
                        './src/pages/UserManagement.jsx',
                        './src/pages/FeedbackManagement.jsx',
                        './src/pages/ViewerAnalytics.jsx',
                        './src/pages/UnifiedSettings.jsx',
                        './src/pages/SponsorManagement.jsx',
                        './src/pages/RecordingDashboard.jsx',
                    ],
                },
            },
        },
    },
});
