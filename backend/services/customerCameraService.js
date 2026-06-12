/**
 * Purpose: Customer self-service camera CRUD — bounded by the account plan's max_cameras,
 *          RTSP URL policy-checked, always subscriber-class, never exposing other tenants.
 * Caller: customerRoutes (POST/PUT/DELETE /api/customer/cameras*).
 * Deps: connectionPool, cameraService (create/update/delete + MediaMTX sync),
 *       billingService (subscription wiring), billingPlanService (plan/limit state),
 *       rtspUrlPolicy.
 * MainFuncs: createOwnCamera, updateOwnCamera, deleteOwnCamera.
 * SideEffects: Creates/updates/deletes cameras + camera_subscriptions; MediaMTX path changes
 *              happen inside cameraService.
 */

import { queryOne, execute } from '../database/connectionPool.js';
import cameraService from './cameraService.js';
import billingService from './billingService.js';
import billingPlanService from './billingPlanService.js';
import { invalidateCameraAccessCache } from './cameraAccessService.js';
import { validateCustomerRtspUrl } from '../utils/rtspUrlPolicy.js';

function parseIsPublic(value) {
    return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

// Customers PICK from the admin-curated public areas (which carry the real geo:
// desa/kelurahan/kecamatan + map point) — they never create areas, so there's a single
// shared "Dander" instead of admin's + a customer duplicate. Subscriber cameras with a
// public area_id stay hidden from every public surface via the camera_class='community'
// filter, so reusing area_id is safe. '' / null clears it.
function resolveAreaId(areaId) {
    if (areaId === undefined || areaId === null || areaId === '') {
        return null;
    }
    const id = Number(areaId);
    if (!Number.isInteger(id) || id <= 0) {
        throw badRequest('Area tidak valid');
    }
    if (!queryOne('SELECT id FROM areas WHERE id = ?', [id])) {
        throw badRequest('Area tidak ditemukan');
    }
    return id;
}

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function assertOwnCamera(userId, cameraId) {
    const camera = queryOne(
        'SELECT id, name, owner_user_id, camera_class FROM cameras WHERE id = ?',
        [cameraId]
    );
    if (!camera || Number(camera.owner_user_id) !== Number(userId)) {
        const err = new Error('Kamera tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }
    return camera;
}

function normalizeTextField(value, { label, min = 0, max = 120, required = false } = {}) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    if (!text) {
        if (required) {
            throw badRequest(`${label} wajib diisi`);
        }
        return null;
    }
    if (text.length < min) {
        throw badRequest(`${label} minimal ${min} karakter`);
    }
    if (text.length > max) {
        throw badRequest(`${label} maksimal ${max} karakter`);
    }
    return text;
}

// Parse an optional coordinate. Empty → null (clears it); non-numeric or out-of-range
// → 400 with a friendly message instead of silently dropping to null like the admin path.
function parseCoordinate(value, { label, min, max } = {}) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
        throw badRequest(`${label} tidak valid`);
    }
    if (num < min || num > max) {
        throw badRequest(`${label} harus antara ${min} dan ${max}`);
    }
    return num;
}

