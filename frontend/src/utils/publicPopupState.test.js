import { describe, expect, it } from 'vitest';
import {
    getPublicPopupErrorType,
    getPublicPopupInitialStatus,
    getPublicPopupOverlayState,
    getPublicPopupStatusDisplay,
    classifyHlsError,
    isCodecFailure,
    isPublicPopupPlaybackLocked,
    shouldShowPublicPopupRetry,
} from './publicPopupState.js';

describe('publicPopupState', () => {
    it('menghitung status awal dari kamera non-playable', () => {
        expect(getPublicPopupInitialStatus({ status: 'maintenance', is_online: 1 })).toBe('maintenance');
        expect(getPublicPopupInitialStatus({ status: 'active', is_online: 0 })).toBe('offline');
        expect(getPublicPopupInitialStatus({ status: 'active', is_online: 0, availability_state: 'degraded' })).toBe('connecting');
        expect(getPublicPopupInitialStatus({ status: 'active', is_online: 1 })).toBe('connecting');
    });

    it('mengklasifikasikan error HLS publik dengan konsisten', () => {
        expect(getPublicPopupErrorType({
            hlsError: { type: 'networkError', details: 'manifestLoadError' },
            streamSource: 'external',
        })).toBe('cors');

        expect(getPublicPopupErrorType({
            hlsError: { type: 'mediaError', details: 'manifestIncompatibleCodecsError' },
            streamSource: 'mediamtx',
        })).toBe('codec');

        /*
         * The buffer-level codec refusals. These are what hls.js reports when the manifest looked
         * fine but addSourceBuffer rejected the codec — the exact shape an H.265 stream takes on a
         * phone with no HEVC decoder. Missing from the list, they fell through to the generic
         * buckets and the viewer was told the CCTV was unreachable.
         */
        expect(getPublicPopupErrorType({
            hlsError: { type: 'mediaError', details: 'bufferAddCodecError' },
            streamSource: 'mediamtx',
        })).toBe('codec');

        expect(getPublicPopupErrorType({
            hlsError: { type: 'mediaError', details: 'bufferIncompatibleCodecsError' },
            streamSource: 'mediamtx',
        })).toBe('codec');

        expect(getPublicPopupErrorType({
            hlsError: { type: 'networkError', details: 'manifestLoadError' },
            streamSource: 'mediamtx',
        })).toBe('network');

        expect(getPublicPopupErrorType({
            hlsError: { type: 'mediaError', details: 'bufferStalledError' },
            streamSource: 'mediamtx',
        })).toBe('media');
    });

    it('menghasilkan overlay dan retry rules yang sesuai untuk state non-live', () => {
        const timeoutState = getPublicPopupOverlayState({ status: 'timeout', loadingStage: 'timeout', errorType: 'timeout' });
        expect(timeoutState.title).toBe('Loading Timeout');
        expect(timeoutState.canRetry).toBe(true);
        expect(shouldShowPublicPopupRetry({ status: 'timeout', errorType: 'timeout' })).toBe(true);

        const corsState = getPublicPopupOverlayState({ status: 'error', loadingStage: 'error', errorType: 'cors' });
        expect(corsState.title).toBe('Kamera Tidak Dapat Ditampilkan');
        expect(corsState.canRetry).toBe(true);
        expect(shouldShowPublicPopupRetry({ status: 'error', errorType: 'cors' })).toBe(true);
        expect(isPublicPopupPlaybackLocked('error')).toBe(true);
    });

    it('menghasilkan badge status yang sama untuk live dan maintenance', () => {
        expect(getPublicPopupStatusDisplay({
            status: 'live',
            loadingStage: 'playing',
            isTunnel: false,
        }).label).toBe('LIVE');

        expect(getPublicPopupStatusDisplay({
            status: 'maintenance',
            loadingStage: 'error',
            isTunnel: false,
        }).label).toBe('PERBAIKAN');

        expect(getPublicPopupStatusDisplay({
            status: 'degraded',
            loadingStage: 'buffering',
            isTunnel: false,
        }).label).toBe('TIDAK STABIL');
    });
});

/*
 * REGRESSION (2026-08-17): `isCodecFailure` runs ABOVE the caller's `if (!fatal) return` guard and
 * its callers answer by destroying the player, so anything it matches is UNRECOVERABLE by
 * construction. `fragParsingError` and `bufferAppendError` were briefly on the list; both are
 * ordinary recoverable media errors, so the first hiccup killed streams that had played for
 * months. Details and line numbers below are read from the hls.js 1.6.15 source this app ships.
 */
