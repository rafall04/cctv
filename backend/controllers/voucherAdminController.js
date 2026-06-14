/**
 * Purpose: Admin management of the voucher area-access feature — global flag, per-area gating toggle,
 *          voucher-profile CRUD, and code generation/listing/revocation. Thin glue over voucherService.
 * Caller: voucherAdminRoutes (/api/admin/voucher/*, requireAdmin).
 * Deps: voucherService.
 * MainFuncs: getVoucherSettings/updateVoucherSettings, setAreaGated, list/create/update/deleteProfile,
 *            generateCodes, listCodes, revokeCode.
 */

import voucherService from '../services/voucherService.js';

function mapError(error, reply, context) {
    if (error.statusCode === 400 || error.statusCode === 404) {
        return reply.code(error.statusCode).send({ success: false, message: error.message });
    }
    console.error(`Voucher admin ${context} error:`, error);
    return reply.code(500).send({ success: false, message: 'Internal server error' });
}

// ---- Global feature flag + gated-area overview ----

export async function getVoucherSettings(request, reply) {
    return reply.send({
        success: true,
        data: {
            enabled: voucherService.isFeatureEnabled(),
            gated_area_ids: voucherService.listGatedAreaIds(),
        },
    });
}

export async function updateVoucherSettings(request, reply) {
    const { enabled } = request.body || {};
    const result = voucherService.setFeatureEnabled(enabled, request);
    return reply.send({
        success: true,
        data: { enabled: result.enabled, gated_area_ids: voucherService.listGatedAreaIds() },
    });
}

// ---- Per-area "berbayar" toggle ----

export async function setAreaGated(request, reply) {
    try {
        const { gated } = request.body || {};
        const result = voucherService.setAreaGated(Number(request.params.id), gated, request);
        return reply.send({ success: true, data: result });
    } catch (error) {
        return mapError(error, reply, 'setAreaGated');
    }
}

// ---- Voucher profiles ----

export async function listProfiles(request, reply) {
    return reply.send({ success: true, data: voucherService.listProfiles() });
}

export async function createProfile(request, reply) {
    try {
        return reply.send({ success: true, data: voucherService.createProfile(request.body || {}, request) });
    } catch (error) {
        return mapError(error, reply, 'createProfile');
    }
}

export async function updateProfile(request, reply) {
    try {
        return reply.send({ success: true, data: voucherService.updateProfile(Number(request.params.id), request.body || {}, request) });
    } catch (error) {
        return mapError(error, reply, 'updateProfile');
    }
}

export async function deleteProfile(request, reply) {
    try {
        return reply.send({ success: true, data: voucherService.deleteProfile(Number(request.params.id), request) });
    } catch (error) {
        return mapError(error, reply, 'deleteProfile');
    }
}

// ---- Codes (admin-generate / komplimen + listing + revoke) ----

export async function generateCodes(request, reply) {
    try {
        const { count = 1, source = 'admin', buyer_name = null, buyer_phone = null } = request.body || {};
        const codes = voucherService.generateCodes(
            Number(request.params.id),
            count,
            { source, buyer_name, buyer_phone, createdBy: request.user?.id ?? null },
            request
        );
        return reply.send({ success: true, data: codes });
    } catch (error) {
        return mapError(error, reply, 'generateCodes');
    }
}

export async function listCodes(request, reply) {
    const { profileId = null, status = null, limit = 200 } = request.query || {};
    return reply.send({
        success: true,
        data: voucherService.listCodes({
            profileId: profileId ? Number(profileId) : null,
            status: status || null,
            limit: Number(limit) || 200,
        }),
    });
}

export async function revokeCode(request, reply) {
    try {
        return reply.send({ success: true, data: voucherService.revokeCode(Number(request.params.id), request) });
    } catch (error) {
        return mapError(error, reply, 'revokeCode');
    }
}

export default {
    getVoucherSettings,
    updateVoucherSettings,
    setAreaGated,
    listProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    generateCodes,
    listCodes,
    revokeCode,
};
