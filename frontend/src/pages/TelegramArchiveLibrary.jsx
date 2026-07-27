/*
 * Purpose: Browse the Telegram recording archive from the web and play a segment back, so nobody
 *          has to open Telegram or be a member of the group.
 * Caller: Protected admin route /admin/arsip (adminOnly).
 * Deps: React hooks, telegramArchiveLibraryService, utils/admin/archiveTimeline, components/ui.
 * MainFuncs: TelegramArchiveLibrary.
 * SideEffects: Calls /api/admin/telegram-archive/library*.
 *
 * Playback goes through OUR backend, never a Telegram link: a Telegram file URL embeds the bot
 * token and is fetchable by anyone holding the string.
 *
 * Segments archived before the uploader recorded `file_id` cannot be fetched back — Telegram offers
 * no way to ask for the file_id of an already-sent message. Those rows say "Hanya di Telegram"
 * rather than showing a play button that would fail.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import archiveLibrary from '../services/telegramArchiveLibraryService';
import { Badge, Button, Field, Modal, PageHeader, StatTile } from '../components/ui';
import { TableSkeleton } from '../components/ui/Skeleton';
import { buildTimeline, findSegmentAt, formatDuration, segmentWindow } from '../utils/admin/archiveTimeline';

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * A hole in the timeline. Drawn in `warn`, never `fault`: footage that was never captured is not a
 * broken system — but it IS the thing an operator must not discover by accident.
 */
function GapRow({ item }) {
    return (
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-dashed border-status-warn/40 bg-status-warn/5 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-status-warn">Tidak ada rekaman</span>
            <span className="font-mono text-sm tabular-nums text-content">{item.label}</span>
            <span className="font-mono text-xs tabular-nums text-content-muted">
                selama {formatDuration(item.seconds)}
            </span>
        </li>
    );
}

