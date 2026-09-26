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
import resolvePublicPopupCamera from '../services/publicCameraResolver';

const ROTATE_DEFAULT_SECONDS = 20;
const ROTATE_MIN_SECONDS = 5;
const ROTATE_MAX_SECONDS = 120;
const ERROR_ADVANCE_MS = 5000;
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

function MonitorView() {
    const { cameras, loading, dataUnavailable, backgroundRefreshError } = useCameras();
    const { branding } = useBranding();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const rotateSeconds = readRotateSeconds(searchParams);

    // Playable = the same verdict the card grid renders: online-ish, not maintenance — plus an
    // HLS-playable capability. The public list carries no `streams`; the URL is resolved per
    // camera on demand (same path as the popup), so upfront URL checks would empty the wall.
    const playable = useMemo(
        () => cameras.filter((camera) => {
            if (!isCameraPlayable(camera)) return false;
            const caps = getStreamCapabilities(camera);
            return caps.popup === true && caps.supported_player === 'hls';
        }),
        [cameras],
    );

    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [chromeVisible, setChromeVisible] = useState(true);
    const videoRef = useRef(null);
    const current = playable.length > 0 ? playable[Math.min(index, playable.length - 1)] : null;
    const nextCamera = playable.length > 1 ? playable[(Math.min(index, playable.length - 1) + 1) % playable.length] : null;

    // The list can shrink mid-cycle when a camera goes offline between refreshes.
    useEffect(() => {
        if (index >= playable.length) setIndex(0);
    }, [index, playable.length]);

    const resolveStream = useCallback(async () => {
        const resolved = await resolvePublicPopupCamera(current, cameras) || current;
        const { targetUrl } = resolveStreamUrl(resolved);
        if (!targetUrl) throw Object.assign(new Error('Stream tidak tersedia'), { friendly: true });
        return targetUrl;
    }, [current, cameras]);

    const player = useHlsLivePlayer({
        videoRef,
        resolveStream,
        resetKey: current?.id ?? 'kosong',
        active: Boolean(current),
        videoCodec: current?.video_codec,
    });

    const stepCamera = useCallback((delta) => {
        setIndex((prev) => (prev + delta + playable.length) % playable.length);
    }, [playable.length]);

    // Rotation: a plain timeout keyed on index — manual skips and error-skips both restart the
    // dwell, which is exactly what a wall wants (full slot per camera shown).
    useEffect(() => {
        if (paused || playable.length < 2) return undefined;
        const timer = setTimeout(() => setIndex((prev) => (prev + 1) % playable.length), rotateSeconds * 1000);
        return () => clearTimeout(timer);
    }, [index, paused, playable.length, rotateSeconds]);

    // A dead stream must not hold the wall: hop to the next camera after a short verdict beat.
    useEffect(() => {
        if (player.status !== 'error' || playable.length < 2) return undefined;
        const timer = setTimeout(() => setIndex((prev) => (prev + 1) % playable.length), ERROR_ADVANCE_MS);
        return () => clearTimeout(timer);
    }, [player.status, playable.length]);

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

    if (!current) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black px-6 text-center">
                <Monitor className="h-10 w-10 text-white/40" aria-hidden="true" />
                <p className="text-sm text-white/80">Tidak ada kamera yang sedang online.</p>
                <Link to="/" className="rounded-control border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10">
                    Kembali ke beranda
                </Link>
            </div>
        );
    }

    return (
        <div className={`fixed inset-0 select-none bg-black ${chromeVisible ? '' : 'cursor-none'}`}>
            <video
                ref={videoRef}
                muted
                playsInline
                className="absolute inset-0 h-full w-full bg-black object-contain"
                aria-label={`Siaran langsung ${current.name}`}
            />
            <span className="sr-only" aria-live="polite">Menampilkan {current.name}</span>

            {player.status === 'loading' && !player.needsGesture && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/60">
                    Memuat siaran…
                </div>
            )}
            {player.status === 'loading' && player.needsGesture && (
                <button
                    type="button"
                    onClick={() => videoRef.current?.play().catch(() => {})}
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/60 text-white"
                >
                    <span className="text-4xl leading-none">▶</span>
                    <span className="text-sm">Ketuk untuk memutar</span>
                </button>
            )}
            {player.status === 'error' && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center">
                    <p className="text-sm text-status-fault">{player.message}</p>
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
                {/* Dwell progress — satu strip tipis yang terisi selama slot kamera ini. */}
                {!paused && playable.length > 1 && (
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
