/**
 * Purpose: Admin billing handlers — customer overview, subscription assignment/lifecycle,
 *          camera class management, payment confirmation, manual top-up, ops charge trigger.
 * Caller: billingAdminRoutes (/api/admin/billing/*, requireAdmin).
 * Deps: connectionPool, billingService, walletService, paymentService.
 * MainFuncs: listCustomers, manualTopup, listSubscriptions, assignSubscription,
 *            updateSubscription, setCameraClass, listPayments, markPaymentPaid, runCharges.
 * SideEffects: Mutates billing tables via services; audit-logged inside the services.
 */

import { query, queryOne } from '../database/connectionPool.js';
import billingService from '../services/billingService.js';
import billingPlanService from '../services/billingPlanService.js';
import walletService from '../services/walletService.js';
import paymentService from '../services/paymentService.js';
import paymentSettingsService from '../services/paymentSettingsService.js';
import customerCameraIpService from '../services/customerCameraIpService.js';
import promoService from '../services/promoService.js';
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
                   u.plan_id, u.trial_ends_at, u.account_status,
                   bp.name AS plan_name, bp.key AS plan_key, bp.is_trial AS plan_is_trial,
                   bp.max_cameras AS plan_max_cameras,
                   COALESCE(w.balance, 0) AS balance,
                   (SELECT COUNT(*) FROM cameras c WHERE c.owner_user_id = u.id) AS camera_count,
                   (SELECT COUNT(*) FROM camera_subscriptions cs
                     WHERE cs.user_id = u.id AND cs.status = 'active') AS active_subscriptions,
                   (SELECT COUNT(*) FROM camera_subscriptions cs
                     WHERE cs.user_id = u.id AND cs.status = 'suspended') AS suspended_subscriptions
            FROM users u
            LEFT JOIN wallets w ON w.user_id = u.id
            LEFT JOIN billing_plans bp ON bp.id = u.plan_id
            WHERE u.role = 'customer'
            ORDER BY u.id ASC
        `);
        return reply.send({ success: true, data: customers });
    } catch (error) {
        return handleError(reply, error, 'List customers error:');
    }
}

export async function listPlansAdmin(request, reply) {
    try {
        return reply.send({ success: true, data: billingPlanService.listPlans() });
    } catch (error) {
        return handleError(reply, error, 'List plans error:');
    }
}

export async function createPlan(request, reply) {
    try {
        const plan = billingPlanService.createPlan(request.body || {}, request);
        return reply.send({ success: true, message: 'Paket dibuat', data: plan });
    } catch (error) {
        return handleError(reply, error, 'Create plan error:');
    }
}

export async function updatePlan(request, reply) {
    try {
        const plan = billingPlanService.updatePlan(request.params.id, request.body || {}, request);
        return reply.send({ success: true, message: 'Paket diperbarui', data: plan });
    } catch (error) {
        return handleError(reply, error, 'Update plan error:');
    }
}

export async function changeCustomerPlan(request, reply) {
    try {
        const state = billingPlanService.changeUserPlan(
            request.params.id,
            request.body?.plan_key ?? request.body?.plan_id,
            { byAdmin: true, request }
        );
        return reply.send({ success: true, message: 'Paket pelanggan diubah', data: state });
    } catch (error) {
        return handleError(reply, error, 'Change customer plan error:');
    }
}

export async function listRegistrations(request, reply) {
    try {
        return reply.send({ success: true, data: billingPlanService.listPendingRegistrations() });
    } catch (error) {
        return handleError(reply, error, 'List registrations error:');
    }
}

export async function approveRegistration(request, reply) {
    try {
        const result = billingPlanService.approveCustomer(request.params.id, request);
        return reply.send({ success: true, message: 'Pendaftaran disetujui', data: result });
    } catch (error) {
        return handleError(reply, error, 'Approve registration error:');
    }
}

export async function rejectRegistration(request, reply) {
    try {
        const result = billingPlanService.rejectCustomer(request.params.id, request);
        return reply.send({ success: true, message: 'Pendaftaran ditolak', data: result });
    } catch (error) {
        return handleError(reply, error, 'Reject registration error:');
    }
}

export async function getPaymentGateway(request, reply) {
    try {
        return reply.send({ success: true, data: paymentSettingsService.getAdminView() });
    } catch (error) {
        return handleError(reply, error, 'Get payment gateway error:');
    }
}

export async function updatePaymentGateway(request, reply) {
    try {
        const data = paymentSettingsService.updateConfig(request.body || {}, request);
        return reply.send({ success: true, message: 'Pengaturan gateway disimpan', data });
    } catch (error) {
        return handleError(reply, error, 'Update payment gateway error:');
    }
}

export async function testPaymentGateway(request, reply) {
    try {
        const result = await paymentService.testIpaymuConnection();
        return reply.send({ success: true, data: result });
    } catch (error) {
        return handleError(reply, error, 'Test payment gateway error:');
    }
}

export async function listPaymentGatewayChannels(request, reply) {
    try {
        const result = await paymentService.getIpaymuPaymentChannels();
        return reply.send({ success: true, data: result });
    } catch (error) {
        return handleError(reply, error, 'List payment gateway channels error:');
    }
}

// Public/private IP list of subscriber cameras for ISP-broadband routing (host/IP only,
// no RTSP credentials). DDNS hostnames are resolved best-effort.
export async function listCustomerCameraIps(request, reply) {
    try {
        const data = await customerCameraIpService.listEndpointsResolved();
        return reply.send({ success: true, data });
    } catch (error) {
        return handleError(reply, error, 'List customer camera IPs error:');
    }
}

export async function getRegistrationSettings(request, reply) {
    try {
        return reply.send({ success: true, data: billingPlanService.getRegistrationSettings() });
    } catch (error) {
        return handleError(reply, error, 'Get registration settings error:');
    }
}

export async function updateRegistrationSettings(request, reply) {
    try {
        const settings = billingPlanService.updateRegistrationSettings(request.body || {}, request);
        return reply.send({ success: true, message: 'Pengaturan registrasi disimpan', data: settings });
    } catch (error) {
        return handleError(reply, error, 'Update registration settings error:');
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

/**
 * Manual wallet correction: a signed `amount` (+credit goodwill / −debit refund). A debit
 * can never drive the balance negative; a credit re-resumes suspended cameras like a top-up.
 * Distinct from manualTopup (which only ever credits and is labelled as a payment top-up).
 */
export async function adjustWallet(request, reply) {
    try {
        const userId = Number(request.body?.user_id);
        const amount = Number(request.body?.amount); // signed: + credit, − debit/refund
        const reason = String(request.body?.reason || '').trim();
        const rp = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;

        if (!Number.isInteger(amount) || amount === 0) {
            return reply.code(400).send({ success: false, message: 'Nominal harus bilangan bulat selain 0' });
        }
        if (!reason) {
            return reply.code(400).send({ success: false, message: 'Alasan penyesuaian wajib diisi' });
        }
        const customer = queryOne("SELECT id, username FROM users WHERE id = ? AND role = 'customer'", [userId]);
        if (!customer) {
            return reply.code(404).send({ success: false, message: 'Pelanggan tidak ditemukan' });
        }
        if (amount < 0) {
            const balance = walletService.getBalance(userId);
            if (balance + amount < 0) {
                return reply.code(400).send({
                    success: false,
                    message: `Saldo pelanggan hanya ${rp(balance)} — tidak bisa dikurangi ${rp(Math.abs(amount))}`,
                });
            }
        }

        const result = walletService.adjust({
            userId,
            signedAmount: amount,
            reference: `adjust-admin:${request.user.id}:${Date.now()}`,
            note: `${amount > 0 ? 'Penyesuaian (+)' : 'Refund (−)'} oleh ${request.user.username}: ${reason}`,
        });

        // A credit may cover suspended cameras again — resume like a manual top-up does.
        const resume = amount > 0 ? billingService.tryResumeForUser(userId) : { resumedCameraIds: [] };

        logAdminAction({
            action: 'billing_wallet_adjusted',
            customerId: userId,
            amount,
            reason,
            resumedCameraIds: resume.resumedCameraIds,
        }, request);

        return reply.send({
            success: true,
            message: amount > 0 ? 'Saldo ditambahkan' : 'Saldo dikurangi (refund)',
            data: { ...result, resumed_camera_ids: resume.resumedCameraIds },
        });
    } catch (error) {
        return handleError(reply, error, 'Adjust wallet error:');
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

export async function healOrphans(request, reply) {
    try {
        const result = billingService.healOrphanedSubscriberCameras();
        logAdminAction({ action: 'billing_orphans_healed', ...result }, request);
        return reply.send({ success: true, message: `${result.healed} kamera yatim ditangani`, data: result });
    } catch (error) {
        return handleError(reply, error, 'Heal orphans error:');
    }
}

export async function listPromos(request, reply) {
    try {
        return reply.send({ success: true, data: promoService.listPromos() });
    } catch (error) {
        return handleError(reply, error, 'List promos error:');
    }
}

export async function createPromo(request, reply) {
    try {
        const promo = promoService.createPromo(request.body || {}, request);
        return reply.send({ success: true, message: 'Kode promo dibuat', data: promo });
    } catch (error) {
        return handleError(reply, error, 'Create promo error:');
    }
}

export async function updatePromo(request, reply) {
    try {
        const promo = promoService.updatePromo(request.params.id, request.body || {}, request);
        return reply.send({ success: true, message: 'Kode promo diperbarui', data: promo });
    } catch (error) {
        return handleError(reply, error, 'Update promo error:');
    }
}

export async function deletePromo(request, reply) {
    try {
        const result = promoService.deletePromo(request.params.id, request);
        return reply.send({ success: true, message: 'Kode promo dihapus', data: result });
    } catch (error) {
        return handleError(reply, error, 'Delete promo error:');
    }
}
