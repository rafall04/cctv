/*
 * Purpose: Render admin controls for live/playback ASN access policies.
 * Caller: UnifiedSettings network tab.
 * Deps: React, NotificationContext, areaService, cameraService, networkAccessPolicyService.
 * MainFuncs: NetworkAccessPolicyPanel.
 * SideEffects: Loads, saves, and deletes ASN access policy rows through authenticated API calls.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotification } from '../../../contexts/NotificationContext';
import { areaService } from '../../../services/areaService';
import { cameraService } from '../../../services/cameraService';
import { networkAccessPolicyService } from '../../../services/networkAccessPolicyService';

const EMPTY_FORM = {
    scope: 'global',
    targetId: '',
    accessFlow: 'live',
    enabled: true,
    mode: 'observe_only',
    asnAllowlist: '',
    asnDenylist: '',
    description: '',
};

const SCOPE_LABELS = {
    global: 'Global',
    area: 'Area',
    camera: 'Camera',
};

const FLOW_LABELS = {
    live: 'Live',
    playback: 'Playback',
};

const MODE_LABELS = {
    observe_only: 'Observe only',
    allowlist: 'Allowlist',
    denylist: 'Denylist',
};

function joinAsnList(value) {
    return Array.isArray(value) ? value.join(', ') : '';
}

function formatTarget(policy, areaMap, cameraMap) {
    if (policy.scope === 'global') {
        return 'All targets';
    }

    const targetMap = policy.scope === 'area' ? areaMap : cameraMap;
    const targetName = targetMap.get(Number(policy.targetId));
    return targetName ? `${SCOPE_LABELS[policy.scope]}: ${targetName}` : `${SCOPE_LABELS[policy.scope]} #${policy.targetId}`;
}

export default function NetworkAccessPolicyPanel() {
    const { success, error: showError } = useNotification();
    const [policies, setPolicies] = useState([]);
    const [form, setForm] = useState(EMPTY_FORM);
    const [areas, setAreas] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState(null);

    const loadPolicies = useCallback(async () => {
        try {
            setLoading(true);
            const [policyResponse, areaResponse, cameraResponse] = await Promise.all([
                networkAccessPolicyService.getPolicies(),
                areaService.getAllAreas(),
                cameraService.getAllCameras(),
            ]);
            setPolicies(policyResponse?.data || []);
            setAreas(areaResponse?.data || []);
            setCameras(cameraResponse?.data || []);
        } catch (requestError) {
            console.error('Failed to load network access policies:', requestError);
            showError('Gagal Memuat', 'Gagal memuat policy ASN.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadPolicies();
    }, [loadPolicies]);

    const sortedPolicies = useMemo(() => policies, [policies]);
    const areaMap = useMemo(() => new Map(areas.map((area) => [Number(area.id), area.name])), [areas]);
    const cameraMap = useMemo(() => new Map(cameras.map((camera) => [Number(camera.id), camera.name])), [cameras]);
    const targetOptions = form.scope === 'area' ? areas : cameras;

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setForm((previous) => {
            const next = {
                ...previous,
                [name]: type === 'checkbox' ? checked : value,
            };

            if (name === 'scope' && value === 'global') {
                next.targetId = '';
            }

            return next;
        });
    };

    const handleEdit = (policy) => {
        setForm({
            scope: policy.scope,
            targetId: policy.targetId || '',
            accessFlow: policy.accessFlow,
            enabled: policy.enabled,
            mode: policy.mode,
            asnAllowlist: joinAsnList(policy.asnAllowlist),
            asnDenylist: joinAsnList(policy.asnDenylist),
            description: policy.description || '',
        });
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            setSaving(true);
            await networkAccessPolicyService.savePolicy({
                ...form,
                targetId: form.scope === 'global' ? null : form.targetId,
            });
            setForm(EMPTY_FORM);
            await loadPolicies();
            success('Policy Tersimpan', 'Policy ASN berhasil diperbarui.');
        } catch (requestError) {
            console.error('Failed to save network access policy:', requestError);
            showError('Gagal Menyimpan', requestError?.response?.data?.message || 'Gagal menyimpan policy ASN.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (policy) => {
        try {
            setDeletingId(policy.id);
            await networkAccessPolicyService.deletePolicy(policy.id);
            await loadPolicies();
            success('Policy Dihapus', 'Policy ASN berhasil dihapus.');
        } catch (requestError) {
            console.error('Failed to delete network access policy:', requestError);
            showError('Gagal Menghapus', 'Gagal menghapus policy ASN.');
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-sky-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="border-b border-gray-200 p-5 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">ASN Access Policy</h3>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        Atur ASN yang boleh atau diblokir untuk akses live dan playback.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="grid gap-4 p-5 md:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Scope
                        <select
                            name="scope"
                            value={form.scope}
                            onChange={handleChange}
                            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="global">Global</option>
                            <option value="area">Area</option>
                            <option value="camera">Camera</option>
                        </select>
                    </label>

                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Target ID
                        {form.scope === 'global' ? (
                            <input
                                value="All targets"
                                disabled
                                className="mt-2 w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400"
                            />
                        ) : (
                            <select
                                name="targetId"
                                value={form.targetId}
                                onChange={handleChange}
                                required
                                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            >
                                <option value="">Pilih {SCOPE_LABELS[form.scope]}</option>
                                {targetOptions.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name || `#${item.id}`}
                                    </option>
                                ))}
                            </select>
                        )}
                    </label>

                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Flow
                        <select
                            name="accessFlow"
                            value={form.accessFlow}
                            onChange={handleChange}
                            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="live">Live</option>
                            <option value="playback">Playback</option>
                        </select>
                    </label>

                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Mode
                        <select
                            name="mode"
                            value={form.mode}
                            onChange={handleChange}
                            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="observe_only">Observe only</option>
                            <option value="allowlist">Allowlist</option>
                            <option value="denylist">Denylist</option>
                        </select>
                    </label>

                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        ASN Allowlist
                        <input
                            name="asnAllowlist"
                            value={form.asnAllowlist}
                            onChange={handleChange}
                            placeholder="7713, 4787"
                            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </label>

                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        ASN Denylist
                        <input
                            name="asnDenylist"
                            value={form.asnDenylist}
                            onChange={handleChange}
                            placeholder="64512"
                            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </label>

                    <label className="md:col-span-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                        Description
                        <input
                            name="description"
                            value={form.description}
                            onChange={handleChange}
                            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </label>

                    <div className="flex items-center justify-between gap-3 md:col-span-2">
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                            <input
                                type="checkbox"
                                name="enabled"
                                checked={form.enabled}
                                onChange={handleChange}
                                className="h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-500"
                            />
                            Enabled
                        </label>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setForm(EMPTY_FORM)}
                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900"
                            >
                                Reset
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                            >
                                {saving ? 'Menyimpan...' : 'Simpan Policy'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Scope</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Flow</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Mode</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">ASN</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Status</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {sortedPolicies.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                                        Belum ada policy ASN.
                                    </td>
                                </tr>
                            ) : sortedPolicies.map((policy) => (
                                <tr key={policy.id} className="align-top">
                                    <td className="px-4 py-3 text-gray-900 dark:text-white">
                                        <div className="font-medium">{formatTarget(policy, areaMap, cameraMap)}</div>
                                        {policy.description && (
                                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{policy.description}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{FLOW_LABELS[policy.accessFlow]}</td>
                                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{MODE_LABELS[policy.mode]}</td>
                                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        <div>Allow: {joinAsnList(policy.asnAllowlist) || '-'}</div>
                                        <div>Deny: {joinAsnList(policy.asnDenylist) || '-'}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${policy.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300'}`}>
                                            {policy.enabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            onClick={() => handleEdit(policy)}
                                            className="mr-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(policy)}
                                            disabled={deletingId === policy.id}
                                            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                                        >
                                            {deletingId === policy.id ? 'Menghapus...' : 'Hapus'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
