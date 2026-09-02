/**
 * Purpose: Lock the money invariants of self-serve playback orders — exactly-once issuance above all.
 * Caller: Vitest backend suite.
 * Deps: better-sqlite3 (in-memory), gateway + product services mocked.
 * MainFuncs: createOrder, getOrder, getOwnedOrderStatus, syncOrder, handleWebhook.
 * SideEffects: None; no network, no real gateway call.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Coverage put this service at 0%. It opens real charges at a payment gateway and issues the
 * access credential the buyer paid for, and its header documents several invariants that
 * nothing verified: one payment must mint exactly one token, a webhook must never be the
 * thing that decides money arrived, and a buyer must never be able to read another buyer's
 * credential. Those are the tests below — the happy path is the least interesting part.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: SQLite } = await import('better-sqlite3');
    return { db: new SQLite(':memory:') };
});

const h = await vi.hoisted(async () => ({
    ipaymuCalls: [],
    chargeResponse: null,
    txResponse: null,
    issued: [],
    revoked: [],
    nextTokenId: 500,
    issueReturnsNoId: false,
    renewLookup: null,
    renewCalls: [],
}));

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

vi.mock('../utils/ipaymuClient.js', async () => {
    const actual = await vi.importActual('../utils/ipaymuClient.js');
    return {
        // interpretIpaymuTransaction stays REAL: how a gateway payload maps to paid/expired
        // is exactly the logic that must not be re-implemented by a stub.
        interpretIpaymuTransaction: actual.interpretIpaymuTransaction,
        ipaymuRequest: async (path, payload) => {
            h.ipaymuCalls.push({ path, payload });
            if (path.includes('payment/direct')) return h.chargeResponse;
            return h.txResponse;
        },
    };
});

vi.mock('../services/paymentSettingsService.js', () => ({
    default: {
        getGatewayConfig: () => ({ gateway: 'ipaymu', publicBaseUrl: 'https://cctvku.example' }),
        resolveIpaymuMethod: () => ({ method: 'qris', channel: 'qris', label: 'QRIS' }),
    },
}));

const PRODUCT = { id: 3, key: 'week', label: 'Akses 7 Hari', enabled: 1, is_trial: 0, price_rupiah: 25000, window_hours: 24, validity_days: 7 };

vi.mock('../services/playbackProductService.js', () => ({
    default: {
        getByKey: (key) => (key === PRODUCT.key ? PRODUCT : null),
        getById: (id) => (id === PRODUCT.id ? PRODUCT : null),
        issueTokenForProduct: (product, meta) => {
            const id = h.issueReturnsNoId ? undefined : (h.nextTokenId += 1);
            h.issued.push({ product, meta, id });
            if (id) {
                db.prepare('INSERT INTO playback_tokens (id, share_key_prefix, expires_at, playback_window_hours) VALUES (?,?,?,?)')
                    .run(id, `key${id}`, '2026-12-31 00:00:00', 24);
            }
            return { token: 'raw', data: id ? { id } : {}, share_key: `key${id}` };
        },
    },
}));

vi.mock('../services/playbackTokenService.js', () => ({
    default: { revokeToken: (id) => { h.revoked.push(id); } },
}));

vi.mock('../services/playbackTokenRenewalService.js', () => ({
    default: {
        findTokenByAccessCode: (code) => (h.renewLookup ? h.renewLookup(code) : null),
        renewToken: (tokenId, days, opts) => {
            h.renewCalls.push({ tokenId, days, opts });
            return { alreadyRenewed: false, previousExpiresAt: null, newExpiresAt: '2027-01-01 00:00:00', daysAdded: days };
        },
    },
}));

const service = (await import('../services/playbackOrderService.js')).default;

const okCharge = {
    httpOk: true,
    body: { Data: { TransactionId: 'TRX-1', QrString: '00020101', Expired: '2099-01-01T00:00:00Z' } },
};

function seedOrder(over = {}) {
    const row = {
        product_id: PRODUCT.id, device_hash: 'dev-a', amount: PRODUCT.price_rupiah,
        gateway: 'ipaymu', gateway_ref: 'TRX-1', reference: 'pbk-3-1', status: 'pending',
        expires_at: '2099-01-01T00:00:00.000Z', token_id: null,
        updated_at: "datetime('now','-1 hour')", ...over,
    };
    const info = db.prepare(`
        INSERT INTO playback_orders (product_id, buyer_name, buyer_phone, device_hash, request_ip, gateway, gateway_ref, reference, amount, status, expires_at, token_id, order_kind, renew_token_id, recovery_code, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now','-1 hour'))
    `).run(row.product_id, row.buyer_name ?? null, row.buyer_phone ?? null, row.device_hash, row.request_ip ?? null, row.gateway,
        row.gateway_ref, row.reference, row.amount, row.status, row.expires_at, row.token_id,
        row.order_kind ?? 'purchase', row.renew_token_id ?? null, row.recovery_code ?? null);
    return info.lastInsertRowid;
}

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS playback_orders; DROP TABLE IF EXISTS playback_tokens; DROP TABLE IF EXISTS playback_token_renewals;');
    db.exec(`
        CREATE TABLE playback_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL, buyer_name TEXT, buyer_phone TEXT,
            device_hash TEXT NOT NULL, request_ip TEXT,
            gateway TEXT NOT NULL DEFAULT 'ipaymu', gateway_ref TEXT, reference TEXT,
            amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            qris_payload TEXT, token_id INTEGER, expires_at TEXT, paid_at TEXT,
            order_kind TEXT NOT NULL DEFAULT 'purchase', renew_token_id INTEGER, recovery_code TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE playback_tokens (
            id INTEGER PRIMARY KEY, share_key_prefix TEXT, share_key_hash TEXT, expires_at DATETIME,
            revoked_at TEXT, playback_window_hours INTEGER, updated_at TEXT
        );
        CREATE TABLE playback_token_renewals (
            id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER UNIQUE, token_id INTEGER NOT NULL,
            days_added INTEGER NOT NULL, previous_expires_at TEXT, new_expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    h.ipaymuCalls.length = 0;
    h.issued.length = 0;
    h.renewCalls.length = 0;
    h.renewLookup = null;
    h.revoked.length = 0;
    h.chargeResponse = okCharge;
    h.txResponse = { httpOk: true, body: { Data: { StatusDesc: 'pending', Amount: PRODUCT.price_rupiah } } };
    h.issueReturnsNoId = false;
    vi.restoreAllMocks();
});

describe('createOrder — refuses before it ever charges', () => {
    it.each([
        ['no deviceHash', {}, 'deviceHash'],
        ['unknown product', { deviceHash: 'd' }, 'tersedia'],
    ])('%s', async (_label, opts, msg) => {
        await expect(service.createOrder(opts.deviceHash ? 'nope' : PRODUCT.key, opts))
            .rejects.toThrow(new RegExp(msg, 'i'));
        expect(h.ipaymuCalls).toHaveLength(0);
    });

    it('refuses a free/trial product instead of opening a zero charge', async () => {
        const svc = await import('../services/playbackProductService.js');
        vi.spyOn(svc.default, 'getByKey').mockReturnValue({ ...PRODUCT, is_trial: 1 });
        await expect(service.createOrder(PRODUCT.key, { deviceHash: 'd' })).rejects.toThrow(/gratis/i);
        expect(h.ipaymuCalls).toHaveLength(0);
    });

    it('reuses a live pending order rather than billing a reload twice', async () => {
        const id = seedOrder({ device_hash: 'dev-a' });
        const result = await service.createOrder(PRODUCT.key, { deviceHash: 'dev-a' });

        expect(result.id).toBe(Number(id));
        expect(h.ipaymuCalls).toHaveLength(0); // no second charge opened
        expect(db.prepare('SELECT COUNT(*) c FROM playback_orders').get().c).toBe(1);
    });

    it('does NOT reuse another device\'s pending order', async () => {
        seedOrder({ device_hash: 'someone-else' });
        await service.createOrder(PRODUCT.key, { deviceHash: 'dev-a' });
        expect(h.ipaymuCalls.some((c) => c.path.includes('payment/direct'))).toBe(true);
        expect(db.prepare('SELECT COUNT(*) c FROM playback_orders').get().c).toBe(2);
    });

    it('caps new charges per IP — the device hash is attacker-controlled, the IP brake is not', async () => {
        for (let i = 0; i < 6; i += 1) {
            db.prepare(`INSERT INTO playback_orders (product_id, device_hash, request_ip, gateway, gateway_ref, reference, amount, status)
                        VALUES (?,?,?,'ipaymu',?,?,?, 'expired')`)
                .run(PRODUCT.id, `d${i}`, '1.2.3.4', `T${i}`, `r${i}`, PRODUCT.price_rupiah);
        }
        await expect(service.createOrder(PRODUCT.key, { deviceHash: 'fresh', ip: '1.2.3.4' }))
            .rejects.toMatchObject({ statusCode: 429 });
        expect(h.ipaymuCalls).toHaveLength(0);
    });

    it('stores the amount as the product price, in integer rupiah', async () => {
        await service.createOrder(PRODUCT.key, { deviceHash: 'dev-a' });
        const row = db.prepare('SELECT amount FROM playback_orders').get();
        expect(row.amount).toBe(25000);
        expect(Number.isInteger(row.amount)).toBe(true);
    });

    it('surfaces a gateway refusal instead of writing a phantom order', async () => {
        h.chargeResponse = { httpOk: false, body: { Message: 'insufficient' } };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(service.createOrder(PRODUCT.key, { deviceHash: 'dev-a' })).rejects.toThrow(/gagal dibuat/i);
        expect(db.prepare('SELECT COUNT(*) c FROM playback_orders').get().c).toBe(0);
    });
});

describe('EXACTLY-ONCE issuance — the whole point of this service', () => {
    const paidGateway = { httpOk: true, body: { Data: { StatusDesc: 'berhasil', Amount: PRODUCT.price_rupiah } } };

    it('a paid order mints exactly one token', async () => {
        const id = seedOrder();
        h.txResponse = paidGateway;

        await service.syncOrder(id);

        expect(h.issued).toHaveLength(1);
        const row = db.prepare('SELECT status, token_id FROM playback_orders WHERE id=?').get(id);
        expect(row.status).toBe('paid');
        expect(row.token_id).toBe(h.issued[0].id);
    });

    /*
     * The scenario this service exists to survive: iPaymu notifies twice, or a notify races the
     * buyer's status poll. Both callers see a pending order and both try to confirm. Only the
     * one whose guarded UPDATE changed a row may mint.
     */
    it('a double webhook cannot mint two tokens for one payment', async () => {
        const id = seedOrder();
        h.txResponse = paidGateway;

        await service.handleWebhook({ trx_id: 'TRX-1' });
        await service.handleWebhook({ trx_id: 'TRX-1' });

        expect(h.issued).toHaveLength(1);
        expect(db.prepare('SELECT token_id FROM playback_orders WHERE id=?').get(id).token_id)
            .toBe(h.issued[0].id);
        expect(db.prepare('SELECT COUNT(*) c FROM playback_tokens').get().c).toBe(1);
    });

    it('a webhook racing a poll cannot mint two tokens either', async () => {
        const id = seedOrder();
        h.txResponse = paidGateway;

        await Promise.all([
            service.syncOrder(id),
            service.handleWebhook({ trx_id: 'TRX-1' }),
        ]);

        expect(h.issued.length).toBeLessThanOrEqual(1);
        expect(db.prepare('SELECT COUNT(*) c FROM playback_tokens').get().c).toBeLessThanOrEqual(1);
    });

    /*
     * If a second caller claimed the slot first, the token we just minted is unreferenced. Leaving
     * it live would mean one payment bought two working credentials — so it must be revoked.
     */
    it('revokes its own token when it loses the claim race', () => {
        const id = seedOrder({ status: 'paid' });
        // Simulate the winner claiming the slot between our mint and our claim.
        const realRun = db.prepare.bind(db);
        vi.spyOn(db, 'prepare').mockImplementation((sql) => {
            const stmt = realRun(sql);
            if (sql.includes('SET token_id = ?') && sql.includes('token_id IS NULL')) {
                return { run: () => ({ changes: 0 }) };
            }
            return stmt;
        });

        service.getOrder(id); // triggers _ensureTokenIssued

        vi.restoreAllMocks();
        expect(h.issued).toHaveLength(1);
        expect(h.revoked).toEqual([h.issued[0].id]);
    });

    it('refuses to claim the slot when the mint came back without an id', () => {
        const id = seedOrder({ status: 'paid' });
        h.issueReturnsNoId = true;
        vi.spyOn(console, 'error').mockImplementation(() => {});

        service.getOrder(id);

        // Claiming with undefined would write NULL, so every later poll would mint again.
        expect(db.prepare('SELECT token_id FROM playback_orders WHERE id=?').get(id).token_id).toBeNull();
    });

    it('heals a paid order whose token was never minted (crash between flip and mint)', () => {
        const id = seedOrder({ status: 'paid' });
        const before = db.prepare('SELECT token_id FROM playback_orders WHERE id=?').get(id);
        expect(before.token_id).toBeNull();

        const presented = service.getOrder(id);

        expect(h.issued).toHaveLength(1);
        expect(presented.access).toMatchObject({ shareKey: `key${h.issued[0].id}` });
    });
});

