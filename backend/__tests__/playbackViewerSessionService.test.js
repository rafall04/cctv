/**
 * Purpose: Verify playback viewer session timing uses configured local SQL semantics.
 * Caller: Backend Vitest suite for services/playbackViewerSessionService.js.
 * Deps: Vitest, mocked connectionPool, mocked timezone/cache services.
 * MainFuncs: endSession, archiveOldHistory.
 * SideEffects: None; database writes are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    queryMock,
    queryOneMock,
    executeMock,
    resolveIpIdentityMock,
    enforceAccessMock,
    logSecurityEventMock,
} = vi.hoisted(() => ({
    queryMock: vi.fn(),
    queryOneMock: vi.fn(),
    executeMock: vi.fn(),
    resolveIpIdentityMock: vi.fn(),
    enforceAccessMock: vi.fn(),
    logSecurityEventMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

vi.mock('../services/cacheService.js', () => ({
    CacheNamespace: { STATS: 'stats' },
    CacheTTL: { SHORT: 1 },
    cacheGetOrSetSync: (_key, factory) => factory(),
    cacheKey: (...parts) => parts.join(':'),
}));

vi.mock('../services/networkIdentityService.js', () => ({
    default: {
        resolveIpIdentity: resolveIpIdentityMock,
    },
}));

vi.mock('../services/networkAccessPolicyService.js', () => ({
    default: {
        enforceAccess: enforceAccessMock,
    },
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    SECURITY_EVENTS: {
        NETWORK_ACCESS_ALLOWED: 'NETWORK_ACCESS_ALLOWED',
        NETWORK_ACCESS_DENIED: 'NETWORK_ACCESS_DENIED',
    },
    logSecurityEvent: logSecurityEventMock,
}));

import playbackViewerSessionService from '../services/playbackViewerSessionService.js';

describe('playbackViewerSessionService', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryOneMock.mockReset();
        executeMock.mockReset();
        executeMock.mockReturnValue({ changes: 1 });
        resolveIpIdentityMock.mockReset();
        resolveIpIdentityMock.mockReturnValue({
            ipAddress: '127.0.0.1',
            asnNumber: 7713,
            asnOrg: 'PT Telekomunikasi Indonesia',
            lookupSource: 'geolite2_asn',
            lookupVersion: '2026-05-07',
        });
        enforceAccessMock.mockReset();
        enforceAccessMock.mockReturnValue({ allowed: true, reason: 'observe_only' });
        logSecurityEventMock.mockReset();
        playbackViewerSessionService.lastRetentionRunAt = Date.now();
    });

    it('blocks playback session creation when ASN policy denies access', () => {
        const policyError = new Error('ASN policy denied');
        policyError.statusCode = 403;
        enforceAccessMock.mockImplementation(() => {
            throw policyError;
        });

        expect(() => playbackViewerSessionService.startSession({
            cameraId: 7,
            cameraName: 'Playback Camera',
            segmentFilename: 'seg-1.mp4',
            segmentStartedAt: '2026-05-05T07:00:00.000Z',
            accessMode: 'public_preview',
        }, {
            headers: { 'user-agent': 'vitest' },
            ip: '127.0.0.1',
        })).toThrow('ASN policy denied');

        expect(resolveIpIdentityMock).toHaveBeenCalledWith('127.0.0.1');
        expect(enforceAccessMock).toHaveBeenCalledWith({
            cameraId: 7,
            accessFlow: 'playback',
            identity: expect.objectContaining({ asnNumber: 7713 }),
        });
        expect(logSecurityEventMock).toHaveBeenCalledWith(
            'NETWORK_ACCESS_DENIED',
            expect.objectContaining({
                flow: 'playback',
                camera_id: 7,
                asn_number: 7713,
            }),
            expect.any(Object)
        );
        expect(executeMock).not.toHaveBeenCalled();
    });

    it('persists playback ASN identity columns when a session starts', () => {
        const sessionId = playbackViewerSessionService.startSession({
            cameraId: 7,
            cameraName: 'Playback Camera',
            segmentFilename: 'seg-1.mp4',
            segmentStartedAt: '2026-05-05T07:00:00.000Z',
            accessMode: 'public_preview',
        }, {
            headers: { 'user-agent': 'vitest' },
            ip: '127.0.0.1',
        });

        expect(sessionId).toEqual(expect.any(String));
        const insertCall = executeMock.mock.calls.find(([sql]) => sql.includes('INSERT INTO playback_viewer_sessions'));
        expect(insertCall).toBeTruthy();
        expect(insertCall[0].match(/\?/g)).toHaveLength(insertCall[1].length);
        expect(insertCall[1]).toEqual(expect.arrayContaining([
            7713,
            'PT Telekomunikasi Indonesia',
            'geolite2_asn',
            '2026-05-07',
        ]));
        expect(logSecurityEventMock).toHaveBeenCalledWith(
            'NETWORK_ACCESS_ALLOWED',
            expect.objectContaining({
                flow: 'playback',
                camera_id: 7,
                asn_number: 7713,
            }),
            expect.any(Object)
        );
    });

    it('does not trust spoofed forwarded IP headers from untrusted playback viewer requests', () => {
        playbackViewerSessionService.startSession({
            cameraId: 7,
            cameraName: 'Playback Camera',
            segmentFilename: 'seg-1.mp4',
            segmentStartedAt: '2026-05-05T07:00:00.000Z',
            accessMode: 'public_preview',
        }, {
            headers: {
                'user-agent': 'vitest',
                'x-forwarded-for': '8.8.8.8',
            },
            ip: '203.0.113.10',
        });

        expect(resolveIpIdentityMock).toHaveBeenCalledWith('203.0.113.10');
    });

    it('calculates playback history duration from local SQL timestamps', () => {
        queryOneMock.mockReturnValue({
            session_id: 'playback-session-1',
            camera_id: 7,
            camera_name: 'Playback Camera',
            segment_filename: 'seg-1.mp4',
            segment_started_at: '2026-05-05T07:00:00.000Z',
            playback_access_mode: 'public_preview',
            ip_address: '127.0.0.1',
            user_agent: 'vitest',
            device_type: 'desktop',
            asn_number: 7713,
            asn_org: 'PT Telekomunikasi Indonesia',
            network_lookup_source: 'geolite2_asn',
            network_lookup_version: '2026-05-07',
            admin_user_id: null,
            admin_username: null,
            started_at: '2026-05-05 14:00:00',
        });

        const ended = playbackViewerSessionService.endSession('playback-session-1', {
            endedAt: '2026-05-05 14:00:30',
        });

        expect(ended).toBe(true);
        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE playback_viewer_sessions'), [
            '2026-05-05 14:00:30',
            30,
            'playback-session-1',
        ]);
    });

    it('archives playback history using a configured local SQL cutoff instead of SQLite UTC now', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-05T17:30:00.000Z'));

        playbackViewerSessionService.archiveOldHistory(90);

        expect(executeMock).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO playback_viewer_session_history_archive'), [
            '2026-02-05 00:30:00',
        ]);
        expect(executeMock).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM playback_viewer_session_history'), [
            '2026-02-05 00:30:00',
        ]);

        vi.useRealTimers();
    });
});
