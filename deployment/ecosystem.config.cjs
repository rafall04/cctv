const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
    apps: [
        {
            name: 'mediamtx',
            script: './mediamtx',
            cwd: path.join(ROOT_DIR, 'mediamtx'),
            args: ['mediamtx.yml'],
            interpreter: 'none',
            instances: 1,
            autorestart: true,
            watch: false,
            max_restarts: 10,
            restart_delay: 3000,
        },
        {
            name: 'cctv-backend',
            script: 'server.js',
            cwd: path.join(ROOT_DIR, 'backend'),
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            wait_ready: true,
            listen_timeout: 10000,
            env_production: {
                NODE_ENV: 'production',
                PORT: 3000
            }
        }
    ]
};
