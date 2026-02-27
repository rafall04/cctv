const { StreamEngine } = require('./streamEngine.js');
const { SegmentProcessor } = require('./segmentProcessor.js');
const { FileWatcher } = require('./fileWatcher.js');
const { HouseKeeper } = require('./houseKeeper.js');
const { LockManager } = require('./lockManager.js');
const { query, queryOne, execute } = require('../../database/connectionPool.js');
import { SegmentProcessor } from './segmentProcessor.js';
import { FileWatcher } from './fileWatcher.js';
import { HouseKeeper } from './houseKeeper.js';
import { LockManager } from './lockManager.js';
import { query, queryOne, execute } from '../../database/connectionPool.js';

class RecordingService {
    constructor(db, customLockManager) {
        this.lockManager = customLockManager || new LockManager();
        const dbDeps = db || { query, queryOne, execute };

        this.streamEngine = new StreamEngine(dbDeps);
        this.segmentProcessor = new SegmentProcessor({ ...dbDeps, lockManager: this.lockManager });
        this.fileWatcher = new FileWatcher();
        this.houseKeeper = new HouseKeeper({ ...dbDeps, lockManager: this.lockManager });

        // Wire dependencies
        this.segmentProcessor.onSegmentProcessed = () => this.houseKeeper.realTimeCleanup();

        // Initial recovery
        setTimeout(() => this.houseKeeper.recoverOrphanedSegments((path, name) => this.segmentProcessor.enqueueSegment(path, name)), 5000);

        // Start watchers/intervals
        this.fileWatcher.startGlobalWatcher((path, name) => this.segmentProcessor.enqueueSegment(path, name));
        
        setInterval(() => this.streamEngine.checkStalledStreams(), 60000);
        setInterval(() => this.houseKeeper.realTimeCleanup(), 1800000);
    }

    // Proxy methods to maintain compatibility with existing callers
    async autoStartRecordings() {
        return this.streamEngine.autoStartRecordings();
    }

    async startRecording(cameraId) {
        return this.streamEngine.startRecording(cameraId);
    }

    async shutdownAll() {
        return this.streamEngine.shutdownAll();
    }

    async stopRecording(cameraId) {
        return this.streamEngine.stopRecording(cameraId);
    }

    getRecordingStatus(cameraId) {
        return this.streamEngine.getRecordingStatus(cameraId);
    }

    getStorageUsage(cameraId) {
        return this.streamEngine.getStorageUsage(cameraId);
    }


    // Accessible modules if needed
    get engine() { return this.streamEngine; }
    get processor() { return this.segmentProcessor; }
    get watcher() { return this.fileWatcher; }
    get keeper() { return this.houseKeeper; }
}

export const recordingService = new RecordingService();
export default recordingService;
