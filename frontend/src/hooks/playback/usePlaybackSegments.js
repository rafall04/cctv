/*
 * Purpose: Load playback recording segments for a selected camera with stale response protection.
 * Caller: Playback route and hook tests.
 * Deps: React hooks, recordingService, request policy, playback policy and segment selection utils.
 * MainFuncs: usePlaybackSegments.
 * SideEffects: Fetches recording segments through recordingService.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import recordingService from '../../services/recordingService.js';
import { REQUEST_POLICY } from '../../services/requestPolicy.js';
import {
    findClosestSegmentByStartTime,
    findSegmentForTimestamp,
} from '../../utils/playbackSegmentSelection.js';
import { getDefaultPlaybackPolicy } from '../../utils/playbackAccessPolicy.js';

function getSegmentKey(segment) {
    if (!segment) {
        return null;
    }

    if (segment.id) {
        return `id:${segment.id}`;
    }

    return `${segment.filename || 'no-file'}:${segment.start_time || 'no-start'}`;
}

function normalizeSegmentsData(data) {
    if (Array.isArray(data)) {
        return {
            segments: data,
            playbackPolicy: null,
        };
    }

    return {
        segments: Array.isArray(data?.segments) ? data.segments : [],
        playbackPolicy: data?.playback_policy || null,
    };
}

function selectLatestSegment(segments) {
    if (!segments.length) {
        return null;
    }

    return [...segments].sort((a, b) => new Date(b.start_time) - new Date(a.start_time))[0];
}

function isNoSegmentsMessage(message) {
    return typeof message === 'string' && message.toLowerCase().includes('no segments found');
}

function applyEmptySegmentsState({
    requestCameraId,
    accessScope,
    setPlaybackPolicy,
    setPlaybackDeniedMessage,
    setSegments,
    setSegmentsCameraId,
    setSelectedSegment,
    setSeekTargetSeconds,
}) {
    setPlaybackPolicy(getDefaultPlaybackPolicy(accessScope));
    setPlaybackDeniedMessage('');
    setSegments([]);
    setSegmentsCameraId(requestCameraId);
    setSelectedSegment(null);
    setSeekTargetSeconds(null);
}

function selectInitialSegment(segments, timestampParam) {
    if (!segments.length) {
        return {
            segment: null,
            seekTargetSeconds: null,
        };
    }

    if (!timestampParam) {
        return {
            segment: selectLatestSegment(segments),
            seekTargetSeconds: null,
        };
    }

    const timestamp = Number.parseInt(timestampParam, 10);
    if (!Number.isFinite(timestamp)) {
        return {
            segment: selectLatestSegment(segments),
            seekTargetSeconds: null,
        };
    }

    const timestampSegment = findSegmentForTimestamp(segments, timestamp);
    if (timestampSegment) {
        const startTime = new Date(timestampSegment.start_time).getTime();
        const diffSeconds = (timestamp - startTime) / 1000;
        return {
            segment: timestampSegment,
            seekTargetSeconds: diffSeconds > 0 ? diffSeconds : 0,
        };
    }

    return {
        segment: findClosestSegmentByStartTime(segments, timestamp) || selectLatestSegment(segments),
        seekTargetSeconds: 0,
    };
}

export function usePlaybackSegments({
    cameraId,
    timestampParam,
    accessScope,
}) {
    const [segments, setSegments] = useState([]);
    const [segmentsCameraId, setSegmentsCameraId] = useState(null);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [seekTargetSeconds, setSeekTargetSeconds] = useState(null);
    const [loading, setLoading] = useState(Boolean(cameraId));
    const [playbackPolicy, setPlaybackPolicy] = useState(() => getDefaultPlaybackPolicy(accessScope));
    const [playbackDeniedMessage, setPlaybackDeniedMessage] = useState('');
    const requestIdRef = useRef(0);
    const selectedSegmentRef = useRef(null);
    const timestampParamRef = useRef(timestampParam);

    useEffect(() => {
        selectedSegmentRef.current = selectedSegment;
    }, [selectedSegment]);

    useEffect(() => {
        timestampParamRef.current = timestampParam;
    }, [timestampParam]);

    useEffect(() => {
        setPlaybackPolicy((currentPolicy) => currentPolicy || getDefaultPlaybackPolicy(accessScope));
    }, [accessScope]);

    const loadSegments = useCallback(async (requestCameraId = cameraId, { mode = 'initial' } = {}) => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (!requestCameraId) {
            setSegments([]);
            setSegmentsCameraId(null);
            setSelectedSegment(null);
            setSeekTargetSeconds(null);
            setLoading(false);
            setPlaybackDeniedMessage('');
            return;
        }

        const isBackgroundMode = mode === 'background' || mode === 'resume';

        if (!isBackgroundMode) {
            setLoading(true);
            setSegments([]);
            setSegmentsCameraId(null);
            setSelectedSegment(null);
            setSeekTargetSeconds(null);
        }

        try {
            const response = await recordingService.getSegments(
                requestCameraId,
                isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING,
                {},
                accessScope
            );

            if (requestId !== requestIdRef.current) {
                return;
            }

            if (!response?.success || !response.data) {
                if (response?.status === 404 || isNoSegmentsMessage(response?.message)) {
                    applyEmptySegmentsState({
                        requestCameraId,
                        accessScope,
                        setPlaybackPolicy,
                        setPlaybackDeniedMessage,
                        setSegments,
                        setSegmentsCameraId,
                        setSelectedSegment,
                        setSeekTargetSeconds,
                    });
                    return;
                }

                if (!isBackgroundMode) {
                    setPlaybackDeniedMessage(response?.message || '');
                }
                return;
            }

            const { segments: nextSegments, playbackPolicy: nextPlaybackPolicy } = normalizeSegmentsData(response.data);
            setPlaybackPolicy(nextPlaybackPolicy || getDefaultPlaybackPolicy(accessScope));
            setPlaybackDeniedMessage('');
            setSegments(nextSegments);
            setSegmentsCameraId(requestCameraId);

            const activeSegmentKey = getSegmentKey(selectedSegmentRef.current);
            if (activeSegmentKey) {
                const hasActiveSegment = nextSegments.some((segment) => getSegmentKey(segment) === activeSegmentKey);
                if (hasActiveSegment && isBackgroundMode) {
                    return;
                }
            }

            const nextSelection = selectInitialSegment(nextSegments, timestampParamRef.current);
            setSelectedSegment(nextSelection.segment);
            setSeekTargetSeconds(nextSelection.seekTargetSeconds);
        } catch (error) {
            if (requestId !== requestIdRef.current) {
                return;
            }

            if (!isBackgroundMode) {
                const errorMessage = error?.response?.data?.message || '';
                if (error?.response?.status === 404 || isNoSegmentsMessage(errorMessage)) {
                    applyEmptySegmentsState({
                        requestCameraId,
                        accessScope,
                        setPlaybackPolicy,
                        setPlaybackDeniedMessage,
                        setSegments,
                        setSegmentsCameraId,
                        setSelectedSegment,
                        setSeekTargetSeconds,
                    });
                    return;
                }

                setPlaybackDeniedMessage(errorMessage);
                setSegments([]);
                setSegmentsCameraId(null);
                setSelectedSegment(null);
                setSeekTargetSeconds(null);
            }
        } finally {
            if (requestId === requestIdRef.current && !isBackgroundMode) {
                setLoading(false);
            }
        }
    }, [accessScope, cameraId]);

    useEffect(() => {
        if (!segments.length || segmentsCameraId !== cameraId) {
            return;
        }

        const nextSelection = selectInitialSegment(segments, timestampParam);
        if (getSegmentKey(nextSelection.segment) !== getSegmentKey(selectedSegmentRef.current)) {
            setSelectedSegment(nextSelection.segment);
        }
        setSeekTargetSeconds(nextSelection.seekTargetSeconds);
    }, [cameraId, segments, segmentsCameraId, timestampParam]);

    useEffect(() => {
        loadSegments(cameraId, { mode: 'initial' });

        if (!cameraId) {
            return undefined;
        }

        const interval = setInterval(() => {
            loadSegments(cameraId, { mode: 'background' });
        }, 10000);

        return () => {
            clearInterval(interval);
        };
    }, [cameraId, loadSegments]);

    return {
        segments,
        segmentsCameraId,
        selectedSegment,
        setSelectedSegment,
        seekTargetSeconds,
        loading,
        playbackPolicy,
        playbackDeniedMessage,
        reload: loadSegments,
    };
}
