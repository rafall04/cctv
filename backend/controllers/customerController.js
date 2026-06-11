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
import paymentService from '../services/paymentService.js';
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
    c.status,
    c.is_online,
    c.last_online_check,
    c.enabled,
    c.camera_class,
    c.billing_status,
    c.delivery_type,
    c.thumbnail_path,
    c.thumbnail_updated_at,
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

export async function createTopup(request, reply) {
    try {
        const amount = Number(request.body?.amount);
        const payment = await paymentService.createTopup(request.user.id, amount);
        return reply.send({ success: true, message: 'Permintaan top-up dibuat', data: payment });
    } catch (error) {
        return handleError(reply, error, 'Create topup error:');
    }
}

export async function getTopupStatus(request, reply) {
    try {
        const payment = paymentService.getPayment(request.params.id, request.user.id);
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
