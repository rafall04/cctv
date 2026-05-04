/*
 * Purpose: Shared option lists and labels for admin area management controls.
 * Caller: AreaManagement page and admin area presentation components.
 * Deps: None.
 * MainFuncs: GRID_DEFAULT_LIMIT_OPTIONS, INTERNAL_INGEST_POLICY_OPTIONS, INTERNAL_RTSP_TRANSPORT_OPTIONS, getBulkFilterLabel.
 * SideEffects: None.
 */

export const GRID_DEFAULT_LIMIT_OPTIONS = [
    { value: '6', label: '6 kamera' },
    { value: '10', label: '10 kamera' },
    { value: '12', label: '12 kamera' },
    { value: '15', label: '15 kamera' },
    { value: '20', label: '20 kamera' },
    { value: '30', label: '30 kamera' },
    { value: '', label: 'Tanpa batas' },
];

export const INTERNAL_INGEST_POLICY_OPTIONS = [
    { value: 'default', label: 'Ikuti Default Sistem' },
    { value: 'always_on', label: 'Always On' },
    { value: 'on_demand', label: 'On-Demand' },
];

export const INTERNAL_RTSP_TRANSPORT_OPTIONS = [
    { value: 'default', label: 'Ikuti Default Sistem' },
    { value: 'tcp', label: 'TCP' },
    { value: 'udp', label: 'UDP' },
    { value: 'auto', label: 'Auto' },
];

export function getBulkFilterLabel(targetFilter) {
    switch (targetFilter) {
        case 'internal_only':
            return 'Hanya Internal';
        case 'external_only':
            return 'Hanya External';
        case 'external_streams_only':
            return 'Hanya External Valid';
        case 'external_hls_only':
            return 'Hanya External HLS';
        case 'external_mjpeg_only':
            return 'Hanya External MJPEG';
        case 'external_probeable_only':
            return 'Hanya External Probeable';
        case 'external_passive_only':
            return 'Hanya External Passive';
        case 'external_unresolved_only':
            return 'Hanya External Unresolved';
        case 'online_only':
            return 'Hanya Online';
        case 'offline_only':
            return 'Hanya Offline';
        case 'recording_enabled_only':
            return 'Hanya Recording Enabled';
        default:
            return 'Semua Kamera Area';
    }
}
