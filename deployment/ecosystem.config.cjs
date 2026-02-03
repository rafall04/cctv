const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');

// Load client configuration
let CLIENT_CODE = 'rafnet';
const configPath = path.join(__dirname, 'client.config.sh');

if (fs.existsSync(configPath)) {
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const match = configContent.match(/CLIENT_CODE="([^"]+)"/);
        if (match) {
            CLIENT_CODE = match[1];
        }
    } catch (error) {
        console.warn('⚠️  Could not read client.config.sh, using default CLIENT_CODE');
    }
}

module.exports = {
    apps: [
        {
            name: `${CLIENT_CODE}-mediamtx`,
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
            name: `${CLIENT_CODE}-cctv-backend`,
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