describe('isCodecFailure memisahkan vonis codec dari error yang bisa pulih', () => {
    it('mengenali vonis codec, termasuk yang datang NON-fatal', () => {
        // Yang memotivasi seluruh hoist: addSourceBuffer menolak codec, dilaporkan fatal:false
        // (hls.js dist:20213-20216). Tanpa ini pemutar menggantung di "Memuat stream".
        expect(isCodecFailure({ details: 'bufferAddCodecError', fatal: false })).toBe(true);
        expect(isCodecFailure({ details: 'manifestIncompatibleCodecsError', fatal: true })).toBe(true);
        expect(isCodecFailure({ details: 'bufferIncompatibleCodecsError', fatal: true })).toBe(true);
    });

    it('mengenali vonis codec dari teks alasan apa pun detailnya', () => {
        expect(isCodecFailure({ details: 'levelLoadError', reason: 'one or more CODECS in variant not supported' })).toBe(true);
        expect(isCodecFailure({ details: 'x', reason: 'HEVC not supported' })).toBe(true);
        expect(isCodecFailure({ details: 'x', reason: 'h265 decode failed' })).toBe(true);
    });

    it('TIDAK menghukum fragParsingError — itu segmen kosong sesaat, bukan codec', () => {
        // hls.js dist:10800 memancarkannya fatal:false dengan reason "Found no media in msn <n>".
        expect(isCodecFailure({
            details: 'fragParsingError',
            fatal: false,
            reason: 'Found no media in msn 1471 of level 0 "https://…/index.m3u8"',
        })).toBe(false);
    });

    it('TIDAK menghukum bufferAppendError — hls.js sendiri bersiap memulihkannya', () => {
        // dist:4262-4270 mereset pilihan level "so that a new selection can be made after
        // calling recoverMediaError". Menghancurkan pemutar di sini membuang pemulihan itu.
        expect(isCodecFailure({ details: 'bufferAppendError', fatal: false, sourceBufferName: 'video' })).toBe(false);
    });

    it('tidak tersinggung oleh error kosong atau tanpa detail', () => {
        expect(isCodecFailure(null)).toBe(false);
        expect(isCodecFailure(undefined)).toBe(false);
        expect(isCodecFailure({})).toBe(false);
        expect(isCodecFailure({ details: 'fragLoadError', fatal: true })).toBe(false);
    });
});

/*
 * REGRESSION: VideoPopup builds a SECOND hls.js instance in its fallback retry, and that handler
 * kept reusing the error type computed for the error that TRIGGERED the retry — so a network
 * failure on the retry could be reported as "Error Media". One shared classifier is what stops a
 * third dialect of this mapping from appearing the next time a player is added.
 */
describe('classifyHlsError menerjemahkan enum hls.js jadi tipe error popup', () => {
    const HlsErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };

    it('menerjemahkan tipe jaringan dan media', () => {
        expect(classifyHlsError({ type: 'networkError', details: 'fragLoadError' }, { HlsErrorTypes }))
            .toBe('network');
        expect(classifyHlsError({ type: 'mediaError', details: 'bufferStalledError' }, { HlsErrorTypes }))
            .toBe('media');
    });

    it('vonis codec tetap menang atas tipe apa pun', () => {
        expect(classifyHlsError({ type: 'mediaError', details: 'bufferAddCodecError' }, { HlsErrorTypes }))
            .toBe('codec');
    });

    it('stream eksternal yang gagal jaringan dilaporkan sebagai kendala penyedia', () => {
        expect(classifyHlsError(
            { type: 'networkError', details: 'manifestLoadError' },
            { HlsErrorTypes, streamSource: 'external' },
        )).toBe('cors');
    });

    it('tipe yang tak dikenal jatuh ke unknown, bukan melempar', () => {
        expect(classifyHlsError({ type: 'otherError', details: 'x' }, { HlsErrorTypes })).toBe('unknown');
        expect(classifyHlsError(null, { HlsErrorTypes })).toBe('unknown');
    });
});

/*
 * DILAPORKAN PEMILIK 2026-08-26. Gejalanya "bug codec melebar kemana mana": live berjalan normal,
 * pengguna pindah aplikasi lalu kembali, dan panel "Codec Tidak Didukung" muncul TANPA tombol
 * coba lagi.
 *
 * Ketiadaan tombol itu memang disengaja untuk vonis codec, dan benar: browser yang tidak
 * mendukung sebuah codec tidak akan berubah pikiran kalau tombolnya diklik lagi. Justru karena
 * itu vonis codec tidak boleh dipinjam untuk keadaan yang PULIH - dan gambar yang berhenti
 * sesudah aplikasi lama di latar belakang selalu pulih dengan menyambung ulang. Meminjamnya
 * mengubah gangguan sepuluh detik menjadi jalan buntu.
 */
describe('gambar yang berhenti bisa dicoba lagi; vonis codec tetap tidak', () => {
    it('memberi tombol coba lagi saat gambar berhenti mengalir', () => {
        expect(shouldShowPublicPopupRetry({ status: 'error', errorType: 'stalled' })).toBe(true);
    });

    it('TETAP tidak memberi tombol untuk vonis codec sungguhan', () => {
        expect(shouldShowPublicPopupRetry({ status: 'error', errorType: 'codec' })).toBe(false);
    });

    it('tidak meminjam bahasa codec untuk perangkat yang jelas mampu mendekode', () => {
        const state = getPublicPopupOverlayState({ status: 'error', errorType: 'stalled' });

        expect(state.canRetry).toBe(true);
        expect(state.title).not.toMatch(/codec/i);
        expect(`${state.title} ${state.description}`).not.toMatch(/codec|h\.?265|hevc|safari/i);
    });

    it('masih jatuh ke varian unknown untuk errorType yang tak dikenal', () => {
        expect(getPublicPopupOverlayState({ status: 'error', errorType: 'ngawur' }).variant).toBe('unknown');
    });
});
