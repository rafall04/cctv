/**
 * Purpose: Pin the standalone iPaymu client (utils/ipaymuClient.js) — a golden HMAC signature so a
 *          careless edit that drifts it from paymentService's proven copy breaks CI, plus the
 *          transaction-status interpretation used to decide paid/expired on the voucher money path.
 * Deps: vitest, node:crypto (golden derivation reference).
 * SideEffects: none (pure functions).
 */

import { describe, it, expect } from 'vitest';
import { buildIpaymuSignature, interpretIpaymuTransaction } from '../utils/ipaymuClient.js';

describe('ipaymuClient.buildIpaymuSignature', () => {
    it('matches the golden HMAC for fixed inputs (drift guard vs the paymentService copy)', () => {
        const sig = buildIpaymuSignature({
            method: 'POST',
            va: '0000001234567890',
            apiKey: 'SANDBOX-keyABC',
            body: '{"amount":10000}',
        });
        // Precomputed: HMAC-SHA256("POST:{va}:{sha256(body)}:{apiKey}", apiKey). A change in the
        // signing algorithm must be a CONSCIOUS update here (and mirrored in paymentService).
        expect(sig).toBe('4b89ac3315a29d80ea34f8e0d972e0055f8f4b3817eaa7739e9a83289ea67a97');
    });
});

describe('ipaymuClient.interpretIpaymuTransaction', () => {
    it('reads paid by status description or code', () => {
        expect(interpretIpaymuTransaction({ StatusDesc: 'Berhasil', Amount: '10000' }))
            .toEqual({ paid: true, expired: false, amount: 10000 });
        expect(interpretIpaymuTransaction({ Status: 6, Total: 5000 }))
            .toEqual({ paid: true, expired: false, amount: 5000 });
        expect(interpretIpaymuTransaction({ status_desc: 'success', amount: '7500.00' }))
            .toEqual({ paid: true, expired: false, amount: 7500 });
    });

    it('reads expired and handles empty payloads safely', () => {
        expect(interpretIpaymuTransaction({ StatusDesc: 'Expired' }))
            .toEqual({ paid: false, expired: true, amount: null });
        expect(interpretIpaymuTransaction({ Status: -2 }))
            .toEqual({ paid: false, expired: true, amount: null });
        expect(interpretIpaymuTransaction(null))
            .toEqual({ paid: false, expired: false, amount: null });
        expect(interpretIpaymuTransaction({ StatusDesc: 'Pending' }))
            .toEqual({ paid: false, expired: false, amount: null });
    });
});
