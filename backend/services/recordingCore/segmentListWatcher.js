import { RECORDINGS_BASE_PATH } from './recordingPaths.js';
import { promises as fsp } from 'fs';
import path from 'path';
import fs from 'fs';

export class SegmentListWatcher {
    constructor(segmentProcessor) {
        this.segmentProcessor = segmentProcessor;
        this.watchers = new Map(); // cameraDir -> fs.FSWatcher
        this.lastReadPositions = new Map(); // cameraDir -> byteOffset
        this.recordingsBasePath = RECORDINGS_BASE_PATH;
    }

    async startGlobalWatcher() {
        console.log('[SegmentListWatcher] Starting global watcher for segments.csv...');
        try {
            await fsp.mkdir(this.recordingsBasePath, { recursive: true });

            // Initial scan for existing camera directories
            const entries = await fsp.readdir(this.recordingsBasePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('camera')) {
                    const cameraDir = path.join(this.recordingsBasePath, entry.name);
                    this.watchCameraDirectory(cameraDir);
                }
            }

            // Watch the base directory for new camera folders
            fs.watch(this.recordingsBasePath, (eventType, filename) => {
                if (eventType === 'rename' && filename && filename.startsWith('camera')) {
                    const cameraDir = path.join(this.recordingsBasePath, filename);
                    // Delay slightly to ensure directory is fully created
                    setTimeout(async () => {
                        try {
                            await fsp.access(cameraDir);
                            this.watchCameraDirectory(cameraDir);
                        } catch (e) {}
                    }, 1000);
                }
            });
        } catch (error) {
            console.error('[SegmentListWatcher] Error in startGlobalWatcher:', error);
        }
    }

    async watchCameraDirectory(cameraDir) {
        if (this.watchers.has(cameraDir)) return;

        console.log(`[SegmentListWatcher] Watching camera directory: ${cameraDir}`);
        
        // Initial check for segments.csv
        const csvPath = path.join(cameraDir, 'segments.csv');
        try {
            await fsp.access(csvPath);
            this.processNewLines(cameraDir).catch(err => console.error(`[SegmentListWatcher] Initial process error for ${cameraDir}:`, err));
        } catch (e) {}

        const watcher = fs.watch(cameraDir, (eventType, filename) => {
            if (filename === 'segments.csv') {
                this.processNewLines(cameraDir).catch(err => 
                    console.error(`[SegmentListWatcher] Error processing segments.csv in ${cameraDir}:`, err)
                );
            }
        });

        this.watchers.set(cameraDir, watcher);
    }

    async processNewLines(cameraDir) {
        const csvPath = path.join(cameraDir, 'segments.csv');
        let fileHandle;
        try {
            try {
                await fsp.access(csvPath);
            } catch (e) {
                return;
            }

            fileHandle = await fsp.open(csvPath, 'r');
            const stats = await fileHandle.stat();
            let lastPos = this.lastReadPositions.get(cameraDir) || 0;

            if (stats.size < lastPos) {
                // File was likely truncated or recreated
                console.log(`[SegmentListWatcher] segments.csv truncated in ${cameraDir}, resetting position.`);
                lastPos = 0;
            }

            if (stats.size === lastPos) {
                await fileHandle.close();
                return;
            }

            const bufferSize = stats.size - lastPos;
            const buffer = Buffer.alloc(bufferSize);
            await fileHandle.read(buffer, 0, bufferSize, lastPos);
            await fileHandle.close();
            fileHandle = null;

            this.lastReadPositions.set(cameraDir, stats.size);

            const content = buffer.toString('utf8');
            const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');

            for (const line of lines) {
                // FFmpeg segments.csv format: filename,start_time,end_time
                const parts = line.split(',');
                if (parts.length > 0) {
                    const filename = parts[0].trim();
                    if (filename.endsWith('.mp4')) {
                        const fullPath = path.join(cameraDir, filename);
                        console.log(`[SegmentListWatcher] New segment detected: ${filename} in ${cameraDir}`);
                        this.segmentProcessor.enqueueSegment(fullPath, filename);
                    }
                }
            }
        } catch (error) {
            console.error(`[SegmentListWatcher] Error reading ${csvPath}:`, error);
        } finally {
            if (fileHandle) {
                try { await fileHandle.close(); } catch (e) {}
            }
        }
    }

    stopAll() {
        for (const [cameraDir, watcher] of this.watchers) {
            watcher.close();
            console.log(`[SegmentListWatcher] Stopped watching: ${cameraDir}`);
        }
        this.watchers.clear();
    }
}
