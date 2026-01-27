/**
 * Sponsor Controller
 * Handles sponsor management endpoints
 */

import sponsorService from '../services/sponsorService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

/**
 * Get all sponsors (admin only)
 */
export async function getAllSponsors(request, reply) {
    try {
        const sponsors = sponsorService.getAllSponsors();
        
        return reply.send({
            success: true,
            data: sponsors
        });
    } catch (error) {
        console.error('Get sponsors error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengambil data sponsor'
        });
    }
}

/**
 * Get active sponsors (public)
 */
export async function getActiveSponsors(request, reply) {
    try {
        const sponsors = sponsorService.getActiveSponsors();
        
        return reply.send({
            success: true,
            data: sponsors
        });
    } catch (error) {
        console.error('Get active sponsors error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengambil data sponsor aktif'
        });
    }
}

/**
 * Get sponsor by ID
 */
export async function getSponsorById(request, reply) {
    try {
        const { id } = request.params;
        const sponsor = sponsorService.getSponsorById(id);
        
        if (!sponsor) {
            return reply.code(404).send({
                success: false,
                message: 'Sponsor tidak ditemukan'
            });
        }
        
        return reply.send({
            success: true,
            data: sponsor
        });
    } catch (error) {
        console.error('Get sponsor error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengambil data sponsor'
        });
    }
}

/**
 * Create new sponsor
 */
export async function createSponsor(request, reply) {
    try {
        const sponsorData = request.body;
        const result = sponsorService.createSponsor(sponsorData);
        
        // Audit log
        logAdminAction({
            action: 'sponsor_created',
            sponsor_id: result.lastInsertRowid,
            sponsor_name: sponsorData.name,
            package: sponsorData.package,
            userId: request.user.id
        }, request);
        
        return reply.code(201).send({
            success: true,
            message: 'Sponsor berhasil ditambahkan',
            data: {
                id: result.lastInsertRowid
            }
        });
    } catch (error) {
        console.error('Create sponsor error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal menambahkan sponsor'
        });
    }
}

/**
 * Update sponsor
 */
export async function updateSponsor(request, reply) {
    try {
        const { id } = request.params;
        const sponsorData = request.body;
        
        // Check if sponsor exists
        const existingSponsor = sponsorService.getSponsorById(id);
        if (!existingSponsor) {
            return reply.code(404).send({
                success: false,
                message: 'Sponsor tidak ditemukan'
            });
        }
        
        sponsorService.updateSponsor(id, sponsorData);
        
        // Audit log
        logAdminAction({
            action: 'sponsor_updated',
            sponsor_id: id,
            sponsor_name: sponsorData.name || existingSponsor.name,
            changes: sponsorData,
            userId: request.user.id
        }, request);
        
        return reply.send({
            success: true,
            message: 'Sponsor berhasil diperbarui'
        });
    } catch (error) {
        console.error('Update sponsor error:', error);
        return reply.code(500).send({
            success: false,
            message: error.message || 'Gagal memperbarui sponsor'
        });
    }
}

/**
 * Delete sponsor
 */
export async function deleteSponsor(request, reply) {
    try {
        const { id } = request.params;
        
        // Check if sponsor exists
        const existingSponsor = sponsorService.getSponsorById(id);
        if (!existingSponsor) {
            return reply.code(404).send({
                success: false,
                message: 'Sponsor tidak ditemukan'
            });
        }
        
        sponsorService.deleteSponsor(id);
        
        // Audit log
        logAdminAction({
            action: 'sponsor_deleted',
            sponsor_id: id,
            sponsor_name: existingSponsor.name,
            userId: request.user.id
        }, request);
        
        return reply.send({
            success: true,
            message: 'Sponsor berhasil dihapus'
        });
    } catch (error) {
        console.error('Delete sponsor error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal menghapus sponsor'
        });
    }
}

/**
 * Get sponsor statistics
 */
export async function getSponsorStats(request, reply) {
    try {
        const stats = sponsorService.getSponsorStats();
        const expiring = sponsorService.getExpiringSponsorships();
        
        return reply.send({
            success: true,
            data: {
                ...stats,
                expiring_soon: expiring
            }
        });
    } catch (error) {
        console.error('Get sponsor stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengambil statistik sponsor'
        });
    }
}

/**
 * Assign sponsor to camera
 */
export async function assignSponsorToCamera(request, reply) {
    try {
        const { cameraId } = request.params;
        const sponsorData = request.body;
        
        sponsorService.assignSponsorToCamera(cameraId, sponsorData);
        
        // Audit log
        logAdminAction({
            action: 'sponsor_assigned',
            camera_id: cameraId,
            sponsor_name: sponsorData.sponsor_name,
            sponsor_package: sponsorData.sponsor_package,
            userId: request.user.id
        }, request);
        
        return reply.send({
            success: true,
            message: 'Sponsor berhasil ditambahkan ke kamera'
        });
    } catch (error) {
        console.error('Assign sponsor error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal menambahkan sponsor ke kamera'
        });
    }
}

/**
 * Remove sponsor from camera
 */
export async function removeSponsorFromCamera(request, reply) {
    try {
        const { cameraId } = request.params;
        
        sponsorService.removeSponsorFromCamera(cameraId);
        
        // Audit log
        logAdminAction({
            action: 'sponsor_removed',
            camera_id: cameraId,
            userId: request.user.id
        }, request);
        
        return reply.send({
            success: true,
            message: 'Sponsor berhasil dihapus dari kamera'
        });
    } catch (error) {
        console.error('Remove sponsor error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal menghapus sponsor dari kamera'
        });
    }
}

/**
 * Get cameras with sponsors
 */
export async function getCamerasWithSponsors(request, reply) {
    try {
        const cameras = sponsorService.getCamerasWithSponsors();
        
        return reply.send({
            success: true,
            data: cameras
        });
    } catch (error) {
        console.error('Get cameras with sponsors error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengambil data kamera dengan sponsor'
        });
    }
}
