import { useRef, useEffect, useCallback } from 'react';
import { Icons } from '../../components/ui/Icons';
import MultiViewVideoItem from './MultiViewVideoItem';

const DEFAULT_STAGGER_DELAY = 800;


// ============================================
// MULTI-VIEW LAYOUT - Optimized with staggered initialization and proper cleanup
// ============================================
function MultiViewLayout({ cameras, onRemove, onClose }) {
    const containerRef = useRef(null);
    const streamErrorsRef = useRef(new Map()); // Track errors per stream for isolation
    const count = cameras.length;

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    // Cleanup all streams on unmount
    useEffect(() => {
        return () => {
            // Clear error tracking
            streamErrorsRef.current.clear();
        };
    }, []);

    const toggleFS = async () => {
        try {
            if (!document.fullscreenElement) await containerRef.current?.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch { }
    };

    // Handle stream errors with isolation - one error doesn't affect others
    const handleStreamError = useCallback((cameraId, error) => {
        streamErrorsRef.current.set(cameraId, error);
        // Error is isolated to this stream only
        console.warn(`Stream ${cameraId} error (isolated):`, error.message);
    }, []);

    // Handle stream status changes
    const handleStatusChange = useCallback((cameraId, status) => {
        if (status === 'live') {
            // Clear any previous error for this stream
            streamErrorsRef.current.delete(cameraId);
        }
    }, []);

    // Calculate stagger delay for each camera based on index
    const getInitDelay = (index) => index * DEFAULT_STAGGER_DELAY;

    return (
        <div className="fixed inset-0 z-50 bg-gray-50 dark:bg-gray-950 flex flex-col">
            <div className="shrink-0 flex items-center justify-between p-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary-400"><Icons.Layout /></div>
                    <div>
                        <h2 className="text-white font-bold text-sm sm:text-base">Multi-View</h2>
                        <p className="text-gray-500 text-[10px] sm:text-xs">{count} camera{count !== 1 ? 's' : ''}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={toggleFS} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/10 rounded-xl text-gray-900 dark:text-white"><Icons.Fullscreen /></button>
                    <button onClick={onClose} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/10 rounded-xl text-gray-900 dark:text-white"><Icons.X /></button>
                </div>
            </div>
            <div ref={containerRef} className="flex-1 p-2 sm:p-3 min-h-0 overflow-hidden">
                {count === 1 && (
                    <div className="h-full">
                        <MultiViewVideoItem
                            camera={cameras[0]}
                            onRemove={() => onRemove(cameras[0].id)}
                            onError={handleStreamError}
                            onStatusChange={handleStatusChange}
                            initDelay={getInitDelay(0)}
                        />
                    </div>
                )}
                {count === 2 && (
                    <div className="h-full grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        {cameras.map((c, index) => (
                            <MultiViewVideoItem
                                key={c.id}
                                camera={c}
                                onRemove={() => onRemove(c.id)}
                                onError={handleStreamError}
                                onStatusChange={handleStatusChange}
                                initDelay={getInitDelay(index)}
                            />
                        ))}
                    </div>
                )}
                {count === 3 && (
                    <div className="h-full flex flex-col gap-2 sm:gap-3">
                        <div style={{ flex: '1.2 1 0%' }} className="min-h-0">
                            <MultiViewVideoItem
                                camera={cameras[0]}
                                onRemove={() => onRemove(cameras[0].id)}
                                onError={handleStreamError}
                                onStatusChange={handleStatusChange}
                                initDelay={getInitDelay(0)}
                            />
                        </div>
                        <div style={{ flex: '0.8 1 0%' }} className="min-h-0 grid grid-cols-2 gap-2 sm:gap-3">
                            {cameras.slice(1).map((c, index) => (
                                <MultiViewVideoItem
                                    key={c.id}
                                    camera={c}
                                    onRemove={() => onRemove(c.id)}
                                    onError={handleStreamError}
                                    onStatusChange={handleStatusChange}
                                    initDelay={getInitDelay(index + 1)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
export default MultiViewLayout;