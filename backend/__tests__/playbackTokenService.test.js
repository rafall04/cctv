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

    it('stores per-token session policy overrides at creation', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ lastInsertRowid: 31, changes: 1 });
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce(null)
            .mockReturnValueOnce({
                id: 31,
                label: 'Trial Limit',
                token_prefix: 'rafpb_limit',
                share_key_prefix: 'ABC12345',
                preset: 'trial_3d',
                scope_type: 'all',
                camera_ids_json: '[]',
                playback_window_hours: 72,
                expires_at: '2026-05-08 12:00:00',
                revoked_at: null,
                last_used_at: null,
                use_count: 0,
                max_active_sessions: 2,
                session_limit_mode: 'strict',
                session_timeout_seconds: 90,
                client_note: 'Client test',
                active_session_count: 0,
                share_template: null,
                created_by: 1,
                created_at: '2026-05-05 12:00:00',
                updated_at: '2026-05-05 12:00:00',
            });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const result = playbackTokenService.createToken(
            {
                label: 'Trial Limit',
                preset: 'trial_3d',
                scope_type: 'all',
                max_active_sessions: 2,
                session_limit_mode: 'strict',
                session_timeout_seconds: 90,
                client_note: 'Client test',
            },
            { user: { id: 1 }, headers: { origin: 'https://cctv.raf.my.id' } }
        );

        expect(result.data.max_active_sessions).toBe(2);
        expect(result.data.session_limit_mode).toBe('strict');
        expect(result.data.session_timeout_seconds).toBe(90);
        expect(connectionPool.execute.mock.calls[0][0]).toContain('max_active_sessions');
        expect(connectionPool.execute.mock.calls[0][1]).toEqual(expect.arrayContaining([2, 'strict', 90, 'Client test']));
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

    it('creates selected token camera rules from payload', async () => {
        vi.spyOn(connectionPool, 'transaction').mockImplementation((callback) => callback);
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ lastInsertRowid: 52, changes: 1 });
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce(null)
            .mockReturnValueOnce({
                id: 52,
                label: 'Area Barat',
                token_prefix: 'rafpb_rules',
                share_key_prefix: 'RULE8888',
                preset: 'custom',
                scope_type: 'selected',
                camera_ids_json: '[3,4]',
                playback_window_hours: 48,
                expires_at: null,
                revoked_at: null,
                last_used_at: null,
                use_count: 0,
                max_active_sessions: null,
                session_limit_mode: 'unlimited',
                session_timeout_seconds: 60,
                client_note: '',
                share_template: 'Kode {{token}}',
                created_by: 1,
                created_at: '2026-05-05 12:00:00',
                updated_at: '2026-05-05 12:00:00',
            });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const result = playbackTokenService.createToken(
            {
                label: 'Area Barat',
                preset: 'custom',
                scope_type: 'selected',
                camera_rules: [
                    { camera_id: 3, enabled: true, playback_window_hours: 24 },
                    { camera_id: 4, enabled: true },
                ],
                playback_window_hours: 48,
                share_template: 'Kode {{token}}',
            },
            { user: { id: 1 }, headers: { origin: 'https://cctv.raf.my.id' } }
        );

        expect(result.data.allowed_camera_ids).toEqual([3, 4]);
        expect(result.data.camera_rules).toEqual([
            { camera_id: 3, enabled: true, playback_window_hours: 24, expires_at: null, note: '' },
            { camera_id: 4, enabled: true, playback_window_hours: null, expires_at: null, note: '' },
        ]);
        expect(connectionPool.execute).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO playback_token_camera_rules'),
            [52, 3, 1, 24, null, '']
        );
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

    it('returns default selected camera metadata when validating a token without requested camera', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({
            id: 77,
            label: 'Client Single CCTV',
            token_prefix: 'rafpb_single',
            share_key_prefix: 'SANDI1234',
            preset: 'custom',
            scope_type: 'selected',
            camera_ids_json: '[]',
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
        vi.spyOn(connectionPool, 'query').mockReturnValue([
            { camera_id: 1168, enabled: 1, playback_window_hours: null, expires_at: null, note: '' },
        ]);
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const result = playbackTokenService.validateRawTokenForCamera('SANDI1234', 0, { touch: false });

        expect(result.allowed_camera_ids).toEqual([1168]);
        expect(result.default_camera_id).toBe(1168);
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

    it('builds selected-camera share link with target camera id', async () => {
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const shareText = playbackTokenService.buildShareText({
            shareKey: 'CLIENT88',
            tokenRow: {
                label: 'Client Gate',
                scope_type: 'selected',
                camera_rules: [{ camera_id: 7, enabled: true }],
                allowed_camera_ids: [7],
                share_template: 'Link: {{playback_url}}',
            },
            request: { headers: { origin: 'https://cctv.raf.my.id' } },
        });

        expect(shareText).toContain('/playback?cam=7&share=CLIENT88');
    });

    it('builds selected-camera share text count from allowed camera metadata', async () => {
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const shareText = playbackTokenService.buildShareText({
            shareKey: 'SANDI1234',
            tokenRow: {
                label: 'Client Alang Alang',
                scope_type: 'selected',
                camera_ids_json: '[]',
                camera_rules: [{ camera_id: 1168, enabled: true }],
                allowed_camera_ids: [1168],
                expires_at: null,
                share_template: 'Kode Akses: {{token}}\nLink: {{playback_url}}\nBerlaku: {{expires_at}}\nAkses: {{camera_scope}}',
            },
            request: { headers: { origin: 'http://172.17.11.12:800' } },
        });

        expect(shareText).toContain('Kode Akses: SANDI1234');
        expect(shareText).toContain('Link: http://172.17.11.12:800/playback?cam=1168&share=SANDI1234');
        expect(shareText).toContain('Akses: 1 kamera terpilih');
        expect(shareText).not.toContain('Akses: 0 kamera terpilih');
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

    it('rejects a new strict session when token active session limit is full', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'query')
            .mockReturnValueOnce([
                { id: 1, last_seen_at: '2026-05-05 12:00:00' },
            ]);
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        expect(() => playbackTokenService.createPlaybackSession({
            token: {
                id: 41,
                max_active_sessions: 1,
                session_limit_mode: 'strict',
                session_timeout_seconds: 60,
            },
            clientId: 'client-a',
            request: { headers: { 'user-agent': 'vitest' }, ip: '127.0.0.1' },
        })).toThrow('Batas perangkat aktif untuk token ini sudah penuh');
    });

    it('replaces oldest active session when token uses replace_oldest mode', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ lastInsertRowid: 2, changes: 1 });
        vi.spyOn(connectionPool, 'query')
            .mockReturnValueOnce([
                { id: 1, last_seen_at: '2026-05-05 11:59:00' },
            ]);
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const session = playbackTokenService.createPlaybackSession({
            token: {
                id: 42,
                max_active_sessions: 1,
                session_limit_mode: 'replace_oldest',
                session_timeout_seconds: 60,
            },
            clientId: 'client-b',
            request: { headers: { 'user-agent': 'vitest' }, ip: '127.0.0.1' },
        });

        expect(session.session_id).toMatch(/^rafpsess_/);
        expect(connectionPool.execute).toHaveBeenCalledWith(
            expect.stringContaining('end_reason = ?'),
            ['replaced', 1]
        );
        expect(connectionPool.execute).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO playback_token_sessions'),
            expect.any(Array)
        );
    });

    it('requires an active playback session for limited token stream requests', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne').mockReturnValueOnce(null);
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        expect(() => playbackTokenService.assertPlaybackSession({
            request: { cookies: {}, headers: {} },
            token: {
                id: 43,
                max_active_sessions: 1,
                session_timeout_seconds: 60,
            },
            touch: true,
        })).toThrow('Session playback tidak aktif');
    });

    it('updates mutable settings and camera entitlement rules without changing token secrets', async () => {
        vi.spyOn(connectionPool, 'transaction').mockImplementation((callback) => callback);
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce({
                id: 51,
                label: 'Nama Lama',
                token_prefix: 'rafpb_safe',
                share_key_prefix: 'SAFE1234',
                preset: 'trial_3d',
                scope_type: 'selected',
                camera_ids_json: '[1,2]',
                playback_window_hours: 72,
                expires_at: '2026-05-08 12:00:00',
                revoked_at: null,
                last_used_at: null,
                use_count: 8,
                max_active_sessions: 1,
                session_limit_mode: 'strict',
                session_timeout_seconds: 60,
                client_note: '',
                share_template: null,
                created_by: 1,
                created_at: '2026-05-05 12:00:00',
                updated_at: '2026-05-05 12:00:00',
            })
            .mockReturnValueOnce({
                id: 51,
                label: 'Nama Baru',
                token_prefix: 'rafpb_safe',
                share_key_prefix: 'SAFE1234',
                preset: 'trial_3d',
                scope_type: 'selected',
                camera_ids_json: '[1,3]',
                playback_window_hours: 24,
                expires_at: '2099-01-01 00:00:00',
                revoked_at: null,
                last_used_at: null,
                use_count: 8,
                max_active_sessions: 2,
                session_limit_mode: 'replace_oldest',
                session_timeout_seconds: 120,
                client_note: 'NOC utama',
                share_template: 'Kode {{token}}',
                created_by: 1,
                created_at: '2026-05-05 12:00:00',
                updated_at: '2026-05-05 12:05:00',
            });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const updated = playbackTokenService.updateTokenSettings(51, {
            label: 'Nama Baru',
            scope_type: 'selected',
            camera_rules: [
                { camera_id: 1, enabled: true, playback_window_hours: 24 },
                { camera_id: 3, enabled: true, playback_window_hours: 12 },
            ],
            playback_window_hours: 24,
            expires_at: '2099-01-01 00:00:00',
            max_active_sessions: 2,
            session_limit_mode: 'replace_oldest',
            session_timeout_seconds: 120,
            client_note: 'NOC utama',
            share_template: 'Kode {{token}}',
        }, { user: { id: 3 }, headers: {} });

        expect(updated).toMatchObject({
            label: 'Nama Baru',
            expires_at: '2099-01-01 00:00:00',
            scope_type: 'selected',
            allowed_camera_ids: [1, 3],
            use_count: 8,
            max_active_sessions: 2,
            session_limit_mode: 'replace_oldest',
            session_timeout_seconds: 120,
        });
        const updateCall = connectionPool.execute.mock.calls.find((call) => call[0].includes('UPDATE playback_tokens'));
        expect(updateCall?.[0]).toContain('UPDATE playback_tokens');
        expect(updateCall?.[0]).not.toContain('token_hash');
        expect(updateCall?.[0]).not.toContain('share_key_hash');
        expect(connectionPool.execute).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO playback_token_camera_rules'),
            [51, 1, 1, 24, null, '']
        );
        expect(connectionPool.execute).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO playback_token_audit_logs'),
            expect.arrayContaining([51, 'updated'])
        );
    });

    it('does not replace existing camera rules when selected update payload is invalid', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne').mockReturnValueOnce({
            id: 52,
            label: 'Token Terpilih',
            token_prefix: 'rafpb_safe',
            share_key_prefix: 'SAFE1234',
            preset: 'trial_3d',
            scope_type: 'selected',
            camera_ids_json: '[1,2]',
            playback_window_hours: 72,
            expires_at: '2026-05-08 12:00:00',
            revoked_at: null,
            last_used_at: null,
            use_count: 8,
            max_active_sessions: 1,
            session_limit_mode: 'strict',
            session_timeout_seconds: 60,
            client_note: '',
            share_template: null,
            created_by: 1,
            created_at: '2026-05-05 12:00:00',
            updated_at: '2026-05-05 12:00:00',
        });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        expect(() => playbackTokenService.updateTokenSettings(52, {
            scope_type: 'selected',
            camera_rules: [],
        }, { user: { id: 3 }, headers: {} })).toThrow('Pilih minimal satu kamera untuk scope selected');

        expect(connectionPool.execute).not.toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM playback_token_camera_rules'),
            expect.any(Array)
        );
        expect(connectionPool.execute).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE playback_tokens'),
            expect.any(Array)
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

    it('returns empty audit logs when audit migration has not run yet', async () => {
        vi.spyOn(connectionPool, 'query').mockImplementation(() => {
            throw new Error('SQLITE_ERROR: no such table: playback_token_audit_logs');
        });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const logs = playbackTokenService.listAuditLogs({ limit: 50 });

        expect(logs).toEqual([]);
    });

    it('does not break token flow when audit table is missing', async () => {
        vi.spyOn(connectionPool, 'execute').mockImplementation((sql) => {
            if (sql.includes('playback_token_audit_logs')) {
                throw new Error('SQLITE_ERROR: no such table: playback_token_audit_logs');
            }
            return { changes: 1 };
        });
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        expect(() => playbackTokenService.recordAudit({
            tokenId: 1,
            eventType: 'created',
            request: { headers: {} },
        })).not.toThrow();
    });
});
