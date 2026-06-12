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
import customerAreaService from './customerAreaService.js';
import { validateCustomerRtspUrl } from '../utils/rtspUrlPolicy.js';

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
        // Resolve to the customer's OWN area (or null). Throws if they reference an area
        // that isn't theirs — the per-tenant guard for the picker.
        const customerAreaId = customerAreaService.resolveOwnAreaId(user.id, data.customer_area_id);
        const rtsp = validateCustomerRtspUrl(data.private_rtsp_url);
        if (!rtsp.ok) {
            throw badRequest(rtsp.message);
        }

        // cameraService handles stream_key generation, MediaMTX path add, cache busts,
        // and the audit log (request.user = the customer — truthful trail).
        const created = await cameraService.createCamera({
            name,
            private_rtsp_url: rtsp.url,
            description,
            location,
            latitude,
            longitude,
            enabled: 1,
            stream_source: 'internal',
            delivery_type: 'internal_hls',
        }, request);

        // Private grouping link (subscriber-only column; never the public area_id).
        if (customerAreaId !== null) {
            execute('UPDATE cameras SET customer_area_id = ? WHERE id = ?', [customerAreaId, created.id]);
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
            customer_area_id: customerAreaId,
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
        // Area is a subscriber-only column handled outside cameraService; resolve to the
        // customer's OWN area (or null to clear). Treated as a valid standalone change.
        const areaProvided = data.customer_area_id !== undefined;
        const customerAreaId = areaProvided
            ? customerAreaService.resolveOwnAreaId(user.id, data.customer_area_id)
            : undefined;

        if (Object.keys(payload).length === 0 && !areaProvided) {
            throw badRequest('Tidak ada field yang diubah');
        }

        if (Object.keys(payload).length > 0) {
            await cameraService.updateCamera(cameraId, payload, request);
        }
        if (areaProvided) {
            execute(
                'UPDATE cameras SET customer_area_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [customerAreaId, cameraId]
            );
        }
        return queryOne(
            'SELECT id, name, description, location, latitude, longitude, camera_class, billing_status, customer_area_id FROM cameras WHERE id = ?',
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
