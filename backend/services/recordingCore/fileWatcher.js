import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH || '/var/www/rafnet-cctv/recordings';

class FileWatcher {
    constructor() {
        this.stabilizingFiles = new Set();
    }

    async startGlobalWatcher(onNewFile) {
        try {
            try {
                await fsp.access(RECORDINGS_BASE_PATH);
            } catch {
                await fsp.mkdir(RECORDINGS_BASE_PATH, { recursive: true });
            }

            fs.watch(RECORDINGS_BASE_PATH, { recursive: true }, async (eventType, filename) => {
                if (!filename || !filename.endsWith('.mp4') || filename.includes('.remux.')) return;
                
                const filePath = path.join(RECORDINGS_BASE_PATH, filename);
                
                if (this.stabilizingFiles.has(filePath)) return;
                this.stabilizingFiles.add(filePath);

                try {
                    let stable = false;
                    let attempts = 0;
                    const maxAttempts = 5;

                    while (!stable && attempts < maxAttempts) {
                        try {
                            const stats1 = await fsp.stat(filePath);
                            const size1 = stats1.size;

                            await new Promise(resolve => setTimeout(resolve, 3000));

                            const stats2 = await fsp.stat(filePath);
                            const size2 = stats2.size;

                            if (size1 === size2 && size1 > 0) {
                                stable = true;
                            } else {
                                attempts++;
                            }
                        } catch (e) {
                            // File might be temporarily locked or deleted
                            attempts++;
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }

                    if (stable) {
                        if (onNewFile) onNewFile(filePath, filename);
                    }
                } finally {
                    this.stabilizingFiles.delete(filePath);
                }
            });
            console.log('[FileWatcher] OS Native Event Listener Active');
        } catch (error) {
            console.error('[FileWatcher] Error starting watcher:', error);
        }
    }
}

export { FileWatcher };
