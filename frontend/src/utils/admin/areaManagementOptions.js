/*
 * Purpose: Shared option lists for admin area management controls.
 * Caller: AreaManagement page and admin area presentation components.
 * Deps: None.
 * MainFuncs: GRID_DEFAULT_LIMIT_OPTIONS, INTERNAL_INGEST_POLICY_OPTIONS.
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
