import { Icons } from './ui/Icons.jsx';

function WrenchIcon() {
    return (
        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
    );
}

/*
 * This overlay always sits over the black <video> body, so it is a permanently-dark
 * surface. We scope it to `.dark` and use the semantic tokens, which then resolve to
 * their bright dark-theme values in EITHER page theme — fixing the old light-mode bug
 * where `text-white` titles sat on a near-white light-mode scrim (invisible).
 *
 * Tone encodes severity (data/warn/idle/fault); the per-variant icon carries the
 * specific reason. Red (`status-fault`) is reserved for genuine faults — offline and
 * unknown — matching the public red-discipline rule; recoverable playback problems are
 * amber (`status-warn`), loading is cyan data.
 */
const VARIANT_TONE = {
    maintenance: 'text-status-warn',
    offline:     'text-content-muted',
    timeout:     'text-status-warn',
    codec:       'text-status-warn',
    network:     'text-status-warn',
    media:       'text-status-warn',
    stalled:     'text-status-warn',
    cors:        'text-status-warn',
    unknown:     'text-status-fault',
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
        // Gambar berhenti mengalir - jam, bukan tengkorak. Ini pulih sendiri lewat 'coba lagi'.
        case 'stalled':
            return <Icons.Clock />;
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
    autoRetryCount = 0,
    maxAutoRetries = 3,
}) {
    if (!state) return null;

    if (state.variant === 'loading') {
        return (
            <div className={`${className} dark flex flex-col items-center justify-center gap-3 bg-black/80`}>
                {!disableAnimations && (
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                    </div>
                )}
                <div className="relative">
                    <div className={`h-12 w-12 rounded-full border-2 border-white/15 ${disableAnimations ? '' : 'animate-pulse'}`} />
                    <div
                        className={`absolute inset-0 h-12 w-12 rounded-full border-2 border-transparent border-t-data ${disableAnimations ? '' : 'animate-spin'}`}
                        style={disableAnimations ? { animation: 'spin 1.5s linear infinite' } : undefined}
                    />
                </div>
                <div className="px-4 text-center">
                    <p className="text-sm font-medium text-content">{state.title}</p>
                    <p className="mt-1 text-xs text-content-muted">{state.description}</p>
                    {autoRetryCount > 0 && (
                        <p className="mt-1 font-mono text-xs font-medium tabular-nums text-data">
                            Mencoba menyambungkan ulang… (percobaan {Math.min(autoRetryCount, maxAutoRetries)} dari {maxAutoRetries})
                        </p>
                    )}
                </div>
            </div>
        );
    }

    const tone = VARIANT_TONE[state.variant] || 'text-status-fault';

    return (
        <div className={`${className} dark flex flex-col items-center justify-center bg-black/85 px-4 py-6`}>
            <div className={`mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/5 ring-1 ring-inset ring-current ${tone}`}>
                {renderIcon(state.variant)}
            </div>
            <div className="max-w-md text-center">
                <h3 className="mb-2 text-xl font-bold text-content">{state.title}</h3>
                <p className="text-sm text-content-muted">{state.description}</p>
            </div>
            {showTroubleshooting && state.variant === 'timeout' && consecutiveFailures >= 3 && (
                <div className="mt-4 max-w-sm rounded-control border border-status-warn/30 bg-status-warn/10 p-3 text-left">
                    <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-status-warn">Tips Mengatasi</p>
                    <ul className="list-inside list-disc space-y-1 text-xs text-content-muted">
                        <li>Periksa koneksi internet Anda</li>
                        <li>Kamera mungkin sedang offline</li>
                        <li>Coba muat ulang halaman</li>
                    </ul>
                </div>
            )}
            {state.canRetry && onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-5 inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2 font-medium text-white transition-colors hover:bg-primary-600"
                >
                    <Icons.Reset />
                    Coba Lagi
                </button>
            )}
        </div>
    );
}
