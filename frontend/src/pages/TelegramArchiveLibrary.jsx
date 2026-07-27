/*
 * Purpose: Browse the Telegram recording archive from the web and play a segment back, so nobody
 *          has to open Telegram or be a member of the group.
 * Caller: Protected admin route /admin/arsip (adminOnly).
 * Deps: React hooks, telegramArchiveLibraryService, components/ui primitives, NotificationContext.
 * MainFuncs: TelegramArchiveLibrary.
 * SideEffects: Calls /api/admin/telegram-archive/library*.
 *
 * Playback goes through OUR backend, never a Telegram link: a Telegram file URL embeds the bot
 * token and is fetchable by anyone holding the string.
 *
 * Segments archived before the uploader started recording `file_id` cannot be fetched back —
 * Telegram offers no way to ask for the file_id of an already-sent message. Those rows are listed
 * honestly as "hanya di Telegram" rather than given a play button that would fail.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import archiveLibrary from '../services/telegramArchiveLibraryService';
import { Badge, Button, Field, Modal, PageHeader, StatTile } from '../components/ui';
import { TableSkeleton } from '../components/ui/Skeleton';

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function parseWhen(value) {
    if (!value) return null;
    // Segment times are stored as local SQL ('YYYY-MM-DD HH:MM:SS'), already in the box's zone —
    // appending 'Z' would shift every label by the UTC offset.
    const parsed = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const clock = (d) => d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const day = (d) => d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

function formatDuration(seconds) {
    const total = Math.round(Number(seconds) || 0);
    if (!total) return null;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m && s) return `${m} mnt ${s} dtk`;
    return m ? `${m} mnt` : `${s} dtk`;
}

/**
 * A CCTV segment is a RANGE. Showing only its start ("19.32") leaves an operator guessing how much
 * footage a row covers, when what they are hunting for is "the clip that contains 19.36".
 */
function segmentWindow(row) {
    const start = parseWhen(row.recordedAt);
    const end = parseWhen(row.recordedUntil);
    if (!start) return { date: '—', range: '—', duration: null };
    return {
        date: day(start),
        range: end ? `${clock(start)} – ${clock(end)}` : clock(start),
        duration: formatDuration(row.durationSeconds),
    };
}

export default function TelegramArchiveLibrary() {
    const { error: notifyError } = useNotification();
    const [summary, setSummary] = useState(null);
    const [rows, setRows] = useState([]);
    const [cameraId, setCameraId] = useState('');
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

            <Field
                as="select"
                label="Kamera"
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
                className="sm:max-w-xs"
            >
                <option value="">Semua kamera ({summary?.total ?? 0} segmen)</option>
                {cameras.map((camera) => (
                    <option key={camera.id} value={camera.id}>
                        {camera.name} ({camera.segments})
                    </option>
                ))}
            </Field>

            {loading ? (
                <TableSkeleton rows={6} columns={5} />
            ) : rows.length === 0 ? (
                <div className="rounded-card border border-edge bg-surface px-4 py-12 text-center">
                    <p className="text-sm text-content-muted">Belum ada segmen terarsip untuk pilihan ini.</p>
                </div>
            ) : (
                /*
                 * A list, not a table. The table forced horizontal scroll on a phone and pushed the
                 * Putar button off-screen entirely — the feature was unusable on mobile. The
                 * filename column is gone too: it IS the timestamp in another format.
                 */
                <ul className="space-y-2">
                    {rows.map((row) => {
                        const when = segmentWindow(row);
                        return (
                            <li
                                key={row.segmentId}
                                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-edge bg-surface p-3"
                            >
                                <div className="min-w-0 flex-1 basis-40">
                                    <p className="truncate text-sm font-semibold text-content">{row.cameraName}</p>
                                    <p className="truncate text-xs text-content-subtle">
                                        {row.areaName ? `${row.areaName} · ` : ''}{when.date}
                                    </p>
                                </div>

                                <div className="shrink-0 text-right">
                                    <p className="font-mono text-sm font-semibold tabular-nums text-content">
                                        {when.range}
                                    </p>
                                    <p className="font-mono text-xs tabular-nums text-content-subtle">
                                        {[when.duration, formatSize(row.fileSize)].filter(Boolean).join(' · ')}
                                    </p>
                                </div>

                                <div className="shrink-0">
                                    {row.playable ? (
                                        <Button size="sm" onClick={() => setPlaying(row)}>Putar</Button>
                                    ) : (
                                        <Badge tone="neutral">Hanya di Telegram</Badge>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {playing && (
                <Modal
                    title={playing.cameraName}
                    description={`${segmentWindow(playing).date} · ${segmentWindow(playing).range}`
                        + `${segmentWindow(playing).duration ? ` · ${segmentWindow(playing).duration}` : ''}`
                        + ` · ${formatSize(playing.fileSize)}`}
                    size="xl"
                    onClose={() => setPlaying(null)}
                    footer={(
                        <Button
                            as="a"
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
