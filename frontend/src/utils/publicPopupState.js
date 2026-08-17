import { getCameraAvailabilityState } from './cameraAvailability.js';

const LOADING_MESSAGES = {
    connecting: 'Menghubungkan...',
    loading: 'Memuat stream...',
    buffering: 'Buffering...',
};

const ERROR_VARIANTS = {
    codec: {
        title: 'Codec Tidak Didukung',
        description: 'Browser Anda tidak mendukung codec H.265/HEVC yang digunakan kamera ini. Coba gunakan browser lain seperti Safari.',
        variant: 'codec',
        canRetry: false,
    },
    network: {
        title: 'Koneksi Gagal',
        description: 'Tidak dapat terhubung ke server stream. Periksa koneksi internet Anda atau coba lagi nanti.',
        variant: 'network',
        canRetry: true,
    },
    media: {
        title: 'Error Media',
        description: 'Terjadi kesalahan saat memutar video. Format stream mungkin tidak kompatibel dengan browser.',
        variant: 'media',
        canRetry: true,
    },
    cors: {
        // External network failures land here. They're usually a temporary
        // upstream/provider hiccup, NOT a permanent block — so use plain
        // language (no "CORS"/"lintas domain" jargon) and allow a retry
        // instead of presenting an unactionable dead end.
        title: 'Kamera Tidak Dapat Ditampilkan',
        description: 'Stream dari penyedia eksternal ini sedang tidak bisa diakses dari sini. Coba lagi beberapa saat lagi.',
        variant: 'cors',
        canRetry: true,
    },
    unknown: {
        title: 'CCTV Tidak Terkoneksi',
        description: 'Kamera sedang offline atau terjadi kesalahan. Coba lagi nanti.',
        variant: 'unknown',
        canRetry: true,
    },
};

/*
 * Does this hls.js error mean "this device cannot decode this stream"?
 *
 * Exported separately because the answer must be acted on BEFORE the caller's usual `if (!fatal)
 * return` guard. Measured against production: hls.js asks the decoder itself
 * (`video/mp4;codecs=hvc1.1.6.L150.0` -> false), drops the level, and reports it NON-FATALLY —
 * then never emits MANIFEST_PARSED and keeps the session alive with nothing to play. Treating a
 * codec refusal as ignorable because it is not flagged fatal is what left the player showing
 * "Memuat stream" indefinitely.
 *
 * bufferAddCodecError / bufferIncompatibleCodecsError are the same verdict arriving later, when the
 * manifest looked fine but addSourceBuffer refused the codec. `bufferAddCodecError` is the
 * non-fatal one that motivated hoisting this check at all (hls.js 1.6.15 dist:20213-20216).
 *
 * WHAT IS DELIBERATELY *NOT* HERE, AND WHY (regression, 2026-08-17)
 * ----------------------------------------------------------------
 * `fragParsingError` and `bufferAppendError` were briefly on this list. They are NOT codec
 * verdicts, and because this predicate runs ABOVE the fatal guard and its callers answer with
 * `hls.destroy()`, including them killed healthy streams on their first hiccup — a stream that
 * had played fine for months went black. Read from the hls.js 1.6.15 source we ship:
 *
 *   - `fragParsingError` is emitted NON-FATALLY at dist:10800 with reason
 *     "Found no media in msn <n>" — a momentarily empty segment, not a decoder refusal.
 *   - `bufferAppendError` (dist:19759) is what hls.js itself prepares to RECOVER from: its
 *     own handler returns early on fatal, then resets level selection specifically "so that a
 *     new selection can be made after calling recoverMediaError" (dist:4262-4270).
 *   - hls.js only reads either as codec evidence when bound to a source buffer or an AUDIO
 *     fragment (dist:5236, 5242) — a condition this predicate never checked.
 *
 * Left off the list, both fall through to the caller's normal fatal-gated path: non-fatal ones
 * are ignored so hls.js can recover exactly as it did before, and a genuinely fatal one still
 * surfaces an error. The H.265 fix is untouched — its verdict arrives as `bufferAddCodecError`.
 */
