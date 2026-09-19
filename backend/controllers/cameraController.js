/**
 * Purpose: Shapes camera API responses for admin/public camera CRUD, source lifecycle, import, restore, and bulk flows.
 * Caller: backend/routes/cameraRoutes.js.
 * Deps: cameraService.
 * MainFuncs: getAllCameras, getActiveCameras, getPlaybackCameras, createCamera, updateCamera, refreshCameraStream, getCameraSourceLifecycleEvents.
 * SideEffects: Delegates camera mutations and lifecycle recovery to cameraService.
 */

import cameraService from '../services/cameraService.js';
import billingService from '../services/billingService.js';
import bulkRecordingDurationUpdater from '../services/recordingRetentionBulkService.js';
import { stripUrlCredentials } from '../utils/logRedaction.js';

// URL-valued columns in the admin camera list that may embed third-party credentials
// (`https://user:pass@host/...`). Same rule as getCameraById: only admins ever need them.
const CREDENTIAL_BEARING_URL_FIELDS = [
    'external_hls_url',
    'external_stream_url',
    'external_embed_url',
    'external_snapshot_url',
];

// Get all cameras (any authenticated staff role - includes disabled cameras).
// The list is viewer-accessible (Camera Management page), so non-admins get the same
// record minus the secrets: `stream_key` (the HLS path for private cameras) and any
// embedded userinfo in external URLs. Admin keeps the full record for the edit form.
export async function getAllCameras(request, reply) {
    try {
        const cameras = cameraService.getAdminCameraList();
        if (request.user?.role === 'admin') {
            return reply.send({ success: true, data: cameras });
        }
        // Copy before stripping: getAdminCameraList() is served from a shared cache, so
        // mutating the returned objects would poison it for admins too.
        const sanitized = cameras.map((camera) => {
            const copy = { ...camera };
            delete copy.stream_key;
            for (const field of CREDENTIAL_BEARING_URL_FIELDS) {
                if (copy[field]) {
                    copy[field] = stripUrlCredentials(copy[field]);
                }
            }
            return copy;
        });
        return reply.send({ success: true, data: sanitized });
    } catch (error) {
        console.error('Get all cameras error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get active cameras (public - only enabled cameras, no RTSP URLs)
export async function getActiveCameras(request, reply) {
    try {
        const view = request.query?.view === 'map' ? 'map' : 'landing';
        const cameras = view === 'map'
            ? cameraService.getPublicMapCameraList()
            : cameraService.getPublicLandingCameraList();
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Get active cameras error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Slim camera list for the playback picker (optional auth). Admin gets every recording
// camera; anonymous/token callers get the community archive only — the scoping itself
// lives in cameraService.getPlaybackCameraList.
export async function getPlaybackCameras(request, reply) {
    try {
        const cameras = cameraService.getPlaybackCameraList(request.user);
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Get playback cameras error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get one camera in full. Requires a login; credentials are stripped for non-admins (see below).
export async function getCameraById(request, reply) {
    try {
        const { id } = request.params;
        const camera = cameraService.getCameraDetailById(id);

        /*
         * `getCameraDetailById` is a `SELECT c.*`, so the row carries private_rtsp_url — which
         * embeds the camera's username:password — and stream_key. This route requires a login but
         * NOT requireAdmin (the comment above claiming 'admin only' was describing an intention,
         * not the route), and `viewer` is a real staff role: cameraAccessService.STAFF_ROLES is
         * {admin, viewer}, and the Camera Management page is reachable by both. So every viewer
         * account could read every camera's RTSP credentials — against the Critical Invariant that
         * RTSP URLs never reach the frontend at all.
         *
         * Gating the route would have been wrong: viewers are meant to open that page. What they
         * are not meant to do is EDIT — PUT /:id does carry requireAdmin — so the credentials are
         * only ever needed by an admin filling the edit form. Non-admins get the same record
         * without them.
         */
        if (camera && request.user?.role !== 'admin') {
            delete camera.private_rtsp_url;
            delete camera.stream_key;
        }

        return reply.send({ success: true, data: camera });
    } catch (error) {
        console.error('Get camera by ID error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Create new camera (admin only)
export async function createCamera(request, reply) {
    try {
        const result = await cameraService.createCamera(request.body, request);
        return reply.code(201).send({
            success: true,
            message: 'Camera created successfully',
            data: result,
        });
    } catch (error) {
        console.error('Create camera error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Update camera (admin only)
export async function updateCamera(request, reply) {
    try {
        const { id } = request.params;
        const result = await cameraService.updateCamera(id, request.body, request);

        // Recording carries a per-camera surcharge, so switching it changes what this camera
        // costs. Repricing lives here rather than in cameraService because billingService
        // imports cameraService — doing it the other way round would close an import cycle.
        // Only admins reach this route; customers cannot touch enable_recording at all.
        if (Object.prototype.hasOwnProperty.call(request.body || {}, 'enable_recording')) {
            billingService.repriceSubscriptionForCamera(Number(id));
        }

        return reply.send({
            success: true,
            message: 'Camera updated successfully',
            data: result,
        });
    } catch (error) {
        console.error('Update camera error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Delete camera (admin only)
export async function deleteCamera(request, reply) {
    try {
        const { id } = request.params;
        await cameraService.deleteCamera(id, request);
        return reply.send({ success: true, message: 'Camera deleted successfully' });
    } catch (error) {
        console.error('Delete camera error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Export cameras (admin only)
export async function exportCameras(request, reply) {
    try {
        const cameras = cameraService.getAllCameras();
        // Option to strip sensitive stuff like IDs, or keep them if needed, we'll keep them as is for now for full exports.
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Export cameras error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Bulk delete by Area (admin only)
export async function bulkDeleteByArea(request, reply) {
    try {
        const { areaId } = request.params;
        const result = await cameraService.bulkDeleteArea(areaId, request);
        return reply.send({ success: true, message: 'Bulk delete successful', data: result });
    } catch (error) {
        console.error('Bulk delete error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Bulk update by Area (admin only)
export async function bulkUpdateByArea(request, reply) {
    try {
        const { areaId, ...bulkRequest } = request.body;
        const result = await cameraService.bulkUpdateArea(areaId, bulkRequest, request);
        return reply.send({ success: true, message: 'Bulk update successful', data: result });
    } catch (error) {
        console.error('Bulk update error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Bulk set recording_duration_hours by area / group / selected ids (admin only)
export async function bulkUpdateRecordingDuration(request, reply) {
    try {
        const result = await bulkRecordingDurationUpdater(request.body, request);
        return reply.send({ success: true, message: `Retensi diperbarui untuk ${result.updated} kamera`, data: result });
    } catch (error) {
        console.error('Bulk recording duration error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function refreshCameraStream(request, reply) {
    try {
        const { id } = request.params;
        const result = await cameraService.refreshCameraStream(id, request);
        return reply.send({
            success: true,
            message: 'Camera stream refreshed successfully',
            data: result,
        });
    } catch (error) {
        console.error('Refresh camera stream error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function getCameraSourceLifecycleEvents(request, reply) {
    try {
        const { id } = request.params;
        const events = cameraService.getCameraSourceLifecycleEvents(id);
        return reply.send({ success: true, data: events });
    } catch (error) {
        console.error('Get camera source lifecycle events error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Import cameras (admin only)
export async function importCameras(request, reply) {
    try {
        const result = await cameraService.importCamerasTransaction(request.body || {}, null, request);
        return reply.send({ success: true, message: 'Import successful', result });
    } catch (error) {
        console.error('Import cameras error:', error);
        if (error.statusCode === 400 || error.statusCode === 502) {
            return reply.code(error.statusCode).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: error.message || 'Internal server error' });
    }
}

export async function previewImportCameras(request, reply) {
    try {
        const result = await cameraService.previewImportCameras(request.body || {});
        return reply.send({ success: true, data: result });
    } catch (error) {
        console.error('Preview import cameras error:', error);
        if (error.statusCode === 400 || error.statusCode === 502) {
            return reply.code(error.statusCode).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function previewCameraRestore(request, reply) {
    try {
        const result = cameraService.previewCameraRestore(request.body || {});
        return reply.send({ success: true, data: result });
    } catch (error) {
        console.error('Preview camera restore error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function applyCameraRestore(request, reply) {
    try {
        const result = await cameraService.applyCameraRestore(request.body || {}, request);
        return reply.send({ success: true, message: 'Backup restore applied successfully', data: result });
    } catch (error) {
        console.error('Apply camera restore error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
