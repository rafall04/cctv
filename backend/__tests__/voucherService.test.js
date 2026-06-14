/**
 * Purpose: Verify voucherService (Phase 1) — feature flag, per-area gating marker, profile CRUD
 *          + validation, code generation, redeem (activation, max-uses-per-code, idempotent
 *          same-device, expiry/revoke), access queries (device + phone + stacking), and expireDue.
 * Caller: Backend focused test gate for voucherService.
 * Deps: vitest, better-sqlite3 (in-memory), mocked connectionPool + securityAuditLogger.
 * SideEffects: In-memory database only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (callback) => db.transaction(callback),
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(),
}));

import voucherService, { FEATURE_KEY } from '../services/voucherService.js';

function seedSchema() {
    db.exec(`
        DROP TABLE IF EXISTS settings;
        DROP TABLE IF EXISTS areas;
        DROP TABLE IF EXISTS voucher_profiles;
        DROP TABLE IF EXISTS voucher_profile_areas;
        DROP TABLE IF EXISTS voucher_codes;
        DROP TABLE IF EXISTS voucher_redemptions;

        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);

        CREATE TABLE areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            is_access_gated INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE voucher_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            duration_minutes INTEGER NOT NULL DEFAULT 1440,
            max_uses_per_code INTEGER NOT NULL DEFAULT 1,
            price INTEGER NOT NULL DEFAULT 0,
            code_validity_days INTEGER,
            online_purchasable INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 100,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE voucher_profile_areas (
            profile_id INTEGER NOT NULL,
            area_id INTEGER NOT NULL,
            PRIMARY KEY (profile_id, area_id)
        );
        CREATE TABLE voucher_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            profile_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'unused',
            source TEXT NOT NULL DEFAULT 'admin',
            buyer_name TEXT,
            buyer_phone TEXT,
            activated_at TEXT,
            expires_at TEXT,
            redeemed_count INTEGER NOT NULL DEFAULT 0,
            code_expires_at TEXT,
            order_ref TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE voucher_redemptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code_id INTEGER NOT NULL,
            device_hash TEXT NOT NULL,
            buyer_name TEXT,
            buyer_phone TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX idx_voucher_redemptions_code_device ON voucher_redemptions(code_id, device_hash);

        INSERT INTO areas (id, name) VALUES (1, 'Dander'), (2, 'Tanjungharjo'), (3, 'Sumber');
    `);
}

function makeProfile(overrides = {}) {
    return voucherService.createProfile({
        name: 'RW Dander 1 Hari',
        duration_minutes: 60,
        max_uses_per_code: 1,
        price: 10000,
        area_ids: [1],
        ...overrides,
    });
}

function rawCode(code) {
    return db.prepare('SELECT * FROM voucher_codes WHERE code = ?').get(code);
}

describe('voucherService', () => {
    beforeEach(() => {
        seedSchema();
        voucherService.resetGateCaches();
    });

    describe('feature flag', () => {
        it('defaults to OFF when the settings row is absent', () => {
            expect(voucherService.isFeatureEnabled()).toBe(false);
        });

        it('toggles on and off and persists in settings', () => {
            expect(voucherService.setFeatureEnabled(true)).toEqual({ enabled: true });
            expect(voucherService.isFeatureEnabled()).toBe(true);
            expect(db.prepare('SELECT value FROM settings WHERE key = ?').get(FEATURE_KEY).value).toBe('true');

            expect(voucherService.setFeatureEnabled(false)).toEqual({ enabled: false });
            expect(voucherService.isFeatureEnabled()).toBe(false);
        });
    });

    describe('per-area gating marker', () => {
        it('is off by default and flips explicitly', () => {
            expect(voucherService.isAreaGated(1)).toBe(false);
            voucherService.setAreaGated(1, true);
            expect(voucherService.isAreaGated(1)).toBe(true);
            expect(voucherService.listGatedAreaIds()).toEqual([1]);
            voucherService.setAreaGated(1, false);
            expect(voucherService.isAreaGated(1)).toBe(false);
            expect(voucherService.listGatedAreaIds()).toEqual([]);
        });

        it('rejects gating a non-existent area', () => {
            expect(() => voucherService.setAreaGated(999, true))
                .toThrowError(expect.objectContaining({ statusCode: 404 }));
        });
    });

    describe('profiles', () => {
        it('creates a profile with an area bundle', () => {
            const profile = makeProfile({ area_ids: [1, 2] });
            expect(profile.name).toBe('RW Dander 1 Hari');
            expect(profile.duration_minutes).toBe(60);
            expect(profile.area_ids).toEqual([1, 2]);
            expect(profile.online_purchasable).toBe(1);
            expect(profile.active).toBe(1);
        });

        it('converts duration_value + duration_unit to minutes', () => {
            const p = makeProfile({ duration_minutes: undefined, duration_value: 2, duration_unit: 'jam' });
            expect(p.duration_minutes).toBe(120);
            const d = makeProfile({ name: 'Tiga Hari', duration_minutes: undefined, duration_value: 3, duration_unit: 'hari' });
            expect(d.duration_minutes).toBe(3 * 1440);
        });

        it('validates name, price, duration and area existence', () => {
            expect(() => makeProfile({ name: 'x' })).toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(() => makeProfile({ price: -1 })).toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(() => makeProfile({ duration_minutes: 0 })).toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(() => makeProfile({ max_uses_per_code: 0 })).toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(() => makeProfile({ area_ids: [999] })).toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('lists and fetches profiles with their area_ids', () => {
            makeProfile({ name: 'Beta', sort_order: 2, area_ids: [2] });
            makeProfile({ name: 'Alfa', sort_order: 1, area_ids: [1] });
            const list = voucherService.listProfiles();
            expect(list.map((p) => p.name)).toEqual(['Alfa', 'Beta']);
            expect(voucherService.getProfileById(list[0].id).area_ids).toEqual([1]);
        });

        it('updates fields and replaces the area bundle', () => {
            const p = makeProfile({ area_ids: [1] });
            const updated = voucherService.updateProfile(p.id, { price: 15000, area_ids: [2, 3] });
            expect(updated.price).toBe(15000);
            expect(updated.area_ids).toEqual([2, 3]);
        });

        it('rejects an empty update', () => {
            const p = makeProfile();
            expect(() => voucherService.updateProfile(p.id, {}))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('blocks deleting a profile that already has codes, allows when none', () => {
            const p = makeProfile();
            const empty = makeProfile({ name: 'Kosong' });
            voucherService.generateCodes(p.id, 1);
            expect(() => voucherService.deleteProfile(p.id))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(voucherService.deleteProfile(empty.id)).toEqual({ id: empty.id });
            expect(voucherService.getProfileById(empty.id)).toBeNull();
        });
    });

    describe('code generation', () => {
        it('generates N unique unused codes in XXXX-XXXX format', () => {
            const p = makeProfile();
            const codes = voucherService.generateCodes(p.id, 5);
            expect(codes).toHaveLength(5);
            const values = codes.map((c) => c.code);
            expect(new Set(values).size).toBe(5);
            for (const code of values) {
                expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
            }
            expect(codes.every((c) => c.status === 'unused')).toBe(true);
        });

        it('snapshots code_expires_at only when the profile has a validity window', () => {
            const withValidity = makeProfile({ code_validity_days: 7 });
            const [a] = voucherService.generateCodes(withValidity.id, 1);
            expect(a.code_expires_at).toBeTruthy();

            const noValidity = makeProfile({ name: 'Tanpa Hangus' });
            const [b] = voucherService.generateCodes(noValidity.id, 1);
            expect(b.code_expires_at).toBeNull();
        });

        it('validates profile existence and count bounds', () => {
            expect(() => voucherService.generateCodes(999, 1))
                .toThrowError(expect.objectContaining({ statusCode: 404 }));
            const p = makeProfile();
            expect(() => voucherService.generateCodes(p.id, 0))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(() => voucherService.generateCodes(p.id, 9999))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
        });
    });

    describe('redeem', () => {
        it('activates a code on first redeem and returns the unlocked areas', () => {
            const p = makeProfile({ duration_minutes: 60, area_ids: [1, 2] });
            const [code] = voucherService.generateCodes(p.id, 1);

            const before = Date.now();
            const res = voucherService.redeemCode(code.code, { name: 'Budi', phone: '0812-3456-7890', deviceHash: 'dev-A' });

            expect(res.status).toBe('active');
            expect(res.area_ids).toEqual([1, 2]);
            const exp = new Date(res.expires_at).getTime();
            expect(exp).toBeGreaterThan(before + 59 * 60 * 1000);
            expect(exp).toBeLessThan(Date.now() + 61 * 60 * 1000);

            const row = rawCode(code.code);
            expect(row.status).toBe('active');
            expect(row.buyer_phone).toBe('081234567890');
            expect(row.redeemed_count).toBe(1);
        });

        it('requires a deviceHash and rejects unknown codes', () => {
            const p = makeProfile();
            const [code] = voucherService.generateCodes(p.id, 1);
            expect(() => voucherService.redeemCode(code.code, { deviceHash: '' }))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(() => voucherService.redeemCode('NOPE-NOPE', { deviceHash: 'dev-A' }))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('enforces max_uses_per_code across distinct devices', () => {
            const p = makeProfile({ max_uses_per_code: 1 });
            const [code] = voucherService.generateCodes(p.id, 1);
            voucherService.redeemCode(code.code, { deviceHash: 'dev-A' });
            expect(() => voucherService.redeemCode(code.code, { deviceHash: 'dev-B' }))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('is idempotent for the same device (no extra slot consumed)', () => {
            const p = makeProfile({ max_uses_per_code: 1 });
            const [code] = voucherService.generateCodes(p.id, 1);
            voucherService.redeemCode(code.code, { deviceHash: 'dev-A' });
            // same device again — must NOT throw and must NOT consume a second slot
            voucherService.redeemCode(code.code, { deviceHash: 'dev-A' });
            expect(rawCode(code.code).redeemed_count).toBe(1);
            expect(db.prepare('SELECT COUNT(*) AS n FROM voucher_redemptions WHERE code_id = ?').get(rawCode(code.code).id).n).toBe(1);
        });

        it('allows multiple devices up to max_uses_per_code', () => {
            const p = makeProfile({ max_uses_per_code: 2 });
            const [code] = voucherService.generateCodes(p.id, 1);
            voucherService.redeemCode(code.code, { deviceHash: 'dev-A' });
            voucherService.redeemCode(code.code, { deviceHash: 'dev-B' });
            expect(rawCode(code.code).redeemed_count).toBe(2);
            expect(() => voucherService.redeemCode(code.code, { deviceHash: 'dev-C' }))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('rejects a revoked code', () => {
            const p = makeProfile();
            const [code] = voucherService.generateCodes(p.id, 1);
            voucherService.revokeCode(code.id);
            expect(() => voucherService.redeemCode(code.code, { deviceHash: 'dev-A' }))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('rejects (and marks) an active code past its expires_at', () => {
            const p = makeProfile({ duration_minutes: 60 });
            const [code] = voucherService.generateCodes(p.id, 1);
            voucherService.redeemCode(code.code, { deviceHash: 'dev-A' });
            db.prepare('UPDATE voucher_codes SET expires_at = ? WHERE code = ?')
                .run(new Date(Date.now() - 1000).toISOString(), code.code);
            expect(() => voucherService.redeemCode(code.code, { deviceHash: 'dev-B' }))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(rawCode(code.code).status).toBe('expired');
        });

        it('rejects an unused code past its code_expires_at (never activated)', () => {
            const p = makeProfile({ code_validity_days: 7 });
            const [code] = voucherService.generateCodes(p.id, 1);
            db.prepare('UPDATE voucher_codes SET code_expires_at = ? WHERE code = ?')
                .run(new Date(Date.now() - 1000).toISOString(), code.code);
            expect(() => voucherService.redeemCode(code.code, { deviceHash: 'dev-A' }))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(rawCode(code.code).status).toBe('expired');
        });
    });

    describe('access queries', () => {
        it('grants access strictly by device redemption — phone is contact, not a key', () => {
            const p = makeProfile({ area_ids: [1, 2], max_uses_per_code: 2 });
            const [code] = voucherService.generateCodes(p.id, 1);
            voucherService.redeemCode(code.code, { phone: '+62 812-3456-7890', deviceHash: 'dev-A' });

            expect(voucherService.getAccessibleAreaIds({ deviceHash: 'dev-A' }).sort()).toEqual([1, 2]);
            // A device that never redeemed gets nothing — even if it knows the buyer's phone.
            expect(voucherService.getAccessibleAreaIds({ deviceHash: 'dev-B' })).toEqual([]);
            expect(voucherService.hasAreaAccess(1, { deviceHash: 'dev-A' })).toBe(true);
            expect(voucherService.hasAreaAccess(3, { deviceHash: 'dev-A' })).toBe(false);

            // Phone canonicalized (+62 -> 0) for storage/contact only, never as a credential.
            expect(rawCode(code.code).buyer_phone).toBe('081234567890');

            // Portability: a second device regains access by RE-ENTERING the code (within max_uses).
            voucherService.redeemCode(code.code, { deviceHash: 'dev-B' });
            expect(voucherService.getAccessibleAreaIds({ deviceHash: 'dev-B' }).sort()).toEqual([1, 2]);
        });

        it('excludes a code whose expires_at has passed even before the sweep', () => {
            const p = makeProfile({ area_ids: [1] });
            const [code] = voucherService.generateCodes(p.id, 1);
            voucherService.redeemCode(code.code, { deviceHash: 'dev-A' });
            db.prepare('UPDATE voucher_codes SET expires_at = ? WHERE code = ?')
                .run(new Date(Date.now() - 1000).toISOString(), code.code);
            expect(voucherService.getAccessibleAreaIds({ deviceHash: 'dev-A' })).toEqual([]);
        });

        it('stacks coverage across multiple codes for the same device', () => {
            const dander = makeProfile({ name: 'Dander', area_ids: [1] });
            const tj = makeProfile({ name: 'Tanjungharjo', area_ids: [2] });
            const [c1] = voucherService.generateCodes(dander.id, 1);
            const [c2] = voucherService.generateCodes(tj.id, 1);
            voucherService.redeemCode(c1.code, { deviceHash: 'dev-A' });
            voucherService.redeemCode(c2.code, { deviceHash: 'dev-A' });
            expect(voucherService.getAccessibleAreaIds({ deviceHash: 'dev-A' }).sort()).toEqual([1, 2]);
        });
    });

    describe('expireDue', () => {
        it('sweeps lapsed active and unused codes to expired', () => {
            const active = makeProfile({ duration_minutes: 60, area_ids: [1] });
            const [c1] = voucherService.generateCodes(active.id, 1);
            voucherService.redeemCode(c1.code, { deviceHash: 'dev-A' });
            db.prepare('UPDATE voucher_codes SET expires_at = ? WHERE code = ?')
                .run(new Date(Date.now() - 1000).toISOString(), c1.code);

            const withValidity = makeProfile({ name: 'Hangus', code_validity_days: 7 });
            const [c2] = voucherService.generateCodes(withValidity.id, 1);
            db.prepare('UPDATE voucher_codes SET code_expires_at = ? WHERE code = ?')
                .run(new Date(Date.now() - 1000).toISOString(), c2.code);

            const result = voucherService.expireDue();
            expect(result.expired).toBe(2);
            expect(rawCode(c1.code).status).toBe('expired');
            expect(rawCode(c2.code).status).toBe('expired');
        });
    });

    describe('gate helpers (Phase 2)', () => {
        it('isAreaAccessGated requires BOTH the feature on AND the area marked', () => {
            voucherService.setAreaGated(1, true);
            expect(voucherService.isAreaAccessGated(1)).toBe(false); // feature still off
            voucherService.setFeatureEnabled(true);
            expect(voucherService.isAreaAccessGated(1)).toBe(true);
            expect(voucherService.isAreaAccessGated(2)).toBe(false); // area not marked
            expect(voucherService.isAreaAccessGated(null)).toBe(false);
        });

        it('getPublicGateState reports the feature cleanly when off', () => {
            expect(voucherService.getPublicGateState({ deviceHash: 'd' }))
                .toEqual({ enabled: false, gated_area_ids: [], accessible_area_ids: [] });
        });

        it('getPublicGateState lists gated areas and the device-accessible subset', () => {
            voucherService.setFeatureEnabled(true);
            voucherService.setAreaGated(1, true);
            voucherService.setAreaGated(2, true);
            const p = makeProfile({ area_ids: [1] });
            const [code] = voucherService.generateCodes(p.id, 1);
            voucherService.redeemCode(code.code, { deviceHash: 'dev-A' });

            const state = voucherService.getPublicGateState({ deviceHash: 'dev-A' });
            expect(state.enabled).toBe(true);
            expect(state.gated_area_ids.sort()).toEqual([1, 2]);
            expect(state.accessible_area_ids).toEqual([1]);

            // A device without a pass sees the gated areas but none accessible.
            expect(voucherService.getPublicGateState({ deviceHash: 'dev-B' }).accessible_area_ids).toEqual([]);
        });
    });
});
