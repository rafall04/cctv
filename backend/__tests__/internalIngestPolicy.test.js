/*
Purpose: Validate internal RTSP ingest policy resolution for area defaults, camera overrides, and compatibility profiles.
Caller: Backend Vitest suite before changing MediaMTX or stream warmer behavior.
Deps: internalIngestPolicy utility.
MainFuncs: resolveInternalIngestPolicy, buildInternalIngestPolicySummary, normalizeOnDemandCloseAfterSeconds.
SideEffects: None; pure policy tests only.
*/

import { describe, expect, it } from 'vitest';
import {
    buildInternalIngestPolicySummary,
    normalizeOnDemandCloseAfterSeconds,
    resolveInternalIngestPolicy,
} from '../utils/internalIngestPolicy.js';

describe('internalIngestPolicy', () => {
    it('defaults ordinary internal RTSP cameras to always_on', () => {
        expect(resolveInternalIngestPolicy({
            private_rtsp_url: 'rtsp://local-camera/stream',
            internal_ingest_policy_override: 'default',
            source_profile: null,
            description: '',
            enable_recording: 1,
        }, {
            internal_ingest_policy_default: 'default',
        })).toMatchObject({
            mode: 'always_on',
            closeAfterSeconds: null,
            isStrictOnDemandProfile: false,
        });
    });

    it('uses area on_demand before ordinary global fallback', () => {
        expect(resolveInternalIngestPolicy({
            private_rtsp_url: 'rtsp://remote-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
        }, {
            internal_ingest_policy_default: 'on_demand',
            internal_on_demand_close_after_seconds: 45,
        })).toMatchObject({
            mode: 'on_demand',
            closeAfterSeconds: 45,
        });
    });

    it('uses camera override before area default', () => {
        expect(resolveInternalIngestPolicy({
            private_rtsp_url: 'rtsp://exception-camera/stream',
            internal_ingest_policy_override: 'always_on',
            internal_on_demand_close_after_seconds_override: 15,
        }, {
            internal_ingest_policy_default: 'on_demand',
            internal_on_demand_close_after_seconds: 45,
        })).toMatchObject({
            mode: 'always_on',
            closeAfterSeconds: null,
        });
    });

    it('keeps strict Surabaya compatibility profile on demand when no area or camera override exists', () => {
        expect(resolveInternalIngestPolicy({
            private_rtsp_url: 'rtsp://surabaya-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            source_profile: 'surabaya_private_rtsp',
            enable_recording: 0,
        }, {
            internal_ingest_policy_default: 'default',
        })).toMatchObject({
            mode: 'on_demand',
            closeAfterSeconds: 15,
            isStrictOnDemandProfile: true,
            sourceProfile: 'surabaya_private_rtsp',
        });
    });

    it('normalizes close-after seconds to the supported 5..300 range', () => {
        expect(normalizeOnDemandCloseAfterSeconds('1', null)).toBe(5);
        expect(normalizeOnDemandCloseAfterSeconds('301', null)).toBe(300);
        expect(normalizeOnDemandCloseAfterSeconds('', 30)).toBe(null);
        expect(normalizeOnDemandCloseAfterSeconds('bad', 30)).toBe(30);
    });

    it('builds a complete operator summary', () => {
        expect(buildInternalIngestPolicySummary({
            private_rtsp_url: 'rtsp://remote-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: '',
        }, {
            internal_ingest_policy_default: 'on_demand',
            internal_on_demand_close_after_seconds: 20,
        })).toMatchObject({
            mode: 'on_demand',
            closeAfterSeconds: 20,
            cameraPolicyOverride: 'default',
            areaPolicyDefault: 'on_demand',
            cameraCloseAfterOverrideSeconds: null,
            areaCloseAfterDefaultSeconds: 20,
        });
    });
});
