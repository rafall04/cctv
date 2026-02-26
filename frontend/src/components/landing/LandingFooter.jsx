import { useState, lazy, Suspense } from 'react';
import { useCameras } from '../../contexts/CameraContext';

const FeedbackWidget = lazy(() => import('../FeedbackWidget'));

export default function Footer({ saweriaEnabled, saweriaLink, branding }) {
    const { cameras, areas } = useCameras();
    const cameraCount = cameras?.length || 0;
    const areaCount = areas?.length || 0;
    const whatsappNumber = branding.whatsapp_number || '6289685645956';
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=Halo%20Admin%20${encodeURIComponent(branding.company_name)}`;

    const showPoweredBy = branding.show_powered_by === 'true';
    const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

    return (
        <>
        <footer className="py-10 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="mb-8 text-center flex flex-col items-center justify-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center text-white shadow-lg shadow-amber-900/20 mb-2">
                        <span className="text-xl font-bold">{branding.logo_text}</span>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
                        {branding.company_name}
                    </h2>
                    <h3 className="text-lg font-medium text-amber-600 dark:text-amber-500">
                        Ramadan Kareem 1447 H 🌙
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mt-2">
                        {branding.company_description}
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    <div className="text-center md:text-left">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Layanan Kami</h4>
                        <ul className="text-sm text-gray-500 dark:text-gray-400 space-y-1.5">
                            <li>• Pemasangan WiFi rumah & kantor</li>
                            <li>• Instalasi CCTV</li>
                            <li>• Monitoring CCTV online 24 jam</li>
                        </ul>
                    </div>

                    <div className="text-center">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Statistik</h4>
                        <div className="flex justify-center gap-6">
                            <div>
                                <p className="text-2xl font-bold text-primary">{cameraCount}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Kamera</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-purple-500">{areaCount}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Lokasi</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-emerald-500">24/7</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Online</p>
                            </div>
                        </div>
                    </div>

                    <div className="text-center md:text-right">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Hubungi Kami</h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                            Butuh WiFi atau CCTV?
                        </p>
                        <a
                            href={whatsappLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-5 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl transition-colors shadow-lg shadow-green-500/30"
                        >
                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                            <span className="font-medium">WhatsApp</span>
                        </a>
                    </div>
                </div>

                <div className="flex flex-wrap justify-center gap-2 mb-6">
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">WiFi Rumah</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Pasang CCTV</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">HD Streaming</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Multi-View</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Playback</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Gratis Akses</span>
                </div>

                <div className="flex flex-col items-center gap-4 mb-8">
                    <div className="flex flex-wrap justify-center gap-4">
                        {saweriaEnabled && saweriaLink && (
                            <a
                                href={saweriaLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-xl"
                            >
                                <span className="text-xl">☕</span>
                                <span>Traktir Kopi</span>
                            </a>
                        )}
                        <button
                            onClick={() => setIsFeedbackOpen(true)}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold rounded-xl"
                        >
                            <span className="text-xl">💬</span>
                            <span>Kritik & Saran</span>
                        </button>
                    </div>
                    {saweriaEnabled && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center max-w-md">
                            Dukung kami tambah CCTV di lokasi strategis
                        </p>
                    )}
                </div>

                <div className="text-center mb-4">
                    <p className="text-[10px] text-gray-400 dark:text-gray-600">
                        {branding.meta_keywords}
                    </p>
                </div>

                <div className="pt-8 mt-4 border-t border-gray-100 dark:border-gray-800/50 flex flex-col items-center justify-center gap-2 text-center">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 dark:text-white">{branding.company_name}</span>
                    </div>
                    <span className="text-sm font-medium text-amber-600 dark:text-amber-500">Ramadan Kareem 1447 H 🌙</span>
                    
                    <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
                        © {new Date().getFullYear()} {branding.company_name} • {branding.copyright_text}
                    </p>

                    {saweriaEnabled && (
                        <p className="text-gray-400 dark:text-gray-600 text-[10px]">
                            Sistem donasi dikelola oleh Saweria
                        </p>
                    )}
                    {showPoweredBy && (
                        <p className="text-gray-400 dark:text-gray-600 text-[10px]">
                            Powered by {branding.company_name || 'CCTV System'}
                        </p>
                    )}
            </div>
            </div>
        </footer>

        <Suspense fallback={null}>
            <FeedbackWidget isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
        </Suspense>
        </>
    );
}
