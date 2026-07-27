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
        },
        {
            // Recording worker — owns every FFmpeg recorder and the whole recording
            // pipeline, so restarting the API for a UI/route change (the overwhelming
            // majority of deploys) does not involve recording at all.
            //
            // Only takes effect when backend/.env sets RECORDING_WORKER_ENABLED=true;
            // otherwise the API still owns recording and this app would be a SECOND
            // ffmpeg per camera writing to the same directory. safe-deploy.sh keys off
            // the same flag, and only restarts this app when recording code changed.
            name: `${CLIENT_CODE}-cctv-recorder`,
            script: 'recorder.js',
            cwd: path.join(ROOT_DIR, 'backend'),
            instances: 1,
            // fork, never cluster: exactly one process may own the recorders. Two
            // workers would both adopt and both spawn.
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            wait_ready: true,
            listen_timeout: 30000,
            // Same reason as the backend: pm2's default treekill walks the process tree
            // by PPID and would kill the detached recorders this worker exists to keep
            // alive across its own restarts.
            treekill: false,
            env_production: {
                NODE_ENV: 'production'
            }
        }
    ]
};
