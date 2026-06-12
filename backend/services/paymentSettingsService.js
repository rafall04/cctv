/**
 * Purpose: Single source of truth for payment-gateway configuration, editable from the admin
 *          page (settings table) so deployments never have to touch .env. Resolves each value
 *          DB → env → default, so existing .env deployments keep working until an admin overrides.
 * Caller: paymentService (runtime config), billingAdminController (admin view/update/test),
 *         customerController (payment method options).
 * Deps: connectionPool (settings table), securityAuditLogger.
 * MainFuncs: getGatewayConfig, getAdminView, updateConfig, getCustomerPaymentOptions,
 *            resolveIpaymuMethod, DEFAULT_IPAYMU_METHODS.
 * SideEffects: Reads/writes the settings table.
 *
 * SECRET HANDLING: ipaymu_api_key / midtrans_server_key are stored in the settings table
 * (same trust level as .env on the same host). They are NEVER returned to the browser —
 * getAdminView() exposes only a boolean "set" flag + a masked hint, and updateConfig() writes
 * a secret only when a non-empty new value is supplied (empty = keep the existing one).
 */

import { query, queryOne, execute } from '../database/connectionPool.js';
import { logAdminAction } from './securityAuditLogger.js';

const KEYS = {
    gateway: 'billing_gateway',
    publicBaseUrl: 'billing_public_base_url',
    ipaymuVa: 'ipaymu_va',
    ipaymuApiKey: 'ipaymu_api_key',
    ipaymuProduction: 'ipaymu_production',
    ipaymuMethods: 'ipaymu_methods',
    midtransServerKey: 'midtrans_server_key',
    midtransProduction: 'midtrans_production',
};

export const SUPPORTED_GATEWAYS = ['manual', 'midtrans', 'ipaymu'];

// iPaymu Direct API v2 method/channel presets. QRIS is enabled by default; its channel is
// `mpm` (verified against the live /payment-channels list — `qris:qris` is NOT a valid combo
// and makes iPaymu 500). The bank VA and convenience-store presets ship DISABLED so an admin
// consciously turns on the ones they want. Admins can verify/add the exact codes via the
// "Ambil channel dari iPaymu" button, so a new channel never requires a code change.
export const DEFAULT_IPAYMU_METHODS = [
    { method: 'qris', channel: 'mpm', label: 'QRIS (semua e-wallet & m-banking)', enabled: true },
    { method: 'va', channel: 'bca', label: 'Virtual Account BCA', enabled: false },
    { method: 'va', channel: 'bni', label: 'Virtual Account BNI', enabled: false },
    { method: 'va', channel: 'bri', label: 'Virtual Account BRI', enabled: false },
    { method: 'va', channel: 'mandiri', label: 'Virtual Account Mandiri', enabled: false },
    { method: 'va', channel: 'permata', label: 'Virtual Account Permata', enabled: false },
    { method: 'va', channel: 'cimb', label: 'Virtual Account CIMB Niaga', enabled: false },
    { method: 'va', channel: 'bsi', label: 'Virtual Account BSI', enabled: false },
    { method: 'cstore', channel: 'indomaret', label: 'Indomaret', enabled: false },
    { method: 'cstore', channel: 'alfamart', label: 'Alfamart', enabled: false },
];

function readSetting(key) {
    // Defensive: a missing settings table (fresh/test DB) must fall through to env, not throw.
    try {
        const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
        if (!row || row.value === null || row.value === undefined || row.value === '') {
            return null;
        }
        return row.value;
    } catch {
        return null;
    }
}

function writeSetting(key, value, description) {
    execute(
        `INSERT INTO settings (key, value, description) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [key, value, description || null]
    );
}

function asBool(raw, fallback = false) {
    if (raw === null || raw === undefined) return fallback;
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

function methodKeyOf(m) {
    return `${m.method}:${m.channel}`;
}

function normalizeMethods(raw) {
    if (!Array.isArray(raw)) {
        return DEFAULT_IPAYMU_METHODS.map((m) => ({ ...m }));
    }
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const method = String(item?.method || '').trim().toLowerCase();
        const channel = String(item?.channel || '').trim().toLowerCase();
        if (!/^[a-z0-9_]{2,20}$/.test(method) || !/^[a-z0-9_]{2,20}$/.test(channel)) {
            continue;
        }
        const key = `${method}:${channel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            method,
            channel,
            label: String(item?.label || `${method.toUpperCase()} ${channel.toUpperCase()}`).slice(0, 60),
            enabled: asBool(item?.enabled, false),
        });
    }
    return out.length ? out : DEFAULT_IPAYMU_METHODS.map((m) => ({ ...m }));
}

