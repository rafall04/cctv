/**
 * Purpose: Verify normalized per-camera playback token entitlement rules and access policy.
 * Caller: Backend focused test gate for playback token rule policy.
 * Deps: Vitest, mocked connectionPool, playbackTokenRuleService.
 * MainFuncs: playbackTokenRuleService behavior tests.
 * SideEffects: Mocks database calls only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';

describe('playbackTokenRuleService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('normalizes selected camera rules with per-camera windows and expiry', async () => {
        const { default: playbackTokenRuleService } = await import('../services/playbackTokenRuleService.js');

        const rules = playbackTokenRuleService.normalizeRules([
            { camera_id: '7', enabled: true, playback_window_hours: '24', expires_at: '2026-05-20T00:00:00.000Z', note: 'Gate' },
            { camera_id: 7, enabled: true, playback_window_hours: 48 },
            { camera_id: 'x', enabled: true },
        ]);

        expect(rules).toEqual([
            {
                camera_id: 7,
                enabled: true,
                playback_window_hours: 24,
                expires_at: '2026-05-20 00:00:00',
                note: 'Gate',
                allow_live: null,
            },
        ]);
    });

    it('parses a per-camera live override tri-state (true/false/inherit)', async () => {
        const { default: playbackTokenRuleService } = await import('../services/playbackTokenRuleService.js');

        const rules = playbackTokenRuleService.normalizeRules([
            { camera_id: 1, enabled: true, allow_live: true },
            { camera_id: 2, enabled: true, allow_live: false },
            { camera_id: 3, enabled: true },
        ]);

        expect(rules.map((r) => r.allow_live)).toEqual([true, false, null]);
    });

    it('denies all-scope token on admin_only camera unless explicit rule exists', async () => {
        const { default: playbackTokenRuleService } = await import('../services/playbackTokenRuleService.js');

        const policy = playbackTokenRuleService.resolveCameraAccess({
            token: { id: 4, scope_type: 'all', playback_window_hours: 72 },
            camera: { id: 9, public_playback_mode: 'admin_only' },
            rules: [],
        });

        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe('token_all_excludes_admin_only');
    });

    it('allows selected explicit rule on admin_only camera', async () => {
        const { default: playbackTokenRuleService } = await import('../services/playbackTokenRuleService.js');

        const policy = playbackTokenRuleService.resolveCameraAccess({
            token: { id: 4, scope_type: 'selected', playback_window_hours: 72 },
            camera: { id: 9, public_playback_mode: 'admin_only' },
            rules: [{ camera_id: 9, enabled: true, playback_window_hours: 12, expires_at: null }],
        });

        expect(policy).toMatchObject({
            allowed: true,
            playbackWindowHours: 12,
            ruleSource: 'camera_rule',
        });
    });

    it('replaces rules in one transaction with normalized rows', async () => {
        const transactionMock = vi.spyOn(connectionPool, 'transaction').mockImplementation((callback) => callback);
        const executeMock = vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        const { default: playbackTokenRuleService } = await import('../services/playbackTokenRuleService.js');

        const rules = playbackTokenRuleService.replaceRulesForToken(12, [
            { camera_id: 3, enabled: true, playback_window_hours: 24 },
            { camera_id: 4, enabled: false, note: 'Paused' },
        ]);

        expect(transactionMock).toHaveBeenCalled();
        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM playback_token_camera_rules'),
            [12]
        );
        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO playback_token_camera_rules'),
            [12, 3, 1, 24, null, '', null]
        );
        expect(rules).toEqual([
            { camera_id: 3, enabled: true, playback_window_hours: 24, expires_at: null, note: '', allow_live: null },
            { camera_id: 4, enabled: false, playback_window_hours: null, expires_at: null, note: 'Paused', allow_live: null },
        ]);
    });

    it('resolves effective live: per-camera override wins, else token default', async () => {
        const { default: playbackTokenRuleService } = await import('../services/playbackTokenRuleService.js');

        // token default ON, no per-camera rule -> allowLive true (all scope)
        const a = playbackTokenRuleService.resolveCameraAccess({
            token: { id: 1, scope_type: 'all', playback_window_hours: 72, allow_live: 1 },
            camera: { id: 5, public_playback_mode: 'inherit' },
            rules: [],
        });
        expect(a).toMatchObject({ allowed: true, allowLive: true });

        // token default ON, per-camera override OFF -> allowLive false
        const b = playbackTokenRuleService.resolveCameraAccess({
            token: { id: 1, scope_type: 'selected', playback_window_hours: 72, allow_live: 1 },
            camera: { id: 5, public_playback_mode: 'inherit' },
            rules: [{ camera_id: 5, enabled: true, allow_live: false }],
        });
        expect(b).toMatchObject({ allowed: true, allowLive: false });

        // token default OFF, per-camera override ON -> allowLive true
        const c = playbackTokenRuleService.resolveCameraAccess({
            token: { id: 1, scope_type: 'selected', playback_window_hours: 72, allow_live: 0 },
            camera: { id: 5, public_playback_mode: 'inherit' },
            rules: [{ camera_id: 5, enabled: true, allow_live: true }],
        });
        expect(c).toMatchObject({ allowed: true, allowLive: true });

        // denied camera -> allowLive false regardless of token default
        const d = playbackTokenRuleService.resolveCameraAccess({
            token: { id: 1, scope_type: 'selected', playback_window_hours: 72, allow_live: 1 },
            camera: { id: 9, public_playback_mode: 'inherit' },
            rules: [{ camera_id: 5, enabled: true }],
        });
        expect(d).toMatchObject({ allowed: false, allowLive: false });
    });
});
