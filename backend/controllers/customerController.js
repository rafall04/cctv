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
import paymentSettingsService from '../services/paymentSettingsService.js';
import cameraHealthService from '../services/cameraHealthService.js';
import { sanitizeCameraThumbnailList } from '../services/thumbnailPathService.js';

function handleError(reply, error, fallback) {
    if (error.statusCode && error.statusCode < 500) {
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
        const payment = await paymentService.createTopup(request.user.id, amount, method);
        return reply.send({ success: true, message: 'Permintaan top-up dibuat', data: payment });
    } catch (error) {
        return handleError(reply, error, 'Create topup error:');
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
