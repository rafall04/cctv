/*
 * Purpose: Ask for support on the public pages without ever taking the screen hostage — the
 *          banner arrives open, settles into a bubble on its own, and the full modal is kept
 *          for the one moment a visitor has actually received something.
 * Caller: Public landing full/simple pages.
 * Deps: React hooks, localStorage/window.open, animationControl, saweriaConfig.
 * MainFuncs: SaweriaSupport.
 * SideEffects: Reads the shared Saweria config, stores banner preferences, opens the external link,
 *              registers the peek/collapse timers.
 */

import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { shouldDisableAnimations } from '../utils/animationControl';
import { isSaweriaEnabled, SAWERIA_SUPPRESSED_KEY, SAWERIA_URL } from '../utils/saweriaConfig';

const STORAGE_KEY = SAWERIA_SUPPRESSED_KEY;
const BANNER_MINIMIZED_KEY = 'saweria_banner_minimized';

// How long the banner stays open before folding itself away. Long enough to read the ask
// and reach for the button, short enough that ignoring it costs nothing.
const PEEK_MS = 9000;
const BANNER_DELAY_MS = 3000;

// Simple icon - no multiple variations
const CoffeeIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 8h1a4 4 0 010 8h-1" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
    </svg>
);

const SaweriaSupport = memo(function SaweriaSupport() {
    const [showModal, setShowModal] = useState(false);
    const [showBanner, setShowBanner] = useState(false);
    const [bannerMinimized, setBannerMinimized] = useState(false);
    const [isEnabled, setIsEnabled] = useState(false);
    const [isReady, setIsReady] = useState(false);
    // Set the moment a pointer or a tap reaches the card, so the auto-collapse never fires
    // out from under someone who is actually reading it.
    const bannerTouchedRef = useRef(false);
    const markBannerTouched = useCallback(() => { bannerTouchedRef.current = true; }, []);
    const disableAnimations = shouldDisableAnimations();

    // Simplified - just use one variation
    const modalContent = useMemo(() => ({
        title: 'Traktir Kopi Dong!',
        subtitle: 'Biar semangat maintain server & kamera 24/7',
    }), []);

    // Shared with SupportInlineNote inside the video popup, so the two asks cost ONE request
    // per page load between them rather than one each every time a popup opens.
    useEffect(() => {
        let isMounted = true;
        isSaweriaEnabled().then((on) => {
            if (!isMounted) return;
            setIsEnabled(on);
            setIsReady(true);
        });
        return () => { isMounted = false; };
    }, []);

    /*
     * Peek, then settle. The ask is visible early — it just never holds the screen.
     *
     * This used to open the full-screen modal at `scrollY > 100` (+1.5s), with an 8s
     * fallback for people who did not scroll at all, so ANY first-time visitor to a public
     * CCTV page got a donation interstitial dropped over the thing they came to look at.
     * On a phone it covered the whole viewport.
     *
     * What actually made that intrusive was not that it existed: it dimmed the page, blocked
     * interaction, arrived BEFORE the visitor had received anything, and demanded a click to
     * go away. So the banner now enters OPEN (icon, headline, button — the whole ask, plainly
     * visible), and folds itself into the coffee bubble after PEEK_MS. Ignoring it costs
     * nothing, which is the entire difference between "present" and "in the way".
     *
     * A visitor who has already collapsed it before keeps that preference and never sees the
     * peek again.
     */
    useEffect(() => {
        if (!isReady) return undefined;
        // "Jangan Tampilkan Lagi" means what it says: it suppresses the ask entirely.
        if (localStorage.getItem(STORAGE_KEY) === 'true') return undefined;

        const timers = [];
        timers.push(setTimeout(() => {
            const alreadyMinimized = localStorage.getItem(BANNER_MINIMIZED_KEY) === 'true';
            setShowBanner(true);
            setBannerMinimized(alreadyMinimized);

            if (!alreadyMinimized) {
                timers.push(setTimeout(() => {
                    // Touching it counts as intent: someone reading or hovering the card is not
                    // someone the widget should fold away mid-thought.
                    if (bannerTouchedRef.current) return;
                    setBannerMinimized(true);
                }, PEEK_MS));
            }
        }, BANNER_DELAY_MS));

        return () => timers.forEach(clearTimeout);
    }, [isReady]);

    /*
     * There is deliberately NO "show the modal after they close a stream" hook here.
     *
     * That moment is the right one to ask — but the ask now lives INSIDE the video popup as a
     * single quiet line under the actions (VideoPopup), which reaches the same person at the
     * same instant without opening anything over them. Once the inline line exists, a modal
     * fired at the same moment is both redundant and the more intrusive of the two.
     */

    const handleModalClose = () => {
        setShowModal(false);
        setTimeout(() => setShowBanner(true), 2000);
    };

    const handleModalDontShow = () => {
        setShowModal(false);
        localStorage.setItem(STORAGE_KEY, 'true');
        setShowBanner(false);
    };

    const handleSupport = () => {
        window.open(SAWERIA_URL, '_blank', 'noopener,noreferrer');
        setShowModal(false);
        setTimeout(() => setShowBanner(true), 2000);
    };

    /*
     * Collapsing by hand is a preference and is remembered — that visitor gets the bubble
     * straight away next time, no peek. The automatic fold deliberately does NOT write this
     * key: it means "you did not react", not "you told me to stay small".
     */
    const handleBannerMinimize = () => {
        markBannerTouched();
        setBannerMinimized(true);
        localStorage.setItem(BANNER_MINIMIZED_KEY, 'true');
    };

    const handleBannerMaximize = () => {
        markBannerTouched();
        setBannerMinimized(false);
        localStorage.setItem(BANNER_MINIMIZED_KEY, 'false');
    };

    const handleBannerClose = () => setShowBanner(false);
    const handleBannerSupport = () => window.open(SAWERIA_URL, '_blank', 'noopener,noreferrer');

    if (!isReady || !isEnabled) return null;

    return (
        <>
            {/* Modal - Simplified, no animations */}
            {showModal && (
                <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/70">
                    <div className="absolute inset-0" onClick={handleModalClose} />

                    <div className="relative bg-surface border border-edge rounded-card shadow-e2 max-w-sm w-full max-h-[90vh] overflow-y-auto">
                        <div className="bg-amber-500 p-4 text-center">
                            <div className="w-12 h-12 mx-auto mb-2 bg-white/30 rounded-full flex items-center justify-center text-white">
                                <CoffeeIcon />
                            </div>
                            <h2 className="text-lg font-bold text-white">{modalContent.title}</h2>
                            <p className="text-white/80 text-xs">{modalContent.subtitle}</p>
                        </div>

                        <div className="p-4">
                            <p className="text-content-muted text-center text-sm mb-3">
                                Dukungan kamu sangat berarti untuk menjaga server tetap aktif 24/7!
                            </p>

                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleSupport}
                                    className="w-full bg-amber-500 text-white font-semibold py-2.5 px-4 rounded-control text-sm transition-colors hover:bg-amber-600"
                                >
                                    Traktir Kopi Sekarang
                                </button>

                                <button
                                    onClick={handleModalClose}
                                    className="w-full border border-edge text-content-muted font-medium py-2 px-4 rounded-control text-sm transition-colors hover:bg-surface-raised"
                                >
                                    Lain Kali Aja
                                </button>

                                <button
                                    onClick={handleModalDontShow}
                                    className="w-full text-gray-500 dark:text-gray-400 text-xs py-1"
                                >
                                    Jangan Tampilkan Lagi
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Banner - Simplified */}
            {showBanner && (
                <div
                    data-testid="saweria-floating-banner"
                    // Same rule as FeedbackWidget: a fixed element must never be sized with
                    // `100vw`, because it escapes the root overflow guard and can widen the page.
                    className={`fixed bottom-24 left-4 z-fab sm:bottom-24 sm:left-auto sm:right-6 ${bannerMinimized ? 'w-14' : 'right-[6.5rem] max-w-52 sm:right-6 sm:w-64 sm:max-w-none'} ${disableAnimations ? '' : 'animate-slide-up'}`}
                    // Reading or reaching for it counts as intent, so the peek timer stands down.
                    // Pointer + touch, because a phone never fires mouseenter.
                    onMouseEnter={markBannerTouched}
                    onTouchStart={markBannerTouched}
                    onFocusCapture={markBannerTouched}
                >
                    {bannerMinimized ? (
                        <button
                            onClick={handleBannerMaximize}
                            className="w-14 h-14 bg-amber-500 text-white rounded-full shadow-e2 flex items-center justify-center transition-colors hover:bg-amber-600"
                        >
                            <CoffeeIcon />
                        </button>
                    ) : (
                        <div className="bg-surface rounded-card shadow-e2 overflow-hidden border border-edge">
                            <div className="bg-amber-500 p-3 flex items-center justify-between">
                                {/* The only way the modal opens now: the visitor asks for it. */}
                                <button
                                    type="button"
                                    onClick={() => setShowModal(true)}
                                    className="flex items-center gap-2 text-left"
                                    aria-label="Selengkapnya tentang dukungan"
                                >
                                    <CoffeeIcon />
                                    <span className="text-white font-bold text-sm">Dukung Kami</span>
                                </button>
                                <div className="flex gap-1">
                                    <button onClick={handleBannerMinimize} className="w-6 h-6 rounded bg-white/20 text-white flex items-center justify-center">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </button>
                                    <button onClick={handleBannerClose} className="w-6 h-6 rounded bg-white/20 text-white flex items-center justify-center">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            </div>
                            <div className="p-3">
                                <p className="text-content-muted text-xs mb-2">Bantu server tetap aktif!</p>
                                <button
                                    onClick={handleBannerSupport}
                                    className="w-full bg-amber-500 text-white font-semibold py-2 rounded-control text-xs transition-colors hover:bg-amber-600"
                                >
                                    Traktir Kopi
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
});

export default SaweriaSupport;
