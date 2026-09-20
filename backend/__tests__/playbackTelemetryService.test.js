// Purpose: Cover the telemetry ring buffer — bounded memory, correct counters, resettable.
// Caller: backend test gate.
// Deps: playbackTelemetryService (module singleton — reset between tests).
// MainFuncs: record, getSummary, resetForTests.
// SideEffects: In-memory only.

import { beforeEach, describe, expect, it } from 'vitest';
import playbackTelemetryService from '../services/playbackTelemetryService.js';

describe('playbackTelemetryService', () => {
    beforeEach(() => playbackTelemetryService.resetForTests());

    it('counts events by stage, error code and camera', () => {
        playbackTelemetryService.record({ stage: 'source_load', errorCode: 'codec', cameraId: 7, scope: 'public_preview', segment: 'a.mp4' });
        playbackTelemetryService.record({ stage: 'source_load', errorCode: 'codec', cameraId: 7 });
        playbackTelemetryService.record({ stage: 'seek_stall', errorCode: 'stalled', cameraId: 9 });

        const s = playbackTelemetryService.getSummary();
        expect(s.totalEvents).toBe(3);
        expect(s.byStage).toEqual({ source_load: 2, seek_stall: 1 });
        expect(s.topErrorCodes[0]).toEqual({ key: 'codec', count: 2 });
        expect(s.topCameras[0]).toEqual({ cameraId: 7, count: 2 });
        expect(s.recent).toHaveLength(3);
        expect(s.lastEventAt).toBeTruthy();
    });

    it('keeps the ring bounded under a flood', () => {
        for (let i = 0; i < 600; i += 1) {
            playbackTelemetryService.record({ stage: 'unknown', cameraId: i });
        }
        const s = playbackTelemetryService.getSummary();
        expect(s.totalEvents).toBe(600);          // counter still tells the true volume
        expect(s.recent.length).toBeLessThanOrEqual(20);
        expect(s.distinctCameraIds).toBe(600);    // counters survive ring eviction — totals stay true
    });

    it('never stores PII-shaped fields even if the caller sends them', () => {
        playbackTelemetryService.record({ stage: 'source_load', cameraId: 3, ip: '1.2.3.4', token: 'abc' });
        const evt = playbackTelemetryService.getSummary().recent[0];
        expect(evt).not.toHaveProperty('ip');
        expect(evt).not.toHaveProperty('token');
    });

    it('folds attacker-chosen camera ids into __other once the counter is full', () => {
        for (let i = 0; i < 2100; i += 1) {
            playbackTelemetryService.record({ stage: 'unknown', cameraId: 1_000_000 + i });
        }
        const s = playbackTelemetryService.getSummary();
        expect(s.distinctCameraIds).toBeLessThanOrEqual(2001);
        // The fold key outranks every count-1 id, so it lands first in topCameras.
        expect(s.topCameras[0].cameraId).toBe('__other');
        expect(s.topCameras[0].count).toBeGreaterThanOrEqual(99);
        expect(s.totalEvents).toBe(2100);
    });
});