class CustomerCameraService {
    async createOwnCamera(user, data, request) {
        const planState = billingPlanService.getUserPlanState(user.id);
        if (!planState.plan) {
            throw badRequest('Akun belum punya paket — pilih paket dulu di menu Paket');
        }
        if (planState.trial_expired) {
            throw badRequest('Trial sudah berakhir — upgrade ke paket berbayar untuk menambah kamera');
        }
        if (planState.used_cameras >= planState.max_cameras) {
            throw badRequest(`Paket ${planState.plan.name} maksimal ${planState.max_cameras} kamera — upgrade paket untuk menambah`);
        }

        const name = normalizeTextField(data.name, { label: 'Nama kamera', min: 2, max: 100, required: true });
        const location = normalizeTextField(data.location, { label: 'Lokasi', max: 120 });
        const description = normalizeTextField(data.description, { label: 'Deskripsi', max: 200 });
        const latitude = parseCoordinate(data.latitude, { label: 'Latitude', min: -90, max: 90 });
        const longitude = parseCoordinate(data.longitude, { label: 'Longitude', min: -180, max: 180 });
        // Chosen from the admin-curated public areas (validated to exist), or null.
        const areaId = resolveAreaId(data.area_id);
        const isPublic = parseIsPublic(data.is_public);
        const rtsp = validateCustomerRtspUrl(data.private_rtsp_url);
        if (!rtsp.ok) {
            throw badRequest(rtsp.message);
        }

        // cameraService handles stream_key generation, MediaMTX path add, cache busts,
        // area_id storage, and the audit log (request.user = the customer — truthful trail).
        const created = await cameraService.createCamera({
            name,
            private_rtsp_url: rtsp.url,
            description,
            location,
            latitude,
            longitude,
            area_id: areaId,
            enabled: 1,
            stream_source: 'internal',
            delivery_type: 'internal_hls',
        }, request);

        // Publish flag (subscriber-only column; default private). Shows on the public hub
        // only while actively paid — enforced by PUBLIC_LIVE_SQL + canViewLive.
        if (isPublic) {
            execute('UPDATE cameras SET is_public = 1 WHERE id = ?', [created.id]);
            invalidateCameraAccessCache(created.id);
        }

        // Tenancy + billing wiring: subscriber class, owner, plan-priced subscription
        // (day-one charge / trial handling happens inside assignSubscription).
        const subscription = billingService.assignSubscription({
            camera_id: created.id,
            user_id: user.id,
            monthly_price: planState.plan.price_per_camera,
        }, request);

        return {
            id: created.id,
            name,
            area_id: areaId,
            is_public: isPublic,
            subscription_status: subscription?.status || 'active',
        };
    }

    async updateOwnCamera(user, cameraId, data, request) {
        assertOwnCamera(user.id, cameraId);

        const payload = {};
        if (data.name !== undefined) {
            payload.name = normalizeTextField(data.name, { label: 'Nama kamera', min: 2, max: 100, required: true });
        }
        if (data.location !== undefined) {
            payload.location = normalizeTextField(data.location, { label: 'Lokasi', max: 120 });
        }
        if (data.description !== undefined) {
            payload.description = normalizeTextField(data.description, { label: 'Deskripsi', max: 200 });
        }
        if (data.private_rtsp_url !== undefined) {
            const rtsp = validateCustomerRtspUrl(data.private_rtsp_url);
            if (!rtsp.ok) {
                throw badRequest(rtsp.message);
            }
            payload.private_rtsp_url = rtsp.url;
        }
        if (data.latitude !== undefined) {
            payload.latitude = parseCoordinate(data.latitude, { label: 'Latitude', min: -90, max: 90 });
        }
        if (data.longitude !== undefined) {
            payload.longitude = parseCoordinate(data.longitude, { label: 'Longitude', min: -180, max: 180 });
        }
        // Area is a normal camera field (public area_id, validated to exist); '' clears it.
        if (data.area_id !== undefined) {
            payload.area_id = resolveAreaId(data.area_id);
        }
        // is_public is a subscriber-only column handled outside cameraService; treat as a
        // valid standalone change so the customer can flip publish without editing anything else.
        const isPublicProvided = data.is_public !== undefined;

        if (Object.keys(payload).length === 0 && !isPublicProvided) {
            throw badRequest('Tidak ada field yang diubah');
        }

        if (Object.keys(payload).length > 0) {
            await cameraService.updateCamera(cameraId, payload, request);
        }
        if (isPublicProvided) {
            execute(
                'UPDATE cameras SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [parseIsPublic(data.is_public), cameraId]
            );
            // Take effect on public surfaces immediately (the access cache has a 30s TTL).
            invalidateCameraAccessCache(cameraId);
            cameraService.invalidateCameraCache();
        }
        return queryOne(
            'SELECT id, name, description, location, latitude, longitude, camera_class, billing_status, area_id, is_public FROM cameras WHERE id = ?',
            [cameraId]
        );
    }

    async deleteOwnCamera(user, cameraId, request) {
        const camera = assertOwnCamera(user.id, cameraId);

        // Drop the billing link first so a delete can never leave a charging
        // subscription behind; ledger history (wallet_transactions) is untouched.
        execute('DELETE FROM camera_subscriptions WHERE camera_id = ?', [cameraId]);
        await cameraService.deleteCamera(cameraId, request);

        return { id: Number(cameraId), name: camera.name };
    }
}

export default new CustomerCameraService();
