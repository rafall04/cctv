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
            cwd: path.join(ROOT_DIR, 'frontend'),
            args: '-s dist -l 8080',
            instances: 1,
            autorestart: true,
            watch: false
        },
        {
            name: 'mediamtx',
            script: './mediamtx',
            cwd: path.join(ROOT_DIR, 'mediamtx'),
            instances: 1,
            autorestart: true,
            watch: false
        }
    ]
};
