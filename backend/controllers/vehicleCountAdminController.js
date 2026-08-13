/**
 * Purpose: Admin handlers for per-camera vehicle-counting settings (/api/admin/vehicle-count).
 * Caller: routes/vehicleCountAdminRoutes.js.
 * Deps: vehicleCountConfigService, database/connectionPool.
 * MainFuncs: listCountCameras, listAvailableCameras, getCountCamera, saveCountCamera, removeCountCamera.
 * SideEffects: writes per-camera config files through the config service.
 */

import fs from 'fs';
import path from 'path';

import config from '../config/config.js';
import { query } from '../database/connectionPool.js';
import {
    bacaConfig,
    bentukBawaan,
    daftarConfig,
    hapusConfig,
    simpanConfig,
    tanpaSumber,
} from '../services/vehicleCountConfigService.js';

function sendError(reply, error, label) {
    const code = error.statusCode || 500;
    if (code === 500) console.error(`${label}:`, error);
    return reply.code(code).send({
        success: false,
        message: code === 500 ? 'Internal server error' : error.message,
    });
}

/**
 * Berjalan atau tidak dinilai dari KEMAJUAN (umur berkas statistik), bukan dari keberadaan
 * proses. Pelajaran mahal 2026-08-13: penghitung pernah "hidup" menurut systemd selama 5,5 jam
 * sambil tidak menghasilkan apa pun. Yang berarti bagi admin adalah apakah angkanya bertambah.
 */
function statusJalan(cameraId) {
    const { stateDir, staleAfterMs } = config.vehicleCount || {};
    if (!stateDir) return { berjalan: false, umurDetik: null };
    try {
        const { mtimeMs } = fs.statSync(path.join(stateDir, `cam${Number(cameraId)}.json`));
        const umur = Date.now() - mtimeMs;
        return { berjalan: umur <= (staleAfterMs || 120000), umurDetik: Math.round(umur / 1000) };
    } catch {
        return { berjalan: false, umurDetik: null };
    }
}

export async function listCountCameras(request, reply) {
    try {
        const configs = daftarConfig();
        if (!configs.length) return reply.send({ success: true, data: [] });
        const ids = configs.map((c) => Number(c.camera_id));
        const rows = query(
            `SELECT id, name, camera_class, enabled FROM cameras WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        const byId = new Map(rows.map((r) => [r.id, r]));
        return reply.send({
            success: true,
            // tanpaSumber: alamat upstream kamera tidak pernah ikut ke browser
            data: configs.map((c) => ({
                ...tanpaSumber(c),
                nama_kamera: byId.get(Number(c.camera_id))?.name || c.label || '',
                ...statusJalan(c.camera_id),
            })),
        });
    } catch (error) {
        return sendError(reply, error, 'List vehicle-count cameras error');
    }
}

/**
 * Kamera yang LAYAK dihitung. Sengaja dibatasi ke community + aktif: permukaan publik hanya
 * menampilkan kamera community, jadi menghitung kamera lain berarti membuat panel yang tidak
 * akan pernah terlihat siapa pun.
 */
export async function listAvailableCameras(request, reply) {
    try {
        const rows = query(
            `SELECT id, name, location, area_id, delivery_type
               FROM cameras
              WHERE camera_class = 'community' AND enabled = 1
              ORDER BY name`
        );
        const dipakai = new Set(daftarConfig().map((c) => Number(c.camera_id)));
        return reply.send({
            success: true,
            data: rows.map((r) => ({ ...r, sudah_diatur: dipakai.has(r.id) })),
        });
    } catch (error) {
        return sendError(reply, error, 'List available counting cameras error');
    }
}

export async function getCountCamera(request, reply) {
    try {
        const id = Number(request.params.cameraId);
        const tersimpan = bacaConfig(id);
        // Kamera yang belum pernah diatur mengembalikan bentuk bawaan, bukan 404: panel butuh
        // sesuatu untuk diisi, dan "belum ada" bukan kesalahan.
        return reply.send({
            success: true,
            data: { ...tanpaSumber(tersimpan || bentukBawaan(id)), ...statusJalan(id) },
        });
    } catch (error) {
        return sendError(reply, error, 'Get vehicle-count camera error');
    }
}

export async function saveCountCamera(request, reply) {
    try {
        const data = simpanConfig(request.params.cameraId, request.body || {});
        return reply.send({
            success: true,
            message: 'Setelan penghitungan tersimpan',
            data: tanpaSumber(data),
        });
    } catch (error) {
        return sendError(reply, error, 'Save vehicle-count camera error');
    }
}

export async function removeCountCamera(request, reply) {
    try {
        const ok = hapusConfig(request.params.cameraId);
        return reply.send({
            success: true,
            message: ok ? 'Setelan dihapus' : 'Tidak ada setelan untuk dihapus',
        });
    } catch (error) {
        return sendError(reply, error, 'Remove vehicle-count camera error');
    }
}
