/**
 * Purpose: Verify payment-gateway settings resolution (DB → env → default), secret masking,
 *          method normalization/curation, and customer-facing options.
 * Caller: Backend focused test gate for paymentSettingsService.
 * Deps: vitest, better-sqlite3 (in-memory), mocked audit logger.
 * SideEffects: In-memory DB only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(),
}));

import paymentSettingsService, { DEFAULT_IPAYMU_METHODS } from '../services/paymentSettingsService.js';

const ENV_KEYS = ['BILLING_GATEWAY', 'IPAYMU_VA', 'IPAYMU_API_KEY', 'IPAYMU_PRODUCTION', 'BILLING_PUBLIC_BASE_URL', 'MIDTRANS_SERVER_KEY'];

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS settings; CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);');
    ENV_KEYS.forEach((k) => { delete process.env[k]; });
});

afterEach(() => {
    ENV_KEYS.forEach((k) => { delete process.env[k]; });
});

describe('paymentSettingsService resolution', () => {
    it('defaults to manual gateway with QRIS-only enabled', () => {
        const cfg = paymentSettingsService.getGatewayConfig();
        expect(cfg.gateway).toBe('manual');
        expect(cfg.ipaymu.methods).toHaveLength(DEFAULT_IPAYMU_METHODS.length);
        // Default QRIS channel is `mpm` (the valid iPaymu code; `qris` is invalid → 500).
        expect(paymentSettingsService.getEnabledIpaymuMethods().map((m) => m.channel)).toEqual(['mpm']);
    });

    it('falls back to env when DB has no setting (backward compat)', () => {
        process.env.BILLING_GATEWAY = 'ipaymu';
        process.env.IPAYMU_VA = '0000-env';
        process.env.IPAYMU_API_KEY = 'env-secret-key';
        const cfg = paymentSettingsService.getGatewayConfig();
        expect(cfg.gateway).toBe('ipaymu');
        expect(cfg.ipaymu.va).toBe('0000-env');
        expect(cfg.ipaymu.apiKey).toBe('env-secret-key');
        expect(cfg.ipaymu.baseUrl).toBe('https://sandbox.ipaymu.com');
    });

    it('DB setting overrides env', () => {
        process.env.BILLING_GATEWAY = 'manual';
        paymentSettingsService.updateConfig({ gateway: 'ipaymu', ipaymu_va: '0000-db', ipaymu_api_key: 'db-secret', ipaymu_production: true });
        const cfg = paymentSettingsService.getGatewayConfig();
        expect(cfg.gateway).toBe('ipaymu');
        expect(cfg.ipaymu.va).toBe('0000-db');
        expect(cfg.ipaymu.apiKey).toBe('db-secret');
        expect(cfg.ipaymu.baseUrl).toBe('https://my.ipaymu.com'); // production
    });

    it('rejects an unknown gateway', () => {
        expect(() => paymentSettingsService.updateConfig({ gateway: 'paypal' }))
            .toThrowError(expect.objectContaining({ statusCode: 400 }));
    });
});

describe('secret handling', () => {
    it('never exposes the raw API key — only a set flag and masked hint', () => {
        paymentSettingsService.updateConfig({ ipaymu_api_key: 'SECRET-abcd1234' });
        const view = paymentSettingsService.getAdminView();
        expect(view.ipaymu.api_key_set).toBe(true);
        expect(view.ipaymu.api_key_hint).toBe('••••1234');
        expect(JSON.stringify(view)).not.toContain('SECRET-abcd1234');
    });

    it('keeps the existing secret when an empty value is submitted', () => {
        paymentSettingsService.updateConfig({ ipaymu_api_key: 'first-key' });
        paymentSettingsService.updateConfig({ ipaymu_api_key: '' }); // blank = keep
        expect(paymentSettingsService.getGatewayConfig().ipaymu.apiKey).toBe('first-key');
    });

    it('updates the secret when a new non-empty value is submitted', () => {
        paymentSettingsService.updateConfig({ ipaymu_api_key: 'first-key' });
        paymentSettingsService.updateConfig({ ipaymu_api_key: 'second-key' });
        expect(paymentSettingsService.getGatewayConfig().ipaymu.apiKey).toBe('second-key');
    });
});

describe('payment methods curation', () => {
    it('persists curated methods and exposes only enabled ones to customers', () => {
        process.env.BILLING_GATEWAY = 'ipaymu';
        paymentSettingsService.updateConfig({
            ipaymu_methods: [
                { method: 'qris', channel: 'qris', label: 'QRIS', enabled: true },
                { method: 'va', channel: 'bca', label: 'VA BCA', enabled: true },
                { method: 'va', channel: 'bni', label: 'VA BNI', enabled: false },
            ],
        });
        const options = paymentSettingsService.getCustomerPaymentOptions();
        expect(options.gateway).toBe('ipaymu');
        expect(options.methods.map((m) => m.key)).toEqual(['qris:qris', 'va:bca']);
    });

    it('drops malformed method rows and dedupes', () => {
        paymentSettingsService.updateConfig({
            ipaymu_methods: [
                { method: 'qris', channel: 'qris', label: 'A', enabled: true },
                { method: 'qris', channel: 'qris', label: 'dup', enabled: true },
                { method: '', channel: 'x', label: 'bad', enabled: true },
                { method: 'va', channel: 'BCA', label: 'VA BCA', enabled: true },
            ],
        });
        const methods = paymentSettingsService.getGatewayConfig().ipaymu.methods;
        expect(methods).toHaveLength(2); // dup removed, malformed dropped
        expect(methods[1]).toMatchObject({ method: 'va', channel: 'bca' }); // lowercased
    });

    it('resolveIpaymuMethod falls back to the first enabled method on an invalid key', () => {
        process.env.BILLING_GATEWAY = 'ipaymu';
        paymentSettingsService.updateConfig({
            ipaymu_methods: [
                { method: 'qris', channel: 'qris', label: 'QRIS', enabled: true },
                { method: 'va', channel: 'bca', label: 'VA BCA', enabled: true },
            ],
        });
        expect(paymentSettingsService.resolveIpaymuMethod('va:bca')).toMatchObject({ channel: 'bca' });
        expect(paymentSettingsService.resolveIpaymuMethod('va:does_not_exist')).toMatchObject({ channel: 'qris' });
        expect(paymentSettingsService.resolveIpaymuMethod(null)).toMatchObject({ channel: 'qris' });
    });

    it('non-ipaymu gateway returns no customer methods', () => {
        paymentSettingsService.updateConfig({ gateway: 'manual' });
        expect(paymentSettingsService.getCustomerPaymentOptions()).toEqual({ gateway: 'manual', methods: [] });
    });
});
