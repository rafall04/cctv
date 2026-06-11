/**
 * Purpose: Admin billing handlers — customer overview, subscription assignment/lifecycle,
 *          camera class management, payment confirmation, manual top-up, ops charge trigger.
 * Caller: billingAdminRoutes (/api/admin/billing/*, requireAdmin).
 * Deps: connectionPool, billingService, walletService, paymentService.
 * MainFuncs: listCustomers, manualTopup, listSubscriptions, assignSubscription,
 *            updateSubscription, setCameraClass, listPayments, markPaymentPaid, runCharges.
 * SideEffects: Mutates billing tables via services; audit-logged inside the services.
 */

import { query } from '../database/connectionPool.js';
import billingService from '../services/billingService.js';
import walletService from '../services/walletService.js';
import paymentService from '../services/paymentService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

function handleError(reply, error, fallback) {
    if (error.statusCode && error.statusCode < 500) {
        return reply.code(error.statusCode).send({ success: false, message: error.message });
    }
    console.error(fallback, error);
    return reply.code(500).send({ success: false, message: 'Internal server error' });
}

export async function listCustomers(request, reply) {
    try {
        const customers = query(`
            SELECT u.id, u.username, u.phone, u.email, u.created_at,
                   COALESCE(w.balance, 0) AS balance,
                   (SELECT COUNT(*) FROM cameras c WHERE c.owner_user_id = u.id) AS camera_count,
                   (SELECT COUNT(*) FROM camera_subscriptions cs
                     WHERE cs.user_id = u.id AND cs.status = 'active') AS active_subscriptions,
                   (SELECT COUNT(*) FROM camera_subscriptions cs
                     WHERE cs.user_id = u.id AND cs.status = 'suspended') AS suspended_subscriptions
            FROM users u
            LEFT JOIN wallets w ON w.user_id = u.id
            WHERE u.role = 'customer'
            ORDER BY u.id ASC
        `);
        return reply.send({ success: true, data: customers });
    } catch (error) {
        return handleError(reply, error, 'List customers error:');
    }
}

export async function manualTopup(request, reply) {
    try {
        const { user_id, amount, note } = request.body;
        const result = walletService.credit({
            userId: Number(user_id),
            amount: Number(amount),
            type: 'topup',
            reference: `manual-admin:${request.user.id}:${Date.now()}`,
            note: note || `Top-up manual oleh ${request.user.username}`,
        });
        const resume = billingService.tryResumeForUser(Number(user_id));

        logAdminAction({
            action: 'billing_manual_topup',
            customerId: Number(user_id),
            amount: Number(amount),
            resumedCameraIds: resume.resumedCameraIds,
        }, request);

        return reply.send({
            success: true,
            message: 'Saldo berhasil ditambahkan',
            data: { ...result, resumed_camera_ids: resume.resumedCameraIds },
        });
    } catch (error) {
        return handleError(reply, error, 'Manual topup error:');
    }
}

export async function listSubscriptions(request, reply) {
    try {
        return reply.send({ success: true, data: billingService.listSubscriptions() });
    } catch (error) {
        return handleError(reply, error, 'List subscriptions error:');
    }
}

export async function assignSubscription(request, reply) {
    try {
        const subscription = billingService.assignSubscription(request.body, request);
        return reply.send({
            success: true,
            message: 'Kamera berhasil di-assign ke pelanggan',
            data: subscription,
        });
    } catch (error) {
        return handleError(reply, error, 'Assign subscription error:');
    }
}

export async function updateSubscription(request, reply) {
    try {
        const subscription = billingService.updateSubscription(request.params.id, request.body, request);
        return reply.send({ success: true, message: 'Langganan diperbarui', data: subscription });
    } catch (error) {
        return handleError(reply, error, 'Update subscription error:');
    }
}

export async function setCameraClass(request, reply) {
    try {
        const camera = billingService.setCameraClass(request.params.id, request.body, request);
        return reply.send({ success: true, message: 'Kelas kamera diperbarui', data: camera });
    } catch (error) {
        return handleError(reply, error, 'Set camera class error:');
    }
}

export async function listPayments(request, reply) {
    try {
        return reply.send({
            success: true,
            data: paymentService.listPayments({ limit: request.query?.limit }),
        });
    } catch (error) {
        return handleError(reply, error, 'List payments error:');
    }
}

export async function markPaymentPaid(request, reply) {
    try {
        const payment = paymentService.markPaid(request.params.id, request);
        return reply.send({ success: true, message: 'Pembayaran dikonfirmasi', data: payment });
    } catch (error) {
        return handleError(reply, error, 'Mark payment paid error:');
    }
}

export async function runCharges(request, reply) {
    try {
        const summary = billingService.runDailyCharges();
        logAdminAction({ action: 'billing_charges_run_manually', ...summary }, request);
        return reply.send({ success: true, data: summary });
    } catch (error) {
        return handleError(reply, error, 'Run charges error:');
    }
}
