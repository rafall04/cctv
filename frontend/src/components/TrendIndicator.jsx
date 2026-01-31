/**
 * Trend Indicator Component
 * Menampilkan perubahan persentase dengan ikon naik/turun
 */
export function TrendIndicator({ value, label, inverse = false }) {
    if (value === null || value === undefined || value === 0) {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                </svg>
                <span>0%</span>
            </span>
        );
    }

    const isPositive = value > 0;
    const isGood = inverse ? !isPositive : isPositive;
    
    const colorClass = isGood 
        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/20' 
        : 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/20';

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold ${colorClass}`}>
            {isPositive ? (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
            ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
            )}
            <span>{Math.abs(value)}%</span>
            {label && <span className="text-[10px] opacity-75">{label}</span>}
        </span>
    );
}

/**
 * Compact Trend Badge - untuk digunakan di stats card
 */
export function TrendBadge({ value, inverse = false }) {
    if (value === null || value === undefined || value === 0) return null;

    const isPositive = value > 0;
    const isGood = inverse ? !isPositive : isPositive;
    
    const colorClass = isGood 
        ? 'text-emerald-600 dark:text-emerald-400' 
        : 'text-red-600 dark:text-red-400';

    return (
        <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${colorClass}`}>
            {isPositive ? '↑' : '↓'}
            {Math.abs(value)}%
        </span>
    );
}
