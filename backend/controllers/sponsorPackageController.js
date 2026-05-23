/*
Purpose: HTTP handlers for admin sponsor package catalog CRUD.
Caller: sponsorPackageRoutes mounted under /api/sponsor-packages.
Deps: sponsorPackageService, securityAuditLogger.
MainFuncs: listPackages, createPackage, updatePackage, deletePackage.
SideEffects: Writes admin-action audit rows on mutations.
*/

import sponsorPackageService from '../services/sponsorPackageService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

function envelope(error) {
    return {
        success: false,
        message: error?.statusCode ? error.message : 'Internal server error',
    };
}

export async function listPackages(request, reply) {
    try {
        const packages = sponsorPackageService.getAllPackages();
        const counts = sponsorPackageService.countSponsorsByKey();
        return reply.send({
            success: true,
            data: packages.map((pkg) => ({
                ...pkg,
                sponsor_count: counts[pkg.key] || 0,
            })),
        });
    } catch (error) {
        console.error('List sponsor packages error:', error);
        return reply.code(500).send({ success: false, message: 'Gagal memuat profil paket' });
    }
}

export async function createPackage(request, reply) {
    try {
        const pkg = sponsorPackageService.createPackage(request.body || {});
        logAdminAction({
            action: 'sponsor_package_created',
            package_key: pkg.key,
            package_name: pkg.name,
            userId: request.user?.id,
        }, request);
        return reply.code(201).send({ success: true, data: pkg });
    } catch (error) {
        console.error('Create sponsor package error:', error);
        return reply.code(error.statusCode || 500).send(envelope(error));
    }
}

export async function updatePackage(request, reply) {
    try {
        const pkg = sponsorPackageService.updatePackage(request.params.id, request.body || {});
        logAdminAction({
            action: 'sponsor_package_updated',
            package_key: pkg.key,
            changes: Object.keys(request.body || {}),
            userId: request.user?.id,
        }, request);
        return reply.send({ success: true, data: pkg });
    } catch (error) {
        console.error('Update sponsor package error:', error);
        return reply.code(error.statusCode || 500).send(envelope(error));
    }
}

export async function deletePackage(request, reply) {
    try {
        const result = sponsorPackageService.deletePackage(request.params.id);
        logAdminAction({
            action: 'sponsor_package_deleted',
            package_key: result.key,
            userId: request.user?.id,
        }, request);
        return reply.send({ success: true, data: result });
    } catch (error) {
        console.error('Delete sponsor package error:', error);
        return reply.code(error.statusCode || 500).send(envelope(error));
    }
}
