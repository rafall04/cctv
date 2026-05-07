/**
 * Purpose: Verify local ASN/ISP network identity resolution for viewer access logging and policy.
 * Caller: Backend Vitest suite for services/networkIdentityService.js.
 * Deps: Vitest, mocked MaxMind ASN reader.
 * MainFuncs: NetworkIdentityService.resolveIpIdentity.
 * SideEffects: None; uses an injected in-memory reader.
 */

import { describe, expect, it, vi } from 'vitest';
import { NetworkIdentityService } from '../services/networkIdentityService.js';

describe('networkIdentityService', () => {
    it('resolves an IP to ASN identity with lookup metadata', () => {
        const lookupMock = vi.fn(() => ({
            autonomousSystemNumber: 7713,
            autonomousSystemOrganization: 'PT Telekomunikasi Indonesia',
        }));
        const service = new NetworkIdentityService({
            reader: { asn: lookupMock },
            lookupVersion: '2026-05-07',
        });

        const identity = service.resolveIpIdentity('36.66.208.112');

        expect(identity).toEqual({
            ipAddress: '36.66.208.112',
            asnNumber: 7713,
            asnOrg: 'PT Telekomunikasi Indonesia',
            lookupSource: 'geolite2_asn',
            lookupVersion: '2026-05-07',
        });
        expect(lookupMock).toHaveBeenCalledWith('36.66.208.112');
    });

    it('returns unknown identity when ASN lookup is unavailable', () => {
        const service = new NetworkIdentityService();

        expect(service.resolveIpIdentity('203.0.113.10')).toEqual({
            ipAddress: '203.0.113.10',
            asnNumber: null,
            asnOrg: 'unknown',
            lookupSource: 'unavailable',
            lookupVersion: 'unavailable',
        });
    });
});
