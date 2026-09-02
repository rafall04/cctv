/*
 * Purpose: Pin the browser-side "Token Saya" store — upsert by shareKey, newest-first, expiry check,
 *          and graceful degradation when localStorage throws.
 * Caller: Vitest frontend suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveToken, listTokens, removeToken, isExpired } from './savedPlaybackTokens';

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => vi.restoreAllMocks());

describe('savedPlaybackTokens', () => {
    it('saves and lists a token', () => {
        saveToken({ shareKey: 'ABC', label: 'Mingguan', expiresAt: '2099-01-01 00:00:00', recoveryCode: 'R1' });
        const list = listTokens();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ shareKey: 'ABC', label: 'Mingguan', recoveryCode: 'R1' });
    });

    it('upserts by shareKey (renewal updates expiry, keeps one row, newest first)', () => {
        saveToken({ shareKey: 'ABC', expiresAt: '2026-01-01 00:00:00' });
        saveToken({ shareKey: 'XYZ', expiresAt: '2026-06-01 00:00:00' });
        saveToken({ shareKey: 'ABC', expiresAt: '2027-01-01 00:00:00' }); // renew ABC
        const list = listTokens();
        expect(list).toHaveLength(2);
        expect(list[0].shareKey).toBe('ABC');                 // moved to front
        expect(list[0].expiresAt).toBe('2027-01-01 00:00:00'); // new expiry
    });

    it('preserves fields not re-sent on upsert (phone/recoveryCode survive a renewal save)', () => {
        saveToken({ shareKey: 'ABC', phone: '0812', recoveryCode: 'R1', expiresAt: '2026-01-01 00:00:00' });
        saveToken({ shareKey: 'ABC', expiresAt: '2027-01-01 00:00:00' }); // renewal only sends expiry
        expect(listTokens()[0]).toMatchObject({ phone: '0812', recoveryCode: 'R1' });
    });

    it('removes a token', () => {
        saveToken({ shareKey: 'ABC' });
        saveToken({ shareKey: 'XYZ' });
        removeToken('ABC');
        expect(listTokens().map((t) => t.shareKey)).toEqual(['XYZ']);
    });

    it('ignores an invalid token', () => {
        saveToken(null);
        saveToken({ shareKey: '' });
        saveToken({});
        expect(listTokens()).toHaveLength(0);
    });

    it('isExpired: past = true, future = false, none = false', () => {
        expect(isExpired({ expiresAt: '2000-01-01 00:00:00' })).toBe(true);
        expect(isExpired({ expiresAt: '2099-01-01 00:00:00' })).toBe(false);
        expect(isExpired({ expiresAt: null })).toBe(false);
    });

    it('degrades gracefully when localStorage throws', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(listTokens()).toEqual([]);           // no throw
        expect(isExpired({ expiresAt: '2000-01-01' })).toBe(true);
        spy.mockRestore();
        const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        expect(() => saveToken({ shareKey: 'ABC' })).not.toThrow();
        setSpy.mockRestore();
    });
});
