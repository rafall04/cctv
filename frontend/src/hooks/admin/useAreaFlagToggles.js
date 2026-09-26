import { useState } from 'react';
import { areaService } from '../../services/areaService';

// updateArea is a full-row update — omitting a field resets it server-side, so every
// flag toggle must resend the whole editable surface with only the target overridden.
function buildAreaUpdatePayload(area, overrides) {
    return {
        name: area.name,
        description: area.description || '',
        rt: area.rt || '',
        rw: area.rw || '',
        kelurahan: area.kelurahan || '',
        kecamatan: area.kecamatan || '',
        latitude: area.latitude || '',
        longitude: area.longitude || '',
        external_health_mode_override: area.external_health_mode_override || 'default',
        coverage_scope: area.coverage_scope || 'default',
        viewport_zoom_override: area.viewport_zoom_override || '',
        show_on_grid_default: area.show_on_grid_default === 1 || area.show_on_grid_default === true,
        grid_default_camera_limit: area.grid_default_camera_limit === null || area.grid_default_camera_limit === undefined ? '' : area.grid_default_camera_limit,
        monitor_enabled: area.monitor_enabled === 1 || area.monitor_enabled === true,
        internal_ingest_policy_default: area.internal_ingest_policy_default || 'default',
        internal_on_demand_close_after_seconds: area.internal_on_demand_close_after_seconds === null || area.internal_on_demand_close_after_seconds === undefined ? '' : area.internal_on_demand_close_after_seconds,
        ...overrides,
    };
}

/**
 * One-click flag toggles on the area card (grid default, monitor wall, grid limit).
 * Each keeps its own busy-id so the card can show "Menyimpan..." per switch.
 */
export function useAreaFlagToggles({ setAreas, loadAreas, success, showError }) {
    const [togglingGridAreaId, setTogglingGridAreaId] = useState(null);
    const [togglingMonitorAreaId, setTogglingMonitorAreaId] = useState(null);

    const applyFlag = async (area, overrides, patch, setBusy, labels) => {
        setBusy(area.id);
        try {
            const result = await areaService.updateArea(area.id, buildAreaUpdatePayload(area, overrides));
            if (result.success) {
                setAreas((currentAreas) => currentAreas.map((currentArea) => (
                    currentArea.id === area.id ? { ...currentArea, ...patch } : currentArea
                )));
                success(labels.title, labels.message);
                loadAreas();
            } else {
                showError(labels.failTitle, result.message);
            }
        } catch (err) {
            showError(labels.failTitle, err.response?.data?.message || 'Terjadi kesalahan saat menyimpan area.');
        } finally {
            setBusy(null);
        }
    };

    const handleToggleGridDefault = (area) => {
        const nextValue = !(area.show_on_grid_default === 1 || area.show_on_grid_default === true);
        return applyFlag(area,
            { show_on_grid_default: nextValue },
            { show_on_grid_default: nextValue ? 1 : 0 },
            setTogglingGridAreaId,
            {
                title: 'Grid Default Diperbarui',
                message: `Area "${area.name}" sekarang ${nextValue ? 'ditampilkan' : 'disembunyikan'} pada Grid View default.`,
                failTitle: 'Gagal Memperbarui Grid Default',
            });
    };

    const handleToggleMonitor = (area) => {
        const nextValue = !(area.monitor_enabled === 1 || area.monitor_enabled === true);
        return applyFlag(area,
            { monitor_enabled: nextValue },
            { monitor_enabled: nextValue ? 1 : 0 },
            setTogglingMonitorAreaId,
            {
                title: 'Mode Monitor Diperbarui',
                message: `Area "${area.name}" sekarang ${nextValue ? 'tampil' : 'disembunyikan'} di halaman /monitor.`,
                failTitle: 'Gagal Memperbarui Mode Monitor',
            });
    };

    const handleGridDefaultLimitChange = (area, nextLimit) => applyFlag(area,
        { grid_default_camera_limit: nextLimit },
        { grid_default_camera_limit: nextLimit === '' ? null : parseInt(nextLimit, 10) },
        setTogglingGridAreaId,
        {
            title: 'Limit Grid Default Diperbarui',
            message: `Area "${area.name}" sekarang memakai limit ${nextLimit === '' ? 'tanpa batas' : `${nextLimit} kamera`} pada Grid View default.`,
            failTitle: 'Gagal Memperbarui Limit Grid Default',
        });

    return {
        togglingGridAreaId,
        togglingMonitorAreaId,
        handleToggleGridDefault,
        handleToggleMonitor,
        handleGridDefaultLimitChange,
    };
}

export default useAreaFlagToggles;
