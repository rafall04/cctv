/*
 * Purpose: TOTP two-factor primitives — RFC 6238 code generation/verification, secret
 *          encryption at rest, one-time recovery codes, otpauth URL + QR data URL.
 * Caller: totpAuthService.js (orchestration), controllers.
 * Deps: node:crypto (HMAC/AES-GCM — no TOTP lib needed; the algorithm is a spec), qrcode.
 * MainFuncs: generateSecret, verifyTotp, encryptSecret/decryptSecret,
 *            generateRecoveryCodes/hashRecoveryCode, buildOtpauthUrl, toQrDataUrl.
 * SideEffects: none — pure crypto + QR rendering.
 *
 * Why the secret is encrypted at rest: the daily Telegram DB backup ships users.* off-box.
 * A leaked backup must not hand out live TOTP generators. Key = scrypt(JWT_SECRET,
 * 'totp-secret-v1') — rotating JWT_SECRET therefore INVALIDATES stored seeds (admins
 * re-enroll); that coupling is deliberate, documented, and preferable to a second
 * secret that would have to live next to the first one anyway.
 */

import { createHmac, randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'crypto';
import QRCode from 'qrcode';
import { config } from '../config/config.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const RECOVERY_COUNT = 8;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars

export function encodeBase32(buf) {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

export function decodeBase32(str) {
    const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
    let bits = 0, value = 0;
    const bytes = [];
    for (const ch of clean) {
        value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

/** RFC 6238 — HMAC-SHA1, 30s step, 6 digits. `counter` is injectable for RFC vectors. */
export function totp(secretBase32, counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS)) {
    const key = decodeBase32(secretBase32);
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac('sha1', key).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
    return String(code).padStart(TOTP_DIGITS, '0');
}

/**
 * Constant-time verification over ±window steps (±30s default covers clock drift).
 * Compares as fixed-length strings via timingSafeEqual.
 */
export function verifyTotp(secretBase32, code, { window = 1, atMs = Date.now() } = {}) {
    const candidate = String(code || '').trim().replace(/\s/g, '');
    if (!/^\d{6}$/.test(candidate)) return false;
    const nowCounter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
    const candBuf = Buffer.from(candidate);
    for (let i = -window; i <= window; i++) {
        const expected = Buffer.from(totp(secretBase32, nowCounter + i));
        if (timingSafeEqual(expected, candBuf)) return true;
    }
    return false;
}

// ---- secret at rest --------------------------------------------------------

function secretKey() {
    const material = config.jwt?.secret || process.env.JWT_SECRET;
    if (!material) throw new Error('JWT secret unavailable — cannot seal TOTP secret');
    return scryptSync(material, 'totp-secret-v1', 32);
}

export function encryptSecret(plainBase32) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
    const enc = Buffer.concat([cipher.update(plainBase32, 'utf8'), cipher.final()]);
    return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

/** @returns {string|null} plaintext base32, or null when the blob is unreadable/wrong key. */
export function decryptSecret(blob) {
    try {
        const [ivB64, tagB64, dataB64] = String(blob || '').split('.');
        const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}

// ---- recovery codes --------------------------------------------------------

export function generateRecoveryCodes(count = RECOVERY_COUNT) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        const bytes = randomBytes(8);
        let code = '';
        for (const b of bytes) code += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
        codes.push(`${code.slice(0, 4)}-${code.slice(4)}`); // e.g. "km3p-9wqs"
    }
    return codes;
}

/** SHA-256 is enough: codes are high-entropy random, not user-chosen passwords. */
export function hashRecoveryCode(code) {
    return createHash('sha256').update(String(code).toLowerCase().replace(/[\s-]/g, '')).digest('hex');
}

// ---- enrollment ------------------------------------------------------------

export function generateSecret() {
    return encodeBase32(randomBytes(20));
}

export function buildOtpauthUrl(secret, username) {
    const label = encodeURIComponent(`RAF NET CCTV:${username}`);
    const issuer = encodeURIComponent('RAF NET CCTV');
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

export async function toQrDataUrl(otpauthUrl) {
    return QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
}

export default {
    encodeBase32, decodeBase32, totp, verifyTotp,
    encryptSecret, decryptSecret,
    generateRecoveryCodes, hashRecoveryCode,
    generateSecret, buildOtpauthUrl, toQrDataUrl,
};
