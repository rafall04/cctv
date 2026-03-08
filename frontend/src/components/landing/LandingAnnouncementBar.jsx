import { useEffect, useMemo, useRef, useState } from 'react';

const STYLE_CLASSES = {
    info: {
        wrapper: 'border-sky-200/70 bg-sky-50/90 text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200',
        icon: 'text-sky-500 dark:text-sky-300',
        accent: 'bg-sky-500',
        fade: 'from-sky-50/95 via-sky-50/70 to-transparent dark:from-gray-950/95 dark:via-gray-950/70',
    },
    warning: {
        wrapper: 'border-amber-200/80 bg-amber-50/90 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200',
        icon: 'text-amber-500 dark:text-amber-300',
        accent: 'bg-amber-500',
        fade: 'from-amber-50/95 via-amber-50/70 to-transparent dark:from-gray-950/95 dark:via-gray-950/70',
    },
    success: {
        wrapper: 'border-emerald-200/80 bg-emerald-50/90 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200',
        icon: 'text-emerald-500 dark:text-emerald-300',
        accent: 'bg-emerald-500',
        fade: 'from-emerald-50/95 via-emerald-50/70 to-transparent dark:from-gray-950/95 dark:via-gray-950/70',
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

    const shouldRender = announcement?.isActive && (
        (layoutMode === 'full' && announcement?.show_in_full) ||
        (layoutMode === 'simple' && announcement?.show_in_simple)
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
    }, [announcement?.text, prefersReducedMotion, shouldRender]);

    const theme = resolveStyle(announcement?.style);
    const isSimple = layoutMode === 'simple';
    const announcementTitle = announcement?.title || 'Pengumuman';
    const marqueeDuration = useMemo(() => {
        const textLength = announcement?.text?.length || 0;
        const base = isSimple ? 18 : 16;
        return `${Math.max(base, Math.min(base + 12, Math.ceil(textLength / 5)))}s`;
    }, [announcement?.text, isSimple]);

    if (!shouldRender) {
        return null;
    }

    return (
        <section
            data-testid={`landing-announcement-${layoutMode}`}
            className="border-b border-gray-200/60 bg-white/80 dark:border-gray-800/60 dark:bg-gray-950/80"
        >
            <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${isSimple ? 'py-2.5' : 'py-3'}`}>
                <div className={`flex items-start gap-3 rounded-2xl border px-4 ${isSimple ? 'py-2.5' : 'py-3'} shadow-sm backdrop-blur-sm ${theme.wrapper}`}>
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 dark:bg-gray-900/40 ${theme.icon}`}>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 8a9 9 0 100 18 9 9 0 000-18z" />
                        </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${theme.accent}`}></span>
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {announcementTitle}
                            </span>
                        </div>

                        <div className="relative mt-1">
                            <span
                                ref={measureRef}
                                aria-hidden="true"
                                className="pointer-events-none absolute -left-[9999px] top-0 whitespace-nowrap text-sm"
                            >
                                {announcement.text}
                            </span>

                            <div
                                ref={containerRef}
                                className={`relative overflow-hidden ${isSimple ? 'h-10' : 'h-11'}`}
                                data-testid={`landing-announcement-content-${layoutMode}`}
                            >
                                {shouldTicker ? (
                                    <>
                                        <div className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r ${theme.fade}`}></div>
                                        <div className={`pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l ${theme.fade}`}></div>
                                        <div
                                            className="announcement-marquee group-hover:[animation-play-state:paused]"
                                            data-testid={`landing-announcement-ticker-${layoutMode}`}
                                        >
                                            <div
                                                className="announcement-marquee-track"
                                                style={{ '--announcement-marquee-duration': marqueeDuration }}
                                            >
                                                <span className="announcement-marquee-item">{announcement.text}</span>
                                                <span aria-hidden="true" className="announcement-marquee-item">
                                                    {announcement.text}
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <p
                                        className="announcement-static-copy text-sm leading-5 text-gray-700 dark:text-gray-200"
                                        data-testid={`landing-announcement-static-${layoutMode}`}
                                    >
                                        {announcement.text}
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