function SegmentRow({ row, win, highlighted, onPlay }) {
    return (
        <li
            id={`seg-${row.segmentId}`}
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border p-3 transition-colors ${
                highlighted ? 'border-primary bg-primary-100' : 'border-edge bg-surface'
            }`}
        >
            <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-semibold text-content">{row.cameraName}</p>
                {row.areaName && <p className="truncate text-xs text-content-subtle">{row.areaName}</p>}
            </div>

            <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-semibold tabular-nums text-content">{win.range}</p>
                <p className="font-mono text-xs tabular-nums text-content-subtle">
                    {[win.duration, formatSize(row.fileSize)].filter(Boolean).join(' · ')}
                </p>
            </div>

            <div className="shrink-0">
                {row.playable ? (
                    <Button size="sm" variant={highlighted ? 'primary' : 'secondary'} onClick={() => onPlay(row)}>
                        Putar
                    </Button>
                ) : (
                    <Badge tone="neutral">Hanya di Telegram</Badge>
                )}
            </div>
        </li>
    );
}

export default function TelegramArchiveLibrary() {
    const { error: notifyError, warning: notifyWarning } = useNotification();
    const [summary, setSummary] = useState(null);
    const [rows, setRows] = useState([]);
    const [cameraId, setCameraId] = useState('');
    const [jumpTo, setJumpTo] = useState('');
    const [highlighted, setHighlighted] = useState(null);
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [sum, list] = await Promise.all([
                archiveLibrary.getSummary(),
                archiveLibrary.listUploads({ cameraId: cameraId || undefined }),
            ]);
            setSummary(sum);
            setRows(list);
        } catch (err) {
            notifyError('Gagal memuat arsip', err?.response?.data?.message || err.message);
        } finally {
            setLoading(false);
        }
    }, [cameraId, notifyError]);

    useEffect(() => { load(); }, [load]);

    const cameras = useMemo(() => summary?.cameras ?? [], [summary]);
    const notPlayable = Math.max((summary?.total ?? 0) - (summary?.playable ?? 0), 0);

    // Gaps are only meaningful along ONE camera's timeline. Across a mixed feed, a "hole" between
    // two different cameras means nothing — drawing one would be a false alarm, so we don't.
    const singleCamera = Boolean(cameraId);
    const days = useMemo(() => buildTimeline(rows, { detectGaps: singleCamera }), [rows, singleCamera]);

    const handleJump = (event) => {
        event.preventDefault();
        const found = findSegmentAt(rows, jumpTo);
        if (!found) {
            notifyWarning('Tidak ketemu', `Tidak ada rekaman di sekitar ${jumpTo}.`);
            return;
        }
        setHighlighted(found.segmentId);
        document.getElementById(`seg-${found.segmentId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (found._approximate) {
            notifyWarning('Tidak persis', `Tidak ada klip yang memuat ${jumpTo}; ini yang terdekat.`);
        }
    };

    return (
        <div className="space-y-5">
            <PageHeader
                title="Arsip Rekaman"
                description="Rekaman yang sudah dikirim ke Telegram, bisa ditonton langsung di sini tanpa membuka Telegram."
                actions={<Button onClick={load} disabled={loading}>Muat ulang</Button>}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatTile label="Segmen terarsip" value={summary?.total ?? 0} />
                <StatTile label="Bisa diputar di web" value={summary?.playable ?? 0} tone="data" />
                <StatTile label="Total ukuran" value={formatSize(summary?.bytes)} tone="data" />
            </div>

            {notPlayable > 0 && (
                <div className="rounded-card border border-status-warn/30 bg-status-warn/10 p-4">
                    <p className="text-sm font-semibold text-status-warn">
                        {notPlayable} segmen hanya bisa dibuka di Telegram
                    </p>
                    <p className="mt-1 text-sm text-content-muted">
                        Segmen itu terarsip sebelum sistem mencatat penanda berkasnya. Telegram tidak
                        menyediakan cara menanyakan penanda untuk pesan yang sudah terkirim, jadi data
                        lama tidak bisa disusulkan. Segmen baru tercatat otomatis.
                    </p>
                </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
                <Field
                    as="select"
                    label="Kamera"
                    value={cameraId}
                    onChange={(e) => { setCameraId(e.target.value); setHighlighted(null); }}
                    className="min-w-0 flex-1 sm:max-w-xs"
                    hint={singleCamera ? undefined : 'Pilih satu kamera untuk melihat celah rekaman'}
                >
                    <option value="">Semua kamera ({summary?.total ?? 0} segmen)</option>
                    {cameras.map((camera) => (
                        <option key={camera.id} value={camera.id}>
                            {camera.name} ({camera.segments})
                        </option>
                    ))}
                </Field>

                <form onSubmit={handleJump} className="flex items-end gap-2">
                    <Field
                        label="Lompat ke jam"
                        value={jumpTo}
                        onChange={(e) => setJumpTo(e.target.value)}
                        placeholder="19:36"
                        inputMode="numeric"
                        className="w-28"
                    />
                    <Button type="submit" disabled={!jumpTo.trim()}>Cari</Button>
                </form>
            </div>

            {loading ? (
                <TableSkeleton rows={6} columns={4} />
            ) : days.length === 0 ? (
                <div className="rounded-card border border-edge bg-surface px-4 py-12 text-center">
                    <p className="text-sm text-content-muted">Belum ada segmen terarsip untuk pilihan ini.</p>
                </div>
            ) : (
                days.map((group) => (
                    <section key={group.key} className="space-y-2">
                        {/* Date once per group, not repeated on every row. */}
                        <h2 className="sticky top-0 z-sticky bg-surface-sunken py-1 text-xs font-semibold uppercase tracking-wide text-content-subtle">
                            {group.label}
                        </h2>
                        <ul className="space-y-2">
                            {group.items.map((item, index) => (
                                item.kind === 'gap' ? (
                                    <GapRow key={`gap-${group.key}-${index}`} item={item} />
                                ) : (
                                    <SegmentRow
                                        key={item.row.segmentId}
                                        row={item.row}
                                        win={item.win}
                                        highlighted={highlighted === item.row.segmentId}
                                        onPlay={setPlaying}
                                    />
                                )
                            ))}
                        </ul>
                    </section>
                ))
            )}

            {playing && (
                <Modal
                    title={playing.cameraName}
                    description={(() => {
                        const w = segmentWindow(playing);
                        return [w.range, w.duration, formatSize(playing.fileSize)].filter(Boolean).join(' · ');
                    })()}
                    size="xl"
                    onClose={() => setPlaying(null)}
                    footer={(
                        <Button
                            variant="primary"
                            onClick={() => window.open(archiveLibrary.streamUrl(playing.segmentId), '_blank', 'noopener')}
                        >
                            Buka di tab baru
                        </Button>
                    )}
                >
                    <video
                        key={playing.segmentId}
                        src={archiveLibrary.streamUrl(playing.segmentId)}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full rounded-control bg-black"
                    />
                </Modal>
            )}
        </div>
    );
}
