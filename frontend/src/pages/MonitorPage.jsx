/*
 * Purpose: Public "Mode Monitor" — a pos-ronda style TV wall that auto-cycles through every
 *          currently-playable public camera, fullscreen, one stream at a time. Built for a
 *          bookmarked URL on a security-post TV (/monitor?interval=30) as much as for a
 *          curious visitor. Uses ONLY the public camera list (CameraContext) — the same data
 *          the landing grid renders — so the public/private boundary is inherited unchanged.
 * Caller: App.jsx public route "/monitor"; navbar/simple-header monitor link.
 * Deps: CameraContext (public list + freshness), BrandingContext, useHlsLivePlayer (shared
 *       playback core), isCameraPlayable + getStreamCapabilities (same playability rule the
 *       cards use), resolvePublicPopupCamera (same /api/stream/:id resolution the popup uses —
 *       the public list carries no streams, so URLs resolve per camera on demand).
 * MainFuncs: MonitorPage (provider shell), MonitorView (wall), readRotateSeconds.
 * SideEffects: One live HLS session at a time (auto-released on rotate); keydown + pointer listeners;
 *              chrome auto-hide timer.
 *
 * Cycle rules: each camera holds the slot for `interval` seconds (default 20, ?interval= clamped
 * 5–120). A stream that errors is skipped early — a dead feed must never hold a wall slot.
 * Offline/maintenance/no-URL cameras never enter the rotation. Chrome fades after a few idle
 * seconds so the wall reads clean on a TV; any pointer/key wake brings it back.
 *
 * Double-buffer: the wall runs TWO player slots like a TV channel-surf — the visible slot plays
 * the current camera while a hidden slot plays the NEXT camera outright (an active reader keeps
 * the MediaMTX muxer warm AND decodes frames ahead of time). Rotation is then a visibility swap,
 * not a cold start; a one-shot playlist "prewarm" fetch can't achieve this because the muxer
 * goes cold again the moment that request ends. Cost: one extra live stream's bandwidth, which
 * the operator explicitly accepted — correctness of the wall beats saving a couple of Mbit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Monitor, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { CameraProvider, useCameras } from '../contexts/CameraContext';
import { useBranding } from '../contexts/BrandingContext';
import { useHlsLivePlayer } from '../hooks/useHlsLivePlayer';
import { isCameraPlayable } from '../utils/cameraAvailability';
import { resolveStreamUrl } from '../utils/directStreamHelper';
import { getStreamCapabilities } from '../utils/cameraDelivery';
import { getPublicAreaSlug } from '../utils/publicGrowthShare';
import resolvePublicPopupCamera from '../services/publicCameraResolver';

const ROTATE_DEFAULT_SECONDS = 20;
const ROTATE_MIN_SECONDS = 5;
const ROTATE_MAX_SECONDS = 120;
const ERROR_ADVANCE_MS = 5000;
const MAX_LOAD_MS = 15000;
const CHROME_HIDE_MS = 4000;

function readRotateSeconds(searchParams) {
    const raw = Number.parseInt(searchParams.get('interval') || '', 10);
    if (!Number.isFinite(raw)) return ROTATE_DEFAULT_SECONDS;
    return Math.min(ROTATE_MAX_SECONDS, Math.max(ROTATE_MIN_SECONDS, raw));
}

function MonitorClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);
    return (
        <span className="font-mono text-sm tabular-nums text-white/80">
            {now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':')}
        </span>
    );
}

const SLOT_LOADING = { status: 'loading', kind: null, httpCode: null, message: '', needsGesture: false };

// One player slot = one <video> + one useHlsLivePlayer instance. The slot reports its player
// state upward so the parent can drive dwell/advance/overlays off the VISIBLE slot only.
// An invisible slot still streams — that is the preload.
function MonitorSlot({ camera, cameras, visible, onStatus, videoRef }) {
    const resolveStream = useCallback(async () => {
        const resolved = await resolvePublicPopupCamera(camera, cameras) || camera;
        const { targetUrl } = resolveStreamUrl(resolved);
        if (!targetUrl) throw Object.assign(new Error('Stream tidak tersedia'), { friendly: true });
        return targetUrl;
    }, [camera, cameras]);
    const player = useHlsLivePlayer({
        videoRef,
        resolveStream,
        resetKey: camera?.id ?? 'kosong',
        active: Boolean(camera),
        videoCodec: camera?.video_codec,
    });
    useEffect(() => { onStatus(player); }, [player, onStatus]);
    return (
        <video
            ref={videoRef}
            data-camera-id={camera?.id}
            muted
            playsInline
            aria-hidden={!visible}
            aria-label={visible && camera ? `Siaran langsung ${camera.name}` : undefined}
            className={`absolute inset-0 h-full w-full bg-black object-contain transition-opacity duration-500 ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        />
    );
}

function MonitorView() {
    const { cameras, areas, loading, dataUnavailable, backgroundRefreshError } = useCameras();
    const { branding } = useBranding();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const rotateSeconds = readRotateSeconds(searchParams);

    // Playable = the same verdict the card grid renders: online-ish, not maintenance — plus an
    // HLS-playable capability. The public list carries no `streams`; the URL is resolved per
    // camera on demand (same path as the popup), so upfront URL checks would empty the wall.
    const hlsPlayable = useMemo(
        () => cameras.filter((camera) => {
            if (!isCameraPlayable(camera)) return false;
            const caps = getStreamCapabilities(camera);
            return caps.popup === true && caps.supported_player === 'hls';
        }),
        [cameras],
    );

    // ?area=<slug> scopes the wall to one village/area — cycling ~800 cameras across the whole
    // network is not what a pos ronda watches. `?area=all` keeps the old everything-rotation.
    const areaParam = (searchParams.get('area') || '').trim();
    const areaSlug = areaParam ? getPublicAreaSlug(areaParam) : null;
    const showAll = areaSlug === 'all';
    const selectedArea = useMemo(() => {
        if (!areaSlug || showAll) return null;
        return areas.find((area) => getPublicAreaSlug(area) === areaSlug) || null;
    }, [areas, areaSlug, showAll]);

    const playable = useMemo(
        () => (selectedArea ? hlsPlayable.filter((camera) => camera.area_id === selectedArea.id) : hlsPlayable),
        [hlsPlayable, selectedArea],
    );

    const [index, setIndex] = useState(0);
    const [front, setFront] = useState(0);
    const [paused, setPaused] = useState(false);
    const [chromeVisible, setChromeVisible] = useState(true);
    const current = playable.length > 0 ? playable[Math.min(index, playable.length - 1)] : null;
    const nextCamera = playable.length > 1 ? playable[(Math.min(index, playable.length - 1) + 1) % playable.length] : null;

    // Slot assignment is derived: the `front` slot shows `current`, the other slot plays
    // `nextCamera` as a live preload. Rotating = advance index + swap front — the camera that
    // was preloading becomes visible with its already-decoded stream, and its old slot picks up
    // the new next camera.
    const slotCameras = [null, null];
    slotCameras[front] = current;
    if (nextCamera) slotCameras[1 - front] = nextCamera;

    const [slotStates, setSlotStates] = useState([SLOT_LOADING, SLOT_LOADING]);
    const videoRefs = [useRef(null), useRef(null)];
    const reportStatus = useCallback((slot, p) => {
        setSlotStates((prev) => (prev[slot] === p ? prev : (slot === 0 ? [p, prev[1]] : [prev[0], p])));
    }, []);
    const report0 = useCallback((p) => reportStatus(0, p), [reportStatus]);
    const report1 = useCallback((p) => reportStatus(1, p), [reportStatus]);
    const frontStatus = slotStates[front];

    // The list can shrink mid-cycle when a camera goes offline between refreshes.
    useEffect(() => {
        if (index >= playable.length) setIndex(0);
    }, [index, playable.length]);

    const advance = useCallback(() => {
        setIndex((prev) => (prev + 1) % playable.length);
        setFront((prev) => 1 - prev);
    }, [playable.length]);

    const stepCamera = useCallback((delta) => {
        setIndex((prev) => (prev + delta + playable.length) % playable.length);
        setFront((prev) => 1 - prev);
    }, [playable.length]);

    // Rotation dwell counts WATCH time, not load time: the timer only runs while the VISIBLE
    // player reports 'playing' (a decoded frame — not merely a fetched playlist). A preloaded
    // slot usually already reports 'playing' when it becomes visible, so the dwell starts
    // immediately after the swap.
    useEffect(() => {
        if (paused || playable.length < 2 || frontStatus.status !== 'playing') return undefined;
        const timer = setTimeout(advance, rotateSeconds * 1000);
        return () => clearTimeout(timer);
    }, [index, front, paused, playable.length, rotateSeconds, frontStatus.status, advance]);

    // …but a camera stuck loading must not freeze the wall — give it a fair chance, then skip.
    useEffect(() => {
        if (frontStatus.status !== 'loading' || playable.length < 2) return undefined;
        const timer = setTimeout(advance, MAX_LOAD_MS);
        return () => clearTimeout(timer);
    }, [index, front, frontStatus.status, playable.length, advance]);

    // A dead stream must not hold the wall: hop to the next camera after a short verdict beat.
    useEffect(() => {
        if (frontStatus.status !== 'error' || playable.length < 2) return undefined;
        const timer = setTimeout(advance, ERROR_ADVANCE_MS);
        return () => clearTimeout(timer);
    }, [frontStatus.status, playable.length, advance]);

    // Chrome auto-hide — the wall is for watching; any gesture wakes it.
    useEffect(() => {
        let hideTimer = null;
        const wake = () => {
            setChromeVisible(true);
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
        };
        wake();
        window.addEventListener('pointermove', wake);
        window.addEventListener('pointerdown', wake);
        window.addEventListener('keydown', wake);
        return () => {
            if (hideTimer) clearTimeout(hideTimer);
            window.removeEventListener('pointermove', wake);
            window.removeEventListener('pointerdown', wake);
            window.removeEventListener('keydown', wake);
        };
    }, []);

    // Keyboard wall controls. Space is skipped on interactive targets so a focused button keeps
    // its native click instead of double-firing with the pause toggle.
    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'ArrowRight') stepCamera(1);
            else if (event.key === 'ArrowLeft') stepCamera(-1);
            else if (event.key === 'Escape') navigate('/');
            else if (event.key === ' ') {
                if (event.target?.closest?.('button, a, input, select, textarea')) return;
                event.preventDefault();
                setPaused((prev) => !prev);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [stepCamera, navigate]);

    const chromeClass = `transition-opacity duration-300 ${chromeVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`;
    const stale = Boolean(backgroundRefreshError) && !loading && !dataUnavailable;

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-black text-sm text-white/70">
                Memuat kamera…
            </div>
        );
    }

    if (dataUnavailable) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black px-6 text-center">
                <p className="text-sm text-white/80">Kami belum bisa memuat daftar kamera.</p>
                <Link to="/" className="rounded-control border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10">
                    Kembali ke beranda
                </Link>
            </div>
        );
    }

    // No ?area — or an unrecognized slug — lands on the picker, not an 800-camera wall.
    // The list is intentionally bare text links: this screen exists to pick a village, and it
    // must stay light on the same TV that will run the wall all day.
    if (!selectedArea && !showAll) {
        const suffix = rotateSeconds !== ROTATE_DEFAULT_SECONDS ? `&interval=${rotateSeconds}` : '';
        return (
            <div className="flex min-h-screen flex-col bg-black px-5 py-8 text-white">
                <div className="mx-auto w-full max-w-md">
                    <div className="mb-6 flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-control bg-primary font-bold text-onprimary">
                            {branding?.logo_text || 'R'}
                        </span>
                        <div>
                            <p className="text-sm font-semibold">Mode Monitor</p>
                            <p className="text-xs text-white/60">Pilih area pantauan</p>
                        </div>
                    </div>
                    <ul className="divide-y divide-white/10 rounded-card border border-white/10">
                        {areas.map((area) => {
                            const count = hlsPlayable.filter((camera) => camera.area_id === area.id).length;
                            return (
                                <li key={area.id}>
                                    <Link
                                        to={`/monitor?area=${encodeURIComponent(getPublicAreaSlug(area))}${suffix}`}
                                        className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-white/10"
                                    >
                                        <span className="truncate">{area.name}</span>
                                        <span className="ml-3 shrink-0 font-mono text-xs text-white/50">{count} kamera</span>
                                    </Link>
                                </li>
                            );
                        })}
                        <li>
                            <Link
                                to={`/monitor?area=all${suffix}`}
                                className="flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors hover:bg-white/10"
                            >
                                <span>Semua area</span>
                                <span className="ml-3 shrink-0 font-mono text-xs text-white/50">{hlsPlayable.length} kamera</span>
                            </Link>
                        </li>
                    </ul>
                    <Link to="/" className="mt-6 inline-block text-xs text-white/50 transition-colors hover:text-white">
                        Kembali ke beranda
                    </Link>
                </div>
            </div>
        );
    }

    if (!current) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black px-6 text-center">
                <Monitor className="h-10 w-10 text-white/40" aria-hidden="true" />
                <p className="text-sm text-white/80">
                    {selectedArea ? `Tidak ada kamera yang sedang online di ${selectedArea.name}.` : 'Tidak ada kamera yang sedang online.'}
                </p>
                <div className="flex items-center gap-3">
                    <Link to="/monitor" className="rounded-control border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10">
                        Pilih area lain
                    </Link>
                    <Link to="/" className="rounded-control border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10">
                        Kembali ke beranda
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className={`fixed inset-0 select-none bg-black ${chromeVisible ? '' : 'cursor-none'}`}>
            {slotCameras.map((camera, slot) => (
                (camera || slot === front) && (
                    <MonitorSlot
                        key={slot}
                        camera={camera}
                        cameras={cameras}
                        visible={slot === front}
                        onStatus={slot === 0 ? report0 : report1}
                        videoRef={videoRefs[slot]}
                    />
                )
            ))}
            <span className="sr-only" aria-live="polite">Menampilkan {current.name}</span>

            {frontStatus.status === 'loading' && !frontStatus.needsGesture && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-white/60">
                    Memuat siaran…
                </div>
            )}
            {frontStatus.status === 'loading' && frontStatus.needsGesture && (
                <button
                    type="button"
                    onClick={() => videoRefs[front].current?.play?.().catch(() => {})}
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/60 text-white"
                >
                    <span className="text-4xl leading-none">▶</span>
                    <span className="text-sm">Ketuk untuk memutar</span>
                </button>
            )}
            {frontStatus.status === 'error' && (
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center">
                    <p className="text-sm text-status-fault">{frontStatus.message}</p>
                    {playable.length > 1 && <p className="text-xs text-white/50">Melewati kamera ini…</p>}
                </div>
            )}

            {/* Top chrome — identitas wall + jam, menghilang saat idle. */}
            <div className={`absolute inset-x-0 top-0 z-10 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-3 sm:px-6 ${chromeClass}`}>
                <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-control bg-primary font-bold text-onprimary">
                        {branding?.logo_text || 'R'}
                    </span>
                    <div>
                        <p className="text-sm font-semibold text-white">Mode Monitor</p>
                        <p className="text-xs text-white/60">{current.name}{current.area_name ? ` · ${current.area_name}` : ''}</p>
                    </div>
                    {stale && (
                        <span className="rounded-control border border-status-warn/40 bg-status-warn/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-status-warn">
                            Menunda
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <MonitorClock />
                    <Link
                        to="/"
                        aria-label="Keluar mode monitor"
                        className="rounded-control p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </Link>
                </div>
            </div>

            {/* Bottom chrome — posisi rotasi + kontrol wall + progress dwell. */}
            <div className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-8 sm:px-6 ${chromeClass}`}>
                <div className="flex items-end justify-between gap-4">
                    <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-white">{current.name}</p>
                        <p className="mt-0.5 font-mono text-xs tabular-nums text-white/60">
                            <span>{Math.min(index, playable.length - 1) + 1}/{playable.length}</span>
                            {nextCamera ? ` · berikutnya ${nextCamera.name}` : ''}
                            {paused ? ' · dijeda' : ''}
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={() => stepCamera(-1)} disabled={playable.length < 2} aria-label="Kamera sebelumnya" title="Kamera sebelumnya" className="rounded-control p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30">
                            <SkipBack className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setPaused((prev) => !prev)} aria-label={paused ? 'Lanjutkan' : 'Jeda'} title={paused ? 'Lanjutkan rotasi' : 'Jeda rotasi'} className="rounded-control p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white">
                            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        </button>
                        <button type="button" onClick={() => stepCamera(1)} disabled={playable.length < 2} aria-label="Kamera berikutnya" title="Kamera berikutnya" className="rounded-control p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30">
                            <SkipForward className="h-4 w-4" />
                        </button>
                    </div>
                </div>
                {/* Dwell progress — fills only while the stream actually plays, matching the timer. */}
                {!paused && playable.length > 1 && frontStatus.status === 'playing' && (
                    <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-white/15">
                        <div
                            key={`${current.id}-${index}`}
                            className="h-full bg-status-live"
                            style={{ animation: `monitor-dwell ${rotateSeconds}s linear forwards` }}
                        />
                    </div>
                )}
            </div>
            <style>{'@keyframes monitor-dwell { from { width: 0% } to { width: 100% } }'}</style>
        </div>
    );
}

export default function MonitorPage() {
    return (
        <CameraProvider>
            <MonitorView />
        </CameraProvider>
    );
}
