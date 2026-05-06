/*
 * Purpose: Render public area-specific CCTV portal pages with area status, discovery sections, standardized popup stream resolution, related popup cameras, and resilient share entry points.
 * Caller: App route /area/:areaSlug.
 * Deps: React Router, CameraThumbnail, VideoPopup, publicGrowthService, publicGrowthShare.
 * MainFuncs: AreaPublicPage.
 * SideEffects: Fetches public area/camera data and updates document metadata.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import CameraThumbnail from '../components/CameraThumbnail';
import { resolvePublicPopupCamera } from '../services/publicCameraResolver';
import publicGrowthService from '../services/publicGrowthService';
import { buildAreaShareText, sharePublicText } from '../utils/publicGrowthShare';

const VideoPopup = lazy(() => import('../components/MultiView/VideoPopup'));

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

    const title = `CCTV Online ${area.name} - RAF NET`;
    const description = area.description || `Pantau CCTV publik area ${area.name} secara online melalui RAF NET.`;

    document.title = title;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[property="og:url"]', window.location.href);
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('id-ID');
}

function getCameraLiveViewers(camera) {
    return Number(camera?.live_viewers || camera?.viewer_stats?.live_viewers || 0);
}

function getCameraTotalViews(camera) {
    return Number(camera?.total_views || camera?.viewer_stats?.total_views || 0);
}

function AreaStat({ label, value }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xl font-bold text-gray-900 dark:text-white">{formatCount(value)}</div>
            <div className="mt-1 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
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
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Status Area</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Ringkasan kondisi kamera publik di area ini.
                    </p>
                </div>
                <span className="text-xs font-semibold text-primary">{onlinePercent}% online</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <AreaStat label="Kamera Publik" value={cameraCount} />
                <AreaStat label="Online" value={onlineCount} />
                <AreaStat label="Live Sekarang" value={liveViewerCount} />
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
            className="rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-primary/60 hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-primary/10"
        >
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
            <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                {camera.location || camera.area_name || 'Lokasi publik'}
            </div>
            <div className="mt-2 text-xs font-semibold text-primary">
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
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
                    {description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
                    )}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">{cameras.length} kamera</span>
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

function AreaCameraCard({ camera, onClick }) {
    return (
        <button
            type="button"
            onClick={() => onClick(camera)}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:border-primary/60 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
        >
            <div className="relative aspect-video bg-gray-100 dark:bg-gray-800">
                <CameraThumbnail
                    cameraId={camera.id}
                    thumbnailPath={camera.external_snapshot_url || camera.thumbnail_path}
                    cameraName={camera.name}
                    isMaintenance={camera.status === 'maintenance'}
                    isOffline={camera.availability_state === 'offline'}
                />
                <span className="absolute left-3 top-3 rounded-lg bg-red-500/90 px-2 py-1 text-[10px] font-bold text-white">
                    LIVE
                </span>
            </div>
            <div className="p-4">
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                    {camera.location || camera.area_name || 'Lokasi publik'}
                </div>
                <div className="mt-3 flex gap-2 text-[11px] font-semibold">
                    <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        {formatCount(getCameraLiveViewers(camera))} live
                    </span>
                    <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {formatCount(getCameraTotalViews(camera))} views
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
    const streamResolveRequestRef = useRef(0);

    useEffect(() => {
        let mounted = true;
        streamResolveRequestRef.current += 1;
        setLoading(true);
        setNotFound(false);
        setSelectedCamera(null);

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
        cameras.reduce((total, camera) => total + getCameraLiveViewers(camera), 0)
    ), [cameras]);
    const liveCameras = useMemo(() => (
        [...cameras]
            .filter((camera) => getCameraLiveViewers(camera) > 0)
            .sort((left, right) => getCameraLiveViewers(right) - getCameraLiveViewers(left))
            .slice(0, 4)
    ), [cameras]);
    const topCameras = useMemo(() => {
        const source = trendingCameras.length ? trendingCameras : cameras;
        return [...source]
            .sort((left, right) => getCameraTotalViews(right) - getCameraTotalViews(left))
            .slice(0, 4);
    }, [cameras, trendingCameras]);
    const newestCameras = useMemo(() => (
        [...cameras]
            .filter((camera) => camera.created_at)
            .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
            .slice(0, 4)
    ), [cameras]);
    const relatedPopupCameras = useMemo(() => {
        if (!selectedCamera) {
            return [];
        }

        return [...cameras]
            .filter((camera) => camera.id !== selectedCamera.id)
            .sort((left, right) => {
                const liveDelta = getCameraLiveViewers(right) - getCameraLiveViewers(left);
                if (liveDelta !== 0) {
                    return liveDelta;
                }
                return getCameraTotalViews(right) - getCameraTotalViews(left);
            })
            .slice(0, 5);
    }, [cameras, selectedCamera]);

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
        const cameraId = Number.parseInt(searchParams.get('camera'), 10);
        if (!cameraId || !cameras.length) {
            return;
        }

        const cameraFromUrl = cameras.find((camera) => camera.id === cameraId);
        if (cameraFromUrl) {
            handleCameraOpen(cameraFromUrl);
        }
    }, [cameras, handleCameraOpen, searchParams]);

    const handleShare = useCallback(async () => {
        if (!shareText) {
            return;
        }

        try {
            const result = await sharePublicText({
                text: shareText,
                title: `CCTV Online ${area?.name || 'Area'} - RAF NET`,
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
            <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
                <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
                    <div className="h-8 w-56 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                        {[0, 1, 2].map((item) => (
                            <div key={item} className="h-20 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
                        ))}
                    </div>
                </div>
            </main>
        );
    }

    if (notFound) {
        return (
            <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
                <div className="mx-auto max-w-2xl px-4 py-20 text-center">
                    <h1 className="text-2xl font-bold">Area tidak ditemukan</h1>
                    <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                        Area CCTV yang Anda buka belum tersedia untuk publik.
                    </p>
                    <Link to="/" className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
                        Kembali ke CCTV Publik
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
            <section className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
                    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Link
                            to="/"
                            className="inline-flex w-fit items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:border-primary/60 hover:text-primary dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:text-primary-300"
                        >
                            Kembali ke CCTV Publik
                        </Link>
                        <div className="flex flex-col items-start gap-1 sm:items-end">
                            <button
                                type="button"
                                onClick={handleShare}
                                className="inline-flex w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
                            >
                                Share Area
                            </button>
                            {shareMessage && (
                                <span role="status" className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                    {shareMessage}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            Area CCTV
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold sm:text-3xl">{area?.name || 'Area CCTV'}</h1>
                            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
                                {area?.description || 'Pantau CCTV publik area ini secara online melalui RAF NET.'}
                            </p>
                        </div>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        <AreaStat label="Kamera Publik" value={area?.camera_count} />
                        <AreaStat label="Online" value={area?.online_count} />
                        <AreaStat label="Live Sekarang" value={liveViewerCount} />
                    </div>
                </div>
            </section>

            <AreaStatusPanel area={area} cameras={cameras} liveViewerCount={liveViewerCount} />

            <AreaCameraSection
                cameras={liveCameras}
                title={`Sedang Ramai di ${area?.name || ''}`.trim()}
                description="Kamera dengan penonton aktif terbanyak saat ini."
                metricLabel="live"
                metricValue={getCameraLiveViewers}
                onCameraClick={handleCameraOpen}
            />

            <AreaCameraSection
                cameras={topCameras}
                title={`Top CCTV ${area?.name || ''}`.trim()}
                description="Kamera yang paling banyak dibuka oleh pengunjung."
                metricLabel="views"
                metricValue={getCameraTotalViews}
                onCameraClick={handleCameraOpen}
            />

            <AreaCameraSection
                cameras={newestCameras}
                title={`Kamera Baru ${area?.name || ''}`.trim()}
                description="Kamera publik terbaru yang sudah tersedia di area ini."
                metricLabel="views"
                metricValue={getCameraTotalViews}
                onCameraClick={handleCameraOpen}
            />

            <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">Semua CCTV Area</h2>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{cameras.length} kamera</span>
                </div>

                {cameras.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center dark:border-gray-700 dark:bg-gray-900">
                        <h3 className="text-base font-semibold">Belum ada CCTV publik</h3>
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                            Kamera area ini akan muncul setelah tersedia untuk publik.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {cameras.map((camera) => (
                            <AreaCameraCard
                                key={camera.id}
                                camera={camera}
                                onClick={handleCameraOpen}
                            />
                        ))}
                    </div>
                )}
            </section>

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
        </main>
    );
}
