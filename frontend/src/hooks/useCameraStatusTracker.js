import { useEffect, useRef } from 'react';

// ============================================
// CAMERA STATUS TRACKER HOOK - Tracks camera status changes
// Notifies when cameras go offline/online
// ============================================
export function useCameraStatusTracker(cameras, addToast) {
    const prevCamerasRef = useRef(null);
    const isFirstLoadRef = useRef(true);

    useEffect(() => {
        // Skip first load - don't notify on initial data fetch
        if (isFirstLoadRef.current) {
            if (cameras.length > 0) {
                prevCamerasRef.current = new Map(cameras.map(c => [c.id, {
                    is_online: c.is_online,
                    status: c.status,
                    name: c.name
                }]));
                isFirstLoadRef.current = false;
            }
            return;
        }

        if (!prevCamerasRef.current || cameras.length === 0) return;

        const prevMap = prevCamerasRef.current;
        const changes = { wentOffline: [], wentOnline: [], wentMaintenance: [] };

        cameras.forEach(camera => {
            const prev = prevMap.get(camera.id);
            if (!prev) return; // New camera, skip

            const wasOnline = prev.is_online !== 0 && prev.status !== 'maintenance';
            const isOnline = camera.is_online !== 0 && camera.status !== 'maintenance';
            const wasMaintenance = prev.status === 'maintenance';
            const isMaintenance = camera.status === 'maintenance';

            // Check for status changes
            if (wasOnline && !isOnline && !isMaintenance) {
                changes.wentOffline.push(camera.name);
            } else if (!wasOnline && isOnline && !wasMaintenance) {
                changes.wentOnline.push(camera.name);
            } else if (!wasMaintenance && isMaintenance) {
                changes.wentMaintenance.push(camera.name);
            }
        });

        // Show notifications for changes
        if (changes.wentOffline.length > 0) {
            if (changes.wentOffline.length === 1) {
                addToast(`${changes.wentOffline[0]} sedang offline`, 'warning');
            } else {
                addToast(`${changes.wentOffline.length} kamera sedang offline`, 'warning');
            }
        }

        if (changes.wentOnline.length > 0) {
            if (changes.wentOnline.length === 1) {
                addToast(`${changes.wentOnline[0]} kembali online`, 'success');
            } else {
                addToast(`${changes.wentOnline.length} kamera kembali online`, 'success');
            }
        }

        if (changes.wentMaintenance.length > 0) {
            if (changes.wentMaintenance.length === 1) {
                addToast(`${changes.wentMaintenance[0]} dalam perbaikan`, 'info');
            } else {
                addToast(`${changes.wentMaintenance.length} kamera dalam perbaikan`, 'info');
            }
        }

        // Update previous state
        prevCamerasRef.current = new Map(cameras.map(c => [c.id, {
            is_online: c.is_online,
            status: c.status,
            name: c.name
        }]));

    }, [cameras, addToast]);
}
