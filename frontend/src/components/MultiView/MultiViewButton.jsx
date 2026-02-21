import { Icons } from '../../components/ui/Icons';
import { shouldDisableAnimations } from '../../utils/animationControl';

// ============================================
// MULTI-VIEW FLOATING BUTTON - Enhanced with tooltip and device-based limit
// Disables animations on low-end devices - **Validates: Requirements 5.2**
// Position: bottom-left to avoid collision with FeedbackWidget (bottom-right)
// Tooltip dihapus agar tidak menimpa maps
// ============================================
function MultiViewButton({ count, onClick, maxReached, maxStreams = 3 }) {
    const disableAnimations = shouldDisableAnimations();

    // Hanya tampilkan button jika ada kamera yang dipilih
    if (count === 0) return null;

    return (
        <div className="fixed bottom-6 left-6 z-40 flex flex-col items-start gap-2">
            {/* Info tooltip when max reached */}
            {maxReached && (
                <div className={`bg-amber-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg ${disableAnimations ? '' : 'animate-bounce'}`}>
                    Maksimal {maxStreams} kamera!
                </div>
            )}

            <button
                onClick={onClick}
                className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-primary to-primary-600 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all"
            >
                <Icons.Layout />
                <span className="font-bold">Multi-View</span>
                <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">{count}</span>
            </button>
        </div>
    );
}
export default MultiViewButton;