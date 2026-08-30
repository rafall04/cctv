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
 * Segments archived before the uploader recorded `file_id` cannot be fetched back — the archive
 * backend offers no way to ask for the file_id of an already-sent message. Those rows show an
 * "Arsip lama" badge rather than a play button that would fail.
 *
 * USER-FACING COPY IS DELIBERATELY APP-NAME-NEUTRAL. The archive backend is Telegram, but that is
 * an implementation detail an operator (and anyone who sees a screenshot) does not need — every
 * VISIBLE string here says "arsip cloud" / "arsip lama", never the product name. Keep it that way:
 * do not put the vendor name back into any rendered text. (Code identifiers, comments, the route,
 * and the service name may keep it — they never reach the screen and are stripped from the build.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import archiveLibrary from '../services/telegramArchiveLibraryService';
import { Badge, Button, Field, IconButton, Modal, PageHeader } from '../components/ui';
import ArchiveVideo from '../components/admin/archive/ArchiveVideo';
import PlaybackCameraPicker from '../components/playback/PlaybackCameraPicker';
import { TableSkeleton } from '../components/ui/Skeleton';
import { buildTimeline, findSegmentAt, formatDuration, segmentWindow } from '../utils/admin/archiveTimeline';

const DownloadIcon = () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
);

const NewTabIcon = () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5M21 3h-6m6 0v6m0-6L10.5 13.5" />
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

function SegmentRow({ row, win, highlighted, showCamera, onPlay }) {
    return (
        <li
            id={`seg-${row.segmentId}`}
            className={`flex items-center gap-3 rounded-card border p-3 transition-colors ${
                highlighted ? 'border-primary bg-primary/10' : 'border-edge bg-surface'
            }`}
        >
            {/*
              * The time leads. It is what the operator is scanning for, and mono/tabular keeps the
              * digits in one column down the whole list so the eye can run straight down it.
              */}
            <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold tabular-nums text-content">{win.range}</p>
                {/*
                  * Camera and area only earn their space when the list actually MIXES cameras. Once
                  * one is picked, every row repeated the same name plus a truncated "KEC BOJONEG…",
                  * spending two lines per card to say what the filter above already says — on a
                  * phone that is most of the card telling you nothing.
                  *
                  * Name on its own line (when shown): it was truncating at "CCTV ALANG ALANG KE…"
                  * while the row still had room. A phone has height to spend, not width.
                  */}
                {showCamera && <p className="mt-0.5 truncate text-xs text-content-muted">{row.cameraName}</p>}
                <p className="mt-0.5 truncate font-mono text-xs tabular-nums text-content-subtle">
                    {[win.duration, formatSize(row.fileSize), showCamera ? row.areaName : null]
                        .filter(Boolean).join(' · ')}
                </p>
            </div>

            <div className="shrink-0">
                {row.playable ? (
                    <Button size="sm" variant={highlighted ? 'primary' : 'secondary'} onClick={() => onPlay(row)}>
                        Putar
                    </Button>
                ) : (
                    <Badge tone="neutral">Arsip lama</Badge>
                )}
            </div>
        </li>
    );
}

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

/**
 * Local calendar date, N days from today, as YYYY-MM-DD for <input type="date">.
 *
 * Built from LOCAL parts on purpose. toISOString() is UTC, so for WIB (+7) any moment before 07:00
 * lands on the previous day — "Hari ini" would silently mean yesterday all morning.
 */
function localDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const RANGE_PRESETS = [
    { label: 'Hari ini', build: () => [localDate(0), localDate(0)] },
    { label: 'Kemarin', build: () => [localDate(-1), localDate(-1)] },
    { label: '7 hari', build: () => [localDate(-6), localDate(0)] },
];

/**
 * "19:36" -> the instant the operator means, as an ISO string.
 *
 * A bare wall-clock time needs a day to become a moment. When a date range is set the operator has
 * already said which day; without one, the most recent occurrence is meant — which is yesterday if
 * that time has not come round yet today.
 */
