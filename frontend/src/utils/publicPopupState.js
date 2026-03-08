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
        title: 'Stream Eksternal Diblokir',
        description: 'Server pihak ketiga tidak mengizinkan akses lintas domain (CORS). Hubungi penyedia stream atau coba akses langsung URL-nya.',
        variant: 'cors',
        canRetry: false,
    },
    unknown: {
        title: 'CCTV Tidak Terkoneksi',
        description: 'Kamera sedang offline atau terjadi kesalahan. Coba lagi nanti.',
        variant: 'unknown',
        canRetry: true,
    },
};

export const getPublicPopupErrorType = ({ hlsError, streamSource }) => {
    if (!hlsError) return 'unknown';

    if (streamSource === 'external' && hlsError.type === 'networkError') {
        return 'cors';
    }

    const reason = (hlsError.reason || '').toLowerCase();
    const details = hlsError.details || '';

    if (
        details === 'manifestIncompatibleCodecsError' ||
        details === 'fragParsingError' ||
        details === 'bufferAppendError' ||
        reason.includes('codec') ||
        reason.includes('hevc') ||
        reason.includes('h265')
    ) {
        return 'codec';
    }

    if (hlsError.type === 'networkError') return 'network';
    if (hlsError.type === 'mediaError') return 'media';
    return 'unknown';
};

export const getPublicPopupInitialStatus = (camera) => {
    if (camera?.status === 'maintenance') return 'maintenance';
    if (camera?.is_online === 0) return 'offline';
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
