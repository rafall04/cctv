import { useState } from 'react';
import { getCodecDisplayName, canPlayCodec, getCodecWarning } from '../utils/codecSupport';

/**
 * CodecBadge Component
 * 
 * Displays video codec badge with browser compatibility warning
 * 
 * Renders NOTHING when the codec plays fine here — see the note in the body.
 *
 * @param {Object} props
 * @param {string} props.codec - 'h264' or 'h265'
 * @param {string} props.size - 'sm' | 'md' | 'lg'
 */
export default function CodecBadge({ codec = 'h264', size = 'sm' }) {
    const [showTooltip, setShowTooltip] = useState(false);

    if (!codec) return null;

    const support = canPlayCodec(codec);
    const warning = getCodecWarning(codec);
    const displayName = getCodecDisplayName(codec);

    /*
     * Silent unless this browser may actually fail to play the stream.
     *
     * The badge used to print the codec name for EVERY camera and merely attach a warning icon
     * when relevant — two jobs in one, and the first is noise: all 36 production cameras are
     * H.264, so it announced "H.264/AVC" on 100% of them while warning about nothing. That is
     * the same conclusion LandingCameraCard already reached ("a badge on 100% of items is
     * decoration, not information"); the popup and playback surfaces never caught up.
     *
     * Going quiet in the normal case is what makes the H.265 case LOUD: on Chrome/Firefox the
     * warning now stands alone instead of sitting beside a badge that cried wolf everywhere.
     * Nothing about the safety net changes — getCodecWarning still fires pre-emptively, and a
     * genuine decode failure still lands on the "Codec Tidak Didukung" panel from
     * publicPopupState.
     */
    if (!warning) return null;

    // Size classes
    const sizeClasses = {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-sm',
        lg: 'px-3 py-1.5 text-base'
    };
    
    // Codec-specific colors
    const codecColors = {
        h264: 'bg-blue-600/20 text-blue-400 border-blue-500/30',
        h265: 'bg-purple-600/20 text-purple-400 border-purple-500/30'
    };
    
    // Warning colors based on severity
    const getWarningColor = () => {
        if (!warning) return '';
        if (warning.severity === 'error') return 'text-red-500';
        if (warning.severity === 'warning') return 'text-yellow-500';
        return 'text-yellow-500';
    };
    
    const badgeClass = `${sizeClasses[size]} ${codecColors[codec] || codecColors.h264} rounded border font-semibold inline-flex items-center gap-1.5`;
    
    // `warning` is non-null by the guard above; this only distinguishes the two failing tiers
    // from a hypothetical future warning that is not about playability.
    const hasWarning = support === 'none' || support === 'partial';
    
    return (
        <div className="relative inline-flex items-center gap-2">
            <span className={badgeClass}>
                {displayName}
            </span>
            
            {hasWarning && (
                <div 
                    className="relative"
                    onMouseEnter={() => setShowTooltip(true)}
                    onMouseLeave={() => setShowTooltip(false)}
                >
                    {/* Warning Icon */}
                    <svg 
                        className={`w-4 h-4 cursor-help ${getWarningColor()}`}
                        fill="currentColor" 
                        viewBox="0 0 20 20"
                    >
                        <path 
                            fillRule="evenodd" 
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" 
                            clipRule="evenodd" 
                        />
                    </svg>
                    
                    {/* Tooltip */}
                    {showTooltip && (
                        <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 px-3 py-2 text-xs text-white bg-gray-900 rounded-lg shadow-lg border border-gray-700">
                            <div className="flex items-start gap-2">
                                <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${getWarningColor()}`} fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <span>{warning.message}</span>
                            </div>
                            {/* Tooltip arrow */}
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
                                <div className="border-4 border-transparent border-t-gray-900"></div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
