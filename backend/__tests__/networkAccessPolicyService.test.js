/**
 * Purpose: Verify ASN access policy evaluation before wiring live/playback enforcement.
 * Caller: Backend Vitest suite for services/networkAccessPolicyService.js.
 * Deps: Vitest, mocked connectionPool for effective policy lookup.
 * MainFuncs: evaluateAsnPolicy, normalizeAsnList.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import {
    buildPolicyPayload,
    evaluateAsnPolicy,
    normalizeAsnList,
    serializePolicyRow,
} from '../services/networkAccessPolicyService.js';

describe('networkAccessPolicyService', () => {
    it('normalizes comma and whitespace separated ASN lists', () => {
        expect(normalizeAsnList('7713, 4787\n 64512')).toEqual([7713, 4787, 64512]);
    });

    it('normalizes JSON ASN lists stored by the policy table', () => {
        expect(normalizeAsnList('[7713, "4787", 64512]')).toEqual([7713, 4787, 64512]);
    });

    it('allows only listed ASN values in allowlist mode', () => {
        expect(evaluateAsnPolicy(
            { asnNumber: 7713 },
            { enabled: true, mode: 'allowlist', asnAllowlist: [7713], asnDenylist: [] }
        )).toMatchObject({ allowed: true, reason: 'allowlisted' });

        expect(evaluateAsnPolicy(
            { asnNumber: 64512 },
            { enabled: true, mode: 'allowlist', asnAllowlist: [7713], asnDenylist: [] }
        )).toMatchObject({ allowed: false, reason: 'asn_not_allowed' });
    });

    it('blocks listed ASN values in denylist mode and never blocks observe-only mode', () => {
        expect(evaluateAsnPolicy(
            { asnNumber: 4787 },
            { enabled: true, mode: 'denylist', asnAllowlist: [], asnDenylist: [4787] }
        )).toMatchObject({ allowed: false, reason: 'asn_blocked' });

        expect(evaluateAsnPolicy(
            { asnNumber: 4787 },
            { enabled: true, mode: 'observe_only', asnAllowlist: [], asnDenylist: [4787] }
        )).toMatchObject({ allowed: true, reason: 'observe_only' });
    });

    it('builds a validated payload for admin policy upsert', () => {
        expect(buildPolicyPayload({
            scope: 'camera',
            targetId: '12',
            accessFlow: 'playback',
            enabled: false,
            mode: 'allowlist',
            asnAllowlist: '7713, 4787',
            asnDenylist: '64512',
            description: '  akses kantor  ',
        })).toEqual({
            scope: 'camera',
            targetId: 12,
            accessFlow: 'playback',
            enabled: 0,
            mode: 'allowlist',
            asnAllowlist: [7713, 4787],
            asnDenylist: [64512],
            description: 'akses kantor',
        });
    });

    it('rejects non-global policies without a numeric target id', () => {
        expect(() => buildPolicyPayload({ scope: 'area', accessFlow: 'live' })).toThrow('targetId is required');
    });

    it('serializes database rows for admin customization UI', () => {
        expect(serializePolicyRow({
            id: 7,
            scope: 'global',
            target_id: null,
            access_flow: 'live',
            enabled: 1,
            mode: 'denylist',
            asn_allowlist: '[]',
            asn_denylist: '[7713]',
            description: 'blocked',
            created_at: '2026-05-07 10:00:00',
            updated_at: '2026-05-07 10:01:00',
        })).toMatchObject({
            id: 7,
            scope: 'global',
            targetId: null,
            accessFlow: 'live',
            enabled: true,
            mode: 'denylist',
            asnAllowlist: [],
            asnDenylist: [7713],
            description: 'blocked',
        });
    });
});
