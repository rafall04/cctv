const THEME_STYLES = {
    ramadan: {
        wrapper: 'border-emerald-200/70 bg-gradient-to-r from-emerald-50 via-white to-amber-50 dark:border-emerald-500/20 dark:from-emerald-950/30 dark:via-gray-900 dark:to-amber-950/20',
        badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
        icon: 'text-amber-500 dark:text-amber-300',
    },
    eid: {
        wrapper: 'border-sky-200/70 bg-gradient-to-r from-sky-50 via-white to-emerald-50 dark:border-sky-500/20 dark:from-sky-950/30 dark:via-gray-900 dark:to-emerald-950/20',
        badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
        icon: 'text-sky-500 dark:text-sky-300',
    },
    national: {
        wrapper: 'border-rose-200/70 bg-gradient-to-r from-rose-50 via-white to-orange-50 dark:border-rose-500/20 dark:from-rose-950/30 dark:via-gray-900 dark:to-orange-950/20',
        badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
        icon: 'text-rose-500 dark:text-rose-300',
    },
    neutral: {
        wrapper: 'border-gray-200/70 bg-gradient-to-r from-white via-gray-50 to-sky-50 dark:border-gray-700/60 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800',
        badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
        icon: 'text-primary dark:text-primary-400',
    },
};

function resolveTheme(theme) {
    return THEME_STYLES[theme] || THEME_STYLES.neutral;
}

export default function LandingEventBanner({ banner, layoutMode = 'full' }) {
    const resolvedBanner = {
        title: typeof banner?.title === 'string' ? banner.title : '',
        text: typeof banner?.text === 'string' ? banner.text : '',
        theme: typeof banner?.theme === 'string' ? banner.theme : 'neutral',
        show_in_full: banner?.show_in_full !== false,
        show_in_simple: banner?.show_in_simple !== false,
        isActive: banner?.isActive === true,
    };

    const shouldRender = resolvedBanner.isActive && resolvedBanner.text.trim() && (
        (layoutMode === 'full' && resolvedBanner.show_in_full) ||
        (layoutMode === 'simple' && resolvedBanner.show_in_simple)
    );

    if (!shouldRender) {
        return null;
    }

    const isSimple = layoutMode === 'simple';
    const theme = resolveTheme(resolvedBanner.theme);

    return (
        <section
            data-testid={`landing-event-banner-${layoutMode}`}
            className={isSimple ? 'border-b border-gray-200/50 dark:border-gray-800/50' : ''}
        >
            <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${isSimple ? 'py-3' : 'pb-2'}`}>
                <div className={`overflow-hidden rounded-3xl border shadow-sm ${theme.wrapper}`}>
                    <div className={`flex gap-4 ${isSimple ? 'items-start px-4 py-3' : 'items-center px-5 py-4 sm:px-6 sm:py-5'}`}>
                        <div className={`flex shrink-0 items-center justify-center rounded-2xl bg-white/70 dark:bg-gray-900/40 ${isSimple ? 'h-10 w-10' : 'h-12 w-12'} ${theme.icon}`}>
                            <svg className={isSimple ? 'h-5 w-5' : 'h-6 w-6'} viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2a9.77 9.77 0 00-5.71 1.84A10 10 0 1012 2zm0 18a7.96 7.96 0 01-4.62-1.47 8 8 0 018.07-13.73A8 8 0 0112 20z" />
                            </svg>
                        </div>

                        <div className="min-w-0 flex-1">
                            {resolvedBanner.title && (
                                <div className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${theme.badge}`}>
                                    {resolvedBanner.title}
                                </div>
                            )}
                            <p className={`event-banner-copy ${resolvedBanner.title ? 'mt-2' : ''} text-sm font-medium leading-relaxed text-gray-900 dark:text-white ${isSimple ? '' : 'sm:text-base'}`}>
                                {resolvedBanner.text}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
