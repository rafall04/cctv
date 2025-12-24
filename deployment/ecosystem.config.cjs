const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
    apps: [
        {
            name: 'rafnet-cctv-backend',
            script: 'server.js',
            cwd: path.join(ROOT_DIR, 'backend'),
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env_production: {
                NODE_ENV: 'production',
                PORT: 3000
            }
        },
        {
            name: 'rafnet-cctv-frontend',
            script: 'serve',
            env: {
                PM2_SERVE_PATH: path.join(ROOT_DIR, 'frontend/dist'),
                PM2_SERVE_PORT: 8080,
                PM2_SERVE_SPA: 'true',
                PM2_SERVE_HOMEPAGE: './index.html'
            },
            instances: 1,
            autorestart: true,
            watch: false
        },
        {
            name: 'mediamtx',
            script: path.join(ROOT_DIR, 'mediamtx/mediamtx'),
            cwd: path.join(ROOT_DIR, 'mediamtx'),
            instances: 1,
            autorestart: true,
            watch: false
        }
    ]
};
