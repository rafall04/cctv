/**
 * Purpose: Customer-portal handlers — own cameras (sanitized, never RTSP), billing summary,
 *          wallet ledger, and prepaid top-up lifecycle.
 * Caller: customerRoutes (/api/customer/*).
 * Deps: connectionPool, walletService, billingService, paymentService, camera helpers.
 * MainFuncs: getMyCameras, getMySummary, getMyWallet, createTopup, getTopupStatus, getMyPayments.
 * SideEffects: createTopup writes a pending payment row.
 */

import { query } from '../database/connectionPool.js';
import walletService from '../services/walletService.js';
import billingService from '../services/billingService.js';
import billingPlanService from '../services/billingPlanService.js';
import customerCameraService from '../services/customerCameraService.js';
import paymentService from '../services/paymentService.js';
import promoService from '../services/promoService.js';
import paymentSettingsService from '../services/paymentSettingsService.js';
import cameraHealthService from '../services/cameraHealthService.js';
import playbackTokenService from '../services/playbackTokenService.js';
import { sanitizeCameraThumbnailList } from '../services/thumbnailPathService.js';

function handleError(reply, error, fallback) {
    if (error.statusCode && error.statusCode < 500) {
        return reply.code(error.statusCode).send({ success: false, message: error.message });
    }
    // Gateway/upstream errors flagged `expose` carry a customer-safe message — surface it
    // (with its real 5xx status) instead of a generic "Internal server error".
    if (error.expose && error.statusCode) {
        console.error(fallback, error.message);
        return reply.code(error.statusCode).send({ success: false, message: error.message });
    }
    console.error(fallback, error);
    return reply.code(500).send({ success: false, message: 'Internal server error' });
}

// Deliberately slim projection: no private_rtsp_url, no external upstream URLs,
// no stream_key (the player obtains stream URLs through /api/stream/:id which
// is ownership-gated and already strips secrets).
const CUSTOMER_CAMERA_PROJECTION = `
    c.id,
    c.name,
    c.description,
    c.location,
    c.latitude,
    c.longitude,
    c.status,
    c.is_online,
    c.last_online_check,
    c.enabled,
    c.camera_class,
    c.billing_status,
    c.delivery_type,
    c.thumbnail_path,
    c.thumbnail_updated_at,
    c.area_id,
    c.is_public,
    -- Surfaced so the portal can explain why two cameras on one plan cost different amounts.
    c.enable_recording,
    a.name AS area_name
`;

export async function getMyCameras(request, reply) {
    try {
        const userId = request.user.id;
        const cameras = sanitizeCameraThumbnailList(query(
            `SELECT ${CUSTOMER_CAMERA_PROJECTION},
                    cs.monthly_price, cs.status AS subscription_status, cs.last_charged_date
             FROM cameras c
             LEFT JOIN areas a ON a.id = c.area_id
             LEFT JOIN camera_subscriptions cs ON cs.camera_id = c.id AND cs.status != 'cancelled'
             WHERE c.owner_user_id = ?
             ORDER BY c.id ASC`,
            [userId]
        )).map((camera) => cameraHealthService.enrichCameraAvailability(camera));

        return reply.send({ success: true, data: cameras });
    } catch (error) {
        return handleError(reply, error, 'Get customer cameras error:');
    }
}

// Read-only list of the admin-curated public areas, for the customer's camera
// area picker. Customers PICK from these (shared, geo-rich) — they never create
// areas, so there's no admin/customer duplicate of the same place.
export async function listMyAreas(request, reply) {
    try {
        const areas = query(
            'SELECT id, name, kelurahan, kecamatan FROM areas ORDER BY name COLLATE NOCASE ASC'
        );
        return reply.send({ success: true, data: areas });
    } catch (error) {
        return handleError(reply, error, 'List areas error:');
    }
}

export async function getMySummary(request, reply) {
    try {
        const summary = billingService.getCustomerBillingSummary(request.user.id);
        return reply.send({ success: true, data: summary });
    } catch (error) {
        return handleError(reply, error, 'Get customer summary error:');
    }
}

export async function getMyWallet(request, reply) {
    try {
        const data = walletService.getTransactions(request.user.id, {
            limit: request.query?.limit,
        });
        return reply.send({ success: true, data });
    } catch (error) {
        return handleError(reply, error, 'Get customer wallet error:');
    }
}

export async function getPaymentOptions(request, reply) {
    try {
        return reply.send({ success: true, data: paymentSettingsService.getCustomerPaymentOptions() });
    } catch (error) {
        return handleError(reply, error, 'Get payment options error:');
    }
}

