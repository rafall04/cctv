/*
 * Purpose: Rute admin untuk keadaan jam kamera di /api/admin/camera-time (requireAdmin).
 * Caller: adminRoutes (bersarang di prefix /api/admin) - server.js sudah di pagar 800 baris.
 * Deps: authMiddleware, cameraTimeStatusService.
 * MainFuncs: GET / (daftar + ringkasan), PUT /:id/onvif-credentials (kredensial darurat).
 * SideEffects: PUT menulis dua kolom kredensial; GET murni baca.
 *
 * Sengaja TIDAK ada endpoint "periksa sekarang". Penyelarasnya berbicara langsung ke perangkat
 * keras lewat ONVIF/ISAPI, dan satu tombol yang bisa ditekan berulang-ulang berarti belasan
 * kamera dibanjiri panggilan oleh siapa pun yang tidak sabar. Timer per jam sudah menjaga
 * semuanya, dan halaman ini menunjukkan hasilnya.
 *
 * Sandi ONVIF TIDAK PERNAH dikirim ke sini — yang dikirim hanya penanda apakah kolomnya terisi.
 */

import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import cameraTimeStatusService from '../services/cameraTimeStatusService.js';

export default async function cameraTimeRoutes(fastify) {
    fastify.addHook('preHandler', authMiddleware);
    fastify.addHook('preHandler', requireAdmin);

    fastify.get('/', async (request, reply) => {
        try {
            return reply.send({
                success: true,
                data: {
                    cameras: cameraTimeStatusService.getCameraTimeStatus(),
                    summary: cameraTimeStatusService.getCameraTimeSummary(),
                },
            });
        } catch (error) {
            console.error('Camera time status error:', error);
            return reply.code(500).send({ success: false, message: 'Internal server error' });
        }
    });

    /*
     * Kredensial ONVIF DARURAT untuk satu kamera.
     *
     * Kosongkan kedua kolom untuk kembali ke default (pakai kredensial RTSP) - itulah keadaan
     * yang benar untuk hampir semua kamera. Kolom ini hanya dibutuhkan bila firmware
     * memisahkan akun ONVIF dari akun utama, atau bila akun RTSP sengaja dibuat read-only.
     */
    fastify.put('/:id/onvif-credentials', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    username: { type: ['string', 'null'], maxLength: 128 },
                    password: { type: ['string', 'null'], maxLength: 256 },
                },
                additionalProperties: false,
            },
        },
    }, async (request, reply) => {
        const id = Number.parseInt(request.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return reply.code(400).send({ success: false, message: 'Camera id tidak valid' });
        }
        try {
            const { username, password } = request.body || {};
            const data = cameraTimeStatusService.setOnvifCredentials(id, { username, password });
            return reply.send({
                success: true,
                message: data.hasOnvifCredentials
                    ? 'Kredensial ONVIF khusus disimpan'
                    : 'Kredensial ONVIF dikosongkan - kembali memakai kredensial RTSP',
                data,
            });
        } catch (error) {
            const code = error.statusCode || 500;
            console.error('Set ONVIF credentials error:', error);
            return reply.code(code).send({
                success: false,
                message: code === 500 ? 'Internal server error' : error.message,
            });
        }
    });
}
