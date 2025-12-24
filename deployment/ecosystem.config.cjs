module.exports = {
    apps: [
        {
            name: 'rafnet-cctv-backend',
            script: 'server.js',
            cwd: '../backend',
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
            cwd: '../frontend',
            args: 'dist -s -l 8080',
            instances: 1,
            autorestart: true,
            watch: false
        },
        {
            name: 'mediamtx',
            script: './mediamtx',
            cwd: '../mediamtx',
            instances: 1,
            autorestart: true,
            watch: false
        }
    ]
};
