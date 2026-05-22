/**
 * Purpose: Verify CSRF skip-list exempts public viewer-tracking endpoints
 *          while still protecting admin mutations.
 * Caller: Vitest backend suite.
 * Deps: middleware/csrfProtection.js shouldSkipCsrf.
 * MainFuncs: shouldSkipCsrf.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { shouldSkipCsrf } from '../middleware/csrfProtection.js';

describe('shouldSkipCsrf', () => {
    it('exempts every public viewer-tracking POST', () => {
        expect(shouldSkipCsrf('/api/viewer/start')).toBe(true);
        expect(shouldSkipCsrf('/api/viewer/heartbeat')).toBe(true);
        expect(shouldSkipCsrf('/api/viewer/stop')).toBe(true);
        // The endpoint that was missed and got 403'd in production.
        expect(shouldSkipCsrf('/api/viewer/runtime-signal')).toBe(true);
    });

    it('exempts public playback-viewer tracking POSTs', () => {
        expect(shouldSkipCsrf('/api/playback-viewer/start')).toBe(true);
        expect(shouldSkipCsrf('/api/playback-viewer/heartbeat')).toBe(true);
        expect(shouldSkipCsrf('/api/playback-viewer/stop')).toBe(true);
    });

    it('exempts token refresh', () => {
        expect(shouldSkipCsrf('/api/auth/refresh')).toBe(true);
    });

    it('still protects admin state-changing endpoints', () => {
        expect(shouldSkipCsrf('/api/cameras')).toBe(false);
        expect(shouldSkipCsrf('/api/areas/12')).toBe(false);
        expect(shouldSkipCsrf('/api/admin/playback-tokens')).toBe(false);
        expect(shouldSkipCsrf('/api/settings/map_default_center')).toBe(false);
    });

    it('handles a missing url defensively', () => {
        expect(shouldSkipCsrf('')).toBe(false);
        expect(shouldSkipCsrf(undefined)).toBe(false);
    });
});