function instantFromTime(hhmm, { from, to }) {
    const match = /^(\d{1,2})[.:](\d{2})$/.exec(String(hhmm).trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;

    const anchor = to || from;
    const target = anchor ? new Date(`${anchor}T00:00:00`) : new Date();
    if (Number.isNaN(target.getTime())) return null;
    target.setHours(hours, minutes, 0, 0);
    if (!anchor && target.getTime() > Date.now()) {
        target.setDate(target.getDate() - 1);
    }
    return target.toISOString();
}

export default function TelegramArchiveLibrary() {
    const { error: notifyError, warning: notifyWarning } = useNotification();
    const [summary, setSummary] = useState(null);
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [cameraId, setCameraId] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [page, setPage] = useState(0);
    const [jumpTo, setJumpTo] = useState('');
    const [jumping, setJumping] = useState(false);
    const [highlighted, setHighlighted] = useState(null);
    // Set when a jump lands on ANOTHER page: the row does not exist yet, so the scroll has to wait
    // for that page to finish loading rather than fire against a DOM that has not caught up.
    const [pendingScroll, setPendingScroll] = useState(null);
    // `ready` = the list has content to show at least once; `busy` = a fetch is in flight.
    // They are separate because blanking the list on every page click was what made paging feel
    // like a page reload — and what silently scrolled the view to the top (see load()).
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(true);
    const [playing, setPlaying] = useState(null);

    const filters = useMemo(() => ({
        cameraId: cameraId || undefined,
        from: archiveLibrary.dayBounds(from, 'start'),
        to: archiveLibrary.dayBounds(to, 'end'),
    }), [cameraId, from, to]);

    // Any change to WHAT is being listed invalidates the position within it. Without this, changing
    // camera while on page 40 asks for an offset that filter may not even have.
    useEffect(() => { setPage(0); setHighlighted(null); }, [filters, pageSize]);

    // The header figures depend on the FILTERS only — never on which page is open. Refetching them
    // on every page click was a wasted request per tap, and it made paging slower than it is.
    useEffect(() => {
        let cancelled = false;
        archiveLibrary.getSummary(filters)
            .then((sum) => { if (!cancelled) setSummary(sum); })
            .catch((err) => {
                if (!cancelled) notifyError('Gagal memuat ringkasan', err?.response?.data?.message || err.message);
            });
        return () => { cancelled = true; };
    }, [filters, notifyError]);

    // Tapping Berikutnya twice quickly leaves two requests racing. Without a guard the slower one
    // can land last and put the earlier page back on screen — so only the newest request may write.
    const requestRef = useRef(0);

    const load = useCallback(async () => {
        const ticket = ++requestRef.current;
        setBusy(true);
        try {
            const result = await archiveLibrary.listUploads({
                ...filters, limit: pageSize, offset: page * pageSize,
            });
            if (ticket !== requestRef.current) return;
            setRows(result.items);
            setTotal(result.total);
            setReady(true);
        } catch (err) {
            if (ticket !== requestRef.current) return;
            notifyError('Gagal memuat arsip', err?.response?.data?.message || err.message);
        } finally {
            if (ticket === requestRef.current) setBusy(false);
        }
    }, [filters, page, pageSize, notifyError]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!pendingScroll || busy) {
            return;
        }
        const el = document.getElementById(`seg-${pendingScroll}`);
        if (!el) {
            return;
        }
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setPendingScroll(null);
    }, [pendingScroll, busy, rows]);

    const pageCount = Math.max(Math.ceil(total / pageSize), 1);
    // The archive grows ~200 rows/hour, so a page deep in an UNFILTERED list drifts as new segments
    // push older ones down. Say so rather than let a segment seem to vanish between clicks; picking
    // a date range pins the window and makes paging exact.
    const driftWarning = page > 0 && !filters.from && !filters.to;

    const cameras = useMemo(() => summary?.cameras ?? [], [summary]);
    // summary.total now honours the camera filter, so it is NOT the right number for the "all
    // cameras" option — that one has to ignore the current camera. The per-camera counts already
    // do (they only honour the date range), so their sum is the honest figure.
    const totalAllCameras = useMemo(
        () => cameras.reduce((sum, camera) => sum + (camera.segments || 0), 0),
        [cameras],
    );
    // Shown once in the sticky day header instead of on every row. The select that carries this
    // name scrolls away; the day header does not, so the context survives a long list without
    // costing a line per card.
    const selectedCamera = useMemo(() => (
        cameraId ? cameras.find((camera) => String(camera.id) === String(cameraId)) || null : null
    ), [cameraId, cameras]);
    const selectedCameraName = selectedCamera?.name || null;
    const notPlayable = Math.max((summary?.total ?? 0) - (summary?.playable ?? 0), 0);

    // Gaps are only meaningful along ONE camera's timeline. Across a mixed feed, a "hole" between
    // two different cameras means nothing — drawing one would be a false alarm, so we don't.
    const singleCamera = Boolean(cameraId);
    const days = useMemo(() => buildTimeline(rows, { detectGaps: singleCamera }), [rows, singleCamera]);

    const handleJump = async (event) => {
        event.preventDefault();
        const at = instantFromTime(jumpTo, { from, to });
        if (!at) {
            notifyWarning('Format jam salah', 'Tulis seperti 19:36.');
            return;
        }

        // Try the rows already on screen first: no round trip, and it keeps the common case
        // (scanning the page you are looking at) instant.
        const onThisPage = findSegmentAt(rows, jumpTo);
        if (onThisPage && !onThisPage._approximate) {
            setHighlighted(onThisPage.segmentId);
            setPendingScroll(onThisPage.segmentId);
            return;
        }

        setJumping(true);
        try {
            const found = await archiveLibrary.locate({ at, ...filters });
            if (!found) {
                notifyWarning('Tidak ketemu', `Tidak ada rekaman pada atau sebelum ${jumpTo}.`);
                return;
            }
            // Turn the position in the whole list into the page that holds it.
            setPage(Math.floor(found.offset / pageSize));
            setHighlighted(found.segmentId);
            setPendingScroll(found.segmentId);
            if (found.approximate) {
                notifyWarning('Tidak persis', `Tidak ada klip yang memuat ${jumpTo}; ini yang terdekat sebelumnya.`);
            }
        } catch (err) {
            notifyError('Gagal mencari', err?.response?.data?.message || err.message);
        } finally {
            setJumping(false);
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader
                title="Arsip Rekaman"
                description="Tersimpan di arsip cloud, diputar dari sini."
                actions={<Button onClick={load} disabled={busy}>Muat ulang</Button>}
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
                        {notPlayable} segmen lama belum bisa diputar dari sini
                    </p>
                    <p className="mt-1 text-sm text-content-muted">
                        Segmen itu terarsip sebelum sistem mencatat penanda berkasnya, jadi data lama
                        tidak bisa disusulkan untuk diputar dari sini. Segmen baru tercatat otomatis
                        dan bisa langsung diputar.
                    </p>
                </div>
            )}

            {/* flex-wrap: dua Field w-40 shrink-0 plus formulir "Lompat ke jam" sebaris di sm.
                Pada font 1,5x isinya melebar sementara shrink-0 melarang menciut, dan tombol
                "Cari" berakhir di 801px pada layar 768px. Membungkus memindahkannya ke baris
                berikutnya alih-alih keluar layar. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                {/*
                  * Not a native <select>. Android renders one as a full-screen radio list where
                  * 30-character camera names wrap to three ragged lines — 31 of them, with no way
                  * to narrow. The playback page already replaced its own select with this picker
                  * for exactly that reason; reusing it means one behaviour to maintain, and an
                  * operator who learns the picker once knows it on both pages.
                  */}
                <div className="min-w-0 sm:flex-1 sm:max-w-sm">
                    <span className="mb-1.5 block text-xs font-semibold text-content-muted">Kamera</span>
                    <PlaybackCameraPicker
                        cameras={cameras}
                        selectedCamera={selectedCamera}
                        onCameraChange={(camera) => {
                            setCameraId(camera ? String(camera.id) : '');
                            setHighlighted(null);
                        }}
                        // Which camera HAS footage is the question here, so the count replaces the
                        // location on each row.
                        metaFor={(camera) => `${camera.segments ?? 0} segmen`}
                        allOption={{ label: 'Semua kamera', meta: `${totalAllCameras} segmen` }}
                    />
                </div>

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
                    <Button type="submit" disabled={!jumpTo.trim() || jumping}>
                        {jumping ? 'Mencari…' : 'Cari'}
                    </Button>
                </form>
            </div>

            {/* The two dates people actually pick, without opening a calendar twice. */}
            <div className="flex flex-wrap items-center gap-2">
                {RANGE_PRESETS.map((preset) => {
                    const [presetFrom, presetTo] = preset.build();
                    const active = from === presetFrom && to === presetTo;
                    return (
                        <Button
                            key={preset.label}
                            size="sm"
                            variant={active ? 'primary' : 'secondary'}
                            onClick={() => {
                                // Clicking the active preset again clears it — otherwise the only way
                                // back to "everything" is to blank two date fields by hand.
                                if (active) { setFrom(''); setTo(''); return; }
                                setFrom(presetFrom);
                                setTo(presetTo);
                            }}
                        >
                            {preset.label}
                        </Button>
                    );
                })}
            </div>

            {(from || to) && (
                <div className="flex items-center gap-3">
                    <p className="text-xs text-content-subtle">Disaring per tanggal.</p>
                    <Button size="sm" variant="secondary" onClick={() => { setFrom(''); setTo(''); }}>
                        Hapus filter
                    </Button>
                </div>
            )}

            {!singleCamera && ready && days.length > 0 && (
                // Said HERE, where the absence of gap markers is what needs explaining — not as a
                // hint under a select, where it pushed the two controls off a shared baseline.
                <p className="text-xs text-content-subtle">
                    Celah rekaman hanya ditandai saat satu kamera dipilih.
                </p>
            )}

            {/*
              * The skeleton appears ONLY when there is nothing yet to show. On a page change the
              * rows stay mounted and merely dim: swapping 25 rows for a 6-row skeleton collapsed
              * the document height, and because the pagination sits at the bottom, the browser
              * clamped the scroll position to the new maximum — which read as "it jumped to the
              * top by itself". Opacity costs no height, so the view stays where the finger left it.
              */}
            {!ready ? (
                <TableSkeleton rows={6} columns={4} />
            ) : days.length === 0 ? (
                <div className="rounded-card border border-edge bg-surface px-4 py-12 text-center">
                    <p className="text-sm text-content-muted">Belum ada segmen terarsip untuk pilihan ini.</p>
                </div>
            ) : (
                <div
                    aria-busy={busy || undefined}
                    className={`space-y-4 transition-opacity duration-150 motion-reduce:transition-none ${
                        busy ? 'opacity-60' : 'opacity-100'
                    }`}
                >
                {days.map((group) => (
                    <section key={group.key} className="space-y-2">
                        {/* Date once per group, not repeated on every row. */}
                        <h2 className="sticky top-0 z-sticky flex items-baseline gap-2 bg-surface-sunken py-1 text-xs font-semibold uppercase tracking-wide text-content-subtle">
                            <span className="shrink-0">{group.label}</span>
                            {selectedCameraName && (
                                <span className="truncate font-normal normal-case tracking-normal">
                                    {selectedCameraName}
                                </span>
                            )}
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
                                        showCamera={!singleCamera}
                                        onPlay={setPlaying}
                                    />
                                )
                            ))}
                        </ul>
                    </section>
                ))}
                </div>
            )}

            {/*
              * Always state the position within the whole. The old page showed the newest 100 rows
              * with no counter and no way forward, so a list that stopped at last night looked like
              * an archive that stopped at last night.
              */}
            {ready && total > 0 && (
                <div className="flex flex-col gap-3 border-t border-edge pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs tabular-nums text-content-subtle">
                            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} dari {total} segmen
                        </p>
                        <label className="flex items-center gap-2 text-xs text-content-muted">
                            Baris
                            <select
                                value={pageSize}
                                onChange={(e) => setPageSize(Number(e.target.value))}
                                className="rounded-control border border-edge bg-surface px-2 py-1 font-mono text-xs tabular-nums text-content"
                            >
                                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                            </select>
                        </label>
                    </div>

                    {/* Wraps, like the camera-grid pager: a Button's label span is `truncate`
                      * (white-space:nowrap), so each button's min-content is its WHOLE label and
                      * the three of them need 410px at Android's 1.5x font scale. */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPage((p) => Math.max(p - 1, 0))}
                            disabled={page === 0}
                        >
                            ‹ Sebelumnya
                        </Button>
                        <span className="font-mono text-xs tabular-nums text-content-muted">
                            Hal. {page + 1} / {pageCount}
                        </span>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
                            disabled={page >= pageCount - 1}
                        >
                            Berikutnya ›
                        </Button>
                    </div>

                    {driftWarning && (
                        <p className="text-xs text-content-subtle">
                            Arsip terus bertambah, jadi halaman dalam bisa bergeser. Pilih rentang
                            tanggal kalau ingin urutannya tetap.
                        </p>
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
                    // Media, not a form: centred so the footage is not pinned to the bottom edge,
                    // and a near-opaque scrim so the list behind stops competing with it. Matches
                    // the public VideoPopup, so both players read as the same product.
                    placement="center"
                    scrim="media"
                    // Both actions are SUBORDINATE to watching, and a footer would cost the video
                    // ~60px of height on a phone for two escape hatches. Icons in the header keep
                    // them one tap away without taking anything from the picture.
                    headerActions={(
                        <>
                            <IconButton
                                label="Buka di tab baru"
                                size="sm"
                                onClick={() => window.open(archiveLibrary.streamUrl(playing.segmentId), '_blank', 'noopener')}
                            >
                                <NewTabIcon />
                            </IconButton>
                            <IconButton
                                label="Unduh rekaman"
                                size="sm"
                                onClick={() => {
                                    // Evidence work means keeping a copy, not just viewing one.
                                    const a = document.createElement('a');
                                    a.href = archiveLibrary.streamUrl(playing.segmentId);
                                    a.download = playing.filename || 'rekaman.mp4';
                                    a.click();
                                }}
                            >
                                <DownloadIcon />
                            </IconButton>
                        </>
                    )}
                >
                    <ArchiveVideo
                        segmentId={playing.segmentId}
                        src={archiveLibrary.streamUrl(playing.segmentId)}
                    />
                </Modal>
            )}
        </div>
    );
}
