/**
 * Purpose: Tests camera source lifecycle utilities and orchestration boundaries.
 * Caller: Backend Vitest suite for camera source update hardening.
 * Deps: Vitest, cameraSourceFingerprint, cameraSourceLifecycleService.
 * MainFuncs: Validates RTSP masking, source hashing, change classification, and refresh orchestration.
 * SideEffects: None; service orchestration tests use injected fakes.
 */

import { describe, expect, it } from 'vitest';
import {
    hashSourceValue,
    maskRtspUrl,
} from '../utils/cameraSourceFingerprint.js';
import { CameraSourceLifecycleService } from '../services/cameraSourceLifecycleService.js';

describe('camera source fingerprint utilities', () => {
    it('masks RTSP credentials before persistence', () => {
        expect(maskRtspUrl('rtsp://admin:secret@192.168.1.10:554/stream1'))
            .toBe('rtsp://admin:***@192.168.1.10:554/stream1');
    });

    it('hashes source values with stable sha256 output', () => {
        expect(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'))
            .toMatch(/^[a-f0-9]{64}$/);
        expect(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'))
            .toBe(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'));
    });
});

describe('CameraSourceLifecycleService source classification', () => {
    const service = new CameraSourceLifecycleService({
        cameraRuntimeStateService: {},
        cameraHealthService: {},
        mediaMtxService: {},
        db: {},
    });

    it('ignores metadata-only camera updates', () => {
        const result = service.classifySourceChange(
            { id: 1, name: 'Old', private_rtsp_url: 'rtsp://10.0.0.1/live', video_codec: 'h264', enabled: 1 },
            { name: 'New' }
        );

        expect(result).toEqual({
            sourceChanged: false,
            changedFields: [],
            maskedChanges: {},
        });
    });

    it('detects IP, transport, delivery, codec, and enabled changes', () => {
        const result = service.classifySourceChange(
            {
                id: 1,
                private_rtsp_url: 'rtsp://admin:old@10.0.0.1/live',
                internal_rtsp_transport_override: 'tcp',
                delivery_type: 'internal_hls',
                stream_source: 'internal',
                video_codec: 'h264',
                enabled: 1,
            },
            {
                private_rtsp_url: 'rtsp://admin:new@10.0.0.2/live',
                internal_rtsp_transport_override: 'udp',
                delivery_type: 'external_hls',
                stream_source: 'external',
                video_codec: 'h265',
                enabled: 0,
            }
        );

        expect(result.sourceChanged).toBe(true);
        expect(result.changedFields).toEqual([
            'private_rtsp_url',
            'internal_rtsp_transport_override',
            'delivery_type',
            'stream_source',
            'video_codec',
            'enabled',
        ]);
        expect(result.maskedChanges.private_rtsp_url.after).toContain('***');
    });
});

describe('CameraSourceLifecycleService refresh orchestration', () => {
    it('marks reconnecting, refreshes MediaMTX, bumps revision, clears health, and records an event', async () => {
        const calls = [];
        const rows = new Map([[1, { stream_revision: 2, source_updated_at: null }]]);
        const service = new CameraSourceLifecycleService({
            mediaMtxService: {
                refreshCameraPathAfterSourceChange: async (streamKey) => {
                    calls.push(['refreshPath', streamKey]);
                    return { success: true, action: 'refreshed', pathName: streamKey };
                },
                getPathConfig: async () => ({ source: 'rtsp://admin:secret@10.0.0.2/live' }),
            },
            cameraHealthService: {
                clearCameraRuntimeState: async (cameraId, pathName) => calls.push(['clearHealth', cameraId, pathName]),
            },
            cameraRuntimeStateService: {
                upsertRuntimeState: (cameraId, state) => calls.push(['runtime', cameraId, state.monitoring_state]),
            },
            db: {
                queryOne: (sql, params) => rows.get(params[0]),
                query: () => [],
                execute: (sql, params) => {
                    calls.push(['execute', sql, params]);
                    if (sql.includes('UPDATE cameras')) {
                        rows.set(params[2], { stream_revision: 3, source_updated_at: params[0] });
                    }
                },
            },
        });

        const result = await service.refreshCameraSource({
            camera: {
                id: 1,
                name: 'Gate',
                stream_key: 'camera_1',
                stream_source: 'internal',
                delivery_type: 'internal_hls',
                enabled: 1,
                private_rtsp_url: 'rtsp://admin:secret@10.0.0.2/live',
            },
            reason: 'camera_update',
            classification: { sourceChanged: true, changedFields: ['private_rtsp_url'], maskedChanges: {} },
        });

        expect(result).toMatchObject({
            sourceChanged: true,
            status: 'refreshed',
            reason: 'camera_update',
            streamRevision: 3,
            mediaMtx: { success: true, action: 'refreshed' },
            verification: { success: true },
        });
        expect(calls.some((call) => call[0] === 'refreshPath')).toBe(true);
        expect(calls.some((call) => call[0] === 'clearHealth')).toBe(true);
        expect(calls.some((call) => call[0] === 'runtime' && call[2] === 'reconnecting')).toBe(true);
        expect(calls.some((call) => call[0] === 'runtime' && call[2] === 'checking')).toBe(true);
        expect(calls.some((call) => call[0] === 'execute' && call[1].includes('camera_source_lifecycle_events'))).toBe(true);
    });

    it('keeps source refresh successful when lifecycle event persistence fails', async () => {
        const service = new CameraSourceLifecycleService({
            mediaMtxService: {
                refreshCameraPathAfterSourceChange: async (streamKey) => ({ success: true, action: 'refreshed', pathName: streamKey }),
                getPathConfig: async () => ({ source: 'rtsp://admin:secret@10.0.0.2/live' }),
            },
            cameraHealthService: {
                clearCameraRuntimeState: async () => {},
            },
            cameraRuntimeStateService: {
                upsertRuntimeState: () => {},
            },
            db: {
                queryOne: (sql) => (
                    sql.includes('SELECT id FROM cameras')
                        ? { id: 999 }
                        : { stream_revision: 4, source_updated_at: '2026-05-11T05:00:00.000Z' }
                ),
                query: () => [],
                execute: (sql) => {
                    if (sql.includes('camera_source_lifecycle_events')) {
                        throw new Error('FOREIGN KEY constraint failed');
                    }
                },
            },
        });

        await expect(service.refreshCameraSource({
            camera: {
                id: 999,
                stream_key: 'missing-camera',
                stream_source: 'internal',
                delivery_type: 'internal_hls',
                enabled: 1,
                private_rtsp_url: 'rtsp://admin:secret@10.0.0.2/live',
            },
            reason: 'camera_update',
            classification: { sourceChanged: true, changedFields: ['enabled'], maskedChanges: {} },
        })).resolves.toMatchObject({
            sourceChanged: true,
            status: 'refreshed',
            streamRevision: 4,
        });
    });
});
