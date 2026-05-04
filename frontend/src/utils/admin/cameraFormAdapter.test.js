/*
Purpose: Regression coverage for camera admin form payload and validation adapters.
Caller: Frontend Vitest suite for Camera Management form behavior.
Deps: cameraFormAdapter exports and frontend validators.
MainFuncs: buildCameraPayload(), mapCameraToFormValues(), getCameraValidationRules().
SideEffects: None; pure adapter tests only.
*/

import { describe, expect, it } from 'vitest';
import {
    buildCameraPayload,
    defaultCameraFormValues,
    getCameraValidationRules,
    mapCameraToFormValues,
} from './cameraFormAdapter';

describe('cameraFormAdapter delivery type support', () => {
    it('maps legacy external HLS cameras into delivery-aware form values safely', () => {
        const values = mapCameraToFormValues({
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
            external_use_proxy: 1,
            external_tls_mode: 'insecure',
        });

        expect(values.delivery_type).toBe('external_hls');
        expect(values.external_stream_url).toBe('https://example.com/live.m3u8');
        expect(values.external_use_proxy).toBe(true);
        expect(values.external_tls_mode).toBe('insecure');
    });

    it('maps external health mode into form values', () => {
        const values = mapCameraToFormValues({
            delivery_type: 'external_mjpeg',
            external_stream_url: 'https://example.com/live.mjpg',
            external_health_mode: 'passive_first',
        });

        expect(values.external_health_mode).toBe('passive_first');
    });

    it('builds external HLS payload with compat fields and strict proxy defaults', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            name: 'External Cam',
            delivery_type: 'external_hls',
            stream_source: 'external',
            external_stream_url: 'https://example.com/live.m3u8',
        });

        expect(payload).toMatchObject({
            stream_source: 'external',
            delivery_type: 'external_hls',
            external_hls_url: 'https://example.com/live.m3u8',
            external_stream_url: 'https://example.com/live.m3u8',
            private_rtsp_url: null,
            external_use_proxy: 1,
            external_tls_mode: 'strict',
        });
    });

    it('keeps recording enabled for external HLS cameras because playback recording supports HLS inputs', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            name: 'External Recording Cam',
            delivery_type: 'external_hls',
            stream_source: 'external',
            enable_recording: true,
            recording_duration_hours: 24,
            external_stream_url: 'https://example.com/live.m3u8',
        });

        expect(payload).toMatchObject({
            delivery_type: 'external_hls',
            stream_source: 'external',
            enable_recording: 1,
            recording_duration_hours: 24,
        });
    });

    it('builds external MJPEG payload without playback recording fields', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            name: 'MJPEG Cam',
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            enable_recording: true,
            external_stream_url: 'https://example.com/zm/cgi-bin/nph-zms',
            external_snapshot_url: 'https://example.com/snapshot.jpg',
        });

        expect(payload).toMatchObject({
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            enable_recording: 0,
            external_stream_url: 'https://example.com/zm/cgi-bin/nph-zms',
            external_snapshot_url: 'https://example.com/snapshot.jpg',
            external_hls_url: null,
            external_health_mode: 'default',
        });
    });

    it('builds external MJPEG payload with passive-first health mode override', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            external_stream_url: 'https://example.com/mjpeg',
            external_health_mode: 'passive_first',
        });

        expect(payload.external_health_mode).toBe('passive_first');
    });

    it('builds external FLV payload as live-only external source without proxy', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            delivery_type: 'external_flv',
            stream_source: 'external',
            external_stream_url: 'https://surakarta.atcsindonesia.info:8086/camera/BalaiKota.flv',
            external_embed_url: 'https://example.com/fallback-player',
            external_use_proxy: true,
        });

        expect(payload).toMatchObject({
            delivery_type: 'external_flv',
            stream_source: 'external',
            external_stream_url: 'https://surakarta.atcsindonesia.info:8086/camera/BalaiKota.flv',
            external_hls_url: null,
            external_embed_url: 'https://example.com/fallback-player',
            external_use_proxy: 0,
            external_tls_mode: 'strict',
        });
    });

    it('validates FLV delivery types with .flv URLs only', () => {
        const rules = getCameraValidationRules('external_flv');

        expect(rules.external_stream_url.custom('https://example.com/live')).toBe('URL FLV harus berakhiran .flv');
        expect(rules.external_stream_url.custom('https://example.com/live.flv')).toBeUndefined();
    });

    it('validates WebSocket delivery types with ws/wss URLs only', () => {
        const rules = getCameraValidationRules('external_custom_ws');

        expect(rules.external_stream_url.custom('https://example.com/live')).toBe('URL must start with ws:// or wss://');
        expect(rules.external_stream_url.custom('wss://example.com/live')).toBeUndefined();
    });

    it('builds internal camera payload with ingest policy override fields', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            name: 'Internal On Demand Cam',
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            private_rtsp_url: 'rtsp://example.local/stream',
            internal_ingest_policy_override: 'on_demand',
            internal_on_demand_close_after_seconds_override: '15',
            internal_rtsp_transport_override: 'udp',
            source_profile: 'remote_private_rtsp',
        });

        expect(payload).toMatchObject({
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            private_rtsp_url: 'rtsp://example.local/stream',
            internal_ingest_policy_override: 'on_demand',
            internal_on_demand_close_after_seconds_override: 15,
            internal_rtsp_transport_override: 'udp',
            source_profile: 'remote_private_rtsp',
        });
    });

    it('clears internal ingest fields for external cameras', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            delivery_type: 'external_hls',
            stream_source: 'external',
            external_stream_url: 'https://example.com/live.m3u8',
            internal_ingest_policy_override: 'on_demand',
            internal_on_demand_close_after_seconds_override: '15',
            internal_rtsp_transport_override: 'udp',
            source_profile: 'remote_private_rtsp',
        });

        expect(payload).toMatchObject({
            delivery_type: 'external_hls',
            stream_source: 'external',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            internal_rtsp_transport_override: 'default',
            source_profile: null,
        });
    });
});
