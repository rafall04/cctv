import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

import { RECORDINGS_BASE_PATH } from './recordingPaths.js';

class FileWatcher {
    constructor() {
        this.stabilizingFiles = new Set();
    }

    async startGlobalWatcher(onNewFile) {
        return;
    }
}

export { FileWatcher };
