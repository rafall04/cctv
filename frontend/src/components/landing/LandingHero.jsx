/**
 * Purpose: Renders the public landing hero with centered brand, status copy, and stats.
 * Caller: LandingPage full mode.
 * Deps: LandingStatsBar and public branding/settings payloads.
 * MainFuncs: LandingHero component and default copy simplification helpers.
 * SideEffects: Renders sanitized HTML from configured area coverage.
 */
import LandingStatsBar from './LandingStatsBar';

export default function Hero({ branding, landingSettings, disableHeavyEffects, onCameraClick }) {
    const heroTitle = branding.hero_title === 'Pantau CCTV Secara Real-Time'
        ? 'Pantau CCTV Real-Time'
        : branding.hero_title;
    const heroSubtitle = branding.hero_subtitle === 'Pantau CCTV secara real-time dengan sistem CCTV RAF NET. Akses gratis 24 jam untuk memantau berbagai lokasi.'
        ? 'Akses CCTV publik 24 jam dari satu halaman.'
        : branding.hero_subtitle;
    const footerText = branding.footer_text === 'Layanan pemantauan CCTV publik oleh RAF NET'
        ? 'Pemantauan publik oleh RAF NET'
        : branding.footer_text;

    return (
        <header className="relative overflow-hidden bg-gradient-to-br from-amber-50/80 via-transparent to-emerald-50/80 dark:from-amber-950/30 dark:via-transparent dark:to-emerald-950/30">
            {!disableHeavyEffects && (
                <>
                    <div className="absolute top-0 left-1/4 w-64 h-64 bg-amber-200/30 dark:bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
                    <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-emerald-200/30 dark:bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
                    <div className="absolute top-10 right-10 w-20 h-20 opacity-20 dark:opacity-10 pointer-events-none">
                        <svg viewBox="0 0 100 100" fill="currentColor" className="text-amber-400 w-full h-full">
                            <path d="M50 5C30.5 5 15 20.5 15 40c0 19.5 15.5 35 35 35 5 0 9-4 9-9 0-3.5-2-6.5-5-8-4-2.5-6.5-7-6.5-12 0-8 6.5-14.5 14.5-14.5H70c13.5 0 24.5-11 24.5-24.5C94.5 18 78.5 5 50 5z"/>
                        </svg>
                    </div>
                    <div className="absolute top-20 left-10 w-12 h-12 opacity-15 dark:opacity-8 pointer-events-none">
                        <svg viewBox="0 0 100 100" fill="currentColor" className="text-amber-400 w-full h-full">
                            <path d="M50 5C30.5 5 15 20.5 15 40c0 19.5 15.5 35 35 35 5 0 9-4 9-9 0-3.5-2-6.5-5-8-4-2.5-6.5-7-6.5-12 0-8 6.5-14.5 14.5-14.5H70c13.5 0 24.5-11 24.5-24.5C94.5 18 78.5 5 50 5z"/>
                        </svg>
                    </div>
                </>
            )}

            <div className="relative mx-auto flex min-h-[28rem] max-w-7xl flex-col items-center justify-center px-4 py-10 text-center sm:min-h-[31rem] sm:px-6 sm:py-14 lg:px-8">
                <div
                    data-testid="landing-hero-badge-stack"
                    className="mx-auto mb-5 flex max-w-sm flex-col items-center gap-2.5 sm:gap-3"
                >
                    {branding.show_powered_by === 'true' && (
                        <div className="flex items-center gap-2 rounded-full bg-sky-100 px-4 py-1.5 text-xs font-semibold text-primary-600 shadow-sm dark:bg-primary/20 dark:text-primary-400">
                            <div className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-primary to-primary-600 text-[10px] font-bold text-white">{branding.logo_text}</div>
                            <span>Powered by {branding.company_name}</span>
                        </div>
                    )}

                    <div className="mt-1 flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-600 shadow-sm dark:bg-emerald-500/20 dark:text-emerald-400">
                        <span className="relative flex h-2 w-2">
                            {!disableHeavyEffects && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        {landingSettings.hero_badge}
                    </div>
                </div>
                <h1 className="mb-4 max-w-4xl text-balance text-3xl font-bold leading-tight text-gray-900 dark:text-white sm:text-4xl lg:text-5xl">
                    {heroTitle}
                </h1>
                <p className="mx-auto mb-3 max-w-xl text-sm leading-6 text-gray-600 dark:text-gray-400 sm:text-base">
                    {heroSubtitle}
                </p>
                <p className="mx-auto mb-6 max-w-lg text-xs text-gray-500 dark:text-gray-500 sm:text-sm">
                    {footerText}
                </p>

                <div className="mb-8 inline-flex max-w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-center dark:border-amber-500/20 dark:bg-amber-500/10">
                    <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                        <circle cx="12" cy="11" r="3" />
                    </svg>
                    <span
                        className="text-sm text-amber-700 dark:text-amber-400"
                        dangerouslySetInnerHTML={{ __html: landingSettings.area_coverage }}
                    />
                </div>

                <LandingStatsBar onCameraClick={onCameraClick} />
            </div>
        </header>
    );
}