function readMethods() {
    const raw = readSetting(KEYS.ipaymuMethods);
    if (!raw) {
        return DEFAULT_IPAYMU_METHODS.map((m) => ({ ...m }));
    }
    try {
        return normalizeMethods(JSON.parse(raw));
    } catch {
        return DEFAULT_IPAYMU_METHODS.map((m) => ({ ...m }));
    }
}

function maskSecret(value) {
    if (!value) return '';
    if (value.length <= 4) return '••••';
    return `••••${value.slice(-4)}`;
}

class PaymentSettingsService {
    /** Runtime config used by paymentService. Secrets included (server-side only). */
    getGatewayConfig() {
        const gatewayRaw = (readSetting(KEYS.gateway) || process.env.BILLING_GATEWAY || 'manual').toLowerCase();
        const gateway = SUPPORTED_GATEWAYS.includes(gatewayRaw) ? gatewayRaw : 'manual';

        const publicBaseUrl = (readSetting(KEYS.publicBaseUrl)
            || process.env.BILLING_PUBLIC_BASE_URL
            || (process.env.FRONTEND_DOMAIN ? `https://${process.env.FRONTEND_DOMAIN}` : '')
        ).replace(/\/$/, '');

        const ipaymuProduction = readSetting(KEYS.ipaymuProduction) !== null
            ? asBool(readSetting(KEYS.ipaymuProduction))
            : process.env.IPAYMU_PRODUCTION === 'true';
        const ipaymuBaseUrl = (process.env.IPAYMU_BASE_URL
            || (ipaymuProduction ? 'https://my.ipaymu.com' : 'https://sandbox.ipaymu.com')).replace(/\/$/, '');

        const midtransProduction = readSetting(KEYS.midtransProduction) !== null
            ? asBool(readSetting(KEYS.midtransProduction))
            : process.env.MIDTRANS_PRODUCTION === 'true';

        return {
            gateway,
            publicBaseUrl,
            ipaymu: {
                va: readSetting(KEYS.ipaymuVa) || process.env.IPAYMU_VA || '',
                apiKey: readSetting(KEYS.ipaymuApiKey) || process.env.IPAYMU_API_KEY || '',
                production: ipaymuProduction,
                baseUrl: ipaymuBaseUrl,
                methods: readMethods(),
            },
            midtrans: {
                serverKey: readSetting(KEYS.midtransServerKey) || process.env.MIDTRANS_SERVER_KEY || '',
                production: midtransProduction,
                apiBase: process.env.MIDTRANS_API_BASE
                    || (midtransProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com'),
            },
        };
    }

    /** Enabled iPaymu methods (for the customer picker + validation). */
    getEnabledIpaymuMethods() {
        return this.getGatewayConfig().ipaymu.methods.filter((m) => m.enabled);
    }

    /**
     * Resolve a customer-chosen method key (`method:channel`) to a concrete method,
     * defaulting to the first enabled method (and finally to QRIS) so a stale/invalid
     * pick can never produce an unconfigured charge.
     */
    resolveIpaymuMethod(methodKey) {
        const enabled = this.getEnabledIpaymuMethods();
        if (methodKey) {
            const found = enabled.find((m) => methodKeyOf(m) === methodKey);
            if (found) return found;
        }
        return enabled[0] || { method: 'qris', channel: 'mpm', label: 'QRIS', enabled: true };
    }

    /** Admin-facing view — NEVER exposes raw secrets. */
    getAdminView() {
        const cfg = this.getGatewayConfig();
        return {
            gateway: cfg.gateway,
            supported_gateways: SUPPORTED_GATEWAYS,
            public_base_url: cfg.publicBaseUrl,
            ipaymu: {
                va: cfg.ipaymu.va,
                production: cfg.ipaymu.production,
                api_key_set: !!cfg.ipaymu.apiKey,
                api_key_hint: maskSecret(cfg.ipaymu.apiKey),
                base_url: cfg.ipaymu.baseUrl,
                methods: cfg.ipaymu.methods,
            },
            midtrans: {
                production: cfg.midtrans.production,
                server_key_set: !!cfg.midtrans.serverKey,
                server_key_hint: maskSecret(cfg.midtrans.serverKey),
            },
        };
    }

    /** Customer-facing list of selectable payment methods for the top-up UI. */
    getCustomerPaymentOptions() {
        const cfg = this.getGatewayConfig();
        if (cfg.gateway !== 'ipaymu') {
            // manual/midtrans present a single implicit method to the customer.
            return { gateway: cfg.gateway, methods: [] };
        }
        return {
            gateway: 'ipaymu',
            methods: this.getEnabledIpaymuMethods().map((m) => ({
                key: methodKeyOf(m),
                method: m.method,
                channel: m.channel,
                label: m.label,
            })),
        };
    }

    updateConfig(patch = {}, request = null) {
        if (patch.gateway !== undefined) {
            const g = String(patch.gateway).toLowerCase();
            if (!SUPPORTED_GATEWAYS.includes(g)) {
                const err = new Error('Gateway tidak dikenal');
                err.statusCode = 400;
                throw err;
            }
            writeSetting(KEYS.gateway, g, 'Gateway pembayaran aktif');
        }

        if (patch.public_base_url !== undefined) {
            const url = String(patch.public_base_url).trim();
            if (url && !/^https?:\/\//i.test(url)) {
                const err = new Error('URL publik harus diawali http(s)://');
                err.statusCode = 400;
                throw err;
            }
            writeSetting(KEYS.publicBaseUrl, url.replace(/\/$/, ''), 'Base URL publik untuk notify webhook');
        }

        if (patch.ipaymu_va !== undefined) {
            writeSetting(KEYS.ipaymuVa, String(patch.ipaymu_va).trim(), 'iPaymu VA / kode toko');
        }
        // Secret: only overwrite when a non-empty value is actually provided.
        if (typeof patch.ipaymu_api_key === 'string' && patch.ipaymu_api_key.trim() !== '') {
            writeSetting(KEYS.ipaymuApiKey, patch.ipaymu_api_key.trim(), 'iPaymu API key (rahasia)');
        }
        if (patch.ipaymu_production !== undefined) {
            writeSetting(KEYS.ipaymuProduction, asBool(patch.ipaymu_production) ? 'true' : 'false', 'iPaymu mode produksi');
        }
        if (patch.ipaymu_methods !== undefined) {
            const methods = normalizeMethods(patch.ipaymu_methods);
            writeSetting(KEYS.ipaymuMethods, JSON.stringify(methods), 'Daftar metode/bank iPaymu');
        }

        if (typeof patch.midtrans_server_key === 'string' && patch.midtrans_server_key.trim() !== '') {
            writeSetting(KEYS.midtransServerKey, patch.midtrans_server_key.trim(), 'Midtrans server key (rahasia)');
        }
        if (patch.midtrans_production !== undefined) {
            writeSetting(KEYS.midtransProduction, asBool(patch.midtrans_production) ? 'true' : 'false', 'Midtrans mode produksi');
        }

        if (request) {
            // Log WITHOUT secret values.
            logAdminAction({
                action: 'billing_payment_gateway_updated',
                gateway: patch.gateway,
                ipaymuVaChanged: patch.ipaymu_va !== undefined,
                ipaymuKeyChanged: typeof patch.ipaymu_api_key === 'string' && patch.ipaymu_api_key.trim() !== '',
                methodsChanged: patch.ipaymu_methods !== undefined,
            }, request);
        }

        return this.getAdminView();
    }
}

const paymentSettingsService = new PaymentSettingsService();
export default paymentSettingsService;
export { methodKeyOf };
