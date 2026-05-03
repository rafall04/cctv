/**
 * Purpose: Provides playback access-scope helpers and default public/admin playback policies.
 * Caller: Playback page and playback segment hook.
 * Deps: None.
 * MainFuncs: isAdminPlaybackScope, getDefaultPlaybackPolicy.
 * SideEffects: None; pure helpers only.
 */
export const PLAYBACK_ACCESS_SCOPES = {
    PUBLIC_PREVIEW: 'public_preview',
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

export function isAdminPlaybackScope(accessScope) {
    return accessScope === PLAYBACK_ACCESS_SCOPES.ADMIN_FULL;
}

export function getDefaultPlaybackPolicy(accessScope) {
    return isAdminPlaybackScope(accessScope)
        ? DEFAULT_ADMIN_PLAYBACK_POLICY
        : DEFAULT_PUBLIC_PLAYBACK_POLICY;
}
