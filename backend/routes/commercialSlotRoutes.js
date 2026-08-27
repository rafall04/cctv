/*
Purpose: Satu rute publik yang mengembalikan SATU penghuni untuk satu slot komersial.
Caller: backend/routes/commerceRoutes.js (dititipkan di sana, BUKAN didaftarkan dari server.js).
Deps: controllers/commercialSlotController.
MainFuncs: commercialSlotRoutes (default export, satu plugin Fastify).
SideEffects: Mendaftarkan satu rute GET. Tidak menyentuh basis data.

KENAPA DITITIPKAN DI commerceRoutes
-----------------------------------
server.js berada di 799 baris terhadap anggaran 800 — satu baris sisa, sementara satu pendaftaran
baru butuh dua (impor dan register). commerceRoutes.js dibuat persis untuk itu, dan rute ini
memang miliknya: ia adalah penengah DI ATAS kedua pohon yang sudah dikumpulkan di sana.

commerceRoutes.js menyatakan dirinya tidak boleh memuat rute sendiri, jadi rutenya tinggal di
berkas ini dan hanya pendaftarannya yang menumpang.

KENAPA TIDAK DI-CACHE
---------------------
Sama seperti rute resolve afiliasi: respons yang diputar ulang akan memutar ulang impresi yang
sudah dihitung untuknya, dan jawabannya bergantung pada kamera yang sedang ditonton. Handler-nya
menyetel Cache-Control: no-store sendiri; jangan pernah memasang cacheMiddleware ke sini.
*/

import { getCommercialSlot } from '../controllers/commercialSlotController.js';

const PUBLIC_BASE = '/api/public/slot';

export default async function commercialSlotRoutes(fastify) {
    /*
     * Muatannya adalah `{ kind, content }`, dan `content` persis payload publik yang sudah
     * dibentuk masing-masing layanan — daftar-izin buatan tangan yang sengaja TIDAK memuat
     * penargetan, jadwal, prioritas, statistik, maupun satu pun field kamera atau area. Slot
     * komersial publik tidak boleh menjadi cara mendaftar kamera.
     */
    fastify.get(PUBLIC_BASE, getCommercialSlot);
}
