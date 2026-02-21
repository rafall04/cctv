import { useRef, useEffect, useState } from 'react';
import CodecBadge from '../CodecBadge';

export default function PlaybackVideo({
    videoRef,
    containerRef,
    selectedCamera,
    selectedSegment,
    playbackSpeed,
    onSpeedChange,
    onSnapshot,
    onToggleFullscreen,
    isFullscreen,
    isBuffering,
    isSeeking,
    videoError,
    errorType,
    currentTime,
    duration,
    autoPlayNotification,
    onAutoPlayNotificationClose,
    seekWarning,
    onSeekWarningClose,
    snapshotNotification,
    formatTimestamp,
}) {
    const getErrorInfo = () => {
        const errors = {
            codec: { 
                title: 'Codec Tidak Didukung', 
                desc: 'Browser Anda tidak mendukung codec H.265/HEVC yang digunakan kamera ini. Coba gunakan browser lain seperti Safari.',
                color: 'yellow',
                icon: (
                    <svg className="w-10 h-10 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                )
            },
            network: { 
                title: 'Koneksi Gagal', 
                desc: 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.',
                color: 'orange',
                icon: (
                    <svg className="w-10 h-10 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"/>
                    </svg>
                )
            },
            default: { 
                title: 'Video Tidak Tersedia', 
                desc: 'Terjadi kesalahan saat memuat video. Silakan coba lagi.',
                color: 'red',
                icon: (
                    <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                )
            }
        };
        return errors[errorType] || errors.default;
    };

    const errorColorClasses = {
        yellow: 'bg-yellow-500/20',
        orange: 'bg-orange-500/20',
        red: 'bg-red-500/20'
    };

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl overflow-hidden shadow-lg">
            {autoPlayNotification && (
                <div className="relative z-50 p-3 sm:p-4">
                    <div className={`px-4 sm:px-5 py-3 rounded-xl shadow-2xl border-2 ${
                        autoPlayNotification.type === 'complete' 
                            ? 'bg-green-500 border-green-400'
                            : autoPlayNotification.type === 'gap'
                            ? 'bg-yellow-500 border-yellow-400'
                            : autoPlayNotification.type === 'enabled'
                            ? 'bg-green-500 border-green-400'
                            : autoPlayNotification.type === 'disabled'
                            ? 'bg-gray-500 border-gray-400'
                            : autoPlayNotification.type === 'stopped'
                            ? 'bg-gray-500 border-gray-400'
                            : 'bg-blue-500 border-blue-400'
                    } text-white`}>
                        <div className="flex items-start gap-3">
                            {autoPlayNotification.type === 'complete' || autoPlayNotification.type === 'enabled' ? (
                                <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                            ) : autoPlayNotification.type === 'gap' ? (
                                <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            ) : autoPlayNotification.type === 'disabled' || autoPlayNotification.type === 'stopped' ? (
                                <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                                </svg>
                            ) : (
                                <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                </svg>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm sm:text-base">{autoPlayNotification.message}</p>
                            </div>
                            <button
                                onClick={onAutoPlayNotificationClose}
                                className="flex-shrink-0 text-white hover:text-gray-200 transition-colors"
                                aria-label="Tutup"
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {seekWarning && (
                <div className="relative z-50 p-3 sm:p-4">
                    <div className="bg-blue-500 text-white px-4 sm:px-5 py-3 rounded-xl shadow-2xl border-2 border-blue-400">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm sm:text-base">Video maksimal lompat 3 menit</p>
                            </div>
                            <button
                                onClick={onSeekWarningClose}
                                className="flex-shrink-0 text-white hover:text-blue-200 transition-colors"
                                aria-label="Tutup"
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="aspect-video bg-black relative" ref={containerRef}>
                <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    controls
                    playsInline
                    preload="metadata"
                    crossOrigin="anonymous"
                    muted
                />
                
                {(isBuffering || isSeeking) && !videoError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none z-40">
                        <div className="text-center bg-black/80 px-8 py-6 rounded-xl">
                            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-white mb-4 mx-auto"></div>
                            <p className="text-white text-lg font-medium mb-2">
                                {isSeeking ? 'Memuat video...' : 'Buffering...'}
                            </p>
                            <p className="text-gray-300 text-sm">
                                {isSeeking ? 'Mohon tunggu, video sedang dimuat' : 'Menunggu data video'}
                            </p>
                        </div>
                    </div>
                )}
                
                {videoError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-8">
                        <div className="text-center max-w-md">
                            {(() => {
                                const info = getErrorInfo();
                                const colorClass = errorColorClasses[info.color] || errorColorClasses.red;
                                return (
                                    <>
                                        <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${colorClass} flex items-center justify-center`}>
                                            {info.icon}
                                        </div>
                                        <h3 className="text-white font-semibold text-lg mb-2">{info.title}</h3>
                                        <p className="text-gray-400 text-sm mb-4">{info.desc}</p>
                                    </>
                                );
                            })()}
                            <button
                                onClick={() => {
                                    if (videoRef.current) {
                                        videoRef.current.load();
                                    }
                                }}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Coba Lagi
                            </button>
                        </div>
                    </div>
                )}
                
                <div className="flex absolute top-2 sm:top-4 right-2 sm:right-4 gap-1 sm:gap-2 z-30">
                    {[0.5, 1, 1.5, 2].map(speed => (
                        <button
                            key={speed}
                            onClick={() => onSpeedChange(speed)}
                            className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all shadow-lg ${
                                playbackSpeed === speed
                                    ? 'bg-primary-500 text-white scale-110'
                                    : 'bg-black/70 text-white hover:bg-black/90 hover:scale-105'
                            }`}
                            title={`Kecepatan ${speed}x`}
                        >
                            {speed}x
                        </button>
                    ))}
                </div>

                {!isFullscreen && (
                    <div className="absolute bottom-16 sm:bottom-20 right-2 sm:right-4 flex flex-col gap-2 z-30">
                        <button
                            onClick={onSnapshot}
                            disabled={!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2}
                            className="p-2 sm:p-2.5 bg-black/70 hover:bg-black/90 disabled:bg-black/40 disabled:cursor-not-allowed text-white rounded-lg transition-all shadow-lg hover:scale-110 disabled:scale-100"
                            title="Ambil Snapshot & Share"
                        >
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </button>
                        
                        <button
                            onClick={onToggleFullscreen}
                            className="p-2 sm:p-2.5 bg-black/70 hover:bg-black/90 text-white rounded-lg transition-all shadow-lg hover:scale-110"
                            title="Fullscreen"
                        >
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        </button>
                    </div>
                )}

                {isFullscreen && (
                    <div className="absolute inset-0 z-50 pointer-events-none">
                        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-white font-bold text-lg">{selectedCamera?.name}</h2>
                                    {selectedCamera?.video_codec && (
                                        <CodecBadge codec={selectedCamera.video_codec} size="sm" showWarning={false} />
                                    )}
                                </div>
                                <button onClick={onToggleFullscreen} className="p-2 hover:bg-white/20 rounded-xl text-white bg-white/10">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="absolute bottom-20 right-4 flex flex-col gap-2 pointer-events-auto">
                            <button
                                onClick={onSnapshot}
                                disabled={!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2}
                                className="p-3 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:cursor-not-allowed text-white rounded-xl transition-all shadow-lg"
                                title="Ambil Snapshot & Share"
                            >
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                        </div>
                    </div>
                )}

                {snapshotNotification && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                        <div className={`px-5 py-3 rounded-xl shadow-2xl border-2 ${
                            snapshotNotification.type === 'success'
                                ? 'bg-green-500 border-green-400'
                                : 'bg-red-500 border-red-400'
                        } text-white animate-slide-down`}>
                            <div className="flex items-center gap-3">
                                {snapshotNotification.type === 'success' ? (
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                )}
                                <p className="font-semibold text-sm">{snapshotNotification.message}</p>
                            </div>
                        </div>
                    </div>
                )}

                {selectedSegment && (
                    <div className="hidden sm:block absolute bottom-16 sm:bottom-4 right-2 sm:right-4 bg-black/70 text-white px-2 sm:px-4 py-1 sm:py-2 rounded text-xs sm:text-sm pointer-events-none">
                        <div className="font-medium">{formatTimestamp(selectedSegment.start_time)}</div>
                        <div className="text-xs text-gray-300">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </div>
                    </div>
                )}
            </div>
            
            {selectedCamera?.video_codec && selectedCamera.video_codec === 'h265' && (
                <div className="p-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-start gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1 text-xs text-yellow-400 dark:text-yellow-400">
                            <strong>Codec H.265:</strong> Terbaik di Safari. Chrome/Edge tergantung hardware device.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
