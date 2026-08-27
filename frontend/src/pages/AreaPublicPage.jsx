/*
 * Purpose: Render public area-specific CCTV portal pages with area status, discovery sections, progressive camera lists, standardized popup stream resolution, related popup cameras, and resilient share entry points.
 * Caller: App route /area/:areaSlug.
 * Deps: React Router, CameraThumbnail, VideoPopup, publicGrowthService, publicGrowthShare.
 * MainFuncs: AreaPublicPage.
 * SideEffects: Fetches public area/camera data and updates document metadata.
 *
 * ── WHAT CHANGED 2026-08-21 (header controls) AND WHY ─────────────────────────────────────────
 * "Kembali ke CCTV Publik" and "Bagikan Area" were two stacked blocks above the page title
 * (`flex-col … sm:flex-row`), so on a phone the first screen of an area page was two rows of
 * chrome — one of them a filled primary button — before the visitor reached the <h1> naming the
 * area. They now share ONE row at every width: back left, share right.
 *   · Labels shorten below `sm` ("Kembali", "Bagikan") through plain responsive utilities, with
 *     the full label kept in aria-label AND title. Shortening is not hiding: nothing moved behind
 *     a scroll, a menu or a disclosure, and no JS window-width state was introduced.
 *   · Both controls are 44px high — this is the top of a public page, reached by thumb.
 *   · Share TIDAK lagi memakai tint primary. Tint itu alpha tetap 10%, jadi ia lembut di atas
 *     putih tapi praktis hilang di atas #08090b - menyisakan garis dan teks merah pekat yang
 *     justru lebih berteriak daripada tombol terisi yang dihindari. Labelnya juga cuma 3,06:1,
 *     gagal AA. Kini keduanya berbagi chrome yang sama dan hierarkinya dibawa terang-redup teks
 *     (`text-content` lawan `text-content-muted`). Lihat komentar di HEADER_CONTROL_ACCENT.
 *   · The share result moved out of the row and below it, right-aligned. "Browser tidak mendukung
 *     share otomatis." beside a button is how a row gets wider than a 320px screen.
 *
 * TWO "Kembali ke CCTV Publik", and why both stay: the other one lives in the `notFound` early
 * return — the 404 state's only way out, rendered when this header does not exist at all. They are
 * mutually exclusive branches, not a duplicate and not a mobile/desktop pair, so only the header
 * copy was restyled. Do not "deduplicate" them into one component; a dead-end page's escape hatch
 * legitimately looks different from a working page's back control.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import CameraThumbnail from '../components/CameraThumbnail';
import CommercialSlot from '../components/commerce/CommercialSlot.jsx';
import LandingMobileDock from '../components/landing/LandingMobileDock.jsx';
import { resolvePublicPopupCamera } from '../services/publicCameraResolver';
import publicGrowthService from '../services/publicGrowthService';
import { buildAreaShareText, sharePublicText } from '../utils/publicGrowthShare';
import {
    buildAreaPublicRankingLists,
    getAreaCameraLiveViewers,
    getAreaCameraTotalViews,
} from '../utils/areaPublicRanking';
import { isCameraHardOffline, isCameraDegraded } from '../utils/cameraAvailability.js';

/*
 * Tujuan dock dari halaman area. Statis: berbeda dengan playback, halaman ini tidak punya
 * konteks pemutaran yang perlu dibawa serta, jadi tidak ada alasan menghitungnya tiap render.
 */
const AREA_DOCK_HREFS = {
    home: '/',
    map: '/?view=map&mode=full',
    grid: '/?view=grid&mode=full',
    quick: '/?view=grid&mode=full#public-quick-access',
    playback: '/playback',
};

const VideoPopup = lazy(() => import('../components/MultiView/VideoPopup'));
const AREA_INITIAL_VISIBLE_CAMERAS = 12;
const AREA_LOAD_MORE_CAMERAS = 12;
const AREA_PRIORITY_THUMBNAILS = 4;

function setMetaContent(selector, content) {
    const element = document.querySelector(selector);
    if (element) {
        element.setAttribute('content', content);
    }
}

