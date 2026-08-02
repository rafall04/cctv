/**
 * Purpose: Admin HTTP handlers for the public playback-access package catalogue.
 * Caller: adminRoutes (all behind authMiddleware + requireAdmin).
 * Deps: playbackProductService, securityAuditLogger.
 * MainFuncs: listPlaybackProducts, createPlaybackProduct, updatePlaybackProduct.
 * SideEffects: Writes playback_products; every mutation leaves an audit row.
 *
 * WHY THIS EXISTS
 * The catalogue could only be changed with hand-written SQL against the production database — the
 * service had updateProduct() and listAll() but nothing called them. That made a routine commercial
 * decision ("stop selling the monthly package", "raise the price") into a manual DB edit, which is
 * exactly the operation AGENTS.md tells us not to perform on production.
 *
 * WHY ENABLE/DISABLE IS THE ONLY WAY TO REMOVE A PACKAGE
 * There is deliberately no DELETE. playback_orders.product_id points at these rows, so deleting a
 * package would orphan the payment history that proves what a buyer was charged for. `enabled = 0`
 * already removes it from every public path — catalogue, trial claim, and order creation all check
 * it — so disabling achieves the operator's actual intent without destroying the receipt trail.
 */

import playbackProductService from '../services/playbackProductService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

function fail(reply, error, fallbackMessage, logLabel) {
    const code = error?.statusCode || 500;
    if (code === 500) console.error(logLabel, error);
    return reply.code(code).send({
        success: false,
        message: code === 500 ? fallbackMessage : error.message,
    });
}

/**
 * The ADMIN list, unlike the public one, returns disabled packages too — an operator cannot switch
 * something back on that the page refuses to show them.
 */
export async function listPlaybackProducts(request, reply) {
    try {
        /*
         * Coverage rides along with the list rather than sitting behind its own endpoint: the page
         * cannot render an honest catalogue without it, so a second request would only create a
         * window in which the two disagree.
         */
        return reply.send({
            success: true,
            data: {
                products: playbackProductService.listAll(),
                coverage: playbackProductService.getCoverage(),
            },
        });
    } catch (error) {
        return fail(reply, error, 'Gagal memuat daftar paket', 'List playback products error:');
    }
}

export async function createPlaybackProduct(request, reply) {
    try {
        const product = playbackProductService.createProduct(request.body || {});

        logAdminAction({
            action: 'playback_product_created',
            targetType: 'playback_product',
            targetId: product.id,
            adminUserId: request.user?.id,
            adminUsername: request.user?.username,
            product_key: product.key,
            price_rupiah: product.price_rupiah,
        }, request);

        return reply.send({
            success: true,
            message: 'Paket dibuat',
            data: playbackProductService.describeForAdmin(product),
        });
    } catch (error) {
        return fail(reply, error, 'Gagal membuat paket', 'Create playback product error:');
    }
}

export async function updatePlaybackProduct(request, reply) {
    try {
        const before = playbackProductService.getById(request.params.id);
        const product = playbackProductService.updateProduct(request.params.id, request.body || {});

        /*
         * Price and availability are recorded explicitly, before and after. "Someone edited package
         * 3" does not answer the question anyone actually asks later — which is whether a buyer was
         * charged the amount that was on display at the time.
         */
        logAdminAction({
            action: 'playback_product_updated',
            targetType: 'playback_product',
            targetId: product.id,
            adminUserId: request.user?.id,
            adminUsername: request.user?.username,
            product_key: product.key,
            price_before: before?.price_rupiah,
            price_after: product.price_rupiah,
            enabled_before: before?.enabled,
            enabled_after: product.enabled,
            window_hours_after: product.window_hours,
            validity_days_after: product.validity_days,
        }, request);

        return reply.send({
            success: true,
            message: 'Paket diperbarui',
            data: playbackProductService.describeForAdmin(product),
        });
    } catch (error) {
        return fail(reply, error, 'Gagal memperbarui paket', 'Update playback product error:');
    }
}
