import { useState, useEffect } from 'react';

export default function SaweriaLeaderboard({ leaderboardLink }) {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    // Don't render if no leaderboard link
    if (!leaderboardLink) {
        return null;
    }

    const handleLoad = () => {
        setIsLoading(false);
        setHasError(false);
    };

    const handleError = () => {
        setIsLoading(false);
        setHasError(true);
    };

    return (
        <section className="py-8 sm:py-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-orange-100 to-amber-100 dark:from-orange-500/20 dark:to-amber-500/20 text-orange-600 dark:text-orange-400 text-xs font-semibold mb-3 shadow-sm">
                        <span className="text-lg">🏆</span>
                        <span>Top Supporters</span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Leaderboard Donasi
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto text-sm sm:text-base">
                        Terima kasih kepada para supporter yang telah mendukung RAF NET CCTV
                    </p>
                </div>

                {/* Leaderboard Container */}
                <div className="relative bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden shadow-lg">
                    {/* Loading State */}
                    {isLoading && !hasError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-800/50 z-10">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-3"></div>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Memuat leaderboard...</p>
                            </div>
                        </div>
                    )}

                    {/* Error State */}
                    {hasError && (
                        <div className="p-8 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400 mb-4">Leaderboard tidak dapat dimuat</p>
                            <button
                                onClick={() => {
                                    setHasError(false);
                                    setIsLoading(true);
                                }}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors text-sm font-medium"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Coba Lagi
                            </button>
                        </div>
                    )}

                    {/* Iframe */}
                    {!hasError && (
                        <iframe
                            src={leaderboardLink}
                            onLoad={handleLoad}
                            onError={handleError}
                            className="w-full h-[500px] sm:h-[600px] border-0"
                            title="Saweria Leaderboard"
                            loading="lazy"
                            sandbox="allow-scripts allow-same-origin"
                        />
                    )}
                </div>

                {/* Footer Note */}
                <div className="mt-4 text-center">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Powered by <a href="https://saweria.co" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600 font-medium">Saweria</a>
                    </p>
                </div>
            </div>
        </section>
    );
}
