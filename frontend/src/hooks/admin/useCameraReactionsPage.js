/*
 * Purpose: Load the fleet-wide visitor verdict and let an operator search and re-sort it.
 * Caller: pages/CameraReactionsOverview.jsx.
 * Deps: adminService.
 * MainFuncs: useCameraReactionsPage.
 * SideEffects: One GET on mount.
 *
 * Sorting and filtering are done in memory, not on the server. The fleet is dozens of cameras, not
 * thousands, and the endpoint already returns all of them — a round trip per column click would add
 * latency to answer a question the browser already holds every byte of.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminService } from '../../services/adminService';

const DEFAULT_SORT = { key: 'dislikes', direction: 'desc' };

/** Positive share of the votes cast, or null when nobody has voted — never 0%, which is a verdict. */
export function positiveShare(camera) {
    if (!camera.total) return null;
    return Math.round((camera.likes / camera.total) * 100);
}

const VALUE = {
    name: (c) => c.name?.toLowerCase() || '',
    area: (c) => c.areaName?.toLowerCase() || '',
    likes: (c) => c.likes,
    dislikes: (c) => c.dislikes,
    total: (c) => c.total,
    share: (c) => (c.total ? c.likes / c.total : -1),
    lastVoteAt: (c) => c.lastVoteAt || '',
};

export function useCameraReactionsPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [search, setSearch] = useState('');
    const [ratedOnly, setRatedOnly] = useState(false);
    const [sort, setSort] = useState(DEFAULT_SORT);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await adminService.getCameraReactions();
        if (res?.success) {
            setData(res.data);
            setLoadError(null);
        } else {
            setLoadError(res?.message || 'Gagal memuat penilaian kamera');
        }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const sortBy = useCallback((key, direction) => setSort({ key, direction }), []);

    const cameras = useMemo(() => {
        const all = data?.cameras || [];
        const needle = search.trim().toLowerCase();

        const filtered = all.filter((camera) => {
            if (ratedOnly && !camera.total) return false;
            if (!needle) return true;
            return `${camera.name} ${camera.areaName || ''}`.toLowerCase().includes(needle);
        });

        const read = VALUE[sort.key] || VALUE.dislikes;
        const factor = sort.direction === 'asc' ? 1 : -1;

        /*
         * `id` breaks every tie. Without it an unstable comparator can reorder equal rows between
         * renders, which on a table of mostly-zero counts looks like the data is changing when only
         * the sort is.
         */
        return [...filtered].sort((a, b) => {
            const left = read(a);
            const right = read(b);
            if (left < right) return -1 * factor;
            if (left > right) return 1 * factor;
            return a.id - b.id;
        });
    }, [data, ratedOnly, search, sort]);

    return {
        cameras,
        totals: data?.totals || null,
        loading,
        loadError,
        search,
        setSearch,
        ratedOnly,
        setRatedOnly,
        sort,
        sortBy,
        reload: load,
    };
}

export default useCameraReactionsPage;
