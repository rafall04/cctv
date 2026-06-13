/*
 * Purpose: Defer mounting of below-the-fold public landing sections until they scroll near the viewport,
 *          cutting initial mount/paint work on constrained (lite) devices without losing the content.
 * Caller: LandingPageSimple (wraps secondary camera strips when the lite experience is active).
 * Deps: React state/ref/effect hooks and the browser IntersectionObserver (with a safe fallback).
 * MainFuncs: DeferUntilVisible.
 * SideEffects: Creates and disconnects an IntersectionObserver while deferred.
 */

import { useEffect, useRef, useState } from 'react';

export default function DeferUntilVisible({
    children,
    rootMargin = '300px',
    placeholderClassName = '',
    minHeight = 96,
}) {
    // If IntersectionObserver is unavailable (old browsers / jsdom), render immediately so content is
    // never withheld. This keeps behaviour correct everywhere; deferral is a best-effort optimization.
    const [visible, setVisible] = useState(() => (
        typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function'
    ));
    const placeholderRef = useRef(null);

    useEffect(() => {
        if (visible) {
            return undefined;
        }

        const node = placeholderRef.current;
        if (!node || typeof window.IntersectionObserver !== 'function') {
            setVisible(true);
            return undefined;
        }

        const observer = new window.IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setVisible(true);
                observer.disconnect();
            }
        }, { rootMargin });

        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, [visible, rootMargin]);

    if (visible) {
        return children;
    }

    // Reserve vertical space so revealing the real content does not shift the layout.
    return (
        <div
            ref={placeholderRef}
            className={placeholderClassName}
            style={{ minHeight }}
            aria-hidden="true"
            data-testid="defer-until-visible-placeholder"
        />
    );
}
