import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH || '/var/www/rafnet-cctv/recordings';

class FileWatcher {
    constructor() {
        this.stabilizingFiles = new Set();
    }

    async startGlobalWatcher(onNewFile) {
        return;
    }
}

export { FileWatcher };
