import { memo } from 'react';
import { shouldDisableAnimations } from '../utils/animationControl';

// ============================================
// LAYOUT TOGGLE FAB - Floating Action Button
// Switches between Full and Simple layout modes
// Position: bottom-right (above FeedbackWidget)
// ============================================

const Icons = {
    LayoutFull: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
        </svg>
    ),
    LayoutSimple: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M9 9h6M9 15h6"/>
        </svg>
    ),
};

const LayoutToggleFAB = memo(function LayoutToggleFAB({ mode, onToggle }) {
    const disableAnimations = shouldDisableAnimations();
    const isSimple = mode === 'simple';
    
    return (
        <button
            onClick={onToggle}
            className={`fixed bottom-20 right-4 z-40 p-3 rounded-full shadow-lg ${
                disableAnimations ? '' : 'transition-all duration-200 hover:scale-110'
            } ${
                isSimple 
                    ? 'bg-purple-500 hover:bg-purple-600' 
                    : 'bg-sky-500 hover:bg-sky-600'
            } text-white`}
            title={isSimple ? 'Switch to Full Layout' : 'Switch to Simple Layout'}
            aria-label={isSimple ? 'Beralih ke Tampilan Lengkap' : 'Beralih ke Tampilan Sederhana'}
        >
            {isSimple ? <Icons.LayoutFull /> : <Icons.LayoutSimple />}
        </button>
    );
});

export default LayoutToggleFAB;
