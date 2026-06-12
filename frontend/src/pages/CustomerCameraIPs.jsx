/*
 * Purpose: Admin page — host/IP of every subscriber (customer) camera, classified public/private,
 *          so the network team can policy-route customer-camera traffic over the ISP broadband link
 *          and keep the dedicated link unburdened. Shows host/IP only (no RTSP credentials).
 * Caller: App.jsx /admin/customer-ips (adminOnly) inside AdminLayout.
 * Deps: billingAdminService, useNotification.
 * MainFuncs: CustomerCameraIPs.
 * SideEffects: Fetches the IP list (backend resolves DDNS hostnames).
 */

import { useCallback, useEffect, useState } from 'react';
import billingAdminService from '../services/billingAdminService';
import { useNotification } from '../contexts/NotificationContext';

const KIND_BADGE = {
    public: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    cgnat: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    private: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    hostname: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    unresolved: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    invalid: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const KIND_LABEL = {
    public: 'Publik',
    cgnat: 'CGNAT',
    private: 'Privat (perlu tunnel)',
    hostname: 'Hostname',
    unresolved: 'Tak teresolve',
    invalid: 'Tidak valid',
};

export default function CustomerCameraIPs() {
    const { success, error: showError } = useNotification();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await billingAdminService.getCameraIps();
            if (res.success) {
                setData(res.data);
            } else {
                showError('Gagal', res.message || 'Gagal memuat daftar IP.');
            }
        } catch (err) {
            showError('Gagal', err.response?.data?.message || 'Gagal memuat daftar IP.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        load();
    }, [load]);

    const publicIps = data?.public_ips || [];
    const endpoints = data?.endpoints || [];

    const copyIps = async () => {
        try {
            await navigator.clipboard.writeText(publicIps.join('\n'));
            success('Disalin', `${publicIps.length} IP publik disalin.`);
        } catch {
            showError('Gagal menyalin', 'Salin manual dari kotak di bawah.');
        }
    };

    const Badge = ({ kind }) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_BADGE[kind] || KIND_BADGE.invalid}`}>
            {KIND_LABEL[kind] || kind}
        </span>
    );

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">IP Kamera Pelanggan (Routing)</h1>
                    <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                        Daftar host/IP kamera pelanggan untuk di-route ke ISP broadband. Hanya alamat — kredensial RTSP tidak ditampilkan.
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="shrink-0 rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                    {loading ? 'Memuat…' : 'Muat ulang'}
                </button>
            </div>

            {loading ? (
                <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat & meresolve IP…</div>
            ) : (
                <>
                    {data?.summary && (
                        <div className="flex flex-wrap gap-2 text-sm">
                            <span className="rounded-xl bg-gray-100 px-3 py-1.5 text-gray-700 dark:bg-gray-800 dark:text-gray-300">Total: <b>{data.summary.total}</b></span>
                            <span className="rounded-xl bg-emerald-100 px-3 py-1.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Publik: <b>{data.summary.public_count}</b></span>
                            <span className="rounded-xl bg-gray-100 px-3 py-1.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">Privat/CGNAT: <b>{data.summary.private_count}</b></span>
                            {data.summary.unresolved_count > 0 && (
                                <span className="rounded-xl bg-red-100 px-3 py-1.5 text-red-700 dark:bg-red-900/40 dark:text-red-300">Tak teresolve: <b>{data.summary.unresolved_count}</b></span>
                            )}
                        </div>
                    )}

                    {/* The deliverable: deduplicated public IPs for the routing rule. */}
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="font-semibold text-gray-900 dark:text-white">IP Publik unik untuk routing broadband ({publicIps.length})</h2>
                            <button
                                onClick={copyIps}
                                disabled={publicIps.length === 0}
                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                            >
                                Salin
                            </button>
                        </div>
                        {publicIps.length === 0 ? (
                            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Belum ada IP publik (semua privat/CGNAT atau belum ada kamera pelanggan).</p>
                        ) : (
                            <textarea
                                readOnly
                                value={publicIps.join('\n')}
                                rows={Math.min(publicIps.length, 8)}
                                className="mt-2 w-full resize-y rounded-lg border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
                            />
                        )}
                        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">IP DDNS bisa berubah sewaktu-waktu — muat ulang sebelum memperbarui rule.</p>
                    </div>

                    {endpoints.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                            Belum ada kamera pelanggan (subscriber).
                        </div>
                    ) : (
                        <div>
                            {/* Desktop: table */}
                            <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800 md:block">
                                <table className="w-full min-w-[680px] text-sm">
                                    <thead>
                                        <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                                            <th className="px-3 py-2">Kamera</th>
                                            <th className="px-3 py-2">Pemilik</th>
                                            <th className="px-3 py-2">Host</th>
                                            <th className="px-3 py-2">IP</th>
                                            <th className="px-3 py-2 text-center">Port</th>
                                            <th className="px-3 py-2 text-center">Jenis</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {endpoints.map((e) => (
                                            <tr key={e.camera_id} className="bg-white dark:bg-gray-900">
                                                <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{e.camera_name}</td>
                                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{e.owner}</td>
                                                <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">{e.host || '—'}</td>
                                                <td className="px-3 py-2 font-mono text-xs text-gray-800 dark:text-gray-200">{e.ip || '—'}</td>
                                                <td className="px-3 py-2 text-center text-gray-500 dark:text-gray-400">{e.port || '—'}</td>
                                                <td className="px-3 py-2 text-center"><Badge kind={e.kind} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile: cards */}
                            <div className="space-y-3 md:hidden">
                                {endpoints.map((e) => (
                                    <div key={e.camera_id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-gray-900 dark:text-white">{e.camera_name}</p>
                                                <p className="text-xs text-gray-400">{e.owner}</p>
                                            </div>
                                            <Badge kind={e.kind} />
                                        </div>
                                        <p className="mt-2 font-mono text-xs text-gray-700 dark:text-gray-300">{e.ip || e.host || '—'}{e.port ? `:${e.port}` : ''}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
