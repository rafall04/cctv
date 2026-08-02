/*
 * Purpose: State and actions for the admin playback-package catalogue page.
 * Caller: pages/PlaybackProductManagement.jsx.
 * Deps: playbackProductService, NotificationContext.
 * MainFuncs: usePlaybackProductManagementPage.
 * SideEffects: Loads and mutates the package catalogue through the admin API.
 *
 * The per-package DRAFT lives in the card, not here. Holding every row's in-progress edit in one
 * object would re-render the whole list on each keystroke, and "cancel" would have to know how to
 * unpick one row from shared state. The hook owns what is genuinely shared: the list, which row is
 * currently saving, and the outcome messages.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNotification } from '../../contexts/NotificationContext';
import playbackProductService from '../../services/playbackProductService';

export function usePlaybackProductManagementPage() {
    const { success: notifySuccess, error: notifyError } = useNotification();
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [savingId, setSavingId] = useState(null);
    const [creating, setCreating] = useState(false);
    const [showCreate, setShowCreate] = useState(false);

    const loadProducts = useCallback(async () => {
        setLoading(true);
        const res = await playbackProductService.listProducts();
        if (res?.success) {
            setProducts(res.data || []);
            setLoadError(null);
        } else {
            setLoadError(res?.message || 'Gagal memuat daftar paket');
        }
        setLoading(false);
    }, []);

    useEffect(() => { loadProducts(); }, [loadProducts]);

    /*
     * Replaces the row in place from the server's response rather than re-fetching the list. The
     * backend returns the saved row, so a refetch would cost a round trip to learn what we were
     * just told — and would scroll a long list back to a stale position.
     */
    const applyUpdated = useCallback((updated) => {
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    }, []);

    const saveProduct = useCallback(async (id, payload) => {
        setSavingId(id);
        const res = await playbackProductService.updateProduct(id, payload);
        setSavingId(null);

        if (!res?.success) {
            notifyError('Gagal menyimpan', res?.message || 'Paket tidak berubah.');
            return false;
        }
        applyUpdated(res.data);
        notifySuccess('Tersimpan', `Paket "${res.data.label}" diperbarui.`);
        return true;
    }, [applyUpdated, notifyError, notifySuccess]);

    /** Enable/disable is the one action worth doing without opening an editor — it is the on/off switch. */
    const toggleEnabled = useCallback(async (product) => {
        return saveProduct(product.id, { enabled: product.enabled ? 0 : 1 });
    }, [saveProduct]);

    const createProduct = useCallback(async (payload) => {
        setCreating(true);
        const res = await playbackProductService.createProduct(payload);
        setCreating(false);

        if (!res?.success) {
            notifyError('Gagal membuat paket', res?.message || 'Paket tidak dibuat.');
            return false;
        }
        setProducts((prev) => [...prev, res.data].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
        setShowCreate(false);
        notifySuccess('Paket dibuat', `"${res.data.label}" sudah masuk katalog.`);
        return true;
    }, [notifyError, notifySuccess]);

    return {
        products,
        loading,
        loadError,
        savingId,
        creating,
        showCreate,
        setShowCreate,
        loadProducts,
        saveProduct,
        toggleEnabled,
        createProduct,
    };
}

export default usePlaybackProductManagementPage;