function updateAreaMetadata(area) {
    if (!area) {
        return;
    }

    const title = `CCTV Online ${area.name} - RAF`;
    const description = area.description || `Pantau CCTV publik area ${area.name} secara online melalui RAF.`;

    document.title = title;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[property="og:url"]', window.location.href);
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('id-ID');
}

/*
 * The two header controls share ONE shape, declared once so "kembali" and "bagikan" cannot drift
 * apart again: a 44px-high compact control. 44px because these are the first things a thumb meets.
 *
 * Catatan yang tetap berlaku meski tint-nya sudah tidak dipakai di sini: `bg-primary/10` compiles
 * to NOTHING di proyek ini, karena `--primary-color` menyimpan warna utuh, bukan triplet kanal
 * yang dibutuhkan Tailwind untuk menghitung alpha. Kalau suatu saat butuh tint primary, pakai
 * token `primary-100` yang sudah dideklarasikan di tailwind.config.js — dan ingat ia alpha TETAP,
 * jadi ia TIDAK theme-aware.
 */
const HEADER_CONTROL = 'inline-flex min-h-[44px] min-w-0 items-center gap-1.5 rounded-control border px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
/*
 * KENAPA KEDUANYA BERBAGI CHROME YANG SAMA
 *
 * Sebelumnya "Bagikan" memakai `border-primary bg-primary-100 text-primary` — perlakuan buatan
 * sendiri yang tidak dipakai di mana pun lagi di aplikasi ini (sistemnya memakai `bg-primary
 * text-white` untuk tombol primer). Maksudnya baik: memberi aksen tanpa berteriak. Tapi diukur
 * di halaman hidup, ia gagal di dua sisi sekaligus:
 *
 *   1. TINT-NYA TIDAK THEME-AWARE. `primary-100` adalah alpha TETAP 10% (tailwind.config.js:49),
 *      jadi kelasnya identik di terang maupun gelap. Di atas putih ia jadi merah muda lembut —
 *      persis yang dimaksud. Di atas #08090b ia praktis tak terlihat, sehingga yang tersisa
 *      hanya GARIS dan TEKS merah pekat: hasil akhirnya justru lebih berteriak daripada tombol
 *      terisi yang sengaja dihindari.
 *   2. KONTRASNYA GAGAL AA. Label merah #fa3333 di atas tint terang = 3,06:1, di bawah ambang
 *      4,5:1 untuk teks 14px semibold. Tombol terisi pun tidak menyelamatkan: putih di atas
 *      #fa3333 = 3,76:1.
 *
 * Jadi hierarkinya sekarang dibawa TERANG-REDUP TEKS, bukan warna: bidang, garis, radius, dan
 * tinggi 44px keduanya identik, dan "Bagikan" memakai `text-content` sementara "Kembali"
 * `text-content-muted`. Keduanya pasangan yang memang dirancang untuk permukaan ini, jadi
 * kontrasnya aman di kedua tema — dan pemilik berhenti bertanya kenapa dua tombol bersebelahan
 * berbicara dalam dua bahasa visual.
 */
const HEADER_CONTROL_IDLE = 'border-edge bg-surface-sunken text-content-muted hover:border-edge-strong hover:bg-surface-raised hover:text-content';
const HEADER_CONTROL_ACCENT = 'border-edge bg-surface-sunken text-content hover:border-edge-strong hover:bg-surface-raised';

function BackIcon() {
    return (
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
    );
}

function ShareIcon() {
    return (
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4M18 8a2 2 0 100-4 2 2 0 000 4zM6 14a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
    );
}

/*
 * Honest per-camera status — mirrors LandingCameraCard's semantics so the two public
 * surfaces read identically: ONE dot carries the state, a label shows only when the
 * state is abnormal, and red is reserved for genuine faults. The old area card shouted
 * a red "LIVE" pill on EVERY tile, which both buried real faults and collided with the
 * red used for problems.
 */
