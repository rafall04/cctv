/**
 * Retention Metrics Component
 * Menampilkan metrik new vs returning visitors dan bounce rate
 */
export function RetentionMetrics({ data }) {
    if (!data) return null;

    const { newVisitors, returningVisitors, bounceRate, retentionRate } = data;
    const totalVisitors = newVisitors + returningVisitors;

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-500/20 rounded-xl flex items-center justify-center text-purple-500">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                </div>
                <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Retensi Pengunjung</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Analisis loyalitas pengunjung</p>
                </div>
            </div>

            {/* New vs Returning Visitors */}
            <div className="space-y-4 mb-6">
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Pengunjung Baru</span>
                        </div>
                        <span className="text-sm font-bold text-gray-900 dark:text-white">
                            {newVisitors} ({totalVisitors > 0 ? Math.round((newVisitors / totalVisitors) * 100) : 0}%)
                        </span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-blue-500 rounded-full transition-all duration-500"
                            style={{ width: `${totalVisitors > 0 ? (newVisitors / totalVisitors) * 100 : 0}%` }}
                        />
                    </div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Pengunjung Kembali</span>
                        </div>
                        <span className="text-sm font-bold text-gray-900 dark:text-white">
                            {returningVisitors} ({totalVisitors > 0 ? Math.round((returningVisitors / totalVisitors) * 100) : 0}%)
                        </span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                            style={{ width: `${totalVisitors > 0 ? (returningVisitors / totalVisitors) * 100 : 0}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-4">
                {/* Bounce Rate */}
                <div className="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-500/10 dark:to-orange-500/10 rounded-xl p-4 border border-red-100 dark:border-red-500/20">
                    <div className="flex items-center gap-2 mb-2">
                        <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                        </svg>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Bounce Rate</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{bounceRate}%</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Keluar &lt;10 detik</p>
                </div>

                {/* Retention Rate */}
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-500/10 dark:to-green-500/10 rounded-xl p-4 border border-emerald-100 dark:border-emerald-500/20">
                    <div className="flex items-center gap-2 mb-2">
                        <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Retention Rate</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{retentionRate}%</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Kembali lagi</p>
                </div>
            </div>

            {/* Insight */}
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/20">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-semibold text-blue-600 dark:text-blue-400">💡 Insight:</span>
                    {' '}
                    {bounceRate > 50 
                        ? 'Bounce rate tinggi. Pertimbangkan untuk meningkatkan kualitas stream atau loading time.'
                        : bounceRate > 30
                        ? 'Bounce rate normal. Terus monitor untuk memastikan kualitas tetap baik.'
                        : 'Bounce rate rendah! Pengunjung engaged dengan konten.'}
                </p>
            </div>
        </div>
    );
}

/**
 * Compact Retention Badge - untuk summary
 */
export function RetentionBadge({ newVisitors, returningVisitors }) {
    const total = newVisitors + returningVisitors;
    if (total === 0) return null;

    const returningPercentage = Math.round((returningVisitors / total) * 100);

    return (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg">
            <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {returningPercentage}% Returning
            </span>
        </div>
    );
}
