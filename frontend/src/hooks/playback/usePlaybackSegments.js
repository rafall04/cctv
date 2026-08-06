/*
 * Purpose: Load playback recording segments for a selected camera with stale response protection.
 * Caller: Playback route and hook tests.
 * Deps: React hooks, recordingService, request policy, playback policy and segment selection utils.
 * MainFuncs: usePlaybackSegments.
 * SideEffects: Fetches recording segments through recordingService.
 *
 * THE LIST IS SCOPED; THE COVERAGE IS NOT.
 * `range` narrows what is fetched, because this hook re-fetches every ten seconds and an unscoped
 * admin listing was ~1,065 segments / 239 KB per poll. `coverage` comes back describing the whole
 * reachable span regardless, so narrowing the list can never hide a day that has no footage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import recordingService from '../../services/recordingService.js';
import { REQUEST_POLICY } from '../../services/requestPolicy.js';
import {
    findClosestSegmentByStartTime,
    findSegmentForTimestamp,
} from '../../utils/playbackSegmentSelection.js';
import { getDefaultPlaybackPolicy } from '../../utils/playbackAccessPolicy.js';
import { localDayRange, rangesEqual, rollingRange } from '../../utils/playbackDayRange.js';

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
            coverage: null,
        };
    }

    return {
        segments: Array.isArray(data?.segments) ? data.segments : [],
        playbackPolicy: data?.playback_policy || null,
        coverage: data?.coverage || null,
    };
}

/**
 * A cheap identity for a segment list.
 *
 * The background poll runs every ten seconds and hands back a brand-new array almost every time,
 * which invalidates every downstream `useMemo` and rebuilds the timeline and the list from scratch
 * — four times a minute, for a payload that usually has not changed at all. Comparing the ids and
 * ends is enough: a segment only ever grows an end time, it never mutates in place.
 */
function segmentsSignature(segments) {
    return segments.map((segment) => `${segment.id}:${segment.end_time || ''}`).join('|');
}

/** The slice to open on: the day a share link points at, otherwise the last rolling window. */
function initialRange(timestampParam) {
    const timestamp = Number.parseInt(timestampParam, 10);
    return Number.isFinite(timestamp) ? localDayRange(timestamp) : rollingRange();
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
    setCoverage,
}) {
    setPlaybackPolicy(getDefaultPlaybackPolicy(accessScope));
    setPlaybackDeniedMessage('');
    setSegments([]);
    setSegmentsCameraId(requestCameraId);
    setSelectedSegment(null);
    setSeekTargetSeconds(null);
    // Nothing came back, so the last camera's coverage bar must not stay on screen describing this one.
    setCoverage?.(null);
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
    const [coverage, setCoverage] = useState(null);
    const [range, setRangeState] = useState(() => initialRange(timestampParam));
    const requestIdRef = useRef(0);
    const selectedSegmentRef = useRef(null);
    const timestampParamRef = useRef(timestampParam);
    const segmentsSignatureRef = useRef('');

    // Ignore a repeat of the slice already on screen: it would blank the list and re-select a
    // segment for no reason.
    const setRange = useCallback((next) => {
        setRangeState((current) => (rangesEqual(current, next) ? current : next || rollingRange()));
    }, []);

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
            segmentsSignatureRef.current = '';
            setSegmentsCameraId(null);
            setSelectedSegment(null);
            setSeekTargetSeconds(null);
            setLoading(false);
            setPlaybackDeniedMessage('');
            setCoverage(null);
            return;
        }

        const isBackgroundMode = mode === 'background' || mode === 'resume';

        if (!isBackgroundMode) {
            setLoading(true);
            setSegments([]);
            // The list on screen is gone, so the signature it was taken from no longer describes it.
            segmentsSignatureRef.current = '';
            setSegmentsCameraId(null);
            setSelectedSegment(null);
            setSeekTargetSeconds(null);
        }

        try {
            const response = await recordingService.getSegments(
                requestCameraId,
                isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING,
                {},
                accessScope,
                range
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
                        setCoverage,
                    });
                    return;
                }

                if (!isBackgroundMode) {
                    setPlaybackDeniedMessage(response?.message || '');
                }
                return;
            }

            const {
                segments: nextSegments,
                playbackPolicy: nextPlaybackPolicy,
                coverage: nextCoverage,
            } = normalizeSegmentsData(response.data);
            setPlaybackPolicy(nextPlaybackPolicy || getDefaultPlaybackPolicy(accessScope));
            setPlaybackDeniedMessage('');
            setCoverage(nextCoverage);

            // Keep the SAME array when nothing changed, so the ten-second poll stops invalidating
            // every memo below it and rebuilding the timeline and the list for no reason.
            const signature = segmentsSignature(nextSegments);
            if (signature !== segmentsSignatureRef.current) {
                segmentsSignatureRef.current = signature;
                setSegments(nextSegments);
            }
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
                        setCoverage,
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
    }, [accessScope, cameraId, range]);

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

    /*
     * A share link naming a moment outside the slice on screen would land on an empty list. The
     * link is the stronger statement of intent — it names an instant — so the slice follows it.
     */
    useEffect(() => {
        const timestamp = Number.parseInt(timestampParam, 10);
        if (!Number.isFinite(timestamp)) return;
        setRange(localDayRange(timestamp));
    }, [setRange, timestampParam]);

    const dayScope = useMemo(() => ({ coverage, range, setRange }), [coverage, range, setRange]);

    return {
        segments,
        segmentsCameraId,
        selectedSegment,
        setSelectedSegment,
        seekTargetSeconds,
        loading,
        playbackPolicy,
        playbackDeniedMessage,
        dayScope,
        reload: loadSegments,
    };
}