const AREA_CAMERA_STATUS = {
    maintenance: { dot: 'bg-status-fault', label: 'Perbaikan', srLabel: 'Sedang perbaikan' },
    offline: { dot: 'bg-status-idle', label: 'Offline', srLabel: 'Sedang offline' },
    degraded: { dot: 'bg-status-warn', label: 'Tidak stabil', srLabel: 'Sinyal tidak stabil' },
    live: { dot: 'bg-status-live', label: null, srLabel: 'Siaran langsung' },
};

function resolveAreaCameraStatus(camera) {
    if (camera.status === 'maintenance') return AREA_CAMERA_STATUS.maintenance;
    if (isCameraHardOffline(camera)) return AREA_CAMERA_STATUS.offline;
    if (isCameraDegraded(camera)) return AREA_CAMERA_STATUS.degraded;
    return AREA_CAMERA_STATUS.live;
}

function AreaStat({ label, value }) {
    return (
        <div className="rounded-card border border-edge bg-surface px-4 py-3">
            <div className="font-mono text-2xl font-bold leading-none tabular-nums text-content">{formatCount(value)}</div>
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-content-subtle">{label}</div>
        </div>
    );
}

function AreaStatusPanel({ area, cameras, liveViewerCount }) {
    const cameraCount = Number(area?.camera_count ?? cameras.length ?? 0);
    const onlineCount = Number(area?.online_count ?? cameras.filter((camera) => camera.is_online === 1 || camera.is_online === true).length);
    const onlinePercent = cameraCount > 0 ? Math.round((onlineCount / cameraCount) * 100) : 0;

    return (
        <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-content">Status Area</h2>
                    <p className="text-sm text-content-muted">
                        Ringkasan kondisi kamera publik di area ini.
                    </p>
                </div>
                <span className="font-mono text-xs font-semibold tabular-nums text-status-live">{onlinePercent}% online</span>
            </div>
            {/*
              * Two columns from the smallest screen, not from `sm`. Stacked one-per-row these four
              * numbers ate ~800px of a phone — the landing page states the same kind of data in a
              * 2x2 board, and there is no reason this page should be twice as tall to say less.
              * The camera grid below deliberately keeps `sm:` : those cards carry long names.
              */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {/*
                  * "22 Online" beside "0 Live Sekarang" read as a contradiction, because the two
                  * count different things: cameras that are up, and people watching right now.
                  * Naming the unit in each label is what makes them stop arguing with each other.
                  */}
                <AreaStat label="Kamera Publik" value={cameraCount} />
                <AreaStat label="Kamera Online" value={onlineCount} />
                <AreaStat label="Penonton Saat Ini" value={liveViewerCount} />
                <AreaStat label="Total Ditonton" value={area?.total_views} />
            </div>
        </section>
    );
}

function AreaCameraMiniCard({ camera, metricLabel, metricValue, onClick }) {
    return (
        <button
            type="button"
            onClick={() => onClick(camera)}
            /* min-w-0 is load-bearing, and its absence overflowed this page by 12px on a 393px
               phone until the e2e suite finally measured the area route (2026-08-23).
               A grid item's `min-width: auto` resolves to its MIN-CONTENT width, and a `truncate`
               child is `white-space: nowrap`, whose min-content equals its max-content — the whole
               camera name on one line. So the card grew to fit the longest name and pushed the body
               28px past its own column. `truncate` does not save it: overflow on the CHILD clips
               the text, it does not shrink the parent that sized itself around it.
               AreaCameraCard below never had this bug because `overflow-hidden` sits on the item
               ITSELF, and the auto minimum size only applies while overflow is visible. */
            className="min-w-0 rounded-card border border-edge bg-surface p-3 text-left transition-colors hover:border-edge-strong"
        >
            <div className="truncate text-sm font-semibold text-content">{camera.name}</div>
            <div className="mt-1 truncate text-xs text-content-muted">
                {camera.location || camera.area_name || 'Lokasi publik'}
            </div>
            <div className="mt-2 font-mono text-xs font-semibold tabular-nums text-data">
                {formatCount(metricValue)} {metricLabel}
            </div>
        </button>
    );
}

function AreaCameraSection({ title, description, cameras, metricLabel, metricValue, onCameraClick }) {
    if (!cameras.length) {
        return null;
    }

    return (
        <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-base font-semibold text-content">{title}</h2>
                    {description && (
                        <p className="text-sm text-content-muted">{description}</p>
                    )}
                </div>
                <span className="font-mono text-xs tabular-nums text-content-subtle">{cameras.length} kamera</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {cameras.map((camera) => (
                    <AreaCameraMiniCard
                        key={`${title}-${camera.id}`}
                        camera={camera}
                        metricLabel={metricLabel}
                        metricValue={metricValue(camera)}
                        onClick={onCameraClick}
                    />
                ))}
            </div>
        </section>
    );
}

function AreaCameraCard({ camera, onClick, thumbnailPriority = false }) {
    const status = resolveAreaCameraStatus(camera);
    return (
        <button
            type="button"
            onClick={() => onClick(camera)}
            className="group/card overflow-hidden rounded-card border border-edge bg-surface text-left transition-colors hover:border-edge-strong"
        >
            <div className="relative aspect-video bg-surface-sunken">
                <CameraThumbnail
                    cameraId={camera.id}
                    thumbnailPath={camera.external_snapshot_url || camera.thumbnail_path}
                    thumbnailVersion={camera.thumbnail_updated_at}
                    cameraName={camera.name}
                    isMaintenance={camera.status === 'maintenance'}
                    isOffline={camera.availability_state === 'offline'}
                    priority={thumbnailPriority}
                />
                {/* One honest status dot; a label appears only when the state is abnormal.
                    Red is reserved for genuine faults — no more red "LIVE" on every tile. */}
                <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur-sm">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} aria-hidden="true"></span>
                    <span className="sr-only">{status.srLabel}</span>
                    {status.label && (
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide leading-none text-white/90">{status.label}</span>
                    )}
                </div>
            </div>
            <div className="p-4">
                <div className="truncate text-sm font-semibold text-content">{camera.name}</div>
                <div className="mt-1 truncate text-xs text-content-muted">
                    {camera.location || camera.area_name || 'Lokasi publik'}
                </div>
                <div className="mt-3 flex gap-2 text-[11px] font-semibold">
                    <span className="rounded-lg bg-status-live/10 px-2 py-1 font-mono tabular-nums text-status-live">
                        {formatCount(getAreaCameraLiveViewers(camera))} live
                    </span>
                    <span className="rounded-lg border border-edge px-2 py-1 font-mono tabular-nums text-content-muted">
                        {formatCount(getAreaCameraTotalViews(camera))} tontonan
                    </span>
                </div>
            </div>
        </button>
    );
}

export default function AreaPublicPage() {
    const { areaSlug } = useParams();
    const [searchParams] = useSearchParams();
    const [area, setArea] = useState(null);
    const [cameras, setCameras] = useState([]);
    const [trendingCameras, setTrendingCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [shareMessage, setShareMessage] = useState('');
    const [visibleAreaCameraCount, setVisibleAreaCameraCount] = useState(AREA_INITIAL_VISIBLE_CAMERAS);
    const streamResolveRequestRef = useRef(0);

    useEffect(() => {
        let mounted = true;
        streamResolveRequestRef.current += 1;
        setLoading(true);
        setNotFound(false);
        setSelectedCamera(null);
        setVisibleAreaCameraCount(AREA_INITIAL_VISIBLE_CAMERAS);

        Promise.all([
            publicGrowthService.getArea(areaSlug),
            publicGrowthService.getAreaCameras(areaSlug),
            publicGrowthService.getTrendingCameras({ areaSlug, limit: 4 }),
        ])
            .then(([areaResponse, camerasResponse, trendingResponse]) => {
                if (!mounted) {
                    return;
                }

                const nextArea = areaResponse.data;
                const nextCameras = camerasResponse.data || [];
                setArea(nextArea);
                setCameras(nextCameras);
                setTrendingCameras(trendingResponse.data || []);
                updateAreaMetadata(nextArea);
            })
            .catch((error) => {
                if (!mounted) {
                    return;
                }

                setNotFound(error?.response?.status === 404);
                setArea(null);
                setCameras([]);
                setTrendingCameras([]);
            })
            .finally(() => {
                if (mounted) {
                    setLoading(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, [areaSlug]);

    const shareText = useMemo(() => (area ? buildAreaShareText(area) : ''), [area]);
    const liveViewerCount = useMemo(() => (
        cameras.reduce((total, camera) => total + getAreaCameraLiveViewers(camera), 0)
    ), [cameras]);
    const {
        liveCameras,
        topCameras,
        newestCameras,
        relatedPopupCameras,
    } = useMemo(() => buildAreaPublicRankingLists(cameras, trendingCameras, selectedCamera), [cameras, selectedCamera, trendingCameras]);
    const visibleAreaCameras = useMemo(() => (
        cameras.slice(0, visibleAreaCameraCount)
    ), [cameras, visibleAreaCameraCount]);
    const hiddenAreaCameraCount = Math.max(cameras.length - visibleAreaCameras.length, 0);
    const nextAreaLoadCount = Math.min(AREA_LOAD_MORE_CAMERAS, hiddenAreaCameraCount);
    const cameraIdFromUrl = useMemo(() => {
        const cameraId = Number.parseInt(searchParams.get('camera'), 10);
        return Number.isFinite(cameraId) && cameraId > 0 ? cameraId : null;
    }, [searchParams]);

    const handleCameraOpen = useCallback(async (camera) => {
        const requestId = streamResolveRequestRef.current + 1;
        streamResolveRequestRef.current = requestId;
        const pendingCamera = {
            ...camera,
            _stream_resolution_pending: true,
        };
        setSelectedCamera(pendingCamera);

        try {
            const resolvedCamera = await resolvePublicPopupCamera(camera);
            if (streamResolveRequestRef.current !== requestId) {
                return;
            }

            setSelectedCamera({
                ...(resolvedCamera || camera),
                _stream_resolution_pending: false,
            });
        } catch {
            if (streamResolveRequestRef.current === requestId) {
                setSelectedCamera({
                    ...camera,
                    _stream_resolution_pending: false,
                });
            }
        }
    }, []);

    useEffect(() => {
        if (!cameraIdFromUrl || !cameras.length) {
            return;
        }

        const cameraFromUrl = cameras.find((camera) => camera.id === cameraIdFromUrl);
        if (cameraFromUrl) {
            handleCameraOpen(cameraFromUrl);
        }
    }, [cameraIdFromUrl, cameras, handleCameraOpen]);

    const handleShare = useCallback(async () => {
        if (!shareText) {
            return;
        }

        try {
            const result = await sharePublicText({
                text: shareText,
                title: `CCTV Online ${area?.name || 'Area'} - RAF`,
            });

            if (result.status === 'native') {
                setShareMessage('Link area berhasil dibagikan.');
            } else if (result.status === 'clipboard') {
                setShareMessage('Teks share area disalin.');
            } else if (result.status === 'aborted') {
                setShareMessage('Share dibatalkan.');
            } else {
                setShareMessage('Browser tidak mendukung share otomatis.');
            }
        } catch {
            setShareMessage('Gagal membagikan area.');
        }
    }, [area, shareText]);

    useEffect(() => {
        if (!shareMessage) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => setShareMessage(''), 3000);
        return () => window.clearTimeout(timeoutId);
    }, [shareMessage]);

    if (loading) {
        return (
            <main className="min-h-screen bg-surface-sunken text-content">
                <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
                    <div className="h-8 w-56 animate-pulse rounded-card bg-surface-raised" />
                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                        {[0, 1, 2].map((item) => (
                            <div key={item} className="h-20 animate-pulse rounded-card bg-surface-raised" />
                        ))}
                    </div>
                </div>
            </main>
        );
    }

    if (notFound) {
        return (
            <main className="min-h-screen bg-surface-sunken text-content">
                <div className="mx-auto max-w-2xl px-4 py-20 text-center">
                    <h1 className="text-2xl font-bold">Area tidak ditemukan</h1>
                    <p className="mt-3 text-sm text-content-muted">
                        Area CCTV yang Anda buka belum tersedia untuk publik.
                    </p>
                    <Link to="/" className="mt-6 inline-flex rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white">
                        Kembali ke CCTV Publik
                    </Link>
                </div>
            </main>
        );
    }

    /*
     * pb-24 di bawah sm menyediakan ruang untuk dock di bawah; di atas sm dock-nya sm:hidden
     * sehingga ruangnya dikembalikan. Padding dan dock harus diputuskan bersama - salah satunya
     * sendirian menghasilkan blok terakhir yang tertutup, atau ruang kosong tanpa penjelasan.
     */
    return (
        <main className="min-h-screen bg-surface-sunken pb-24 text-content sm:pb-0">
            <section className="border-b border-edge bg-surface">
                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
                    {/*
                      * ONE row at every width: back on the left, share on the right. These used to
                      * be two stacked blocks that pushed the page's own <h1> below the fold on a
                      * phone — a filled primary "Bagikan Area" shouting above the title of the
                      * thing it shares. Nothing is hidden to achieve the row: the labels shorten
                      * ("Kembali", "Bagikan") below `sm` via plain Tailwind responsive utilities,
                      * and the FULL label stays in aria-label + title, so a screen reader and a
                      * long-press both still get the whole sentence. No JS width state — that
                      * flickers on first paint and has nothing to say that CSS cannot.
                      */}
                    <div className="mb-5 flex items-center justify-between gap-2">
                        <Link
                            to="/"
                            aria-label="Kembali ke CCTV Publik"
                            title="Kembali ke CCTV Publik"
                            className={`${HEADER_CONTROL} ${HEADER_CONTROL_IDLE}`}
                        >
                            <BackIcon />
                            <span className="truncate">
                                Kembali<span className="hidden sm:inline"> ke CCTV Publik</span>
                            </span>
                        </Link>
                        {/*
                          * Tinted, not filled. Sharing an area is a useful thing to offer and a
                          * poor thing to demand: it keeps the brand colour so it still reads as
                          * THE action here, without out-shouting the live cameras below it.
                          */}
                        <button
                            type="button"
                            onClick={handleShare}
                            aria-label="Bagikan Area"
                            title="Bagikan Area"
                            className={`${HEADER_CONTROL} ${HEADER_CONTROL_ACCENT}`}
                        >
                            <ShareIcon />
                            <span className="truncate">
                                Bagikan<span className="hidden sm:inline"> Area</span>
                            </span>
                        </button>
                    </div>
                    {/* The result of the share lives BELOW the row, never inside it: a sentence
                        this long sitting next to a button is what widens a row on a 320px phone. */}
                    {shareMessage && (
                        <p role="status" className="mb-4 text-right text-xs font-medium text-content-muted">
                            {shareMessage}
                        </p>
                    )}
                    <div className="flex flex-col gap-2">
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                            Area CCTV
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold sm:text-3xl">{area?.name || 'Area CCTV'}</h1>
                            <p className="mt-2 max-w-2xl text-sm text-content-muted">
                                {area?.description || 'Pantau CCTV publik area ini secara online melalui RAF.'}
                            </p>
                        </div>
                    </div>
                    {/*
                      * The hero used to repeat the exact three numbers that AreaStatusPanel states
                      * a screen below, percentage and all. One of them had to go, and the panel is
                      * the one that also carries Total Ditonton and the online percentage.
                      */}
                </div>
            </section>

            <AreaStatusPanel area={area} cameras={cameras} liveViewerCount={liveViewerCount} />

            <AreaCameraSection
                cameras={liveCameras}
                title={`Sedang Ramai di ${area?.name || ''}`.trim()}
                description="Kamera dengan penonton aktif terbanyak saat ini."
                metricLabel="live"
                metricValue={getAreaCameraLiveViewers}
                onCameraClick={handleCameraOpen}
            />

            {/*
              * A "most opened" ranking is a claim about what visitors did. With no views recorded
              * at all it ranked nothing and simply asserted popularity that did not exist, so it is
              * withheld until there is something real to rank.
              */}
            {Number(area?.total_views || 0) > 0 && (
                <AreaCameraSection
                    cameras={topCameras}
                    // Parallels its sibling above ("Sedang Ramai di …") and says the same thing as
                    // its own description, instead of leaving an English "Top" on a public page.
                    title={`Paling Sering Dibuka di ${area?.name || ''}`.trim()}
                    description="Kamera yang paling banyak dibuka oleh pengunjung."
                    metricLabel="tontonan"
                    metricValue={getAreaCameraTotalViews}
                    onCameraClick={handleCameraOpen}
                />
            )}

            <AreaCameraSection
                cameras={newestCameras}
                title={`Kamera Baru ${area?.name || ''}`.trim()}
                description="Kamera publik terbaru yang sudah tersedia di area ini."
                metricLabel="tontonan"
                metricValue={getAreaCameraTotalViews}
                onCameraClick={handleCameraOpen}
            />

            <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">Semua CCTV Area</h2>
                    <span className="font-mono text-xs font-medium tabular-nums text-content-subtle">{cameras.length} kamera</span>
                </div>

                {cameras.length === 0 ? (
                    <div className="rounded-card border border-dashed border-edge bg-surface p-10 text-center">
                        <h3 className="text-base font-semibold">Belum ada CCTV publik</h3>
                        <p className="mt-2 text-sm text-content-muted">
                            Kamera area ini akan muncul setelah tersedia untuk publik.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {visibleAreaCameras.map((camera, index) => (
                                <AreaCameraCard
                                    key={camera.id}
                                    camera={camera}
                                    onClick={handleCameraOpen}
                                    thumbnailPriority={index < AREA_PRIORITY_THUMBNAILS}
                                />
                            ))}
                        </div>
                        {hiddenAreaCameraCount > 0 && (
                            <div className="mt-6 flex flex-col items-center gap-3 text-center">
                                <p className="font-mono text-xs font-medium tabular-nums text-content-subtle">
                                    Menampilkan {visibleAreaCameras.length} dari {cameras.length} kamera
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setVisibleAreaCameraCount((current) => Math.min(current + AREA_LOAD_MORE_CAMERAS, cameras.length))}
                                    className="rounded-control border border-edge bg-surface px-4 py-2 text-sm font-bold text-content-muted transition-colors hover:border-edge-strong hover:text-content"
                                >
                                    Tampilkan {nextAreaLoadCount} kamera lagi
                                </button>
                            </div>
                        )}
                    </>
                )}
            </section>

            {/* SATU blok komersial untuk halaman ini. Arbiter memilih penghuninya: tawaran
                mitra lebih dulu, promo sendiri kalau tidak ada, tidak dirender kalau keduanya
                tidak ada. Konteks area saja - tanpa kamera tunggal, tawaran bertarget kamera
                memang tidak bisa cocok di sini. Di luar seksi grid supaya grid yang kosong
                atau bergalat tetap menampilkannya. */}
            <CommercialSlot placement="area" areaId={area?.id} className="mx-auto w-full max-w-2xl px-4 pb-8" />

            {selectedCamera && (
                <Suspense fallback={null}>
                    <VideoPopup
                        camera={selectedCamera}
                        onClose={() => {
                            streamResolveRequestRef.current += 1;
                            setSelectedCamera(null);
                        }}
                        modalTestId="area-popup-modal"
                        bodyTestId="area-video-body"
                        relatedCameras={relatedPopupCameras}
                        onRelatedCameraClick={handleCameraOpen}
                    />
                </Suspense>
            )}

            {/*
              * Dock yang sama dengan beranda dan playback. Tanpa ini halaman area jadi pulau:
              * pengunjung yang mendarat dari tautan bagikan kehilangan seluruh navigasi, dan
              * satu-satunya jalan keluar adalah tombol Kembali di pojok atas. Terukur di
              * produksi: beranda dan playback punya dock, area satu-satunya yang tidak.
              *
              * viewMode="area" sengaja tidak cocok dengan kunci mana pun di dock, jadi tidak ada
              * ikon yang menyala aktif - halaman ini memang bukan salah satu dari kelima tujuan
              * itu, dan menyalakan salah satunya akan berbohong tentang di mana pengunjung berada.
              */}
            <LandingMobileDock viewMode="area" itemHrefs={AREA_DOCK_HREFS} />
        </main>
    );
}
