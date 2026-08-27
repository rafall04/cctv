/**
 * Purpose: Ambil angka jangkauan publik untuk halaman /dukungan.
 * Caller: pages/SupportPage.jsx.
 * Deps: apiClient, requestPolicy.
 * MainFuncs: getPublicReach.
 * SideEffects: Satu GET saat halaman dibuka.
 *
 * Gagal itu SENYAP dan mengembalikan null. Halaman ini jalur penjualan: kalau angkanya tidak bisa
 * dibaca, yang benar adalah blok angkanya hilang, bukan pesan galat di depan calon pendukung yang
 * baru saja mengklik tautan dari proposal.
 */

import apiClient from './apiClient';
import { REQUEST_POLICY } from './requestPolicy';

const BASE = '/api/public/support-reach';

/**
 * @returns {Promise<{window_days:number, sessions:number, cameras:number, areas:number}|null>}
 */
export async function getPublicReach() {
    try {
        const response = await apiClient.get(BASE, { requestPolicy: REQUEST_POLICY.SILENT_PUBLIC });
        const data = response.data?.data;
        return data && typeof data.sessions === 'number' ? data : null;
    } catch {
        return null;
    }
}

export default { getPublicReach };
