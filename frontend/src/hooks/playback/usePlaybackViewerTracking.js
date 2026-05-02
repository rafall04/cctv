/*
 * Purpose: Manage playback viewer session lifecycle outside Playback.jsx.
 * Caller: Playback route and hook tests.
 * Deps: React hooks, playbackViewerService.
 * MainFuncs: usePlaybackViewerTracking.
 * SideEffects: Starts/stops playback viewer sessions through playbackViewerService.
 */

import { useCallback, useEffect, useRef } from 'react';
import playbackViewerService from '../../services/playbackViewerService.js';

function buildPlaybackViewerKey(cameraId, segment, accessScope) {
    if (!cameraId || !segment?.filename) {
        return null;
    }

    return `${cameraId}:${segment.filename}:${accessScope}`;
}

export function usePlaybackViewerTracking({
    cameraId,
    segment,
    accessScope,
}) {
    const activeSessionIdRef = useRef(null);
    const activeKeyRef = useRef(null);
    const pendingKeyRef = useRef(null);
    const pendingTokenRef = useRef(0);
    const latestRef = useRef({ cameraId, segment, accessScope });

    useEffect(() => {
        latestRef.current = { cameraId, segment, accessScope };
    }, [accessScope, cameraId, segment]);

    const stopSession = useCallback(async () => {
        const activeSessionId = activeSessionIdRef.current;
        activeSessionIdRef.current = null;
        activeKeyRef.current = null;
        pendingKeyRef.current = null;
        pendingTokenRef.current += 1;

        if (activeSessionId) {
            await playbackViewerService.stopSession(activeSessionId);
        }
    }, []);

    const ensureSessionStarted = useCallback(async () => {
        const current = latestRef.current;
        const nextKey = buildPlaybackViewerKey(current.cameraId, current.segment, current.accessScope);

        if (!nextKey) {
            return;
        }

        if (activeSessionIdRef.current && activeKeyRef.current === nextKey) {
            return;
        }

        if (pendingKeyRef.current === nextKey) {
            return;
        }

        const pendingToken = pendingTokenRef.current + 1;
        pendingTokenRef.current = pendingToken;
        pendingKeyRef.current = nextKey;

        if (activeSessionIdRef.current && activeKeyRef.current !== nextKey) {
            await stopSession();
        }

        try {
            const sessionId = await playbackViewerService.startSession({
                cameraId: current.cameraId,
                segmentFilename: current.segment.filename,
                segmentStartedAt: current.segment.start_time || null,
                accessMode: current.accessScope,
            });

            const latest = latestRef.current;
            const currentKey = buildPlaybackViewerKey(latest.cameraId, latest.segment, latest.accessScope);

            if (pendingToken !== pendingTokenRef.current || currentKey !== nextKey) {
                if (sessionId) {
                    await playbackViewerService.stopSession(sessionId);
                }
                return;
            }

            if (sessionId) {
                activeSessionIdRef.current = sessionId;
                activeKeyRef.current = nextKey;
            }
        } finally {
            if (pendingToken === pendingTokenRef.current) {
                pendingKeyRef.current = null;
            }
        }
    }, [stopSession]);

    useEffect(() => {
        const nextKey = buildPlaybackViewerKey(cameraId, segment, accessScope);
        if (activeKeyRef.current && activeKeyRef.current !== nextKey) {
            stopSession();
        }
    }, [accessScope, cameraId, segment, stopSession]);

    useEffect(() => {
        return () => {
            stopSession();
            playbackViewerService.stopAllSessions();
        };
    }, [stopSession]);

    return {
        ensureSessionStarted,
        stopSession,
        stopAllSessions: playbackViewerService.stopAllSessions,
    };
}
