import { countDecodedFrames } from './livePictureWatch.js';

/**
 * Purpose: Translate an HTMLMediaElement error into the playback player's error variant.
 * Caller: pages/Playback.jsx.
 * Deps: none — pure mapping over MediaError.code.
 * MainFuncs: classifyPlaybackMediaError.
 * SideEffects: None.
 *
 * WHY THIS EXISTS
 * ---------------
 * Playback mapped only code 2 (NETWORK) and sent everything else to `null`, which renders the
 * generic "Video Tidak Tersedia". PlaybackVideo has carried a proper `codec` variant the whole
 * time — "Browser Anda tidak mendukung codec H.265/HEVC..." — and nothing could ever reach it:
 * `setErrorType` was never called with 'codec' anywhere in the page. Dead UI, and the one case it
 * was written for is the common one, since most of this fleet records H.265.
 *
 * Codes 3 and 4 are the two ways a browser says "I cannot play this file":
 *   3 MEDIA_ERR_DECODE            — accepted the container, then failed to decode it
 *   4 MEDIA_ERR_SRC_NOT_SUPPORTED — refused the resource outright
 * Neither is a network problem, and for a recording neither is retryable by waiting, so telling
 * the viewer which browser WILL play it is the only useful thing left to say.
 *
 * Code 1 (ABORTED) stays generic on purpose: that is usually our own code switching segments, not
 * a fault the viewer needs a verdict about.
 */
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/*
 * KODE 3 PADA REKAMAN YANG SUDAH TERBUKTI DIPUTAR BUKAN VONIS CODEC (2026-08-26).
 *
 * Ini bentuk yang sama persis dengan bug pemutar live yang baru saja diperbaiki: menyimpulkan
 * "browser Anda tidak mendukung H.265" dari perangkat yang BARU SAJA mendekode berkas itu.
 * Kalau penghitung bingkai sudah bergerak, dukungan codec-nya sudah terbukti secara empiris -
 * apa pun yang menghentikannya sesudah itu (dekoder direbut OS, berkas terpotong, memori habis)
 * bukan soal dukungan, dan vonis codec menyuruh pengunjung pindah browser tanpa guna.
 *
 * Kode 4 tetap 'codec': ia berarti sumbernya DITOLAK mentah-mentah, jadi ia tidak mungkin
 * datang sesudah ada bingkai yang ter-decode.
 *
 * countDecodedFrames dipinjam dari watchdog live, bukan ditulis ulang - ia sudah menangani
 * browser yang tidak melaporkan penghitung sama sekali (mengembalikan null, yang di sini berarti
 * "tidak tahu" dan karenanya tidak boleh dipakai membantah vonis).
 */
export function classifyPlaybackMediaError(mediaError, video) {
    const code = mediaError?.code;
    if (code === MEDIA_ERR_NETWORK) return 'network';
    if (code === MEDIA_ERR_DECODE && countDecodedFrames(video) > 0) return 'stalled';
    if (code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED) return 'codec';
    return null;
}