export const isCodecFailure = (hlsError) => {
    if (!hlsError) return false;
    const reason = (hlsError.reason || '').toLowerCase();
    const details = hlsError.details || '';
    return details === 'manifestIncompatibleCodecsError'
        || details === 'bufferAddCodecError'
        || details === 'bufferIncompatibleCodecsError'
        || reason.includes('codec')
        || reason.includes('hevc')
        || reason.includes('h265');
};

export const getPublicPopupErrorType = ({ hlsError, streamSource }) => {
    if (!hlsError) return 'unknown';

    if (streamSource === 'external' && hlsError.type === 'networkError') {
        return 'cors';
    }

    if (isCodecFailure(hlsError)) return 'codec';

    if (hlsError.type === 'networkError') return 'network';
    if (hlsError.type === 'mediaError') return 'media';
    return 'unknown';
};

export const getPublicPopupInitialStatus = (camera) => {
    if (camera?.status === 'maintenance') return 'maintenance';
    if (getCameraAvailabilityState(camera) === 'offline') return 'offline';
    return 'connecting';
};

export const isPublicPopupPlaybackLocked = (status) => (
    ['maintenance', 'offline', 'timeout', 'error'].includes(status)
);

export const shouldShowPublicPopupRetry = ({ status, errorType }) => {
    if (status === 'timeout') return true;
    if (status !== 'error') return false;
    return (ERROR_VARIANTS[errorType] || ERROR_VARIANTS.unknown).canRetry;
};

export const getPublicPopupStatusDisplay = ({ status, loadingStage, isTunnel }) => {
    if (status === 'live' || status === 'playing') {
        return {
            label: 'LIVE',
            color: isTunnel ? 'bg-orange-500/20 text-orange-400' : 'bg-emerald-500/20 text-emerald-400',
            dotColor: isTunnel ? 'bg-orange-400' : 'bg-emerald-400',
        };
    }

    if (status === 'maintenance') {
        return {
            label: 'PERBAIKAN',
            color: 'bg-red-500/20 text-red-400',
            dotColor: 'bg-red-400',
        };
    }

    if (status === 'offline') {
        return {
            label: 'OFFLINE',
            color: 'bg-gray-500/20 text-gray-400',
            dotColor: 'bg-gray-400',
        };
    }

    if (status === 'degraded') {
        return {
            label: 'TIDAK STABIL',
            color: 'bg-amber-500/20 text-amber-400',
            dotColor: 'bg-amber-400',
        };
    }

    if (status === 'timeout') {
        return {
            label: 'TIMEOUT',
            color: 'bg-amber-500/20 text-amber-400',
            dotColor: 'bg-amber-400',
        };
    }

    if (status === 'error') {
        return {
            label: 'ERROR',
            color: 'bg-red-500/20 text-red-400',
            dotColor: 'bg-red-400',
        };
    }

    const loadingMessage = LOADING_MESSAGES[loadingStage] || LOADING_MESSAGES.connecting;
    return {
        label: loadingMessage.toUpperCase(),
        color: 'bg-sky-500/20 text-sky-400',
        dotColor: 'bg-sky-400',
    };
};

export const getPublicPopupOverlayState = ({ status, loadingStage, errorType }) => {
    if (status === 'live' || status === 'playing') return null;

    if (status === 'maintenance') {
        return {
            variant: 'maintenance',
            title: 'Dalam Perbaikan',
            description: 'Kamera ini sedang dalam masa perbaikan/maintenance',
            canRetry: false,
        };
    }

    if (status === 'offline') {
        return {
            variant: 'offline',
            title: 'Kamera Offline',
            description: 'Kamera ini sedang tidak tersedia atau tidak dapat dijangkau',
            canRetry: false,
        };
    }

    if (status === 'degraded') return null;

    if (status === 'timeout') {
        return {
            variant: 'timeout',
            title: 'Loading Timeout',
            description: 'Stream terlalu lama merespons. Kamera mungkin sedang offline atau jaringan lambat.',
            canRetry: true,
        };
    }

    if (status === 'error') {
        return ERROR_VARIANTS[errorType] || ERROR_VARIANTS.unknown;
    }

    return {
        variant: 'loading',
        title: LOADING_MESSAGES[loadingStage] || LOADING_MESSAGES.connecting,
        description: 'Mohon tunggu sebentar...',
        canRetry: false,
    };
};
