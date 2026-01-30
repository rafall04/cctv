/**
 * Camera List Optimizer
 * Prevents unnecessary re-renders in grid view by memoizing camera data
 * and detecting actual changes (not just reference changes)
 */

/**
 * Deep compare two camera objects to detect actual changes
 * Only compares fields that affect rendering
 */
export const areCamerasEqual = (cam1, cam2) => {
    if (!cam1 || !cam2) return false;
    
    // Compare essential fields only
    return (
        cam1.id === cam2.id &&
        cam1.name === cam2.name &&
        cam1.location === cam2.location &&
        cam1.is_online === cam2.is_online &&
        cam1.status === cam2.status &&
        cam1.is_tunnel === cam2.is_tunnel &&
        cam1.video_codec === cam2.video_codec &&
        cam1.streams?.hls === cam2.streams?.hls
    );
};

/**
 * Compare two camera arrays and return true if they're functionally equal
 * This prevents re-renders when API returns same data with different object references
 */
export const areCameraListsEqual = (list1, list2) => {
    if (!Array.isArray(list1) || !Array.isArray(list2)) return false;
    if (list1.length !== list2.length) return false;
    
    // Check if all cameras are equal
    for (let i = 0; i < list1.length; i++) {
        if (!areCamerasEqual(list1[i], list2[i])) {
            return false;
        }
    }
    
    return true;
};

/**
 * Custom hook to optimize camera list updates
 * Only updates state if cameras actually changed
 */
export const useOptimizedCameraList = (initialCameras = []) => {
    const [cameras, setCamerasInternal] = React.useState(initialCameras);
    const previousCamerasRef = React.useRef(initialCameras);
    
    const setCameras = React.useCallback((newCameras) => {
        // Only update if cameras actually changed
        if (!areCameraListsEqual(previousCamerasRef.current, newCameras)) {
            previousCamerasRef.current = newCameras;
            setCamerasInternal(newCameras);
        }
    }, []);
    
    return [cameras, setCameras];
};

/**
 * Batch camera updates to reduce re-renders
 * Collects multiple updates and applies them once
 */
export class CameraUpdateBatcher {
    constructor(updateCallback, batchDelay = 100) {
        this.updateCallback = updateCallback;
        this.batchDelay = batchDelay;
        this.pendingUpdates = new Map();
        this.timeoutId = null;
    }
    
    /**
     * Queue a camera update
     */
    queueUpdate(cameraId, updates) {
        this.pendingUpdates.set(cameraId, {
            ...this.pendingUpdates.get(cameraId),
            ...updates
        });
        
        // Clear existing timeout
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
        
        // Schedule batch update
        this.timeoutId = setTimeout(() => {
            this.flush();
        }, this.batchDelay);
    }
    
    /**
     * Apply all pending updates
     */
    flush() {
        if (this.pendingUpdates.size === 0) return;
        
        const updates = Array.from(this.pendingUpdates.entries());
        this.pendingUpdates.clear();
        this.timeoutId = null;
        
        this.updateCallback(updates);
    }
    
    /**
     * Cancel pending updates
     */
    cancel() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        this.pendingUpdates.clear();
    }
}

/**
 * Virtual scrolling helper for large camera lists
 * Only renders visible cameras to reduce memory usage
 */
export const calculateVisibleRange = (scrollTop, itemHeight, containerHeight, totalItems, overscan = 3) => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
        totalItems - 1,
        Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );
    
    return { startIndex, endIndex };
};

/**
 * Chunk cameras into batches for progressive rendering
 * Prevents UI freeze when rendering many cameras at once
 */
export const chunkCameras = (cameras, chunkSize = 10) => {
    const chunks = [];
    for (let i = 0; i < cameras.length; i += chunkSize) {
        chunks.push(cameras.slice(i, i + chunkSize));
    }
    return chunks;
};

/**
 * Progressive rendering hook
 * Renders cameras in chunks to prevent UI freeze
 */
export const useProgressiveRender = (cameras, chunkSize = 10, delayMs = 50) => {
    const [renderedCameras, setRenderedCameras] = React.useState([]);
    const [isRendering, setIsRendering] = React.useState(false);
    
    React.useEffect(() => {
        if (cameras.length === 0) {
            setRenderedCameras([]);
            return;
        }
        
        setIsRendering(true);
        const chunks = chunkCameras(cameras, chunkSize);
        let currentChunk = 0;
        
        const renderNextChunk = () => {
            if (currentChunk >= chunks.length) {
                setIsRendering(false);
                return;
            }
            
            setRenderedCameras(prev => [...prev, ...chunks[currentChunk]]);
            currentChunk++;
            
            setTimeout(renderNextChunk, delayMs);
        };
        
        // Start rendering
        setRenderedCameras([]);
        renderNextChunk();
        
    }, [cameras, chunkSize, delayMs]);
    
    return { renderedCameras, isRendering };
};

export default {
    areCamerasEqual,
    areCameraListsEqual,
    useOptimizedCameraList,
    CameraUpdateBatcher,
    calculateVisibleRange,
    chunkCameras,
    useProgressiveRender,
};
