/**
 * Purpose: Verify voucherOrderService (Phase 3 self-serve payment) — create an iPaymu order,
 *          confirm via poll/webhook, issue + ACTIVATE exactly one code on payment (exactly-once),
 *          amount-mismatch guard, expiry, and per-device ownership. Uses the REAL voucherService
 *          against an in-memory DB so the confirm→issue→activate path is exercised end-to-end; only
 *          the iPaymu HTTP client and gateway config are mocked.
 * Deps: vitest, better-sqlite3 (in-memory), mocked connectionPool/ipaymuClient/paymentSettings/audit.
 * SideEffects: In-memory database only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

const { ipaymuRequestMock, interpretMock, gatewayConfigMock } = vi.hoisted(() => ({
    ipaymuRequestMock: vi.fn(),
    interpretMock: vi.fn(),
    gatewayConfigMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (callback) => db.transaction(callback),
}));

vi.mock('../utils/ipaymuClient.js', () => ({
    ipaymuRequest: (...args) => ipaymuRequestMock(...args),
    interpretIpaymuTransaction: (...args) => interpretMock(...args),
}));

vi.mock('../services/paymentSettingsService.js', () => ({
    default: {
        getGatewayConfig: () => gatewayConfigMock(),
        resolveIpaymuMethod: () => ({ method: 'qris', channel: 'mpm', label: 'QRIS' }),
    },
}));

vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: vi.fn() }));

import voucherService from '../services/voucherService.js';
import voucherOrderService from '../services/voucherOrderService.js';

function seedSchema() {
    db.exec(`
        DROP TABLE IF EXISTS settings;
        DROP TABLE IF EXISTS areas;
        DROP TABLE IF EXISTS voucher_profiles;
        DROP TABLE IF EXISTS voucher_profile_areas;
        DROP TABLE IF EXISTS voucher_codes;
        DROP TABLE IF EXISTS voucher_redemptions;
        DROP TABLE IF EXISTS voucher_orders;

        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE areas (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_access_gated INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE voucher_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
            duration_minutes INTEGER NOT NULL DEFAULT 1440, max_uses_per_code INTEGER NOT NULL DEFAULT 1,
            price INTEGER NOT NULL DEFAULT 0, code_validity_days INTEGER,
            online_purchasable INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 100, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE voucher_profile_areas (profile_id INTEGER NOT NULL, area_id INTEGER NOT NULL, PRIMARY KEY (profile_id, area_id));
        CREATE TABLE voucher_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, profile_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'unused', source TEXT NOT NULL DEFAULT 'admin', buyer_name TEXT, buyer_phone TEXT,
            activated_at TEXT, expires_at TEXT, redeemed_count INTEGER NOT NULL DEFAULT 0, code_expires_at TEXT,
            order_ref TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE voucher_redemptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code_id INTEGER NOT NULL, device_hash TEXT NOT NULL,
            buyer_name TEXT, buyer_phone TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX idx_voucher_redemptions_code_device ON voucher_redemptions(code_id, device_hash);
        CREATE TABLE voucher_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL, buyer_name TEXT, buyer_phone TEXT,
            device_hash TEXT NOT NULL, request_ip TEXT, gateway TEXT NOT NULL DEFAULT 'ipaymu', gateway_ref TEXT, reference TEXT,
            amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', qris_payload TEXT, code_id INTEGER,
            expires_at TEXT, paid_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO areas (id, name, is_access_gated) VALUES (1, 'Dander', 1), (2, 'Tanjungharjo', 1);
    `);
}

function makePaidProfile(overrides = {}) {
    voucherService.setFeatureEnabled(true);
    return voucherService.createProfile({
        name: 'RW Dander 1 Hari', duration_minutes: 1440, price: 10000,
        online_purchasable: 1, area_ids: [1], ...overrides,
    });
}

function backdateOrder(id) {
    db.prepare("UPDATE voucher_orders SET updated_at = datetime('now', '-2 minutes') WHERE id = ?").run(id);
}

const CHARGE_OK = { httpOk: true, body: { Data: { TransactionId: 'TRX123', QrString: '00020101...', Expired: null } } };

describe('voucherOrderService', () => {
    beforeEach(() => {
        seedSchema();
        voucherService.resetGateCaches();
        ipaymuRequestMock.mockReset();
        interpretMock.mockReset();
        gatewayConfigMock.mockReset();
        gatewayConfigMock.mockReturnValue({
            gateway: 'ipaymu',
            publicBaseUrl: 'https://cctv.example',
            ipaymu: { va: 'VA', apiKey: 'KEY', baseUrl: 'https://sandbox.ipaymu.com' },
        });
    });

    describe('createOrder', () => {
        it('creates a pending iPaymu order with the QR payload', async () => {
            const p = makePaidProfile();
            ipaymuRequestMock.mockResolvedValue(CHARGE_OK);

            const order = await voucherOrderService.createOrder(p.id, { name: 'Budi', phone: '0812', deviceHash: 'dev-A' });

            expect(order.status).toBe('pending');
            expect(order.amount).toBe(10000);
            expect(order.qris.qr_string).toBe('00020101...');
            expect(ipaymuRequestMock).toHaveBeenCalledWith('/api/v2/payment/direct', expect.objectContaining({
                amount: 10000,
                notifyUrl: 'https://cctv.example/api/voucher/webhook/ipaymu',
            }));
            const raw = db.prepare('SELECT * FROM voucher_orders WHERE id = ?').get(order.id);
            expect(raw.gateway_ref).toBe('TRX123');
            expect(raw.device_hash).toBe('dev-A');
        });

        it('reuses a still-valid pending order for the same device/profile/amount', async () => {
            const p = makePaidProfile();
            ipaymuRequestMock.mockResolvedValue(CHARGE_OK);
            const first = await voucherOrderService.createOrder(p.id, { deviceHash: 'dev-A' });
            const second = await voucherOrderService.createOrder(p.id, { deviceHash: 'dev-A' });
            expect(second.id).toBe(first.id);
            expect(ipaymuRequestMock).toHaveBeenCalledTimes(1);
        });

        it('rejects an offline/free/inactive profile and a non-ipaymu gateway', async () => {
            const offline = makePaidProfile({ name: 'Offline', online_purchasable: 0 });
            await expect(voucherOrderService.createOrder(offline.id, { deviceHash: 'd' }))
                .rejects.toMatchObject({ statusCode: 400 });

            const free = makePaidProfile({ name: 'Gratis', price: 0 });
            await expect(voucherOrderService.createOrder(free.id, { deviceHash: 'd' }))
                .rejects.toMatchObject({ statusCode: 400 });

            const paid = makePaidProfile({ name: 'Bayar' });
            gatewayConfigMock.mockReturnValue({ gateway: 'manual', publicBaseUrl: '', ipaymu: {} });
            await expect(voucherOrderService.createOrder(paid.id, { deviceHash: 'd' }))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it('surfaces a gateway rejection as a 400', async () => {
            const p = makePaidProfile();
            ipaymuRequestMock.mockResolvedValue({ httpOk: false, body: { Message: 'Suspicious buyer' } });
            await expect(voucherOrderService.createOrder(p.id, { deviceHash: 'd' }))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it('caps order creation per IP (blocks charge spam from rotated device cookies)', async () => {
            const p = makePaidProfile();
            ipaymuRequestMock.mockResolvedValue(CHARGE_OK);
            for (let i = 0; i < 6; i++) {
                await voucherOrderService.createOrder(p.id, { deviceHash: `dev-${i}`, ip: '9.9.9.9' });
            }
            await expect(voucherOrderService.createOrder(p.id, { deviceHash: 'dev-x', ip: '9.9.9.9' }))
                .rejects.toMatchObject({ statusCode: 429 });
            // A different IP is unaffected.
            await expect(voucherOrderService.createOrder(p.id, { deviceHash: 'dev-y', ip: '8.8.8.8' }))
                .resolves.toMatchObject({ status: 'pending' });
        });
    });

    describe('confirmation (poll/webhook) issues + activates exactly one code', () => {
        async function pendingOrder(profile, deviceHash = 'dev-A') {
            ipaymuRequestMock.mockResolvedValue(CHARGE_OK);
            const order = await voucherOrderService.createOrder(profile.id, { name: 'Budi', phone: '0812-3456-7890', deviceHash });
            backdateOrder(order.id);
            return order;
        }

        it('on paid: issues a self-source code, activates it on the buyer device, grants area access', async () => {
            const p = makePaidProfile({ area_ids: [1, 2] });
            const order = await pendingOrder(p);

            ipaymuRequestMock.mockResolvedValue({ httpOk: true, body: { Data: {} } });
            interpretMock.mockReturnValue({ paid: true, expired: false, amount: 10000 });

            const synced = await voucherOrderService.syncOrder(order.id);
            expect(synced.status).toBe('paid');

            const presented = voucherOrderService.getOrder(order.id);
            expect(presented.status).toBe('paid');
            expect(presented.voucher.code).toBeTruthy();
            expect(presented.voucher.area_ids.sort()).toEqual([1, 2]);

            const codes = db.prepare("SELECT * FROM voucher_codes WHERE profile_id = ?").all(p.id);
            expect(codes).toHaveLength(1);
            expect(codes[0].source).toBe('self');
            expect(codes[0].status).toBe('active');
            // Activated on the buyer's device → has live access.
            expect(voucherService.getAccessibleAreaIds({ deviceHash: 'dev-A' }).sort()).toEqual([1, 2]);
        });

        it('never issues two codes when confirmed twice (exactly-once)', () => {
            const p = makePaidProfile();
            const id = db.prepare(
                "INSERT INTO voucher_orders (profile_id, device_hash, gateway, gateway_ref, amount, status) VALUES (?, 'dev-A', 'ipaymu', 'TRX9', 10000, 'pending')"
            ).run(p.id).lastInsertRowid;
            const order = db.prepare('SELECT * FROM voucher_orders WHERE id = ?').get(id);

            voucherOrderService._confirmOrder(order);
            voucherOrderService._confirmOrder(order); // second is a no-op

            expect(db.prepare('SELECT COUNT(*) AS n FROM voucher_codes WHERE profile_id = ?').get(p.id).n).toBe(1);
            expect(db.prepare('SELECT COUNT(*) AS n FROM voucher_redemptions').get().n).toBe(1);
        });

        it('does NOT confirm when the paid amount is less than charged', async () => {
            const p = makePaidProfile();
            const order = await pendingOrder(p);
            ipaymuRequestMock.mockResolvedValue({ httpOk: true, body: { Data: {} } });
            interpretMock.mockReturnValue({ paid: true, expired: false, amount: 5000 }); // underpaid

            await voucherOrderService.syncOrder(order.id);
            expect(db.prepare('SELECT status FROM voucher_orders WHERE id = ?').get(order.id).status).toBe('pending');
            expect(db.prepare('SELECT COUNT(*) AS n FROM voucher_codes').get().n).toBe(0);
        });

        it('marks the order expired when the gateway reports expiry', async () => {
            const p = makePaidProfile();
            const order = await pendingOrder(p);
            ipaymuRequestMock.mockResolvedValue({ httpOk: true, body: { Data: {} } });
            interpretMock.mockReturnValue({ paid: false, expired: true, amount: null });

            await voucherOrderService.syncOrder(order.id);
            expect(db.prepare('SELECT status FROM voucher_orders WHERE id = ?').get(order.id).status).toBe('expired');
        });

        it('handleWebhook re-verifies and confirms the matching order', async () => {
            const p = makePaidProfile();
            const order = await pendingOrder(p);
            ipaymuRequestMock.mockResolvedValue({ httpOk: true, body: { Data: {} } });
            interpretMock.mockReturnValue({ paid: true, expired: false, amount: 10000 });

            const res = await voucherOrderService.handleWebhook({ trx_id: 'TRX123' });
            expect(res.handled).toBe(true);
            expect(res.status).toBe('paid');
            expect(db.prepare('SELECT COUNT(*) AS n FROM voucher_codes WHERE profile_id = ?').get(p.id).n).toBe(1);
        });

        it('handleWebhook ignores an unknown transaction', async () => {
            const res = await voucherOrderService.handleWebhook({ trx_id: 'NOPE' });
            expect(res.handled).toBe(false);
        });
    });

    describe('ownership', () => {
        it('getOwnedOrderStatus hides an order from a different device', async () => {
            const p = makePaidProfile();
            ipaymuRequestMock.mockResolvedValue(CHARGE_OK);
            const order = await voucherOrderService.createOrder(p.id, { deviceHash: 'dev-A' });

            await expect(voucherOrderService.getOwnedOrderStatus(order.id, 'dev-OTHER'))
                .rejects.toMatchObject({ statusCode: 404 });
            await expect(voucherOrderService.getOwnedOrderStatus(order.id, null))
                .rejects.toMatchObject({ statusCode: 404 });
        });
    });
});
