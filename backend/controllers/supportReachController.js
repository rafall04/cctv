/**
 * Purpose: Sajikan angka jangkauan publik untuk halaman /dukungan.
 * Caller: routes/supportReachRoutes.js.
 * Deps: services/supportReachService.
 * MainFuncs: getSupportReach.
 * SideEffects: Tidak ada. Hanya membaca.
 *
 * KENAPA GAGALNYA MENGEMBALIKAN NOL, BUKAN 500
 * --------------------------------------------
 * Halaman ini adalah jalur penjualan. Kalau agregatnya gagal dibaca, yang benar adalah halamannya
 * tetap tampil tanpa angka - bukan halaman galat di depan calon pendukung yang baru saja mengklik
 * tautan dari proposal. Komponennya menyembunyikan blok angka ketika nilainya nol, jadi "nol"
 * di sini berarti "jangan tampilkan", bukan "sungguh nol orang".
 */

import { getPublicReach } from '../services/supportReachService.js';

export async function getSupportReach(request, reply) {
    try {
        return reply.send({ success: true, data: getPublicReach() });
    } catch (error) {
        console.error('Support reach error:', error);
        return reply.send({
            success: true,
            data: { window_days: 30, sessions: 0, cameras: 0, areas: 0 },
        });
    }
}
