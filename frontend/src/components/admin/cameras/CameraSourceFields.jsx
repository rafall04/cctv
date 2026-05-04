/*
Purpose: Render Camera Management stream source, delivery type, and internal ingest policy controls.
Caller: CameraFormModal inside admin Camera Management.
Deps: validators and camera form state callbacks.
MainFuncs: CameraSourceFields.
SideEffects: Emits form change/blur callbacks only.
*/

import { getRtspFormatHint } from '../../../utils/validators';

const DELIVERY_OPTIONS = [
    { value: 'internal_hls', label: 'Internal HLS', description: 'RTSP privat -> MediaMTX -> HLS/WebRTC. Cocok untuk source private seperti Surabaya', group: 'internal' },
    { value: 'external_hls', label: 'External HLS', description: 'URL .m3u8 publik/third-party', group: 'external' },
    { value: 'external_flv', label: 'External FLV', description: 'HTTP-FLV live stream seperti Surakarta', group: 'external' },
    { value: 'external_mjpeg', label: 'External MJPEG', description: 'Popup-only, cocok untuk ZoneMinder/HTTP MJPEG', group: 'external' },
    { value: 'external_embed', label: 'External Embed', description: 'Popup-only via iframe/embed URL resmi', group: 'external' },
    { value: 'external_jsmpeg', label: 'External JSMpeg', description: 'Popup-only, gunakan embed fallback bila tersedia', group: 'external' },
    { value: 'external_custom_ws', label: 'Custom WebSocket', description: 'Tidak dijamin playable, default fallback ke sumber resmi', group: 'external' },
];

const EXTERNAL_HEALTH_MODE_OPTIONS = [
    {
        value: 'default',
        label: 'Default',
        description: 'Ikuti policy global berdasarkan delivery type.',
    },
    {
        value: 'passive_first',
        label: 'Passive First',
        description: 'Gunakan bukti runtime pengguna. Cocok untuk MJPEG yang sering false offline.',
    },
    {
        value: 'hybrid_probe',
        label: 'Hybrid Probe',
        description: 'Gabungkan runtime dan probe backend dengan runtime tetap menang untuk mismatch transient.',
    },
    {
        value: 'probe_first',
        label: 'Probe First',
        description: 'Backend probe diutamakan. Gunakan hanya jika sumbernya stabil untuk diverifikasi.',
    },
    {
        value: 'disabled',
        label: 'Disabled',
        description: 'Tanpa active probe. Hanya maintenance, metadata, dan runtime evidence.',
    },
];

const INTERNAL_INGEST_POLICY_OPTIONS = [
    { value: 'default', label: 'Use Area Default', description: 'Gunakan default policy internal dari area kamera ini.' },
    { value: 'always_on', label: 'Always On', description: 'MediaMTX menjaga source tetap tersambung walau tidak ada viewer.' },
    { value: 'on_demand', label: 'On Demand', description: 'Source hanya dibuka saat ada viewer lalu ditutup lagi saat idle.' },
];

const INTERNAL_RTSP_TRANSPORT_OPTIONS = [
    { value: 'default', label: 'Use Area Default', description: 'Aman untuk existing camera: area default tetap TCP kecuali diubah.' },
    { value: 'tcp', label: 'TCP', description: 'Paksa RTSP over TCP. Ini default lama dan paling aman untuk kamera yang sudah berjalan.' },
    { value: 'udp', label: 'UDP', description: 'Gunakan jika FFmpeg gagal dengan Nonmatching transport tetapi VLC bisa play.' },
    { value: 'auto', label: 'Auto', description: 'Biarkan MediaMTX/FFmpeg negosiasi transport sendiri.' },
];

const THUMBNAIL_STRATEGY_OPTIONS = [
    { value: 'default', label: 'Default', description: 'Pakai perilaku sistem saat ini: internal RTSP langsung jika tersedia.' },
    { value: 'direct_rtsp', label: 'Direct RTSP', description: 'Paksa thumbnail langsung dari RTSP kamera.' },
    { value: 'hls_fallback', label: 'HLS Fallback', description: 'Coba RTSP dulu, lalu MediaMTX HLS jika RTSP gagal.' },
    { value: 'hls_only', label: 'HLS Only', description: 'Langsung ambil thumbnail dari MediaMTX HLS. Cocok untuk V380/Yoosee.' },
];

