export const AREA_COVERAGE_OPTIONS = [
    { value: 'default', label: 'Default / Auto', zoom: null },
    { value: 'site_point', label: 'Titik / Site', zoom: 17 },
    { value: 'rt_rw', label: 'RT / RW', zoom: 16 },
    { value: 'kelurahan_desa', label: 'Kelurahan / Desa', zoom: 14 },
    { value: 'kecamatan', label: 'Kecamatan', zoom: 12 },
    { value: 'kabupaten_kota', label: 'Kabupaten / Kota', zoom: 10 },
    { value: 'regional', label: 'Regional / Multi-Kota', zoom: 8 },
    { value: 'custom', label: 'Custom', zoom: null },
];

const AREA_COVERAGE_LOOKUP = new Map(AREA_COVERAGE_OPTIONS.map((option) => [option.value, option]));

export function getAreaCoverageLabel(scope) {
    return AREA_COVERAGE_LOOKUP.get(scope)?.label || AREA_COVERAGE_LOOKUP.get('default').label;
}

export function getAreaCoverageDefaultZoom(scope) {
    return AREA_COVERAGE_LOOKUP.get(scope)?.zoom ?? null;
}

export function resolveAreaFocusZoom(scope, overrideZoom, fallbackZoom = 15) {
    if (overrideZoom !== undefined && overrideZoom !== null && overrideZoom !== '') {
        const parsed = parseInt(overrideZoom, 10);
        if (!Number.isNaN(parsed)) {
            return Math.max(1, Math.min(parsed, 20));
        }
    }

    const scopeZoom = getAreaCoverageDefaultZoom(scope);
    if (scopeZoom !== null) {
        return scopeZoom;
    }

    return fallbackZoom;
}

export function isBroadAreaCoverage(scope) {
    return ['kecamatan', 'kabupaten_kota', 'regional'].includes(scope);
}
