/**
 * Purpose: Minimal, self-contained iPaymu v2 signed-request client for the VOUCHER order flow.
 *          Deliberately standalone (does not import paymentService) so the voucher self-serve path
 *          stays isolated from the billing/wallet money path — the agreed D1 decision. paymentService
 *          keeps its own internal copy for the wallet top-up flow; a future task may DRY the two.
 * Caller: voucherOrderService (createOrder charge + status re-query).
 * Deps: node:crypto, paymentSettingsService (admin-editable VA/API key/base URL), global fetch.
 * MainFuncs: ipaymuRequest, interpretIpaymuTransaction, buildIpaymuSignature, isIpaymuConfigured.
 *
 * iPaymu v2 signature: stringToSign = "{METHOD}:{VA}:{lowercase sha256(jsonBody)}:{API_KEY}";
 * signature = HMAC-SHA256(stringToSign, API_KEY) hex. Sent via va/signature/timestamp headers.
 */

import crypto from 'crypto';
import paymentSettingsService from '../services/paymentSettingsService.js';

function getIpaymuConfig() {
    const { ipaymu } = paymentSettingsService.getGatewayConfig();
    return { va: ipaymu.va, apiKey: ipaymu.apiKey, baseUrl: ipaymu.baseUrl };
}

export function isIpaymuConfigured() {
    const { va, apiKey } = getIpaymuConfig();
    return !!va && !!apiKey;
}

export function buildIpaymuSignature({ method = 'POST', va, apiKey, body }) {
    const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex').toLowerCase();
    const stringToSign = `${method.toUpperCase()}:${va}:${bodyHash}:${apiKey}`;
    return crypto.createHmac('sha256', apiKey).update(stringToSign, 'utf8').digest('hex');
}

function ipaymuTimestamp(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export async function ipaymuRequest(path, payload, { method = 'POST', timeoutMs = 10000 } = {}) {
    const { va, apiKey, baseUrl } = getIpaymuConfig();
    if (!va || !apiKey) {
        const err = new Error('iPaymu belum dikonfigurasi (VA / API key kosong)');
        err.statusCode = 503;
        throw err;
    }
    const verb = method.toUpperCase();
    const isGet = verb === 'GET';
    // iPaymu signs sha256(JSON body); a GET signs the literal "{}" per the official samples.
    const body = isGet ? '{}' : JSON.stringify(payload || {});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${baseUrl}${path}`, {
            method: verb,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                va,
                signature: buildIpaymuSignature({ method: verb, va, apiKey, body }),
                timestamp: ipaymuTimestamp(),
            },
            ...(isGet ? {} : { body }),
            signal: controller.signal,
        });
        const json = await response.json().catch(() => ({}));
        return { httpOk: response.ok, body: json };
    } finally {
        clearTimeout(timeout);
    }
}

/** Normalize an iPaymu transaction-check payload into {paid, expired, amount}. */
export function interpretIpaymuTransaction(data) {
    if (!data) {
        return { paid: false, expired: false, amount: null };
    }
    const statusDesc = String(data.StatusDesc ?? data.status_desc ?? '').toLowerCase();
    const statusCode = Number(data.Status ?? data.status);
    const paid = statusDesc === 'berhasil' || statusDesc === 'success' || statusCode === 1 || statusCode === 6;
    const expired = statusDesc.includes('expired') || statusDesc.includes('kadaluarsa') || statusCode === -2;
    const rawAmount = data.Amount ?? data.amount ?? data.Total ?? data.total ?? null;
    const amount = rawAmount === null ? null : Math.round(Number.parseFloat(rawAmount));
    return { paid, expired, amount: Number.isFinite(amount) ? amount : null };
}

export default { ipaymuRequest, interpretIpaymuTransaction, buildIpaymuSignature, isIpaymuConfigured };
