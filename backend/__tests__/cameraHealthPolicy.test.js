/*
Purpose: Verifies external camera health mode resolution outside the full health service.
Caller: Vitest backend service test suite.
Deps: cameraHealthPolicy.
MainFuncs: resolveExternalHealthMode policy coverage.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    normalizeExternalHealthMode,
    resolveExternalHealthMode,
} from '../services/cameraHealthPolicy.js';

describe('cameraHealthPolicy', () => {
    it('normalizes known canonical modes and falls back to default for invalid values', () => {
        expect(normalizeExternalHealthMode('passive_first')).toBe('passive_first');
        expect(normalizeExternalHealthMode('hybrid_probe')).toBe('hybrid_probe');
        expect(normalizeExternalHealthMode('PASSIVE_FIRST')).toBe('default');
        expect(normalizeExternalHealthMode('unknown')).toBe('default');
    });

    it('prioritizes explicit camera mode before area and global defaults', () => {
        expect(resolveExternalHealthMode({
            delivery_type: 'external_hls',
            external_health_mode: 'disabled',
            area_external_health_mode_override: 'passive_first',
        }, {
            external_hls: 'hybrid_probe',
        })).toBe('disabled');
    });

    it('uses area override before delivery defaults when camera mode is default', () => {
        expect(resolveExternalHealthMode({
            delivery_type: 'external_hls',
            external_health_mode: 'default',
            area_external_health_mode_override: 'passive_first',
        }, {
            external_hls: 'hybrid_probe',
        })).toBe('passive_first');
    });

    it('resolves delivery-specific defaults with safe fallbacks', () => {
        expect(resolveExternalHealthMode({ delivery_type: 'external_mjpeg' }, {})).toBe('passive_first');
        expect(resolveExternalHealthMode({ delivery_type: 'external_hls' }, {})).toBe('hybrid_probe');
        expect(resolveExternalHealthMode({ delivery_type: 'external_flv' }, {})).toBe('passive_first');
        expect(resolveExternalHealthMode({ delivery_type: 'external_embed' }, {})).toBe('passive_first');
        expect(resolveExternalHealthMode({ delivery_type: 'external_jsmpeg' }, {})).toBe('disabled');
        expect(resolveExternalHealthMode({ delivery_type: 'external_custom_ws' }, {})).toBe('disabled');
    });

    it('allows configured delivery defaults to override safe fallbacks', () => {
        expect(resolveExternalHealthMode({ delivery_type: 'external_hls' }, {
            external_hls: 'passive_first',
        })).toBe('passive_first');
        expect(resolveExternalHealthMode({ delivery_type: 'external_custom_ws' }, {
            external_custom_ws: 'hybrid_probe',
        })).toBe('hybrid_probe');
    });
});
