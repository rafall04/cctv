/*
 * Purpose: Provide pure ranking helpers for public area pages.
 * Caller: AreaPublicPage and related public area tests.
 * Deps: geoDistance.sortCamerasByDistance for distance-first related ordering.
 * MainFuncs: getAreaCameraLiveViewers, getAreaCameraTotalViews, buildAreaPublicRankingLists.
 * SideEffects: None.
 */

import { sortCamerasByDistance } from './geoDistance.js';

export function getAreaCameraLiveViewers(camera) {
    return Number(camera?.live_viewers || camera?.viewer_stats?.live_viewers || 0);
}

export function getAreaCameraTotalViews(camera) {
    return Number(camera?.total_views || camera?.viewer_stats?.total_views || 0);
}

function sortByNewest(left, right) {
    const rightCreated = String(right?.created_at || '');
    const leftCreated = String(left?.created_at || '');
    const byCreated = rightCreated.localeCompare(leftCreated);
    if (byCreated !== 0) {
        return byCreated;
    }

    return Number(right?.id || 0) - Number(left?.id || 0);
}

/*
 * Daftar kurasi ("Paling Sering Dibuka", "Kamera Baru") adalah JALAN PINTAS ke dalam grid yang
 * panjang. Ia berhenti jadi jalan pintas begitu ia mencakup hampir seluruh gridnya.
 *
 * Terukur di DS DANDER (8 kamera, 2026-08-26): kedua daftar itu memakan 1.008px dari halaman
 * setinggi 4.431px — 27% — untuk menampilkan kamera yang SAMA dengan grid di bawahnya, dalam
 * bentuk kartu teks tanpa thumbnail. Dari 9 kemunculan kamera hanya 7 unik: dua kamera bahkan
 * muncul dua kali di antara kedua daftar itu sendiri. Grid bergambar baru dimulai di 1.696px,
 * lebih dari dua layar ke bawah.
 *
 * Ambangnya bukan angka cantik: di bawah 12 kamera, gridnya sendiri kurang dari empat layar dan
 * menggulirnya lebih murah daripada membaca dua daftar teks yang mengulang isinya. Di atas itu,
 * menyorot 8 dari 12+ benar-benar menghemat gulir.
 */
export const CURATED_MIN_CAMERAS = 12;

export function buildAreaPublicRankingLists(cameras = [], trendingCameras = [], selectedCamera = null) {
    // "Sedang Ramai" TIDAK ikut ambang: ia menjawab pertanyaan yang tidak dijawab grid mana pun —
    // "ada yang sedang menonton ini SEKARANG" — dan ia menyembunyikan dirinya sendiri saat nol.
    const liveCameras = [...cameras]
        .filter((camera) => getAreaCameraLiveViewers(camera) > 0)
        .sort((left, right) => getAreaCameraLiveViewers(right) - getAreaCameraLiveViewers(left))
        .slice(0, 4);

    const cukupUntukKurasi = cameras.length >= CURATED_MIN_CAMERAS;

    const topSource = trendingCameras.length ? trendingCameras : cameras;
    const topCameras = cukupUntukKurasi
        ? [...topSource]
            .sort((left, right) => getAreaCameraTotalViews(right) - getAreaCameraTotalViews(left))
            .slice(0, 4)
        : [];

    // Disaring terhadap topCameras: kamera yang sudah disorot sebagai paling sering dibuka tidak
    // perlu disorot lagi dua kartu di bawahnya. Keduanya sempat menampilkan kamera yang sama.
    const sudahDisorot = new Set(topCameras.map((camera) => camera.id));
    const newestCameras = cukupUntukKurasi
        ? [...cameras]
            .filter((camera) => camera.created_at && !sudahDisorot.has(camera.id))
            .sort(sortByNewest)
            .slice(0, 4)
        : [];

    // Nearest-first from the playing camera; viewer ranking is the tiebreaker when distance
    // is equal or unavailable (cameras without coordinates fall back to this order).
    const rankByViewers = (left, right) => {
        const liveDelta = getAreaCameraLiveViewers(right) - getAreaCameraLiveViewers(left);
        if (liveDelta !== 0) {
            return liveDelta;
        }

        return getAreaCameraTotalViews(right) - getAreaCameraTotalViews(left);
    };

    const relatedPopupCameras = selectedCamera
        ? sortCamerasByDistance(
            cameras.filter((camera) => camera.id !== selectedCamera.id),
            selectedCamera,
            rankByViewers,
        ).slice(0, 5)
        : [];

    return {
        liveCameras,
        topCameras,
        newestCameras,
        relatedPopupCameras,
    };
}
