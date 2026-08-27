/*
Purpose: Satu rute publik: angka jangkauan untuk halaman /dukungan.
Caller: backend/routes/commerceRoutes.js (dititipkan di sana, BUKAN dari server.js).
Deps: controllers/supportReachController.
MainFuncs: supportReachRoutes (default export, satu plugin Fastify).
SideEffects: Mendaftarkan satu rute GET. Tidak menyentuh basis data.

KENAPA DITITIPKAN DI commerceRoutes
-----------------------------------
Alasan yang sama seperti commercialSlotRoutes: server.js ada di 799 baris terhadap anggaran 800,
dan satu pendaftaran baru butuh dua baris. Rute ini memang milik "commerce" - ia melayani halaman
yang menjual penempatan komersial.
*/

import { getSupportReach } from '../controllers/supportReachController.js';

export default async function supportReachRoutes(fastify) {
    /*
     * Boleh di-cache lama: tiga agregat 30-hari tidak berubah dari menit ke menit, dan tidak ada
     * impresi yang dihitung di sini - berbeda dari rute slot, yang justru TIDAK boleh di-cache.
     */
    fastify.get('/api/public/support-reach', getSupportReach);
}