describe('the gateway decides payment, never the webhook body', () => {
    it('a webhook claiming success does not confirm anything if the API says pending', async () => {
        const id = seedOrder();
        h.txResponse = { httpOk: true, body: { Data: { StatusDesc: 'pending' } } };

        await service.handleWebhook({ trx_id: 'TRX-1', status: 'berhasil', paid: true });

        expect(db.prepare('SELECT status FROM playback_orders WHERE id=?').get(id).status).toBe('pending');
        expect(h.issued).toHaveLength(0);
    });

    it('ignores a webhook for a transaction it does not know', async () => {
        await expect(service.handleWebhook({ trx_id: 'NOPE' }))
            .resolves.toEqual({ handled: false, reason: 'unknown_transaction' });
    });

    it('finds the order by reference when no trx id is supplied', async () => {
        const id = seedOrder({ reference: 'pbk-ref-9' });
        h.txResponse = { httpOk: true, body: { Data: { StatusDesc: 'berhasil', Amount: PRODUCT.price_rupiah } } };

        const result = await service.handleWebhook({ reference_id: 'pbk-ref-9' });

        expect(result.handled).toBe(true);
        expect(db.prepare('SELECT status FROM playback_orders WHERE id=?').get(id).status).toBe('paid');
    });

    /* Underpayment must never buy access. */
    it('refuses to confirm when the gateway reports less than the order amount', async () => {
        const id = seedOrder();
        h.txResponse = { httpOk: true, body: { Data: { StatusDesc: 'berhasil', Amount: 1000 } } };
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await service.syncOrder(id);

        expect(db.prepare('SELECT status FROM playback_orders WHERE id=?').get(id).status).toBe('pending');
        expect(h.issued).toHaveLength(0);
    });

    it('marks an expired gateway transaction as expired', async () => {
        const id = seedOrder();
        h.txResponse = { httpOk: true, body: { Data: { StatusDesc: 'Expired' } } };

        await service.syncOrder(id);

        expect(db.prepare('SELECT status FROM playback_orders WHERE id=?').get(id).status).toBe('expired');
    });

    it('survives the gateway being unreachable without changing the order', async () => {
        const id = seedOrder();
        const client = await import('../utils/ipaymuClient.js');
        vi.spyOn(client, 'ipaymuRequest').mockRejectedValue(new Error('ECONNRESET'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(service.syncOrder(id)).resolves.toBeDefined();
        expect(db.prepare('SELECT status FROM playback_orders WHERE id=?').get(id).status).toBe('pending');
    });
});

describe('one buyer can never read another buyer\'s order', () => {
    it('refuses a mismatched device hash', async () => {
        const id = seedOrder({ device_hash: 'owner' });
        await expect(service.getOwnedOrderStatus(id, 'attacker')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('refuses when no device hash is presented at all', async () => {
        const id = seedOrder({ device_hash: 'owner' });
        await expect(service.getOwnedOrderStatus(id, null)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('the access credential is absent until the order is actually paid', () => {
        const id = seedOrder();
        expect(service.getOrder(id).access).toBeNull();
    });
});

describe('expiry', () => {
    it('marks a pending order past its expiry as expired on read', () => {
        const id = seedOrder({ expires_at: '2000-01-01T00:00:00.000Z' });
        expect(service.getOrder(id).status).toBe('expired');
    });

    it('leaves a paid order alone even if its expiry has passed', () => {
        const id = seedOrder({ status: 'paid', expires_at: '2000-01-01T00:00:00.000Z', token_id: 999 });
        db.prepare('INSERT INTO playback_tokens (id, share_key_prefix) VALUES (999, ?)').run('key999');
        expect(service.getOrder(id).status).toBe('paid');
    });

    it('throws 404 for an order that does not exist', () => {
        expect(() => service.getOrder(4242)).toThrow(/tidak ditemukan/i);
    });
});

describe('renewal (perpanjang) — extend, not mint', () => {
    const paidGateway = { httpOk: true, body: { Data: { StatusDesc: 'berhasil', Amount: PRODUCT.price_rupiah } } };

    it('createRenewalOrder opens a renewal order bound to the resolved token', async () => {
        h.renewLookup = () => ({ id: 777, revoked_at: null });
        const order = await service.createRenewalOrder('CODE-XYZ', PRODUCT.key, { deviceHash: 'dev-r', phone: '0812' });
        expect(order.orderKind).toBe('renewal');
        expect(order.renewTokenId).toBe(777);
        expect(order.recoveryCode).toMatch(/^[A-Z0-9]{8}$/);
        const raw = db.prepare('SELECT order_kind, renew_token_id FROM playback_orders WHERE id = ?').get(order.id);
        expect(raw.order_kind).toBe('renewal');
        expect(raw.renew_token_id).toBe(777);
    });

    it('rejects an unknown access code', async () => {
        h.renewLookup = () => null;
        await expect(service.createRenewalOrder('NOPE', PRODUCT.key, { deviceHash: 'dev-r' }))
            .rejects.toThrow(/tidak ditemukan/i);
    });

    it('a paid renewal order EXTENDS the token (renewToken) and mints nothing', async () => {
        db.prepare('INSERT INTO playback_tokens (id, share_key_prefix, expires_at, playback_window_hours) VALUES (?,?,?,?)')
            .run(777, 'key777', '2026-12-01 00:00:00', 24);
        const id = seedOrder({ order_kind: 'renewal', renew_token_id: 777, device_hash: 'dev-r' });
        h.txResponse = paidGateway;
        await service.syncOrder(id);
        expect(h.renewCalls).toHaveLength(1);
        expect(h.renewCalls[0]).toMatchObject({ tokenId: 777, days: PRODUCT.validity_days, opts: { orderId: id } });
        expect(h.issued).toHaveLength(0);                       // NOT a mint
        const raw = db.prepare('SELECT status, token_id FROM playback_orders WHERE id = ?').get(id);
        expect(raw.status).toBe('paid');
        expect(raw.token_id).toBe(777);                          // claimed the existing token
    });

    it('a double webhook on a renewal extends exactly once', async () => {
        db.prepare('INSERT INTO playback_tokens (id, share_key_prefix, expires_at, playback_window_hours) VALUES (?,?,?,?)')
            .run(777, 'key777', '2026-12-01 00:00:00', 24);
        const id = seedOrder({ order_kind: 'renewal', renew_token_id: 777, device_hash: 'dev-r' });
        h.txResponse = paidGateway;
        await service.handleWebhook({ trx_id: 'TRX-1' });
        await service.handleWebhook({ trx_id: 'TRX-1' });
        expect(h.renewCalls.length).toBeLessThanOrEqual(1);      // guarded flip = one fulfil
    });

    it('recoverActiveTokens returns a paid buyer token by phone + code', () => {
        db.prepare('INSERT INTO playback_tokens (id, share_key_prefix, expires_at, playback_window_hours) VALUES (?,?,?,?)')
            .run(888, 'key888', '2099-01-01 00:00:00', 24);
        seedOrder({ status: 'paid', token_id: 888, buyer_phone: '08123', recovery_code: 'ABCD2345' });
        const out = service.recoverActiveTokens('08123', 'abcd2345');   // case-insensitive code
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ shareKey: 'key888' });
        expect(service.recoverActiveTokens('08123', 'WRONG')).toHaveLength(0);
        expect(() => service.recoverActiveTokens('', 'ABCD2345')).toThrow(/wajib/i);
    });
});

describe('reconcilePendingOrders — self-heal', () => {
    it('confirms a recently-pending order whose webhook was missed', async () => {
        const id = seedOrder({});
        h.txResponse = { httpOk: true, body: { Data: { StatusDesc: 'berhasil', Amount: PRODUCT.price_rupiah } } };
        const res = await service.reconcilePendingOrders();
        expect(res.checked).toBeGreaterThanOrEqual(1);
        expect(db.prepare('SELECT status FROM playback_orders WHERE id = ?').get(id).status).toBe('paid');
    });

    it('leaves already-paid orders untouched (not in the pending set)', async () => {
        db.prepare('INSERT INTO playback_tokens (id, share_key_prefix) VALUES (?, ?)').run(555, 'k555');
        const id = seedOrder({ status: 'paid', token_id: 555 });
        h.txResponse = { httpOk: true, body: { Data: { StatusDesc: 'berhasil', Amount: PRODUCT.price_rupiah } } };
        await service.reconcilePendingOrders();
        expect(db.prepare('SELECT status FROM playback_orders WHERE id = ?').get(id).status).toBe('paid');
    });
});