export default function CameraSourceFields({
    formData,
    isSubmitting,
    onChange,
    onBlur,
    getFieldError,
}) {
    const deliveryType = formData.delivery_type || 'internal_hls';
    const isInternal = deliveryType === 'internal_hls';
    const isExternalHls = deliveryType === 'external_hls';
    const isExternalFlv = deliveryType === 'external_flv';
    const isExternal = !isInternal;
    const usesStreamUrl = ['external_hls', 'external_flv', 'external_mjpeg', 'external_jsmpeg', 'external_custom_ws'].includes(deliveryType);
    const usesEmbedUrl = deliveryType === 'external_embed' || deliveryType === 'external_flv' || deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws';

    const setDeliveryType = (value) => {
        onChange({ target: { name: 'delivery_type', value, type: 'text' } });
        onChange({ target: { name: 'stream_source', value: value === 'internal_hls' ? 'internal' : 'external', type: 'text' } });
        if (value === 'internal_hls') {
            onChange({ target: { name: 'external_health_mode', value: 'default', type: 'text' } });
        } else if (value === 'external_mjpeg') {
            onChange({ target: { name: 'external_health_mode', value: 'passive_first', type: 'text' } });
        } else if (value === 'external_flv') {
            onChange({ target: { name: 'external_health_mode', value: 'passive_first', type: 'text' } });
        } else if (value === 'external_hls') {
            onChange({ target: { name: 'external_health_mode', value: 'hybrid_probe', type: 'text' } });
        } else {
            onChange({ target: { name: 'external_health_mode', value: 'default', type: 'text' } });
        }
    };

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
                        <p className="text-sm font-medium text-gray-900 dark:text-white">Delivery Type</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Pilih format distribusi stream yang benar-benar dipakai kamera.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DELIVERY_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => setDeliveryType(option.value)}
                            disabled={isSubmitting}
                            className={`rounded-xl border px-3 py-3 text-left transition-colors ${deliveryType === option.value
                                ? 'border-blue-500 bg-blue-500 text-white'
                                : 'border-blue-200 bg-white text-gray-700 hover:bg-blue-50 dark:border-blue-500/30 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-blue-500/10'
                                }`}
                        >
                            <div className="text-xs font-semibold">{option.label}</div>
                            <div className={`mt-1 text-[11px] ${deliveryType === option.value ? 'text-blue-50/90' : 'text-gray-500 dark:text-gray-400'}`}>
                                {option.description}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {isInternal && (
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
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{getRtspFormatHint()} RTSP tetap backend-only; browser menerima HLS/WebRTC internal.</p>
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
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">Internal RTSP / MediaMTX Policy</p>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            Gunakan override ini jika kamera internal perlu berbeda dari default area, misalnya Surabaya harus on-demand dan mati saat idle.
                        </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label htmlFor="camera-internal-ingest-policy" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Ingest Policy Override
                            </label>
                            <select
                                id="camera-internal-ingest-policy"
                                name="internal_ingest_policy_override"
                                value={formData.internal_ingest_policy_override || 'default'}
                                onChange={onChange}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 border-gray-200 dark:border-gray-700/50"
                            >
                                {INTERNAL_INGEST_POLICY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {INTERNAL_INGEST_POLICY_OPTIONS.find((option) => option.value === (formData.internal_ingest_policy_override || 'default'))?.description}
                            </p>
                        </div>

                        <div>
                            <label htmlFor="camera-rtsp-transport" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                RTSP Transport Override
                            </label>
                            <select
                                id="camera-rtsp-transport"
                                name="internal_rtsp_transport_override"
                                value={formData.internal_rtsp_transport_override || 'default'}
                                onChange={onChange}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 border-gray-200 dark:border-gray-700/50"
                            >
                                {INTERNAL_RTSP_TRANSPORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {INTERNAL_RTSP_TRANSPORT_OPTIONS.find((option) => option.value === (formData.internal_rtsp_transport_override || 'default'))?.description}
                            </p>
                        </div>

                        <div>
                            <label htmlFor="camera-thumbnail-strategy" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Thumbnail Strategy
                            </label>
                            <select
                                id="camera-thumbnail-strategy"
                                name="thumbnail_strategy"
                                value={formData.thumbnail_strategy || 'default'}
                                onChange={onChange}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 border-gray-200 dark:border-gray-700/50"
                            >
                                {THUMBNAIL_STRATEGY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {THUMBNAIL_STRATEGY_OPTIONS.find((option) => option.value === (formData.thumbnail_strategy || 'default'))?.description}
                            </p>
                        </div>

                        <div>
                            <label htmlFor="camera-close-after-seconds" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Idle Close Timeout Override (detik)
                            </label>
                            <input
                                id="camera-close-after-seconds"
                                type="number"
                                min="5"
                                max="300"
                                name="internal_on_demand_close_after_seconds_override"
                                value={formData.internal_on_demand_close_after_seconds_override}
                                onChange={onChange}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 border-gray-200 dark:border-gray-700/50"
                                placeholder="Kosong = ikuti area/default"
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                Dipakai hanya untuk mode on-demand. Kosongkan agar mengikuti area atau default sistem.
                            </p>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="camera-source-profile" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Source Profile
                        </label>
                        <input
                            id="camera-source-profile"
                            type="text"
                            name="source_profile"
                            value={formData.source_profile}
                            onChange={onChange}
                            disabled={isSubmitting}
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 border-gray-200 dark:border-gray-700/50"
                            placeholder="Contoh: surabaya_private_rtsp"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Tag operasional internal untuk policy dan troubleshooting. Contoh Surabaya: <span className="font-mono">surabaya_private_rtsp</span>.
                        </p>
                    </div>
                </>
            )}

            {!isInternal && (
                <div className="space-y-4">
                    {usesStreamUrl && (
                        <div>
                            <label htmlFor="camera-external-stream-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                External Stream URL <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="camera-external-stream-url"
                                type="text"
                                name="external_stream_url"
                                value={formData.external_stream_url}
                                onChange={onChange}
                                onBlur={onBlur}
                                disabled={isSubmitting}
                                className={`w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white font-mono text-xs placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${getFieldError('external_stream_url') ? 'border-red-500 focus:ring-red-500' : 'border-gray-200 dark:border-gray-700/50'}`}
                                placeholder={deliveryType.includes('ws') || deliveryType.includes('jsmpeg') ? 'wss://example.com/stream' : 'https://example.com/live.m3u8'}
                            />
                            {getFieldError('external_stream_url') ? (
                                <p className="mt-1 text-xs text-red-500">{getFieldError('external_stream_url')}</p>
                            ) : (
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {deliveryType === 'external_hls' && 'Gunakan URL HLS (.m3u8). Hanya type ini yang boleh memakai proxy backend dan Multi-View.'}
                                    {deliveryType === 'external_flv' && 'Gunakan URL HTTP-FLV resmi (.flv). Live popup memakai player FLV browser-side dan tidak masuk playback/recording.'}
                                    {deliveryType === 'external_mjpeg' && 'Cocok untuk MJPEG/ZoneMinder. Popup akan memuat direct browser stream, bukan HLS proxy.'}
                                    {deliveryType === 'external_jsmpeg' && 'Gunakan WebSocket JSMpeg jika Anda juga punya fallback embed/resmi. Type ini popup-only.'}
                                    {deliveryType === 'external_custom_ws' && 'Custom WebSocket tidak dijamin playable. Idealnya isi juga embed URL resmi sebagai fallback.'}
                                </p>
                            )}
                        </div>
                    )}

                    {usesEmbedUrl && (
                        <div>
                            <label htmlFor="camera-external-embed-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                External Embed URL {deliveryType === 'external_embed' ? <span className="text-red-500">*</span> : null}
                            </label>
                            <input
                                id="camera-external-embed-url"
                                type="text"
                                name="external_embed_url"
                                value={formData.external_embed_url}
                                onChange={onChange}
                                onBlur={onBlur}
                                disabled={isSubmitting}
                                className={`w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white font-mono text-xs placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${getFieldError('external_embed_url') ? 'border-red-500 focus:ring-red-500' : 'border-gray-200 dark:border-gray-700/50'}`}
                                placeholder="https://source.example.com/player?id=cam-1"
                            />
                            {getFieldError('external_embed_url') ? (
                                <p className="mt-1 text-xs text-red-500">{getFieldError('external_embed_url')}</p>
                            ) : (
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {deliveryType === 'external_embed' ? 'URL resmi iframe/embed yang akan dipakai langsung di popup.' : (isExternalFlv ? 'Opsional. Dipakai sebagai fallback jika browser gagal memutar HTTP-FLV secara native.' : 'Opsional tapi sangat disarankan sebagai fallback resmi saat stream WebSocket tidak punya adapter generik.')}
                                </p>
                            )}
                        </div>
                    )}

                    <div>
                        <label htmlFor="camera-external-snapshot-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Snapshot / Thumbnail URL
                        </label>
                        <input
                            id="camera-external-snapshot-url"
                            type="text"
                            name="external_snapshot_url"
                            value={formData.external_snapshot_url}
                            onChange={onChange}
                            onBlur={onBlur}
                            disabled={isSubmitting}
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white font-mono text-xs placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 border-gray-200 dark:border-gray-700/50"
                            placeholder="https://example.com/snapshot.jpg"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Dipakai untuk card/grid/map agar halaman utama tetap thumbnail-first dan tidak membebani server.</p>
                    </div>

                    {isExternalHls && (
                        <>
                            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">Gunakan Proxy Backend</p>
                                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                            {formData.external_tls_mode === 'insecure'
                                                ? 'Proxy WAJIB aktif karena Mode TLS Insecure.'
                                                : 'Nonaktifkan untuk direct browser HLS. Pastikan sumber mengizinkan CORS dan sertifikat TLS valid.'}
                                        </p>
                                    </div>
                                    <label className={`inline-flex items-center gap-2 text-xs font-semibold ${formData.external_tls_mode === 'insecure' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-700 dark:text-gray-300'}`}>
                                        <input
                                            type="checkbox"
                                            name="external_use_proxy"
                                            aria-label="Gunakan Proxy"
                                            checked={formData.external_tls_mode === 'insecure' ? true : formData.external_use_proxy}
                                            onChange={onChange}
                                            disabled={formData.external_tls_mode === 'insecure' || isSubmitting}
                                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                                        />
                                        {formData.external_tls_mode === 'insecure' ? 'Wajib Aktif' : (formData.external_use_proxy ? 'Aktif' : 'Nonaktif')}
                                    </label>
                        </div>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">Internal RTSP Workflow</p>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            Gunakan mode ini untuk source private seperti Surabaya. Jalur yang dipakai adalah RTSP privat -&gt; MediaMTX -&gt; HLS/WebRTC. Jika recording dimatikan, kamera berjalan live-only tanpa playback.
                        </p>
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
                            </div>
                        </>
                    )}

                    {isExternalFlv && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                            <div className="flex items-start gap-3">
                                <div>
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">HTTP-FLV Live Only</p>
                                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                        Type ini khusus live popup. Recording, playback, dan Multi-View belum didukung. Isi embed URL resmi bila ingin fallback aman di browser yang gagal memutar FLV.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {isExternal ? (
                        <div>
                            <label htmlFor="camera-external-health-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Health Mode
                            </label>
                            <select
                                id="camera-external-health-mode"
                                name="external_health_mode"
                                value={formData.external_health_mode || 'default'}
                                onChange={onChange}
                                onBlur={onBlur}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 border-gray-200 dark:border-gray-700/50"
                            >
                                {EXTERNAL_HEALTH_MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {EXTERNAL_HEALTH_MODE_OPTIONS.find((option) => option.value === (formData.external_health_mode || 'default'))?.description}
                            </p>
                        </div>
                    ) : null}

                    <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                    {deliveryType === 'external_flv' && 'Type ini live-only. Tidak masuk playback, recording, atau Multi-View pada v1.'}
                    {deliveryType === 'external_mjpeg' && 'Type ini popup-only dan tidak masuk playback atau Multi-View.'}
                    {deliveryType === 'external_embed' && 'Type ini popup-only dan tidak masuk playback atau Multi-View.'}
                        {deliveryType === 'external_jsmpeg' && 'Type ini popup-only. Jika adapter tidak tersedia, sistem akan fallback ke embed atau tombol sumber resmi.'}
                        {deliveryType === 'external_custom_ws' && 'Type ini metadata-limited. Sistem tidak akan mencoba decode generic WebSocket stream di server.'}
                    </div>
                </div>
            )}
        </>
    );
}
