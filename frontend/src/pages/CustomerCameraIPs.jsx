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
import { Button, Card, PageHeader, TableShell } from '../components/ui';

const KIND_BADGE = {
    public: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    cgnat: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    private: 'bg-surface-sunken text-content-muted',
    hostname: 'bg-primary-100 text-primary dark:bg-sky-900/40 text-primary',
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


// Module level: defined inside the page this was a new component type per render,
// remounting every row badge on each state change.
function Badge({ kind }) {
    return (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_BADGE[kind] || KIND_BADGE.invalid}`}>
            {KIND_LABEL[kind] || kind}
        </span>
    );
}

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

    return (
        <div className="space-y-5">
            <PageHeader
                title="IP Kamera Pelanggan (Routing)"
                description="Daftar host/IP kamera pelanggan untuk di-route ke ISP broadband. Hanya alamat — kredensial RTSP tidak ditampilkan."
                /* Was a hand-rolled <button> with `focus:` chrome only and a 36px box on touch;
                   ui/Button carries the focus-visible ring, the 44px floor and the busy state. */
                actions={(
                    <Button onClick={load} loading={loading}>
                        {loading ? 'Memuat…' : 'Muat ulang'}
                    </Button>
                )}
            />

            {loading ? (
                <div className="py-16 text-center text-content-muted">Memuat & meresolve IP…</div>
            ) : (
                <>
                    {data?.summary && (
                        <div className="flex flex-wrap gap-2 text-sm">
                            <span className="rounded-xl bg-surface-sunken px-3 py-1.5 text-content-muted">Total: <b>{data.summary.total}</b></span>
                            <span className="rounded-xl bg-emerald-100 px-3 py-1.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Publik: <b>{data.summary.public_count}</b></span>
                            <span className="rounded-xl bg-surface-sunken px-3 py-1.5 text-content-muted">Privat/CGNAT: <b>{data.summary.private_count}</b></span>
                            {data.summary.unresolved_count > 0 && (
                                <span className="rounded-xl bg-red-100 px-3 py-1.5 text-red-700 dark:bg-red-900/40 dark:text-red-300">Tak teresolve: <b>{data.summary.unresolved_count}</b></span>
                            )}
                        </div>
                    )}

                    {/* The deliverable: deduplicated public IPs for the routing rule. */}
                    <Card>
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="font-semibold text-content">IP Publik unik untuk routing broadband ({publicIps.length})</h2>
                            <button
                                onClick={copyIps}
                                disabled={publicIps.length === 0}
                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                            >
                                Salin
                            </button>
                        </div>
                        {publicIps.length === 0 ? (
                            <p className="mt-2 text-sm text-content-muted">Belum ada IP publik (semua privat/CGNAT atau belum ada kamera pelanggan).</p>
                        ) : (
                            <textarea
                                readOnly
                                value={publicIps.join('\n')}
                                rows={Math.min(publicIps.length, 8)}
                                className="mt-2 w-full resize-y rounded-lg border border-edge bg-surface-sunken p-2 font-mono text-xs text-content"
                            />
                        )}
                        <p className="mt-2 text-xs text-content-subtle">IP DDNS bisa berubah sewaktu-waktu — muat ulang sebelum memperbarui rule.</p>
                    </Card>

                    {endpoints.length === 0 ? (
                        <div className="rounded-card border border-dashed border-edge px-4 py-12 text-center text-sm text-content-muted">
                            Belum ada kamera pelanggan (subscriber).
                        </div>
                    ) : (
                        <div>
                            {/* Desktop: table */}
                            <TableShell className="hidden md:block">
                                <table className="w-full min-w-[680px] text-sm">
                                    <thead>
                                        <tr className="text-left text-xs uppercase text-content-muted">
                                            <th className="px-3 py-2">Kamera</th>
                                            <th className="px-3 py-2">Pemilik</th>
                                            <th className="px-3 py-2">Host</th>
                                            <th className="px-3 py-2">IP</th>
                                            <th className="px-3 py-2 text-center">Port</th>
                                            <th className="px-3 py-2 text-center">Jenis</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-edge">
                                        {endpoints.map((e) => (
                                            <tr key={e.camera_id}>
                                                <td className="px-3 py-2 font-medium text-content">{e.camera_name}</td>
                                                <td className="px-3 py-2 text-content-muted">{e.owner}</td>
                                                <td className="px-3 py-2 font-mono text-xs text-content-muted">{e.host || '—'}</td>
                                                <td className="px-3 py-2 font-mono text-xs text-content">{e.ip || '—'}</td>
                                                <td className="px-3 py-2 text-center text-content-muted">{e.port || '—'}</td>
                                                <td className="px-3 py-2 text-center"><Badge kind={e.kind} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableShell>

                            {/* Mobile: cards */}
                            <div className="space-y-3 md:hidden">
                                {endpoints.map((e) => (
                                    <Card key={e.camera_id}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-content">{e.camera_name}</p>
                                                <p className="break-words text-xs text-content-subtle">{e.owner}</p>
                                            </div>
                                            <Badge kind={e.kind} />
                                        </div>
                                        {/* Host/IP is one unbreakable token (a full IPv6 is 39 chars): without break-all its
                                            ink overflows the card and pushes the admin shell sideways at 1.5x font. */}
                                        <p className="mt-2 break-all font-mono text-xs text-content-muted">{e.ip || e.host || '—'}{e.port ? `:${e.port}` : ''}</p>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
