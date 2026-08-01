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
import { Badge, Button, Field, Modal, PageHeader } from '../components/ui';
import { TableSkeleton } from '../components/ui/Skeleton';
import { buildTimeline, findSegmentAt, formatDuration, segmentWindow } from '../utils/admin/archiveTimeline';

const DownloadIcon = () => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
);

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
            className={`flex items-center gap-3 rounded-card border p-3 transition-colors ${
                highlighted ? 'border-primary bg-primary-100' : 'border-edge bg-surface'
            }`}
        >
            {/*
              * The time leads. It is what the operator is scanning for, and mono/tabular keeps the
              * digits in one column down the whole list so the eye can run straight down it.
              */}
            <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold tabular-nums text-content">{win.range}</p>
                {/* Name on its own line: it was truncating at "CCTV ALANG ALANG KE…" while the row
                  * still had room. A phone has height to spend, not width. */}
                <p className="mt-0.5 truncate text-xs text-content-muted">{row.cameraName}</p>
                <p className="mt-0.5 truncate font-mono text-xs tabular-nums text-content-subtle">
                    {[win.duration, formatSize(row.fileSize), row.areaName].filter(Boolean).join(' · ')}
                </p>
            </div>

            <div className="shrink-0">
                {row.playable ? (
                    <Button size="sm" variant={highlighted ? 'primary' : 'secondary'} onClick={() => onPlay(row)}>
                        Putar
                    </Button>
                ) : (
                    <Badge tone="neutral">Telegram</Badge>
                )}
            </div>
        </li>
    );
}

// One request covers ~33 minutes of a 30-camera fleet, or ~2 weeks of a single camera. Big enough
// that browsing rarely needs a second click, small enough to stay under the backend's 500 cap.
const PAGE_SIZE = 200;

