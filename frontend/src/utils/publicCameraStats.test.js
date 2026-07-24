import { describe, it, expect } from 'vitest';
import { getPublicCameraStats } from './publicCameraStats.js';

describe('getPublicCameraStats', () => {
    it('buckets online/offline/maintenance and they sum to total', () => {
        const cameras = [
            { is_online: 1 },
            { availability_state: 'online' },
            { availability_state: 'degraded' },       // degraded counts as up/online
            { availability_state: 'offline' },
            { is_online: 0 },                          // hard offline
            { status: 'maintenance' },
        ];
        const s = getPublicCameraStats(cameras);
        expect(s).toEqual({ online: 3, offline: 2, maintenance: 1, total: 6 });
        expect(s.online + s.offline + s.maintenance).toBe(s.total);
    });

    it('treats maintenance status as maintenance even if availability_state says otherwise', () => {
        const s = getPublicCameraStats([{ status: 'maintenance', availability_state: 'online' }]);
        expect(s).toEqual({ online: 0, offline: 0, maintenance: 1, total: 1 });
    });

    it('defaults unknown cameras to online (matches legacy is_online !== 0 rule)', () => {
        expect(getPublicCameraStats([{}, {}]).online).toBe(2);
    });

    it('handles empty / non-array input', () => {
        expect(getPublicCameraStats([])).toEqual({ online: 0, offline: 0, maintenance: 0, total: 0 });
        expect(getPublicCameraStats(undefined)).toEqual({ online: 0, offline: 0, maintenance: 0, total: 0 });
    });
});
