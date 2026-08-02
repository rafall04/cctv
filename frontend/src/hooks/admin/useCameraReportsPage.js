/*
 * Purpose: State and actions for the camera-report queue page.
 * Caller: pages/CameraReportsManagement.jsx.
 * Deps: adminService, NotificationContext.
 * MainFuncs: useCameraReportsPage.
 * SideEffects: Loads the queue and changes report status through the admin API.
 *
 * Filters live here rather than in the URL because this is a working queue, not a shareable view:
 * an operator moves between "belum ditutup" and "selesai" dozens of times in a sitting, and every
 * one of those would otherwise be a history entry standing between them and the page they came from.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotification } from '../../contexts/NotificationContext';
import { adminService } from '../../services/adminService';

const DEFAULT_FILTERS = { status: 'open', category: '', cameraId: '', sort: 'newest' };
const PAGE_SIZE = 25;

export function useCameraReportsPage() {
    const { success: notifySuccess, error: notifyError } = useNotification();
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [savingId, setSavingId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await adminService.getCameraReports({ ...filters, page, limit: PAGE_SIZE });
        if (res?.success) {
            setData(res.data);
            setLoadError(null);
        } else {
            setLoadError(res?.message || 'Gagal memuat laporan kamera');
        }
        setLoading(false);
    }, [filters, page]);

    useEffect(() => { load(); }, [load]);

    /** Any filter change returns to page 1 — page 4 of a narrower list is usually empty. */
    const applyFilter = useCallback((patch) => {
        setPage(1);
        setFilters((current) => ({ ...current, ...patch }));
    }, []);

    const resetFilters = useCallback(() => {
        setPage(1);
        setFilters(DEFAULT_FILTERS);
    }, []);

    /*
     * Refetches instead of patching the row in place. Changing a status can move a report OUT of
     * the current filter (closing one while viewing "belum ditutup"), and the summary counts shift
     * with it — a local edit would leave both lying until the next load.
     */
    const setStatus = useCallback(async (id, status) => {
        setSavingId(id);
        const res = await adminService.updateCameraReport(id, status);
        setSavingId(null);

        if (!res?.success) {
            notifyError('Gagal memperbarui', res?.message || 'Status laporan tidak berubah.');
            return false;
        }
        notifySuccess('Tersimpan', `Laporan #${id} ditandai "${status}".`);
        await load();
        return true;
    }, [load, notifyError, notifySuccess]);

    const isFiltered = useMemo(
        () => JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS),
        [filters],
    );

    return {
        filters,
        applyFilter,
        resetFilters,
        isFiltered,
        page,
        setPage,
        reports: data?.reports || [],
        pagination: data?.pagination || { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 },
        summary: data?.summary || null,
        categories: data?.categories || [],
        cameras: data?.cameras || [],
        loading,
        loadError,
        savingId,
        setStatus,
        reload: load,
    };
}

export default useCameraReportsPage;