export async function createTopup(request, reply) {
    try {
        const amount = Number(request.body?.amount);
        const method = request.body?.method || null;
        const promo = request.body?.promo || null;
        const payment = await paymentService.createTopup(request.user.id, amount, method, promo);
        return reply.send({ success: true, message: 'Permintaan top-up dibuat', data: payment });
    } catch (error) {
        return handleError(reply, error, 'Create topup error:');
    }
}

export async function validatePromo(request, reply) {
    try {
        const amount = Number(request.query?.amount) || 0;
        const result = promoService.validateForTopup(request.query?.code, request.user.id, amount);
        return reply.send({ success: true, data: result });
    } catch (error) {
        return handleError(reply, error, 'Validate promo error:');
    }
}

export async function redeemPromo(request, reply) {
    try {
        const result = promoService.redeemGift(request.body?.code, request.user.id, request);
        return reply.send({ success: true, message: `Hadiah Rp${Number(result.bonus).toLocaleString('id-ID')} masuk ke saldo`, data: result });
    } catch (error) {
        return handleError(reply, error, 'Redeem promo error:');
    }
}

export async function getTopupStatus(request, reply) {
    try {
        // Ownership check first (throws 404 for other users' payments) …
        let payment = paymentService.getPayment(request.params.id, request.user.id);
        // … then opportunistically re-verify pending iPaymu payments against the
        // gateway so polling confirms even without a reachable webhook.
        if (payment.gateway === 'ipaymu' && payment.status === 'pending') {
            await paymentService.syncIpaymuPayment(payment.id);
            payment = paymentService.getPayment(request.params.id, request.user.id);
        }
        return reply.send({ success: true, data: payment });
    } catch (error) {
        return handleError(reply, error, 'Get topup status error:');
    }
}

export async function getMyPayments(request, reply) {
    try {
        const payments = paymentService.listPaymentsForUser(request.user.id, {
            limit: request.query?.limit,
        });
        return reply.send({ success: true, data: payments });
    } catch (error) {
        return handleError(reply, error, 'Get customer payments error:');
    }
}

export async function getMyPlan(request, reply) {
    try {
        const state = billingPlanService.getUserPlanState(request.user.id);
        return reply.send({ success: true, data: state });
    } catch (error) {
        return handleError(reply, error, 'Get customer plan error:');
    }
}

export async function listAvailablePlans(request, reply) {
    try {
        const plans = billingPlanService.listPlans({ activeOnly: true });
        return reply.send({ success: true, data: plans });
    } catch (error) {
        return handleError(reply, error, 'List plans error:');
    }
}

export async function switchMyPlan(request, reply) {
    try {
        const state = billingPlanService.changeUserPlan(
            request.user.id,
            request.body?.plan_key,
            { byAdmin: false, request }
        );
        return reply.send({ success: true, message: 'Paket berhasil diubah', data: state });
    } catch (error) {
        return handleError(reply, error, 'Switch plan error:');
    }
}

export async function createMyCamera(request, reply) {
    try {
        const created = await customerCameraService.createOwnCamera(request.user, request.body || {}, request);
        return reply.send({ success: true, message: 'Kamera berhasil ditambahkan', data: created });
    } catch (error) {
        return handleError(reply, error, 'Create own camera error:');
    }
}

export async function updateMyCamera(request, reply) {
    try {
        const updated = await customerCameraService.updateOwnCamera(request.user, request.params.id, request.body || {}, request);
        return reply.send({ success: true, message: 'Kamera diperbarui', data: updated });
    } catch (error) {
        return handleError(reply, error, 'Update own camera error:');
    }
}

export async function deleteMyCamera(request, reply) {
    try {
        const deleted = await customerCameraService.deleteOwnCamera(request.user, request.params.id, request);
        return reply.send({ success: true, message: 'Kamera dihapus', data: deleted });
    } catch (error) {
        return handleError(reply, error, 'Delete own camera error:');
    }
}

/**
 * Setup details a customer needs to configure their own router — currently just the address they
 * must allow through to their camera.
 *
 * Deliberately an authenticated API call rather than a constant in the React page: a component
 * compiles into a JS chunk that anyone can download WITHOUT logging in, so "put it on a guarded
 * route" hides the page, not the content. It matters here because the site sits behind a
 * Cloudflare Tunnel — publishing the egress address would undo the origin hiding that buys.
 *
 * No hardcoded fallback on purpose. If the value is not configured the page says so and asks the
 * customer to contact us, which is safer than confidently printing an address that has since moved.
 */
