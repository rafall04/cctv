import { getRtspFormatHint } from '../../../utils/validators';

export default function CameraSourceFields({
    formData,
    isSubmitting,
    onChange,
    onBlur,
    getFieldError,
}) {
    return (
        <>
            <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">Sumber Stream</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Pilih sumber video</p>
                    </div>
                </div>
                <div className="flex rounded-lg overflow-hidden border border-blue-200 dark:border-blue-500/30">
                    <button
                        type="button"
                        onClick={() => onChange({ target: { name: 'stream_source', value: 'internal', type: 'text' } })}
                        disabled={isSubmitting}
                        className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${formData.stream_source !== 'external' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-500/10'}`}
                    >
                        Internal (RTSP)
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange({ target: { name: 'stream_source', value: 'external', type: 'text' } })}
                        disabled={isSubmitting}
                        className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${formData.stream_source === 'external' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-500/10'}`}
                    >
                        External (HLS)
                    </button>
                </div>
            </div>

            {formData.stream_source !== 'external' && (
                <>
                    <div>
                        <label htmlFor="camera-rtsp-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            RTSP URL <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="camera-rtsp-url"
                            type="text"
                            name="private_rtsp_url"
                            value={formData.private_rtsp_url}
                            onChange={onChange}
                            onBlur={onBlur}
                            disabled={isSubmitting}
                            className={`w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white font-mono text-xs placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${getFieldError('private_rtsp_url') ? 'border-red-500 focus:ring-red-500' : 'border-gray-200 dark:border-gray-700/50'}`}
                            placeholder="rtsp://user:pass@ip:port/path"
                        />
                        {getFieldError('private_rtsp_url') ? (
                            <p className="mt-1 text-xs text-red-500">{getFieldError('private_rtsp_url')}</p>
                        ) : (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{getRtspFormatHint()}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Video Codec</label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="radio"
                                    name="video_codec"
                                    value="h264"
                                    checked={formData.video_codec === 'h264'}
                                    onChange={onChange}
                                    disabled={isSubmitting}
                                    className="w-4 h-4 text-primary-600 focus:ring-primary focus:ring-2 disabled:opacity-50"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-primary-600 dark:group-hover:text-primary-400">H.264 (Universal)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="radio"
                                    name="video_codec"
                                    value="h265"
                                    checked={formData.video_codec === 'h265'}
                                    onChange={onChange}
                                    disabled={isSubmitting}
                                    className="w-4 h-4 text-purple-600 focus:ring-purple-500 focus:ring-2 disabled:opacity-50"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">H.265 (Safari only)</span>
                            </label>
                        </div>
                        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                            H.265 lebih efisien bandwidth tapi hanya support di Safari. H.264 kompatibel dengan semua browser.
                        </p>
                    </div>
                </>
            )}

            {formData.stream_source === 'external' && (
                <div className="space-y-4">
                    <div>
                        <label htmlFor="camera-external-hls-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            URL HLS Eksternal <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="camera-external-hls-url"
                            type="text"
                            name="external_hls_url"
                            value={formData.external_hls_url}
                            onChange={onChange}
                            onBlur={onBlur}
                            disabled={isSubmitting}
                            className={`w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white font-mono text-xs placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${getFieldError('external_hls_url') ? 'border-red-500 focus:ring-red-500' : 'border-gray-200 dark:border-gray-700/50'}`}
                            placeholder="https://data.bojonegorokab.go.id/live/local/xxx.m3u8"
                        />
                        {getFieldError('external_hls_url') ? (
                            <p className="mt-1 text-xs text-red-500">{getFieldError('external_hls_url')}</p>
                        ) : (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">URL .m3u8 sumber pihak ketiga. V1 tetap mengakses stream melalui proxy backend agar perilaku player tetap konsisten.</p>
                        )}
                    </div>

                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">Gunakan Proxy</p>
                                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                    Proxy backend tetap diaktifkan pada v1 untuk menjaga kompatibilitas playback, CORS, dan tracking stream external.
                                </p>
                            </div>
                            <label className="inline-flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                                <input
                                    type="checkbox"
                                    name="external_use_proxy"
                                    aria-label="Gunakan Proxy"
                                    checked={formData.external_use_proxy !== false}
                                    onChange={onChange}
                                    disabled
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-70"
                                />
                                Terkunci Aktif
                            </label>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="camera-external-tls-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Mode TLS
                        </label>
                        <select
                            id="camera-external-tls-mode"
                            name="external_tls_mode"
                            value={formData.external_tls_mode || 'strict'}
                            onChange={onChange}
                            onBlur={onBlur}
                            disabled={isSubmitting}
                            className={`w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${getFieldError('external_tls_mode') ? 'border-red-500 focus:ring-red-500' : 'border-gray-200 dark:border-gray-700/50'}`}
                        >
                            <option value="strict">Strict (Default)</option>
                            <option value="insecure">Insecure (Darurat)</option>
                        </select>
                        {getFieldError('external_tls_mode') ? (
                            <p className="mt-1 text-xs text-red-500">{getFieldError('external_tls_mode')}</p>
                        ) : (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                Gunakan <strong>Insecure</strong> hanya jika sumber external memiliki sertifikat TLS bermasalah. Mode ini menurunkan keamanan dan tidak direkomendasikan untuk penggunaan normal.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
