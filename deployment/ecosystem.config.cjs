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
            script: path.join(ROOT_DIR, 'mediamtx', 'mediamtx'),
            args: [path.join(ROOT_DIR, 'mediamtx', 'mediamtx.yml')],
            cwd: path.join(ROOT_DIR, 'mediamtx'),
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
            // treekill:false — signal ONLY the backend, never its children.
            //
            // pm2 defaults to treekill:true, which enumerates the process tree by PPID
            // and kills everything under the app. That reaches the recording ffmpeg even
            // though they are spawned `detached` — detaching wins its own process GROUP,
            // which stops group-wide signals, but does nothing against pm2 explicitly
            // hunting children by parent pid. Measured on prod: with treekill on, every
            // recorder pid changed across a restart despite the detach; the recordings
            // are only actually continuous with this off.
            //
            // Safe here because the only other children are thumbnail ffmpeg, which are
            // short-lived and self-terminating — briefly orphaning one is harmless, and
            // recordingOrphanReaper cleans up anything genuinely unwanted at next boot.
            treekill: false,
            env_production: {
                NODE_ENV: 'production',
                PORT: 3000
            }
        }
    ]
};
