import { Icons } from '../ui/Icons';
import { shouldDisableAnimations } from '../../utils/animationControl';

export default function Hero({ branding, landingSettings, onCameraClick, disableHeavyEffects }) {
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

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold mb-3 shadow-sm">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z"/>
                    </svg>
                    <span>Ramadan Kareem 1446 H</span>
                </div>

                {branding.show_powered_by === 'true' && (
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-100 dark:bg-primary/20 text-primary-600 dark:text-primary-400 text-xs font-semibold mb-3 shadow-sm">
                        <div className="w-5 h-5 rounded bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white text-[10px] font-bold">{branding.logo_text}</div>
                        <span>Powered by {branding.company_name}</span>
                    </div>
                )}

                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold mb-4 shadow-sm">
                    <span className="relative flex h-2 w-2">
                        {!disableHeavyEffects && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    {landingSettings.hero_badge}
                </div>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-4">
                    {branding.hero_title}
                </h1>
                <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-3 text-sm sm:text-base">
                    {branding.hero_subtitle}
                </p>
                <p className="text-gray-500 dark:text-gray-500 max-w-xl mx-auto mb-6 text-xs">
                    {branding.footer_text}
                </p>

                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 mb-6">
                    <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                        <circle cx="12" cy="11" r="3" />
                    </svg>
                    <span
                        className="text-sm text-amber-700 dark:text-amber-400"
                        dangerouslySetInnerHTML={{ __html: landingSettings.area_coverage }}
                    />
                </div>

                <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                        <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-primary/20 flex items-center justify-center text-primary-600 dark:text-primary-400">
                            <Icons.Eye />
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">HD Streaming</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                        <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                            <Icons.Grid />
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Multi-View</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                            <Icons.Shield />
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Aman</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                            <Icons.Clock />
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">24/7 Live</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Playback</span>
                    </div>
                </div>
            </div>
        </header>
    );
}