export async function getSetupInfo(request, reply) {
    try {
        const ip = (process.env.EGRESS_PUBLIC_IP || '').trim();
        return reply.send({ success: true, data: { server_ip: ip || null } });
    } catch (error) {
        return handleError(reply, error, 'Get setup info error:');
    }
}

// ---------------------------------------------------------------------------
// Share links a customer mints for THEIR OWN cameras
// ---------------------------------------------------------------------------
/*
 * A shop owner handing footage to their staff or to the police is a real need, and routing every
 * one of those through us does not scale. But this is the highest-risk surface in the portal:
 * a link leaves our system entirely, so what it can reach must be decided here, never by the
 * client.
 *
 * Three rules, all enforced server-side:
 *  - the camera list is INTERSECTED with what this customer owns; a forged camera_id is dropped
 *    rather than trusted, so the worst a tampered request achieves is a token for nothing;
 *  - scope is forced to 'selected'. An 'all' or 'area' token would be refused by the playback
 *    gate anyway, but minting one at all would be a trap waiting for someone to widen that gate;
 *  - a quota, because one account must not be able to mint links without bound.
 */
const KUOTA_TOKEN_PELANGGAN = 10;

function kameraMilik(userId, cameraIds) {
    const diminta = (Array.isArray(cameraIds) ? cameraIds : [])
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0);
    if (diminta.length === 0) return [];

    const placeholders = diminta.map(() => '?').join(', ');
    return query(
        `SELECT id FROM cameras
         WHERE owner_user_id = ? AND camera_class = 'subscriber' AND id IN (${placeholders})`,
        [userId, ...diminta]
    ).map((row) => row.id);
}

/*
 * Scoped query rather than playbackTokenService.listTokens(): that method takes no filter, returns
 * EVERY token in the system and caps at 200 rows. Filtering its output afterwards would both leak
 * other people's tokens on the way through and silently lose this customer's once the global count
 * passed the cap.
 */
function tokenMilikPelanggan(userId) {
    return query(
        `SELECT id, label, token_prefix, share_key_prefix, scope_type, camera_ids_json,
                playback_window_hours, expires_at, revoked_at, last_used_at, use_count,
                client_note, created_at
         FROM playback_tokens
         WHERE created_by = ?
         ORDER BY created_at DESC, id DESC`,
        [userId]
    ).map((row) => ({
        ...row,
        camera_ids: JSON.parse(row.camera_ids_json || '[]'),
        is_active: !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()),
    }));
}

export async function listMyPlaybackTokens(request, reply) {
    try {
        return reply.send({ success: true, data: tokenMilikPelanggan(request.user.id) });
    } catch (error) {
        return handleError(reply, error, 'List customer playback tokens error:');
    }
}

export async function createMyPlaybackToken(request, reply) {
    try {
        const userId = request.user.id;
        const cameraIds = kameraMilik(userId, request.body?.camera_ids);
        if (cameraIds.length === 0) {
            const err = new Error('Pilih minimal satu kamera milik Anda');
            err.statusCode = 400;
            throw err;
        }

        const aktif = tokenMilikPelanggan(userId).filter((t) => t.is_active).length;
        if (aktif >= KUOTA_TOKEN_PELANGGAN) {
            const err = new Error(`Maksimal ${KUOTA_TOKEN_PELANGGAN} tautan aktif. Cabut yang lama dulu.`);
            err.statusCode = 400;
            throw err;
        }

        const hasil = playbackTokenService.createToken({
            label: String(request.body?.label || 'Tautan rekaman').slice(0, 60),
            scope_type: 'selected',
            camera_ids: cameraIds,
            preset: 'custom',
            playback_window_hours: Math.min(Number(request.body?.playback_window_hours) || 24, 168),
            expires_at: request.body?.expires_at,
            client_note: String(request.body?.client_note || '').slice(0, 120),
        }, request);

        return reply.send({ success: true, message: 'Tautan dibuat', data: hasil?.data ?? hasil });
    } catch (error) {
        return handleError(reply, error, 'Create customer playback token error:');
    }
}

export async function revokeMyPlaybackToken(request, reply) {
    try {
        const id = Number.parseInt(request.params.id, 10);
        // Ownership is re-checked here rather than trusted from the URL: revoking is destructive,
        // and a customer must not be able to kill a link they did not create.
        const milik = tokenMilikPelanggan(request.user.id).some((t) => Number(t.id) === id);
        if (!milik) {
            const err = new Error('Tautan tidak ditemukan');
            err.statusCode = 404;
            throw err;
        }

        playbackTokenService.revokeToken(id, request);
        return reply.send({ success: true, message: 'Tautan dicabut' });
    } catch (error) {
        return handleError(reply, error, 'Revoke customer playback token error:');
    }
}
