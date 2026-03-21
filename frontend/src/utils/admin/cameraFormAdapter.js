import { validateRtspUrl } from '../validators';

export const defaultCameraFormValues = {
    name: '',
    private_rtsp_url: '',
    video_codec: 'h264',
    description: '',
    location: '',
    group_name: '',
    area_id: '',
    enabled: true,
    is_tunnel: false,
    latitude: '',
    longitude: '',
    status: 'active',
    enable_recording: false,
    recording_duration_hours: 5,
    stream_source: 'internal',
    external_hls_url: '',
    external_use_proxy: true,
    external_tls_mode: 'strict',
};

export const recordingDurationOptions = [
    {
        label: 'Per Jam (1-10 jam)',
        options: [
            { value: 1, label: '1 Jam (~1.8 GB)' },
            { value: 2, label: '2 Jam (~3.6 GB)' },
            { value: 3, label: '3 Jam (~5.4 GB)' },
            { value: 4, label: '4 Jam (~7.2 GB)' },
            { value: 5, label: '5 Jam (~9 GB)' },
            { value: 6, label: '6 Jam (~11 GB)' },
            { value: 7, label: '7 Jam (~13 GB)' },
            { value: 8, label: '8 Jam (~14 GB)' },
            { value: 9, label: '9 Jam (~16 GB)' },
            { value: 10, label: '10 Jam (~18 GB)' },
        ],
    },
    {
        label: 'Setengah Hari (12-18 jam)',
        options: [
            { value: 12, label: '12 Jam (~22 GB)' },
            { value: 15, label: '15 Jam (~27 GB)' },
            { value: 18, label: '18 Jam (~32 GB)' },
        ],
    },
    {
        label: 'Per Hari (1-7 hari)',
        options: [
            { value: 24, label: '1 Hari / 24 Jam (~43 GB)' },
            { value: 48, label: '2 Hari / 48 Jam (~86 GB)' },
            { value: 72, label: '3 Hari / 72 Jam (~130 GB)' },
            { value: 96, label: '4 Hari / 96 Jam (~173 GB)' },
            { value: 120, label: '5 Hari / 120 Jam (~216 GB)' },
            { value: 144, label: '6 Hari / 144 Jam (~259 GB)' },
            { value: 168, label: '7 Hari / 168 Jam (~302 GB)' },
        ],
    },
    {
        label: 'Per Minggu (1-4 minggu)',
        options: [
            { value: 336, label: '2 Minggu / 14 Hari (~605 GB)' },
            { value: 504, label: '3 Minggu / 21 Hari (~907 GB)' },
            { value: 672, label: '4 Minggu / 28 Hari (~1.2 TB)' },
        ],
    },
    {
        label: 'Per Bulan (1-3 bulan)',
        options: [
            { value: 720, label: '1 Bulan / 30 Hari (~1.3 TB)' },
            { value: 1440, label: '2 Bulan / 60 Hari (~2.6 TB)' },
            { value: 2160, label: '3 Bulan / 90 Hari (~3.9 TB)' },
        ],
    },
];

export function getCameraValidationRules(streamSource = 'internal') {
    return {
        name: {
            required: 'Camera name is required',
            minLength: { value: 2, message: 'Name must be at least 2 characters' },
            maxLength: { value: 100, message: 'Name must not exceed 100 characters' },
        },
        private_rtsp_url: {
            required: streamSource === 'internal' ? 'RTSP URL is required' : false,
            custom: (value) => {
                if (streamSource === 'external') return undefined;
                if (!value || value.trim() === '') return undefined;
                const result = validateRtspUrl(value);
                return result.isValid ? undefined : result.error;
            },
        },
        external_hls_url: {
            required: streamSource === 'external' ? 'External HLS URL is required' : false,
            custom: (value) => {
                if (streamSource === 'internal') return undefined;
                if (!value || value.trim() === '') return undefined;
                if (!value.startsWith('http')) {
                    return 'URL must start with http:// or https://';
                }
                return undefined;
            },
        },
        external_tls_mode: {
            custom: (value) => {
                if (streamSource === 'internal') return undefined;
                if (!value) return undefined;
                if (!['strict', 'insecure'].includes(value)) {
                    return 'TLS mode must be strict or insecure';
                }
                return undefined;
            },
        },
    };
}

export function mapCameraToFormValues(camera) {
    return {
        ...defaultCameraFormValues,
        name: camera.name || '',
        private_rtsp_url: camera.private_rtsp_url || '',
        video_codec: camera.video_codec || 'h264',
        description: camera.description || '',
        location: camera.location || '',
        group_name: camera.group_name || '',
        area_id: camera.area_id || '',
        enabled: camera.enabled === 1 || camera.enabled === true,
        is_tunnel: camera.is_tunnel === 1 || camera.is_tunnel === true,
        latitude: camera.latitude || '',
        longitude: camera.longitude || '',
        status: camera.status || 'active',
        enable_recording: camera.enable_recording === 1 || camera.enable_recording === true,
        recording_duration_hours: camera.recording_duration_hours || 5,
        stream_source: camera.stream_source || 'internal',
        external_hls_url: camera.external_hls_url || '',
        external_use_proxy: camera.external_use_proxy !== false && camera.external_use_proxy !== 0,
        external_tls_mode: camera.external_tls_mode || 'strict',
    };
}

export function buildCameraPayload(formData) {
    const recordingDuration = formData.recording_duration_hours
        ? parseInt(formData.recording_duration_hours, 10)
        : 5;

    return {
        ...formData,
        enabled: formData.enabled ? 1 : 0,
        is_tunnel: formData.is_tunnel ? 1 : 0,
        status: formData.status,
        enable_recording: formData.enable_recording ? 1 : 0,
        recording_duration_hours: recordingDuration,
        stream_source: formData.stream_source || 'internal',
        external_hls_url: formData.stream_source === 'external' ? formData.external_hls_url : null,
        private_rtsp_url: formData.stream_source === 'internal' ? formData.private_rtsp_url : null,
        external_use_proxy: formData.stream_source === 'external' 
            ? (formData.external_tls_mode === 'insecure' ? 1 : (formData.external_use_proxy ? 1 : 0)) 
            : 1,
        external_tls_mode: formData.stream_source === 'external' ? (formData.external_tls_mode || 'strict') : 'strict',
    };
}
