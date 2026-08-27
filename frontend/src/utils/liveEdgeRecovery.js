/*
 * Purpose: Satu jawaban untuk galat FATAL hls.js yang datang SESUDAH stream terbukti hidup.
 * Caller: components/MultiView/VideoPopup.jsx, components/MultiView/MultiViewVideoItem.jsx.
 * Deps: countDecodedFrames dari livePictureWatch.js.
 * MainFuncs: resumeAtLiveEdgeOrFail.
 * SideEffects: Menggeser video.currentTime dan memanggil hls.startLoad/recoverMediaError.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * hls.js memanggil stopLoad() SENDIRI pada setiap galat fatal, dan ia TIDAK PERNAH me-retry 4xx
 * ("Do not retry on status 4xx" di utils/error-helper.ts). Jadi SATU segmen live yang kedaluwarsa
 * (404/410) mematikan pemuatan secara permanen. Sesudah itu tidak ada yang menghidupkannya lagi:
 * tenggat pemuatan sudah dilucuti saat go-live. Watchdog gambar-hidup kini MELIHAT bentuk ini
 * (playhead beku, bukan bingkai macet) dan melaporkannya ke sini lewat onFrozen - tetapi ia
 * hanya melapor sesudah 20 detik, sedangkan jalur galat di bawah menjawab seketika.
 *
 * Dulu kedua pemutar membuang galat itu lewat `if (... || isLive) return;`. Karena stopLoad()
 * berjalan LEBIH DULU, gerbang itu bukan cuma membuang laporan - ia membuang satu-satunya
 * kesempatan tersisa untuk memanggil startLoad(). Hasilnya: bingkai beku di bawah lencana LIVE
 * hijau, tanpa satu pun tombol, selamanya. Gejalanya muncul 6-18 detik SESUDAH sebabnya (panjang
 * buffer), jadi tidak ada apa pun di layar yang bertepatan dengan penyebabnya.
 *
 * ATURAN MODUL INI
 * ----------------
 * 1. Galat NON-fatal tidak pernah disentuh - hls.js memang sedang memulihkannya sendiri, dan
 *    bertindak atas galat non-fatal persis yang menimbulkan regresi 2026-08-17.
 * 2. Tidak ada timer. Semua dipicu event ERROR, jadi ini secara struktural tidak bisa jadi badai.
 * 3. Setiap galat fatal BERAKHIR: dilanjutkan atau divonis. Tidak ada yang dibuang diam-diam -
 *    membuang satu = beku permanen, yaitu persis bug yang sedang diperbaiki.
 * 4. Sesudah live, "codec tidak didukung" adalah kebohongan (perangkat ini BARU SAJA mendekode
 *    stream ini) dan vonis codec ber-canRetry:false. Vonisnya selalu 'stalled' - amber, dan ADA
 *    tombol coba lagi.
 */

import { countDecodedFrames } from './livePictureWatch.js';

/*
 * Playlist-nya sendiri yang hilang = sumbernya mati. Melanjutkan pemuatan tidak bisa menolong,
 * hanya menunda panel yang jujur. Detail SEGMEN (fragLoadError) sengaja TIDAK ada di sini:
 * di situ playlist-nya masih hidup, yang tertinggal cuma playhead-nya.
 */
const SOURCE_GONE = [
    'manifestLoadError', 'manifestParsingError', 'manifestIncompatibleCodecsError',
    'levelLoadError', 'levelEmptyError', 'levelParsingError',
];

/**
 * Berapa detik data yang sudah tersedia DI DEPAN playhead.
 *
 * Ini yang memisahkan dua bentuk playhead beku yang butuh obat berbeda: kalau datanya SUDAH ADA
 * dan playhead tetap tidak bergerak, yang macet dekodernya - memuat ulang segmen tidak menolong,
 * dekodernya yang harus dibangun ulang. Kalau tidak ada data di depan, itu kelaparan: pemuatannya
 * yang harus dihidupkan lagi.
 */
function detikDiDepan(video) {
    const b = video?.buffered;
    if (!b?.length) return 0;
    const t = video.currentTime;
    for (let i = 0; i < b.length; i += 1) {
        if (t >= b.start(i) - 0.1 && t <= b.end(i)) return b.end(i) - t;
    }
    return 0;
}

/** Playhead beku dilaporkan watchdog gambar-hidup; bukan galat hls.js, jadi detailnya kita sendiri. */
export const PLAYHEAD_FROZEN = 'playheadFrozen';

/** Berapa kali boleh melanjutkan sebelum bukti kemajuan baru dituntut. */
export const MAX_RESUMES_PER_EPISODE = 3;
/** Batas keras seumur satu instans hls, supaya stream yang bolak-balik tidak melanjut selamanya. */
export const MAX_RESUMES_PER_INSTANCE = 30;

