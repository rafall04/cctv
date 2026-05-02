/*
 * Purpose: Manage playback share links, snapshots, and notification lifecycle outside Playback.jsx.
 * Caller: Playback route and share/snapshot hook tests.
 * Deps: React hooks, public share URL utility, camera slug utility, browser media/canvas/share APIs.
 * MainFuncs: usePlaybackShareAndSnapshot.
 * SideEffects: Reads video element state, draws canvas snapshots, invokes native share/clipboard/download APIs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCameraSlug } from '../../utils/slugify.js';
import { buildPublicPlaybackShareUrl } from '../../utils/publicShareUrl.js';

const NOTIFICATION_TIMEOUT_MS = 3000;
const LONG_NOTIFICATION_TIMEOUT_MS = 5000;

export function usePlaybackShareAndSnapshot({
    videoRef,
    branding,
    selectedCamera,
    selectedSegment,
    searchParams,
    isAdminPlayback,
}) {
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const notificationTimeoutRef = useRef(null);

    const clearSnapshotNotification = useCallback(() => {
        if (notificationTimeoutRef.current) {
            clearTimeout(notificationTimeoutRef.current);
            notificationTimeoutRef.current = null;
        }
        setSnapshotNotification(null);
    }, []);

    const showSnapshotNotification = useCallback((notification, timeoutMs = NOTIFICATION_TIMEOUT_MS) => {
        if (notificationTimeoutRef.current) {
            clearTimeout(notificationTimeoutRef.current);
        }

        setSnapshotNotification(notification);
        notificationTimeoutRef.current = setTimeout(() => {
            setSnapshotNotification(null);
            notificationTimeoutRef.current = null;
        }, timeoutMs);
    }, []);

    useEffect(() => {
        return () => {
            if (notificationTimeoutRef.current) {
                clearTimeout(notificationTimeoutRef.current);
            }
        };
    }, []);

    const takeSnapshot = useCallback(async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            showSnapshotNotification({ type: 'error', message: 'Video belum siap untuk snapshot' });
            return;
        }

        const cameraName = selectedCamera?.name || 'camera';

        try {
            const video = videoRef.current;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const watermarkHeight = Math.max(40, canvas.height * 0.08);
            const padding = watermarkHeight * 0.3;
            const fontSize = watermarkHeight * 0.4;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(canvas.width - (watermarkHeight * 4) - padding, canvas.height - watermarkHeight - padding, watermarkHeight * 4, watermarkHeight);

            const logoSize = watermarkHeight * 0.6;
            const logoX = canvas.width - (watermarkHeight * 3.5) - padding;
            const logoY = canvas.height - (watermarkHeight / 2) - padding;

            ctx.fillStyle = '#0ea5e9';
            ctx.beginPath();
            ctx.arc(logoX, logoY, logoSize / 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${logoSize * 0.6}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding?.logo_text || 'R', logoX, logoY);

            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding?.company_name || 'RAF NET', logoX + logoSize / 2 + padding / 2, logoY - fontSize / 3);

            ctx.font = `${fontSize * 0.7}px Arial`;
            ctx.fillStyle = '#94a3b8';
            const timestamp = new Date().toLocaleString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
            ctx.fillText(timestamp, logoX + logoSize / 2 + padding / 2, logoY + fontSize / 2);

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    showSnapshotNotification({ type: 'error', message: 'Gagal membuat snapshot' });
                    return;
                }

                const filename = `${cameraName}-${Date.now()}.png`;

                if (navigator.share && navigator.canShare) {
                    try {
                        const file = new File([blob], filename, { type: 'image/png' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({ files: [file], title: `Snapshot - ${cameraName}` });
                            showSnapshotNotification({ type: 'success', message: 'Snapshot berhasil dibagikan!' });
                            return;
                        }
                    } catch (err) {
                        if (err.name !== 'AbortError') console.warn('Share failed:', err);
                    }
                }

                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.click();
                URL.revokeObjectURL(url);

                showSnapshotNotification({ type: 'success', message: 'Snapshot berhasil diunduh!' });
            }, 'image/png', 0.95);
        } catch (error) {
            console.error('Snapshot error:', error);
            showSnapshotNotification({ type: 'error', message: 'Gagal mengambil snapshot' });
        }
    }, [branding, selectedCamera, showSnapshotNotification, videoRef]);

    const handleShare = useCallback(async () => {
        if (isAdminPlayback) {
            return;
        }

        let preciseTimestamp = null;
        if (selectedSegment?.start_time) {
            const baseTimeMs = new Date(selectedSegment.start_time).getTime();
            preciseTimestamp = baseTimeMs;

            if (videoRef.current && typeof videoRef.current.currentTime === 'number') {
                const currentSecsMs = Math.floor(videoRef.current.currentTime * 1000);
                preciseTimestamp += currentSecsMs;
            }
        }

        const shareUrl = buildPublicPlaybackShareUrl({
            searchParams,
            camera: selectedCamera?.id ? createCameraSlug(selectedCamera) : null,
            timestamp: preciseTimestamp,
        });

        const shareData = {
            title: `Playback - ${selectedCamera?.name || 'CCTV'}`,
            text: `Lihat rekaman dari kamera ${selectedCamera?.name || 'CCTV'}`,
            url: shareUrl,
        };

        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    await navigator.clipboard.writeText(shareUrl);
                    showSnapshotNotification({ type: 'success', message: 'Tautan disalin ke clipboard!' });
                }
            }
        } else {
            try {
                await navigator.clipboard.writeText(shareUrl);
                showSnapshotNotification({ type: 'success', message: 'Tautan disalin ke clipboard!' });
            } catch (err) {
                showSnapshotNotification({ type: 'error', message: 'Gagal menyalin tautan' }, LONG_NOTIFICATION_TIMEOUT_MS);
            }
        }
    }, [isAdminPlayback, searchParams, selectedCamera, selectedSegment, showSnapshotNotification, videoRef]);

    return {
        snapshotNotification,
        clearSnapshotNotification,
        takeSnapshot,
        handleShare,
    };
}
