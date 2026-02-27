import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH || '/var/www/rafnet-cctv/recordings';

class FileWatcher {
    constructor() {
        this.fileDebounceTimers = new Map();
    }

    async startGlobalWatcher(onNewFile) {
        try {
            try {
                await fsp.access(RECORDINGS_BASE_PATH);
            } catch {
                await fsp.mkdir(RECORDINGS_BASE_PATH, { recursive: true });
            }

            fs.watch(RECORDINGS_BASE_PATH, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.mp4') || filename.includes('.remux.')) return;
                
                const filePath = path.join(RECORDINGS_BASE_PATH, filename);
                const fileKey = filename;
                
                if (this.fileDebounceTimers.has(fileKey)) {
                    clearTimeout(this.fileDebounceTimers.get(fileKey));
                }
                
                const timer = setTimeout(() => {
                    this.fileDebounceTimers.delete(fileKey);
                    if (onNewFile) onNewFile(filePath, filename);
                }, 10000);
                
                this.fileDebounceTimers.set(fileKey, timer);
            });
            console.log('[FileWatcher] OS Native Event Listener Active');
        } catch (error) {
            console.error('[FileWatcher] Error starting watcher:', error);
        }
    }
}

export const fileWatcher = new FileWatcher();
