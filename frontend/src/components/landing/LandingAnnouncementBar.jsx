const STYLE_CLASSES = {
    info: {
        wrapper: 'border-sky-200/70 bg-sky-50/90 text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200',
        icon: 'text-sky-500 dark:text-sky-300',
        accent: 'bg-sky-500',
    },
    warning: {
        wrapper: 'border-amber-200/80 bg-amber-50/90 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200',
        icon: 'text-amber-500 dark:text-amber-300',
        accent: 'bg-amber-500',
    },
    success: {
        wrapper: 'border-emerald-200/80 bg-emerald-50/90 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200',
        icon: 'text-emerald-500 dark:text-emerald-300',
        accent: 'bg-emerald-500',
    },
};

function resolveStyle(style) {
    return STYLE_CLASSES[style] || STYLE_CLASSES.info;
}

export default function LandingAnnouncementBar({ announcement, layoutMode = 'full' }) {
    const shouldRender = announcement?.isActive && (
        (layoutMode === 'full' && announcement?.show_in_full) ||
        (layoutMode === 'simple' && announcement?.show_in_simple)
    );

    if (!shouldRender) {
        return null;
    }

    const theme = resolveStyle(announcement.style);
    const isSimple = layoutMode === 'simple';

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
                            {announcement.title && (
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {announcement.title}
                                </span>
                            )}
                            {!announcement.title && (
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                    Pengumuman
                                </span>
                            )}
                        </div>
                        <p className={`mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-200 ${isSimple ? 'sm:text-[13px]' : ''}`}>
                            {announcement.text}
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}
