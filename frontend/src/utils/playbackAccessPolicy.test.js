/**
 * Purpose: Verifies playback access-scope helpers and default policy selection.
 * Caller: Frontend Vitest suite.
 * Deps: playbackAccessPolicy utilities.
 * MainFuncs: playback access policy utility tests.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_ADMIN_PLAYBACK_POLICY,
    DEFAULT_PUBLIC_PLAYBACK_POLICY,
    getDefaultPlaybackPolicy,
    isAdminPlaybackScope,
    PLAYBACK_ACCESS_SCOPES,
} from './playbackAccessPolicy';

describe('playbackAccessPolicy', () => {
    it('identifies admin playback scope exactly', () => {
        expect(isAdminPlaybackScope(PLAYBACK_ACCESS_SCOPES.ADMIN_FULL)).toBe(true);
        expect(isAdminPlaybackScope(PLAYBACK_ACCESS_SCOPES.PUBLIC_PREVIEW)).toBe(false);
        expect(isAdminPlaybackScope(undefined)).toBe(false);
    });

    it('returns safe default policies for public and admin playback', () => {
        expect(getDefaultPlaybackPolicy(PLAYBACK_ACCESS_SCOPES.PUBLIC_PREVIEW)).toBe(DEFAULT_PUBLIC_PLAYBACK_POLICY);
        expect(getDefaultPlaybackPolicy(undefined)).toBe(DEFAULT_PUBLIC_PLAYBACK_POLICY);
        expect(getDefaultPlaybackPolicy(PLAYBACK_ACCESS_SCOPES.ADMIN_FULL)).toBe(DEFAULT_ADMIN_PLAYBACK_POLICY);
        expect(getDefaultPlaybackPolicy(PLAYBACK_ACCESS_SCOPES.ADMIN_FULL)).toEqual(expect.objectContaining({
            isPublicPreview: false,
            previewMinutes: null,
        }));
    });
});
