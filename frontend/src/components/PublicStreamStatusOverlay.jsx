import { Icons } from './ui/Icons.jsx';

function WrenchIcon() {
    return (
        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
    );
}

const OVERLAY_STYLES = {
    maintenance: {
        container: 'bg-red-950/80',
        iconCircle: 'bg-red-500/20 text-red-400',
        title: 'text-red-300',
        description: 'text-gray-300',
    },
    offline: {
        container: 'bg-gray-100/95 dark:bg-gray-900/90',
        iconCircle: 'bg-gray-700 text-gray-400',
        title: 'text-gray-200',
        description: 'text-gray-400',
    },
    timeout: {
        container: 'bg-gray-100/95 dark:bg-black/90',
        iconCircle: 'bg-amber-500/20 text-amber-400',
        title: 'text-white',
        description: 'text-gray-400',
    },
    codec: {
        container: 'bg-gray-100/95 dark:bg-black/90',
        iconCircle: 'bg-yellow-500/20 text-yellow-400',
        title: 'text-white',
        description: 'text-gray-400',
    },
    network: {
        container: 'bg-gray-100/95 dark:bg-black/90',
        iconCircle: 'bg-orange-500/20 text-orange-400',
        title: 'text-white',
        description: 'text-gray-400',
    },
    media: {
        container: 'bg-gray-100/95 dark:bg-black/90',
        iconCircle: 'bg-purple-500/20 text-purple-400',
        title: 'text-white',
        description: 'text-gray-400',
    },
    cors: {
        container: 'bg-gray-100/95 dark:bg-black/90',
        iconCircle: 'bg-blue-500/20 text-blue-400',
        title: 'text-white',
        description: 'text-gray-400',
    },
    unknown: {
        container: 'bg-gray-100/95 dark:bg-black/90',
        iconCircle: 'bg-red-500/20 text-red-400',
        title: 'text-white',
        description: 'text-gray-400',
    },
};

function renderIcon(variant) {
    switch (variant) {
        case 'maintenance':
            return <WrenchIcon />;
        case 'offline':
            return <Icons.X />;
        case 'timeout':
            return <Icons.Clock />;
        case 'codec':
            return <Icons.Camera />;
        case 'network':
            return <Icons.Signal />;
        case 'cors':
            return <Icons.Map />;
        case 'media':
        case 'unknown':
        default:
            return <Icons.Shield />;
    }
}

export default function PublicStreamStatusOverlay({
    state,
    onRetry,
    showTroubleshooting = false,
    consecutiveFailures = 0,
    className = 'absolute inset-0 z-10',
    disableAnimations = false,
}) {
    if (!state) return null;

    if (state.variant === 'loading') {
        return (
            <div className={`${className} bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 flex flex-col items-center justify-center gap-3`}>
                {!disableAnimations && (
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                    </div>
                )}
                <div className="relative">
                    <div className={`w-12 h-12 border-2 border-gray-700 rounded-full ${disableAnimations ? '' : 'animate-pulse'}`} />
                    <div
                        className={`absolute inset-0 w-12 h-12 border-2 border-transparent border-t-sky-500 rounded-full ${disableAnimations ? '' : 'animate-spin'}`}
                        style={disableAnimations ? { animation: 'spin 1.5s linear infinite' } : undefined}
                    />
                </div>
                <div className="text-center px-4">
                    <p className="text-white font-medium text-sm">{state.title}</p>
                    <p className="text-gray-400 text-xs mt-1">{state.description}</p>
                </div>
            </div>
        );
    }

    const style = OVERLAY_STYLES[state.variant] || OVERLAY_STYLES.unknown;

    return (
        <div className={`${className} ${style.container} flex flex-col items-center justify-center px-4 py-6`}>
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 ${style.iconCircle}`}>
                {renderIcon(state.variant)}
            </div>
            <div className="text-center max-w-md">
                <h3 className={`font-bold text-xl mb-2 ${style.title}`}>{state.title}</h3>
                <p className={`text-sm ${style.description}`}>{state.description}</p>
            </div>
            {showTroubleshooting && state.variant === 'timeout' && consecutiveFailures >= 3 && (
                <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 max-w-sm text-left">
                    <p className="text-amber-400 text-xs font-medium mb-1">Troubleshooting Tips:</p>
                    <ul className="text-gray-400 text-xs list-disc list-inside space-y-1">
                        <li>Check your internet connection</li>
                        <li>Camera may be offline</li>
                        <li>Try refreshing the page</li>
                    </ul>
                </div>
            )}
            {state.canRetry && onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-600 text-white rounded-lg font-medium transition-colors"
                >
                    <Icons.Reset />
                    Coba Lagi
                </button>
            )}
        </div>
    );
}
