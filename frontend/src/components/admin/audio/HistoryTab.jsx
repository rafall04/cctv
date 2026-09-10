/*
 * Purpose: "Riwayat & Bukti" tab — a dedicated, always-visible log of every broadcast (manual, scheduled,
 *   adzan/qori, motion, emergency) with WHEN (WIB), WHO, and the per-camera delivery receipt. Before this,
 *   the history was buried below the "Putar Sekarang" form and only appeared when non-empty, so an operator
 *   could not answer "was the 6am announcement delivered?" to the kepala desa.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService.getPlayHistory, components/ui, audioFormatting.
 * MainFuncs: HistoryTab.
 * SideEffects: polls the broadcast history while mounted.
 */

import { useCallback, useEffect, useState } from 'react';
import { getPlayHistory } from '../../../services/audioService';
import { EmptyState } from '../../ui';

// created_at is a UTC "YYYY-MM-DD HH:MM:SS" string; show it in local (WIB) wall-clock.
const fmtTime = (utc) => {
    if (!utc) return '';
    const d = new Date(`${String(utc).replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return String(utc);
    try { return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return d.toISOString(); }
};

// Human label + tone from the source type / name prefix the loggers use.
const kindOf = (h) => {
    const n = String(h.source_name || '');
    if (n.startsWith('ADZAN') || n.startsWith('Adzan')) return { label: 'Adzan', cls: 'bg-status-live/10 text-status-live' };
    if (n.startsWith('Qori')) return { label: 'Qori', cls: 'bg-status-live/10 text-status-live' };
    if (n.startsWith('DARURAT')) return { label: 'Darurat', cls: 'bg-status-fault/10 text-status-fault' };
    if (n.startsWith('JADWAL')) return { label: 'Jadwal', cls: 'bg-primary/10 text-primary' };
    if (h.operator_name === 'motion-auto') return { label: 'Motion', cls: 'bg-status-warn/10 text-status-warn' };
    return { label: 'Manual', cls: 'bg-surface-sunken text-content-muted' };
};

export default function HistoryTab() {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [openId, setOpenId] = useState(null);

    const load = useCallback(async () => {
        const r = await getPlayHistory();
        if (r.success) setHistory(r.data || []);
        setLoading(false);
    }, []);
    useEffect(() => {
        load();
        const t = setInterval(load, 8000);
        return () => clearInterval(t);
    }, [load]);

    if (loading) return <p className="text-sm text-content-muted">Memuat riwayat…</p>;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-content">Riwayat &amp; Bukti Siaran</h3>
                    <p className="mt-0.5 text-xs text-content-muted">Semua siaran (manual, jadwal, adzan/qori, motion, darurat) dengan jam, operator, dan bukti terkirim per kamera.</p>
                </div>
                <button type="button" onClick={load} className="shrink-0 text-xs font-medium text-primary hover:underline">Muat ulang</button>
            </div>

            {history.length === 0 ? (
                <EmptyState title="Belum ada siaran" description="Setiap kali audio disiarkan (sekarang atau otomatis), buktinya muncul di sini." />
            ) : (
                <ul className="space-y-2">
                    {history.map((h) => {
                        const k = kindOf(h);
                        const dot = h.ok_count === 0 ? 'bg-status-fault' : h.ok_count < h.total_count ? 'bg-status-warn' : 'bg-status-live';
                        const open = openId === h.id;
                        return (
                            <li key={h.id} className="rounded-card border border-edge bg-surface p-3 shadow-e1">
                                <button type="button" onClick={() => setOpenId(open ? null : h.id)} className="flex w-full items-center gap-3 text-left">
                                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-2">
                                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${k.cls}`}>{k.label}</span>
                                            <span className="min-w-0 truncate text-sm font-semibold text-content">{h.source_name || `#${h.source_id}`}</span>
                                        </span>
                                        <span className="mt-0.5 block text-xs text-content-subtle">
                                            {fmtTime(h.created_at)} · {h.ok_count}/{h.total_count} kamera{h.operator_name ? ` · ${h.operator_name}` : ''}
                                        </span>
                                    </span>
                                    <span className="shrink-0 text-xs text-content-subtle">{open ? '▲' : 'Rincian ▾'}</span>
                                </button>
                                {open && (
                                    <ul className="mt-2 space-y-1 border-t border-edge pt-2">
                                        {(h.results || []).map((r, i) => (
                                            <li key={r.cameraId ?? i} className="flex items-center gap-2 text-xs">
                                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? 'bg-status-live' : 'bg-status-fault'}`} aria-hidden="true" />
                                                <span className="min-w-0 flex-1 truncate text-content-muted">{r.name || `#${r.cameraId}`}</span>
                                                <span className={`shrink-0 ${r.ok ? 'text-status-live' : 'text-status-fault'}`}>{r.ok ? 'terkirim' : (r.message || 'gagal')}</span>
                                            </li>
                                        ))}
                                        {(!h.results || h.results.length === 0) && <li className="text-xs text-content-subtle">Tak ada rincian per kamera.</li>}
                                    </ul>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
