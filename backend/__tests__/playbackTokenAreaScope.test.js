/*
 * Purpose: Lock the access decision for area-scoped playback tokens.
 * Caller: vitest.
 *
 * WHY THIS FILE EXISTS
 * resolveCameraAccess ends in a fall-through that returns allowed:true for EVERY camera. Before area
 * scope existed, only 'selected' was decided above it, so anything unrecognised landed there and was
 * granted the whole fleet. A new scope added without its own branch is therefore not a broken
 * feature — it is a silent grant of every camera to every holder. These tests exist so that
 * regression cannot pass review.
 */

import { describe, it, expect } from 'vitest';
import playbackTokenRuleService from '../services/playbackTokenRuleService.js';

const AREA_BOJONEGORO = 3;
const AREA_MAGETAN = 4;

/** rules: [] keeps the evaluation pure — no per-camera rule rows, no DB. */
function decide(token, camera) {
    return playbackTokenRuleService.resolveCameraAccess({ token, camera, rules: [] });
}

const areaToken = {
    id: 1,
    scope_type: 'area',
    area_ids_json: JSON.stringify([AREA_BOJONEGORO]),
    playback_window_hours: 24,
};

describe('area-scoped playback token', () => {
    it('allows a camera inside the token area', () => {
        const result = decide(areaToken, { id: 15, area_id: AREA_BOJONEGORO });
        expect(result.allowed).toBe(true);
        expect(result.ruleSource).toBe('token_area_scope');
        expect(result.playbackWindowHours).toBe(24);
    });

    it('DENIES a camera in another area — the whole point of the scope', () => {
        const result = decide(areaToken, { id: 40, area_id: AREA_MAGETAN });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('token_area_excludes_camera');
    });

    it('covers a camera added to the area later, because membership is read at decision time', () => {
        // No token change, no re-issue: a brand-new camera id that simply sits in the area.
        const result = decide(areaToken, { id: 9999, area_id: AREA_BOJONEGORO });
        expect(result.allowed).toBe(true);
    });

    it('fails CLOSED when the camera has no area', () => {
        for (const camera of [
            { id: 1 },
            { id: 2, area_id: null },
            { id: 3, area_id: 'not-a-number' },
            { id: 4, area_id: 0 },
        ]) {
            expect(decide(areaToken, camera).allowed).toBe(false);
        }
    });

    it('fails CLOSED when the token carries no areas', () => {
        for (const areaIds of [null, '', '[]', 'not json', JSON.stringify([])]) {
            const token = { ...areaToken, area_ids_json: areaIds };
            expect(decide(token, { id: 15, area_id: AREA_BOJONEGORO }).allowed).toBe(false);
        }
    });

    it('never reaches admin-only cameras even inside the area', () => {
        const result = decide(areaToken, {
            id: 15,
            area_id: AREA_BOJONEGORO,
            public_playback_mode: 'admin_only',
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('token_area_excludes_admin_only');
    });

    it('does not widen the existing scopes', () => {
        // 'all' still grants a camera in any area...
        expect(decide({ scope_type: 'all' }, { id: 15, area_id: AREA_MAGETAN }).allowed).toBe(true);
        // ...and 'selected' still ignores areas entirely.
        const selected = { scope_type: 'selected', camera_ids_json: JSON.stringify([15]) };
        expect(decide(selected, { id: 15, area_id: AREA_MAGETAN }).allowed).toBe(true);
        expect(decide(selected, { id: 16, area_id: AREA_BOJONEGORO }).allowed).toBe(false);
    });

    it('reports its scope honestly rather than collapsing to "all"', () => {
        expect(playbackTokenRuleService.buildCameraRulesSummary(areaToken).scope_type).toBe('area');
    });
});
