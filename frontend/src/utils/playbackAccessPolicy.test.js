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
    resolveViewerTrackingScope,
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

/*
 * Token holders browse the PUBLIC playback page, so the page's own scope prop says
 * `public_preview` for them too. Trusting that prop is what filed every token view as anonymous —
 * production ended up with 134 "public" sessions and zero token ones, while the token audit log
 * plainly showed token holders watching.
 */
describe('resolveViewerTrackingScope', () => {
    it('reports the server-resolved mode over the page prop', () => {
        expect(resolveViewerTrackingScope({ accessMode: 'token_full', tokenId: 7 }, 'public_preview'))
            .toEqual({ accessScope: 'token_full', tokenId: 7 });
    });

    it('falls back to the page prop until the policy has arrived', () => {
        // First paint has no policy yet; reporting nothing would lose the session entirely.
        expect(resolveViewerTrackingScope(null, 'public_preview'))
            .toEqual({ accessScope: 'public_preview', tokenId: null });
        expect(resolveViewerTrackingScope(undefined, 'admin_full'))
            .toEqual({ accessScope: 'admin_full', tokenId: null });
    });

    it('carries no token for a genuinely anonymous preview', () => {
        expect(resolveViewerTrackingScope({ accessMode: 'public_preview' }, 'public_preview'))
            .toEqual({ accessScope: 'public_preview', tokenId: null });
    });

    it('keeps admin views attributed to admin, not to a token', () => {
        expect(resolveViewerTrackingScope({ accessMode: 'admin_full', tokenId: null }, 'public_preview'))
            .toEqual({ accessScope: 'admin_full', tokenId: null });
    });

    it('exposes token_full as a real scope, which was the missing one', () => {
        expect(PLAYBACK_ACCESS_SCOPES.TOKEN_FULL).toBe('token_full');
    });
});
