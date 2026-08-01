/**
 * Purpose: Provides playback access-scope helpers and default public/admin playback policies.
 * Caller: Playback page and playback segment hook.
 * Deps: None.
 * MainFuncs: isAdminPlaybackScope, getDefaultPlaybackPolicy.
 * SideEffects: None; pure helpers only.
 */
/**
 * The three ways footage is actually reached. TOKEN_FULL was missing, and its absence was not
 * harmless: a token holder watching was reported as PUBLIC_PREVIEW, so Playback Analytics counted
 * paying viewers as anonymous ones. On production that made "Preview Publik: 134" wrong and
 * "token_full: 0" a fiction, while the token audit log plainly showed token holders watching.
 */
export const PLAYBACK_ACCESS_SCOPES = {
    PUBLIC_PREVIEW: 'public_preview',
    TOKEN_FULL: 'token_full',
    ADMIN_FULL: 'admin_full',
};

export const DEFAULT_PUBLIC_PLAYBACK_POLICY = {
    accessMode: PLAYBACK_ACCESS_SCOPES.PUBLIC_PREVIEW,
    isPublicPreview: true,
    previewMinutes: 10,
    notice: {
        enabled: true,
        title: 'Akses Playback Publik Terbatas',
        text: 'Playback publik dibatasi untuk menjaga privasi. Untuk akses lebih lanjut silakan hubungi admin.',
    },
    contact: null,
};

export const DEFAULT_ADMIN_PLAYBACK_POLICY = {
    accessMode: PLAYBACK_ACCESS_SCOPES.ADMIN_FULL,
    isPublicPreview: false,
    previewMinutes: null,
    notice: null,
    contact: null,
};

/**
 * What the viewer-session tracker should report for this view.
 *
 * The page's `accessScope` prop is static — a token holder arrives on the PUBLIC playback page, so
 * the prop says `public_preview` for them too. `playback_policy` is the server's own resolution of
 * the same question and is therefore the honest answer. Preferring the prop is what filed every
 * token view as anonymous, leaving production with 134 "public" sessions and zero token ones.
 *
 * @param {{accessMode?: string, tokenId?: number|null}|null} playbackPolicy resolved by the backend
 * @param {string} fallbackScope the page's static scope, used before the policy arrives
 */
export function resolveViewerTrackingScope(playbackPolicy, fallbackScope) {
    return {
        accessScope: playbackPolicy?.accessMode || fallbackScope,
        tokenId: playbackPolicy?.tokenId || null,
    };
}

export function isAdminPlaybackScope(accessScope) {
    return accessScope === PLAYBACK_ACCESS_SCOPES.ADMIN_FULL;
}

export function getDefaultPlaybackPolicy(accessScope) {
    return isAdminPlaybackScope(accessScope)
        ? DEFAULT_ADMIN_PLAYBACK_POLICY
        : DEFAULT_PUBLIC_PLAYBACK_POLICY;
}
