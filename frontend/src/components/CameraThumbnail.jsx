/*
Purpose: Render a camera thumbnail or fallback camera status icon with optional first-viewport priority loading.
Caller: Public/admin camera cards and grids.
Deps: React state and buildApiAssetUrl.
MainFuncs: CameraThumbnail.
SideEffects: Tracks thumbnail load failure in local component state.
*/

import { useEffect, useRef, useState } from 'react';
import { buildApiAssetUrl } from '../config/config.js';

// Module level on purpose: defined inside CameraThumbnail this was a new component
// type per render, so every offline/maintenance card in the public grid threw away
// and rebuilt its SVG on each background refresh.
function FallbackIcon({ isMaintenance, isOffline }) {
    return (
        <div className={`absolute inset-0 flex items-center justify-center ${
            isMaintenance
                ? 'text-red-300 dark:text-red-700'
                : isOffline
                    ? 'text-gray-400 dark:text-gray-600'
                    : 'text-gray-300 dark:text-gray-700'
        }`}>
            <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                {isMaintenance ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
                ) : isOffline ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"/>
                ) : (
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                )}
            </svg>
        </div>
    );
}

// Thumbnail files keep a STABLE name (/api/thumbnails/16.jpg) and are overwritten in
// place on every capture, so nothing in the URL tells a cache that the picture changed.
// The origin already says `Cache-Control: public, max-age=0`, but Cloudflare rewrites
// that to `max-age=14400` (its default 4h browser TTL, applied because .jpg is a
// default-cacheable extension) — so a fresh capture stayed invisible for up to 4 hours
// and no amount of reloading helped. Versioning the URL with thumbnail_updated_at makes
// a new capture a genuinely new URL, which every cache layer honours.
// External snapshot URLs are left untouched: they are third-party and may be signed.
function withThumbnailVersion(path, version) {
    if (!path || !version || !path.startsWith('/api/thumbnails/')) {
        return path;
    }

    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}v=${encodeURIComponent(version)}`;
}

export default function CameraThumbnail({
    thumbnailPath,
    thumbnailVersion = null,
    cameraName,
    isMaintenance = false,
    isOffline = false,
    priority = false,
}) {
    const [error, setError] = useState(false);
    const imageRef = useRef(null);

    // Version is part of the deps on purpose: a camera whose thumbnail 404'd once must
    // retry when a newer capture lands, otherwise the fallback icon sticks for the
    // whole session.
    useEffect(() => {
        setError(false);
    }, [thumbnailPath, thumbnailVersion]);

    useEffect(() => {
        if (!imageRef.current) {
            return;
        }

        imageRef.current.setAttribute('fetchpriority', priority ? 'high' : 'auto');
    }, [priority]);

    if (isMaintenance || isOffline || !thumbnailPath || error) {
        return <FallbackIcon isMaintenance={isMaintenance} isOffline={isOffline} />;
    }
    
    const thumbnailUrl = buildApiAssetUrl(withThumbnailVersion(thumbnailPath, thumbnailVersion));
    
    return (
        <img
            ref={imageRef}
            src={thumbnailUrl}
            alt={`${cameraName} preview`}
            className="absolute inset-0 w-full h-full object-cover"
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => setError(true)}
        />
    );
}
