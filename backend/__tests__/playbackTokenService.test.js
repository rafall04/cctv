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
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce(null)
            .mockReturnValueOnce({
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
        expect(result.share_key).toMatch(/^[A-Z0-9]{8}$/);
        expect(result.share_text).toContain(result.share_key);
        expect(result.share_text).not.toContain(result.token);
        expect(result.share_text).toContain('https://cctv.raf.my.id/playback?share=');
        expect(connectionPool.execute.mock.calls[0][0]).toContain('INSERT INTO playback_tokens');
        expect(connectionPool.execute.mock.calls[0][1][1]).not.toBe(result.token);
    });

    it('creates a token with custom short access code for sharing', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ lastInsertRowid: 8, changes: 1 });
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce(null)
            .mockReturnValueOnce({
                id: 8,
                label: 'Kode Custom',
                token_prefix: 'rafpb_custom',
                share_key_prefix: 'RAFNET88',
                preset: 'trial_1d',
                scope_type: 'all',
                camera_ids_json: '[]',
                playback_window_hours: 24,
                expires_at: '2026-05-06 12:00:00',
                revoked_at: null,
                last_used_at: null,
                use_count: 0,
                share_template: 'Kode: {{token}}\nLink: {{playback_url}}',
                created_by: 1,
                created_at: '2026-05-05 12:00:00',
                updated_at: '2026-05-05 12:00:00',
            });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const result = playbackTokenService.createToken(
            {
                label: 'Kode Custom',
                preset: 'trial_1d',
                scope_type: 'all',
                access_code_mode: 'custom',
                custom_access_code: 'RAFNET88',
            },
            { user: { id: 1 }, headers: { origin: 'https://cctv.raf.my.id' } }
        );

        expect(result.share_key).toBe('RAFNET88');
        expect(result.share_text).toContain('Kode: RAFNET88');
        expect(result.share_text).toContain('/playback?share=RAFNET88');
        expect(connectionPool.queryOne.mock.calls[0][0]).toContain('share_key_hash = ?');
        expect(connectionPool.execute.mock.calls[0][1][4]).toBe('RAFNET88');
    });

    it('creates an automatic short access code using requested length', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ lastInsertRowid: 10, changes: 1 });
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce(null)
            .mockReturnValueOnce({
                id: 10,
                label: 'Kode Auto',
                token_prefix: 'rafpb_auto',
                share_key_prefix: 'ABCDEFGH',
                preset: 'trial_1d',
                scope_type: 'all',
                camera_ids_json: '[]',
                playback_window_hours: 24,
                expires_at: '2026-05-06 12:00:00',
                revoked_at: null,
                last_used_at: null,
                use_count: 0,
                share_template: 'Kode: {{token}}',
                created_by: 1,
                created_at: '2026-05-05 12:00:00',
                updated_at: '2026-05-05 12:00:00',
            });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const result = playbackTokenService.createToken(
            {
                label: 'Kode Auto',
                preset: 'trial_1d',
                scope_type: 'all',
                access_code_mode: 'auto',
                access_code_length: 8,
            },
            { user: { id: 1 }, headers: { origin: 'https://cctv.raf.my.id' } }
        );

        expect(result.share_key).toMatch(/^[A-Z0-9]{8}$/);
        expect(result.share_key).toHaveLength(8);
        expect(result.share_text).toContain(result.share_key);
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

    it('builds repeat share text with a share key instead of exposing the original token', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce({
                id: 17,
                label: 'Client Lama',
                token_prefix: 'rafpb_secret',
                share_key_prefix: null,
                preset: 'client_30d',
                scope_type: 'all',
                camera_ids_json: '[]',
                playback_window_hours: 720,
                expires_at: '2026-06-05 12:00:00',
                revoked_at: null,
                last_used_at: null,
                use_count: 0,
                share_template: 'Kode: {{token}}\nLink: {{playback_url}}',
                created_by: 1,
                created_at: '2026-05-05 12:00:00',
                updated_at: '2026-05-05 12:00:00',
            })
            .mockReturnValueOnce(null)
            .mockReturnValueOnce({
                id: 17,
                label: 'Client Lama',
                token_prefix: 'rafpb_secret',
                share_key_prefix: 'rafps_newkey',
                preset: 'client_30d',
                scope_type: 'all',
                camera_ids_json: '[]',
                playback_window_hours: 720,
                expires_at: '2026-06-05 12:00:00',
                revoked_at: null,
                last_used_at: null,
                use_count: 0,
                share_template: 'Kode: {{token}}\nLink: {{playback_url}}',
                created_by: 1,
                created_at: '2026-05-05 12:00:00',
                updated_at: '2026-05-05 12:00:00',
            });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const result = playbackTokenService.buildRepeatShareText(17, {
            user: { id: 2 },
            headers: { origin: 'https://cctv.raf.my.id' },
        });

        expect(result.share_text).toMatch(/Kode: [A-Z0-9]{8}/);
        expect(result.share_text).toContain('/playback?share=');
        expect(result.share_text).not.toContain('rafpb_secret');
        expect(connectionPool.execute.mock.calls[0][0]).toContain('share_key_hash');
        expect(connectionPool.execute.mock.calls.at(-1)[0]).toContain('INSERT INTO playback_token_audit_logs');
    });

    it('records camera access audit when token validation is touched', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({
            id: 21,
            label: 'Audit Client',
            token_prefix: 'rafpb_audit',
            share_key_prefix: 'rafps_audit',
            preset: 'custom',
            scope_type: 'all',
            camera_ids_json: '[]',
            playback_window_hours: null,
            expires_at: null,
            revoked_at: null,
            last_used_at: null,
            use_count: 4,
            share_template: null,
            created_by: 1,
            created_at: '2026-05-05 12:00:00',
            updated_at: '2026-05-05 12:00:00',
        });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        playbackTokenService.validateRequestForCamera(
            {
                cookies: { raf_playback_token: 'rafpb_audit_raw' },
                headers: { 'user-agent': 'vitest', 'x-forwarded-for': '10.0.0.8' },
                ip: '127.0.0.1',
                user: null,
            },
            1168,
            { touch: true, eventType: 'access_segments' }
        );

        expect(connectionPool.execute).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO playback_token_audit_logs'),
            expect.arrayContaining([21, 'access_segments', 1168])
        );
    });

    it('lists recent audit logs with one bounded joined query', async () => {
        vi.spyOn(connectionPool, 'query').mockReturnValue([
            {
                id: 1,
                token_id: 21,
                token_label: 'Audit Client',
                token_prefix: 'rafpb_audit',
                event_type: 'access_segments',
                camera_id: 1168,
                camera_name: 'CCTV ALANG ALANG',
                actor_user_id: null,
                actor_username: null,
                ip_address: '10.0.0.8',
                user_agent: 'vitest',
                detail_json: '{"scope_type":"all"}',
                created_at: '2026-05-05 12:00:00',
            },
        ]);
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const logs = playbackTokenService.listAuditLogs({ limit: 25 });

        expect(connectionPool.query).toHaveBeenCalledTimes(1);
        expect(connectionPool.query.mock.calls[0][0]).toContain('LEFT JOIN playback_tokens pt');
        expect(connectionPool.query.mock.calls[0][0]).toContain('LIMIT ?');
        expect(connectionPool.query.mock.calls[0][1]).toEqual([25]);
        expect(logs[0]).toMatchObject({
            token_label: 'Audit Client',
            camera_name: 'CCTV ALANG ALANG',
            detail: { scope_type: 'all' },
        });
    });
});
