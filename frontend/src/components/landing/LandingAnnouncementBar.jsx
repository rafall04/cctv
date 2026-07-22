import { useEffect, useMemo, useRef, useState } from 'react';

const STYLE_CLASSES = {
    info: {
        rail: 'border-l-primary',
        icon: 'text-primary',
        accent: 'bg-primary',
    },
    warning: {
        rail: 'border-l-status-warn',
        icon: 'text-status-warn',
        accent: 'bg-status-warn',
    },
    success: {
        rail: 'border-l-status-live',
        icon: 'text-status-live',
        accent: 'bg-status-live',
    },
};

function resolveStyle(style) {
    return STYLE_CLASSES[style] || STYLE_CLASSES.info;
}

function usePrefersReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

        updatePreference();

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', updatePreference);
            return () => mediaQuery.removeEventListener('change', updatePreference);
        }

        mediaQuery.addListener(updatePreference);
        return () => mediaQuery.removeListener(updatePreference);
    }, []);

    return prefersReducedMotion;
}

export default function LandingAnnouncementBar({ announcement, layoutMode = 'full' }) {
    const containerRef = useRef(null);
    const measureRef = useRef(null);
    const prefersReducedMotion = usePrefersReducedMotion();
    const [shouldTicker, setShouldTicker] = useState(false);
    const resolvedAnnouncement = useMemo(() => ({
        title: typeof announcement?.title === 'string' ? announcement.title : '',
        text: typeof announcement?.text === 'string' ? announcement.text : '',
        style: typeof announcement?.style === 'string' ? announcement.style : 'info',
        show_in_full: announcement?.show_in_full !== false,
        show_in_simple: announcement?.show_in_simple !== false,
        isActive: announcement?.isActive === true,
    }), [announcement]);

    const shouldRender = resolvedAnnouncement.isActive && resolvedAnnouncement.text.trim() && (
        (layoutMode === 'full' && resolvedAnnouncement.show_in_full) ||
        (layoutMode === 'simple' && resolvedAnnouncement.show_in_simple)
    );

    useEffect(() => {
        if (!shouldRender || prefersReducedMotion) {
            setShouldTicker(false);
            return undefined;
        }

        const evaluateTicker = () => {
            const containerWidth = containerRef.current?.clientWidth || 0;
            const textWidth = measureRef.current?.scrollWidth || 0;
            setShouldTicker(textWidth > containerWidth + 24);
        };

        evaluateTicker();

        if (typeof ResizeObserver === 'function' && containerRef.current) {
            const observer = new ResizeObserver(() => evaluateTicker());
            observer.observe(containerRef.current);
            return () => observer.disconnect();
        }

        window.addEventListener('resize', evaluateTicker);
        return () => window.removeEventListener('resize', evaluateTicker);
    }, [prefersReducedMotion, resolvedAnnouncement.text, shouldRender]);

    const theme = resolveStyle(resolvedAnnouncement.style);
    const isSimple = layoutMode === 'simple';
    const announcementTitle = resolvedAnnouncement.title || 'Pengumuman';
    const marqueeDuration = useMemo(() => {
        const textLength = resolvedAnnouncement.text.length || 0;
        const base = isSimple ? 18 : 16;
        return `${Math.max(base, Math.min(base + 12, Math.ceil(textLength / 5)))}s`;
    }, [resolvedAnnouncement.text, isSimple]);

    if (!shouldRender) {
        return null;
    }

    return (
        <section
            data-testid={`landing-announcement-${layoutMode}`}
            className="border-b border-edge bg-surface"
        >
            <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${isSimple ? 'py-2.5' : 'py-3'}`}>
                {/* Was a glassy tinted slab (bg-*-50/90 + backdrop-blur + shadow). The
                    style still carries meaning (info/warning/success), so the accent
                    survives as a left rule + coloured icon on the plain token surface. */}
                <div className={`flex items-start gap-3 rounded-card border border-edge border-l-2 bg-surface-raised px-4 ${isSimple ? 'py-2.5' : 'py-3'} ${theme.rail}`}>
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-surface-sunken ${theme.icon}`}>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 8a9 9 0 100 18 9 9 0 000-18z" />
                        </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${theme.accent}`}></span>
                            <span className="text-sm font-semibold text-content">
                                {announcementTitle}
                            </span>
                        </div>

                        <div className="relative mt-1">
                            <span
                                ref={measureRef}
                                aria-hidden="true"
                                className="pointer-events-none absolute -left-[9999px] top-0 whitespace-nowrap text-sm"
                            >
                                {resolvedAnnouncement.text}
                            </span>

                            <div
                                ref={containerRef}
                                className={`relative overflow-hidden ${isSimple ? 'h-10' : 'h-11'}`}
                                data-testid={`landing-announcement-content-${layoutMode}`}
                            >
                                {shouldTicker ? (
                                    <div
                                        className="announcement-marquee"
                                        data-testid={`landing-announcement-ticker-${layoutMode}`}
                                    >
                                        <div
                                            className="announcement-marquee-track"
                                            style={{ '--announcement-marquee-duration': marqueeDuration }}
                                        >
                                            <span className="announcement-marquee-item">{resolvedAnnouncement.text}</span>
                                            <span aria-hidden="true" className="announcement-marquee-item">
                                                {resolvedAnnouncement.text}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <p
                                        className="announcement-static-copy text-sm leading-5 text-content-muted"
                                        data-testid={`landing-announcement-static-${layoutMode}`}
                                    >
                                        {resolvedAnnouncement.text}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
