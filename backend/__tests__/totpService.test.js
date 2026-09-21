/**
 * Purpose: Lock down the TOTP crypto primitives — RFC 6238 correctness (real RFC test
 *          vectors, not self-consistency), base32 round-trip, AES-256-GCM secret sealing,
 *          and one-time recovery code format/hashing.
 * Caller: backend test gate for the F2.1 admin-2FA feature.
 * Deps: vitest, services/totpService.js (pure crypto — no DB, no mocks needed).
 * SideEffects: none.
 */
import { describe, expect, it } from 'vitest';
import {
    decodeBase32, encodeBase32, totp, verifyTotp,
    encryptSecret, decryptSecret,
    generateRecoveryCodes, hashRecoveryCode,
    generateSecret, buildOtpauthUrl, toQrDataUrl,
} from '../services/totpService.js';

// RFC 6238 Appendix B key: ASCII "12345678901234567890" → this well-known base32.
const RFC_KEY_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totpService base32', () => {
    it('decodes the RFC test key back to the raw 20-byte secret', () => {
        expect(decodeBase32(RFC_KEY_B32).toString()).toBe('12345678901234567890');
    });

    it('encode→decode round-trips arbitrary secrets', () => {
        const raw = Buffer.from('raaf-net-cctv-secret');
        expect(decodeBase32(encodeBase32(raw)).toString()).toBe(raw.toString());
    });
});

describe('totpService.totp — RFC 6238 vectors (SHA-1, 6-digit = 8-digit mod 1e6)', () => {
    // RFC gives 8-digit codes at these timestamps; ours is the same code mod 1e6.
    const VECTORS = [
        { tSeconds: 59, expected8: '94287082', expected6: '287082' },
        { tSeconds: 1111111109, expected8: '07081804', expected6: '081804' },
        { tSeconds: 1111111111, expected8: '14050471', expected6: '050471' },
        { tSeconds: 1234567890, expected8: '89005924', expected6: '005924' },
        { tSeconds: 2000000000, expected8: '69279037', expected6: '279037' },
    ];

    for (const v of VECTORS) {
        it(`T=${v.tSeconds} → ${v.expected6} (RFC 8-digit ${v.expected8} mod 1e6)`, () => {
            const counter = Math.floor(v.tSeconds / 30);
            expect(totp(RFC_KEY_B32, counter)).toBe(v.expected6);
        });
    }
});

describe('totpService.verifyTotp', () => {
    const secret = generateSecret();
    const atMs = 1_700_000_000_000;
    const counter = Math.floor(atMs / 1000 / 30);

    it('accepts the current code and ±1 window neighbours (clock drift)', () => {
        expect(verifyTotp(secret, totp(secret, counter), { atMs })).toBe(true);
        expect(verifyTotp(secret, totp(secret, counter - 1), { atMs })).toBe(true);
        expect(verifyTotp(secret, totp(secret, counter + 1), { atMs })).toBe(true);
    });

    it('rejects a code outside the window, a wrong code, and malformed input', () => {
        expect(verifyTotp(secret, totp(secret, counter + 3), { atMs })).toBe(false);
        expect(verifyTotp(secret, '000000', { atMs })).toBe(false);
        expect(verifyTotp(secret, 'abcdef', { atMs })).toBe(false);
        expect(verifyTotp(secret, '12345', { atMs })).toBe(false);   // too short
        expect(verifyTotp(secret, '1234567', { atMs })).toBe(false); // too long
        expect(verifyTotp(secret, '', { atMs })).toBe(false);
        expect(verifyTotp(secret, null, { atMs })).toBe(false);
    });

    it('tolerates spaces inside the code (users paste "123 456")', () => {
        const code = totp(secret, counter);
        expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { atMs })).toBe(true);
    });
});

describe('totpService secret sealing (AES-256-GCM)', () => {
    it('encrypt→decrypt round-trips and the blob carries iv.tag.data', () => {
        const secret = generateSecret();
        const blob = encryptSecret(secret);
        expect(blob).not.toContain(secret);                       // never plaintext
        expect(blob.split('.')).toHaveLength(3);
        expect(decryptSecret(blob)).toBe(secret);
    });

    it('two encryptions of the same secret differ (random IV)', () => {
        const secret = generateSecret();
        expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
    });

    it('returns null on a tampered/corrupt blob instead of throwing', () => {
        expect(decryptSecret('garbage')).toBeNull();
        expect(decryptSecret(null)).toBeNull();
        const blob = encryptSecret(generateSecret());
        const [iv, tag, data] = blob.split('.');
        // Flip one base64 char in the ciphertext → auth tag must reject it.
        const tampered = `${iv}.${tag}.${data.slice(0, -1)}${data.endsWith('A') ? 'B' : 'A'}`;
        expect(decryptSecret(tampered)).toBeNull();
    });
});

describe('totpService recovery codes', () => {
    it('mints 8 unique "xxxx-xxxx" codes from the unambiguous alphabet', () => {
        const codes = generateRecoveryCodes();
        expect(codes).toHaveLength(8);
        expect(new Set(codes).size).toBe(8);
        for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    });

    it('hash is case- and dash-insensitive (typed "KM3P9WQS" == "km3p-9wqs")', () => {
        const [code] = generateRecoveryCodes();
        const bare = code.replace('-', '');
        expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(bare));
        expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(bare.toUpperCase()));
        expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('totpService enrollment material', () => {
    it('generates a 32-char base32 secret and a correct otpauth URL', () => {
        const secret = generateSecret();
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        const url = buildOtpauthUrl(secret, 'admin@raf');
        expect(url).toContain(`secret=${secret}`);
        expect(url).toContain('issuer=RAF%20NET%20CCTV');
        expect(url.startsWith('otpauth://totp/RAF%20NET%20CCTV%3Aadmin%40raf')).toBe(true);
    });

    it('renders a PNG data URL for the QR', async () => {
        const dataUrl = await toQrDataUrl(buildOtpauthUrl(generateSecret(), 'alice'));
        expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });
});
