/*
Purpose: Synchronize public landing layout/view mode state with URL params and localStorage.
Caller: LandingPage public mode controller.
Deps: React transition/effects/refs/state and router search param setter.
MainFuncs: useLandingModeState.
SideEffects: Updates search params and localStorage layout preference.
*/

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';

function getInitialLayoutMode(searchParams) {
    const queryMode = searchParams.get('mode');
    if (queryMode === 'simple' || queryMode === 'full') {
        return queryMode;
    }

    try {
        const savedMode = localStorage.getItem('landing_layout_mode');
        if (savedMode === 'simple' || savedMode === 'full') {
            return savedMode;
        }
    } catch (err) {
        console.warn('Failed to read localStorage:', err);
    }

    return 'full';
}

function getInitialViewMode(searchParams) {
    const queryView = searchParams.get('view');
    const queryMode = searchParams.get('mode');

    if (queryMode === 'playback' || queryMode === 'grid') {
        return queryMode;
    }

    return ['map', 'grid', 'playback'].includes(queryView) ? queryView : 'map';
}

export function useLandingModeState(searchParams, setSearchParams) {
    const isInitialMount = useRef(true);
    const [layoutMode, setLayoutMode] = useState(() => getInitialLayoutMode(searchParams));
    const viewMode = getInitialViewMode(searchParams);

    const handleViewModeChange = useCallback((newMode) => {
        if (newMode === viewMode) {
            return;
        }

        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('view', newMode);
            if (newMode !== 'playback') {
                next.delete('cam');
                next.delete('t');
            }
            if (!next.has('mode') || !['full', 'simple'].includes(next.get('mode'))) {
                next.set('mode', layoutMode);
            }
            return next;
        }, { replace: true });
    }, [layoutMode, setSearchParams, viewMode]);

    useEffect(() => {
        if (!isInitialMount.current) {
            return;
        }

        isInitialMount.current = false;
        const queryMode = searchParams.get('mode');
        const queryView = searchParams.get('view');
        const nextParams = new URLSearchParams(searchParams);
        let needsUpdate = false;

        if (!queryMode || !['full', 'simple'].includes(queryMode)) {
            nextParams.set('mode', layoutMode);
            needsUpdate = true;
        }

        if (queryMode === 'playback' || queryMode === 'grid') {
            nextParams.set('view', queryMode);
            needsUpdate = true;
        }

        if (!queryView && !['playback', 'grid'].includes(queryMode)) {
            nextParams.set('view', viewMode);
            needsUpdate = true;
        }

        if (needsUpdate) {
            setSearchParams(nextParams, { replace: true });
        }
    }, [layoutMode, searchParams, setSearchParams, viewMode]);

    useEffect(() => {
        if (isInitialMount.current) {
            return;
        }

        const queryMode = searchParams.get('mode');
        if ((queryMode === 'simple' || queryMode === 'full') && queryMode !== layoutMode) {
            setLayoutMode(queryMode);
            try {
                localStorage.setItem('landing_layout_mode', queryMode);
            } catch (err) {
                console.warn('Failed to save to localStorage:', err);
            }
        }
    }, [layoutMode, searchParams]);

    const toggleLayoutMode = useCallback(() => {
        const nextMode = layoutMode === 'full' ? 'simple' : 'full';

        startTransition(() => {
            setLayoutMode(nextMode);
        });

        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('mode', nextMode);
            return next;
        }, { replace: true });

        try {
            localStorage.setItem('landing_layout_mode', nextMode);
        } catch (err) {
            console.warn('Failed to save to localStorage:', err);
        }
    }, [layoutMode, setSearchParams]);

    return {
        layoutMode,
        setLayoutMode,
        viewMode,
        setViewMode: handleViewModeChange,
        toggleLayoutMode,
    };
}

export default useLandingModeState;
