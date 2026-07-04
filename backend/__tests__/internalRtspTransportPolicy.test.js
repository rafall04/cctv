/*
Purpose: Validate internal RTSP transport policy resolution for area defaults and camera overrides.
Caller: Backend Vitest suite before changing MediaMTX and FFmpeg RTSP transport behavior.
Deps: internalRtspTransportPolicy utility.
MainFuncs: normalizeInternalRtspTransport, resolveInternalRtspTransport, toMediaMtxSourceProtocol, buildFfmpegRtspInputArgs.
SideEffects: None; pure policy tests only.
*/

import { describe, expect, it } from 'vitest';
import {
    buildFfmpegRtspInputArgs,
    normalizeInternalRtspTransport,
    resolveInternalRtspTransport,
    toMediaMtxSourceProtocol,
} from '../utils/internalRtspTransportPolicy.js';

describe('internalRtspTransportPolicy', () => {
    it('defaults existing internal cameras to tcp for backward compatibility', () => {
        expect(resolveInternalRtspTransport({}, {})).toBe('tcp');
        expect(resolveInternalRtspTransport({
            internal_rtsp_transport_override: 'default',
        }, {
            internal_rtsp_transport_default: 'default',
        })).toBe('tcp');
    });

    it('uses camera override before area default', () => {
        expect(resolveInternalRtspTransport({
            internal_rtsp_transport_override: 'udp',
        }, {
            internal_rtsp_transport_default: 'tcp',
        })).toBe('udp');
    });

    it('uses area default before tcp fallback', () => {
        expect(resolveInternalRtspTransport({
            internal_rtsp_transport_override: 'default',
        }, {
            internal_rtsp_transport_default: 'auto',
        })).toBe('auto');
    });

    it('normalizes invalid transport values to default', () => {
        expect(normalizeInternalRtspTransport('udp')).toBe('udp');
        expect(normalizeInternalRtspTransport('auto')).toBe('auto');
        expect(normalizeInternalRtspTransport('automatic')).toBe('auto');
        expect(normalizeInternalRtspTransport('bad')).toBe('default');
    });

    it('maps resolved transport to MediaMTX sourceProtocol', () => {
        expect(toMediaMtxSourceProtocol('tcp')).toBe('tcp');
        expect(toMediaMtxSourceProtocol('udp')).toBe('udp');
        expect(toMediaMtxSourceProtocol('auto')).toBe('automatic');
    });

    it('builds FFmpeg RTSP input args for tcp, udp, and auto', () => {
        expect(buildFfmpegRtspInputArgs('rtsp://cam/stream', 'tcp')).toEqual([
            '-rtsp_transport',
            'tcp',
            '-i',
            'rtsp://cam/stream',
        ]);
        expect(buildFfmpegRtspInputArgs('rtsp://cam/stream', 'udp')).toEqual([
            '-rtsp_transport',
            'udp',
            '-i',
            'rtsp://cam/stream',
        ]);
        expect(buildFfmpegRtspInputArgs('rtsp://cam/stream', 'auto')).toEqual([
            '-i',
            'rtsp://cam/stream',
        ]);
    });

    it('injects -stimeout before -i when a socket timeout is provided', () => {
        expect(buildFfmpegRtspInputArgs('rtsp://cam/stream', 'tcp', { socketTimeoutMicros: 20_000_000 })).toEqual([
            '-rtsp_transport',
            'tcp',
            '-stimeout',
            '20000000',
            '-i',
            'rtsp://cam/stream',
        ]);
        expect(buildFfmpegRtspInputArgs('rtsp://cam/stream', 'auto', { socketTimeoutMicros: 20_000_000 })).toEqual([
            '-stimeout',
            '20000000',
            '-i',
            'rtsp://cam/stream',
        ]);
    });

    it('omits -stimeout when no/invalid socket timeout is given', () => {
        expect(buildFfmpegRtspInputArgs('rtsp://cam/stream', 'tcp')).not.toContain('-stimeout');
        expect(buildFfmpegRtspInputArgs('rtsp://cam/stream', 'tcp', { socketTimeoutMicros: 0 })).not.toContain('-stimeout');
        expect(buildFfmpegRtspInputArgs('rtsp://cam/stream', 'tcp', { socketTimeoutMicros: null })).not.toContain('-stimeout');
    });
});
