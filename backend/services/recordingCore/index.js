import { streamEngine } from './streamEngine.js';
import { segmentProcessor } from './segmentProcessor.js';
import { fileWatcher } from './fileWatcher.js';
import { houseKeeper } from './houseKeeper.js';

class RecordingService {
    constructor() {
        // Wire dependencies
        segmentProcessor.onSegmentProcessed = () => houseKeeper.realTimeCleanup();

        // Initial recovery
        setTimeout(() => houseKeeper.recoverOrphanedSegments((path, name) => segmentProcessor.enqueueSegment(path, name)), 5000);

        // Start watchers/intervals
        fileWatcher.startGlobalWatcher((path, name) => segmentProcessor.enqueueSegment(path, name));
        
        setInterval(() => streamEngine.checkStalledStreams(), 60000);
        setInterval(() => houseKeeper.realTimeCleanup(), 1800000);
    }

    // Proxy methods to maintain compatibility with existing callers
    async autoStartRecordings() {
        return streamEngine.autoStartRecordings();
    }

    async startRecording(cameraId) {
        return streamEngine.startRecording(cameraId);
    }

    async stopRecording(cameraId) {
        return streamEngine.stopRecording(cameraId);
    }

    // Accessible modules if needed
    get engine() { return streamEngine; }
    get processor() { return segmentProcessor; }
    get watcher() { return fileWatcher; }
    get houseKeeper() { return houseKeeper; }
}

export const recordingService = new RecordingService();
export default recordingService;
