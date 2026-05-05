/**
 * Purpose: Verify scoped playback token creation, share text, and camera validation behavior.
 * Caller: Backend focused test gate for playback token access.
 * Deps: vitest, mocked connectionPool, playbackTokenService.
 * MainFuncs: playbackTokenService behavior tests.
 * SideEffects: Mocks database calls only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';

describe('playbackTokenService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('creates a trial token with share text and hashed storage only', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ lastInsertRowid: 7, changes: 1 });
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({
            id: 7,
            label: 'Trial Client',
            token_prefix: 'rafpb_abc123',
            preset: 'trial_3d',
            scope_type: 'all',
            camera_ids_json: '[]',
            playback_window_hours: 72,
            expires_at: '2026-05-08 12:00:00',
            revoked_at: null,
            last_used_at: null,
            use_count: 0,
            share_template: 'Token: {{token}}\nLink: {{playback_url}}\nAkses: {{camera_scope}}',
            created_by: 1,
            created_at: '2026-05-05 12:00:00',
            updated_at: '2026-05-05 12:00:00',
        });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const result = playbackTokenService.createToken(
            { label: 'Trial Client', preset: 'trial_3d', scope_type: 'all' },
            { user: { id: 1 }, headers: { origin: 'https://cctv.raf.my.id' } }
        );

        expect(result.token).toMatch(/^rafpb_/);
        expect(result.share_text).toContain(result.token);
        expect(result.share_text).toContain('https://cctv.raf.my.id/playback?token=');
        expect(connectionPool.execute.mock.calls[0][0]).toContain('INSERT INTO playback_tokens');
        expect(connectionPool.execute.mock.calls[0][1][1]).not.toBe(result.token);
    });

    it('allows only cameras included in selected scope', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({
            id: 9,
            label: 'Area Timur',
            token_prefix: 'rafpb_xyz789',
            preset: 'custom',
            scope_type: 'selected',
            camera_ids_json: '[10,11]',
            playback_window_hours: null,
            expires_at: null,
            revoked_at: null,
            last_used_at: null,
            use_count: 0,
            share_template: null,
            created_by: 1,
            created_at: '2026-05-05 12:00:00',
            updated_at: '2026-05-05 12:00:00',
        });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const valid = playbackTokenService.validateRawTokenForCamera('rafpb_test', 10, { touch: true });
        expect(valid.id).toBe(9);
        expect(connectionPool.execute).toHaveBeenCalledWith(expect.stringContaining('use_count = use_count + 1'), [9]);
        expect(() => playbackTokenService.validateRawTokenForCamera('rafpb_test', 12)).toThrow('Token playback tidak mencakup kamera ini');
    });
});