export default function TelegramArchiveLibrary() {
    const { error: notifyError, warning: notifyWarning } = useNotification();
    const [summary, setSummary] = useState(null);
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [cameraId, setCameraId] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [jumpTo, setJumpTo] = useState('');
    const [highlighted, setHighlighted] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [playing, setPlaying] = useState(null);

    const filters = useMemo(() => ({
        cameraId: cameraId || undefined,
        from: archiveLibrary.dayBounds(from, 'start'),
        to: archiveLibrary.dayBounds(to, 'end'),
    }), [cameraId, from, to]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [sum, page] = await Promise.all([
                archiveLibrary.getSummary(),
                archiveLibrary.listUploads({ ...filters, limit: PAGE_SIZE, offset: 0 }),
            ]);
            setSummary(sum);
            setRows(page.items);
            setTotal(page.total);
        } catch (err) {
            notifyError('Gagal memuat arsip', err?.response?.data?.message || err.message);
        } finally {
            setLoading(false);
        }
    }, [filters, notifyError]);

    // Paged by the CURRENT row count, so rows that arrive while browsing cannot shift the window
    // and make a segment appear twice or get skipped.
    const loadMore = useCallback(async () => {
        setLoadingMore(true);
        try {
            const page = await archiveLibrary.listUploads({
                ...filters, limit: PAGE_SIZE, offset: rows.length,
            });
            const seen = new Set(rows.map((row) => row.segmentId));
            setRows((prev) => [...prev, ...page.items.filter((row) => !seen.has(row.segmentId))]);
            setTotal(page.total);
        } catch (err) {
            notifyError('Gagal memuat lagi', err?.response?.data?.message || err.message);
        } finally {
            setLoadingMore(false);
        }
    }, [filters, rows, notifyError]);

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
        <div className="space-y-4">
            <PageHeader
                title="Arsip Rekaman"
                description="Tersimpan di Telegram, diputar dari sini."
                actions={<Button onClick={load} disabled={loading}>Muat ulang</Button>}
            />

            {/*
              * One strip, not three stacked tiles. Full-size StatTiles put ~700px of chrome above
              * the first record on a phone — 65% of the screen spent before any content. These
              * three numbers are context for the list, so they get one line of it.
              */}
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-edge bg-surface px-4 py-3">
                {[
                    { label: 'Segmen', value: summary?.total ?? 0 },
                    { label: 'Bisa diputar', value: summary?.playable ?? 0, tone: 'text-data' },
                    { label: 'Ukuran', value: formatSize(summary?.bytes), tone: 'text-data' },
                ].map((stat) => (
                    <div key={stat.label} className="flex items-baseline gap-2">
                        <dt className="text-xs text-content-subtle">{stat.label}</dt>
                        <dd className={`font-mono text-base font-bold tabular-nums ${stat.tone || 'text-content'}`}>
                            {stat.value}
                        </dd>
                    </div>
                ))}
            </dl>

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

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field
                    as="select"
                    label="Kamera"
                    value={cameraId}
                    onChange={(e) => { setCameraId(e.target.value); setHighlighted(null); }}
                    className="min-w-0 sm:flex-1 sm:max-w-sm"
                >
                    <option value="">Semua kamera · {summary?.total ?? 0} segmen</option>
                    {cameras.map((camera) => (
                        <option key={camera.id} value={camera.id}>
                            {camera.name} · {camera.segments}
                        </option>
                    ))}
                </Field>

                <Field
                    type="date"
                    label="Dari tanggal"
                    value={from}
                    onChange={(e) => { setFrom(e.target.value); setHighlighted(null); }}
                    max={to || undefined}
                    className="w-40 shrink-0"
                />
                <Field
                    type="date"
                    label="Sampai tanggal"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); setHighlighted(null); }}
                    min={from || undefined}
                    className="w-40 shrink-0"
                />

                <form onSubmit={handleJump} className="flex items-end gap-2">
                    <Field
                        label="Lompat ke jam"
                        value={jumpTo}
                        onChange={(e) => setJumpTo(e.target.value)}
                        placeholder="19:36"
                        inputMode="numeric"
                        className="w-24 shrink-0"
                    />
                    <Button type="submit" disabled={!jumpTo.trim()}>Cari</Button>
                </form>
            </div>

            {(from || to) && (
                <div className="flex items-center gap-3">
                    <p className="text-xs text-content-subtle">
                        Disaring per tanggal. &ldquo;Lompat ke jam&rdquo; hanya mencari di dalam hasil yang sudah dimuat.
                    </p>
                    <Button size="sm" variant="secondary" onClick={() => { setFrom(''); setTo(''); }}>
                        Hapus filter
                    </Button>
                </div>
            )}

            {!singleCamera && !loading && days.length > 0 && (
                // Said HERE, where the absence of gap markers is what needs explaining — not as a
                // hint under a select, where it pushed the two controls off a shared baseline.
                <p className="text-xs text-content-subtle">
                    Celah rekaman hanya ditandai saat satu kamera dipilih.
                </p>
            )}

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

            {/*
              * Always state how much is loaded against how much exists. The old page showed the
              * newest 100 rows with no counter and no way forward, so a list that stopped at last
              * night looked like an archive that stopped at last night.
              */}
            {!loading && rows.length > 0 && (
                <div className="flex flex-col items-center gap-2 py-2">
                    <p className="font-mono text-xs tabular-nums text-content-subtle">
                        {rows.length} dari {total} segmen
                    </p>
                    {rows.length < total ? (
                        <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                            {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
                        </Button>
                    ) : (
                        <p className="text-xs text-content-subtle">Semua segmen sudah ditampilkan.</p>
                    )}
                </div>
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
                    bodyClassName=""
                    footer={(
                        <>
                            {/*
                              * Both actions are SUBORDINATE. The primary action on this screen is
                              * watching, and that is the video itself — a full-width brand-red bar
                              * for an escape hatch competed with the footage it sits under.
                              */}
                            <Button
                                size="sm"
                                onClick={() => window.open(archiveLibrary.streamUrl(playing.segmentId), '_blank', 'noopener')}
                            >
                                Tab baru
                            </Button>
                            <Button
                                size="sm"
                                icon={<DownloadIcon />}
                                onClick={() => {
                                    // Evidence work means keeping a copy, not just viewing one.
                                    const a = document.createElement('a');
                                    a.href = archiveLibrary.streamUrl(playing.segmentId);
                                    a.download = playing.filename || 'rekaman.mp4';
                                    a.click();
                                }}
                            >
                                Unduh
                            </Button>
                        </>
                    )}
                >
                    {/*
                      * aspect-video reserves the box BEFORE metadata arrives, so the sheet does not
                      * resize under the finger the moment the first frame decodes.
                      */}
                    <div className="aspect-video w-full bg-black">
                        <video
                            key={playing.segmentId}
                            src={archiveLibrary.streamUrl(playing.segmentId)}
                            controls
                            autoPlay
                            playsInline
                            preload="metadata"
                            className="h-full w-full"
                        />
                    </div>
                </Modal>
            )}
        </div>
    );
}