/**
 * Jawab satu galat hls.js yang datang sesudah stream terbukti hidup.
 *
 * @param {Object} d - payload Events.ERROR hls.js
 * @param {Object} ctx
 * @param {Object} ctx.hls - instans hls.js yang sedang berjalan (menyimpan anggaran di sini)
 * @param {HTMLVideoElement} ctx.video
 * @param {Object} [ctx.HlsErrorTypes] - `HlsClass.ErrorTypes`, dioper seperti classifyHlsError
 * @param {(el: HTMLVideoElement) => void} [ctx.requestPlay]
 * @param {(d: Object) => void} [ctx.onGiveUp] - vonis pemanggil. WAJIB 'stalled', bukan 'codec'.
 */
export function resumeAtLiveEdgeOrFail(d, { hls, video, HlsErrorTypes, requestPlay, onGiveUp } = {}) {
    if (!d?.fatal) return;                                   // hls.js masih memulihkannya sendiri
    if (!hls || !video) { onGiveUp?.(d); return; }
    if (SOURCE_GONE.includes(d.details)) { onGiveUp?.(d); return; }

    /*
     * Isi ulang anggaran hanya atas BUKTI, bukan atas sepi: penghitung bingkai harus MAJU melewati
     * nilai yang dicatat saat melanjutkan terakhir.
     *
     * Sengaja `>` dan bukan `!==` - kebalikan dari livePictureWatch, dan alasannya juga kebalikan.
     * Di sana penghitung yang MUNDUR berarti "dekoder baru, jangan divonis"; di sini penghitung
     * yang mundur (pipeline dibangun ulang oleh recoverMediaError) BUKAN bukti ada gambar baru,
     * jadi ia tidak boleh mengisi ulang anggaran.
     *
     * `frames === null` berarti browsernya menolak menjawab (sebagian Safari). Tidak tahu bukan
     * bukti, jadi anggarannya tidak diisi ulang - bukan dianggap nol.
     */
    const frames = countDecodedFrames(video);
    if (frames !== null && hls._liveEdgeFrames != null && frames > hls._liveEdgeFrames) {
        hls._liveEdgeResumes = 0;
    }

    hls._liveEdgeResumes = (hls._liveEdgeResumes || 0) + 1;
    hls._liveEdgeTotal = (hls._liveEdgeTotal || 0) + 1;
    if (hls._liveEdgeResumes > MAX_RESUMES_PER_EPISODE
        || hls._liveEdgeTotal > MAX_RESUMES_PER_INSTANCE) {
        onGiveUp?.(d);
        return;
    }
    hls._liveEdgeFrames = frames;

    // Playhead beku sementara datanya SUDAH ada di depan: dekodernya yang macet, bukan
    // segmennya yang hilang. Ambang 1 detik supaya sisa buffer sekejap tidak terbaca sebagai
    // "ada data" pada stream yang sebenarnya kelaparan.
    const dekoderMacet = d.details === PLAYHEAD_FROZEN && detikDiDepan(video) > 1;
    if (dekoderMacet || (HlsErrorTypes && d.type === HlsErrorTypes.MEDIA_ERROR)) {
        /*
         * Buffer BERISI tapi dekodernya macet. startLoad tidak membangun ulang dekoder;
         * recoverMediaError ya. Mengarahkan kasus ini ke startLoad berarti galat yang sama
         * berulang sampai anggarannya habis.
         */
        hls.recoverMediaError();
        requestPlay?.(video);
        return;
    }

    /*
     * WAJIB argumen numerik. `hls.startLoad()` tanpa argumen sama dengan startLoad(-1), dan -1
     * DIGANTI hls.js dengan lastCurrentTime - posisi basi yang barusan 404. Itu resep 404
     * berulang, dan itu cacat yang sudah ada di jalur pemulihan eksternal sebelumnya.
     *
     * liveSyncPosition sudah dijepit hls.js supaya tidak pernah melewati tepi playlist yang
     * diketahui, jadi ia tidak bisa mengarahkan playhead ke segmen yang belum ada.
     */
    const target = hls.liveSyncPosition;
    if (!Number.isFinite(target)) { onGiveUp?.(d); return; }

    console.log(`[liveEdge] lanjut ${hls._liveEdgeResumes}/${MAX_RESUMES_PER_EPISODE} sesudah ${d.details} -> ${target.toFixed(1)}s`);
    video.currentTime = target;       // seek DULU supaya lastCurrentTime hls.js ikut maju
    hls.startLoad(target);
    requestPlay?.(video);
}

export default resumeAtLiveEdgeOrFail;
