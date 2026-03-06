import { useCameras } from '../../contexts/CameraContext';

export default function Footer({ saweriaEnabled, saweriaLink, branding }) {
    const { cameras, areas } = useCameras();
    const cameraCount = cameras?.length || 0;
    const areaCount = areas?.length || 0;
    const whatsappNumber = branding.whatsapp_number || '6289685645956';
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=Halo%20Admin%20${encodeURIComponent(branding.company_name)}`;
    const showPoweredBy = branding.show_powered_by === 'true';

    return (
        <footer className="border-t border-gray-200 bg-white py-12 dark:border-gray-800 dark:bg-gray-900">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="mb-10 text-center">
                    <div
                        data-testid="landing-footer-brand-stack"
                        className="mx-auto mb-6 flex max-w-sm flex-col items-center gap-3"
                    >
                        <div className="flex items-center gap-2 rounded-full border border-emerald-200/50 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm dark:border-emerald-700/30 dark:bg-emerald-900/30 dark:text-emerald-400">
                            <svg className="h-4 w-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z" />
                            </svg>
                            <span>Ramadan Kareem 1447 H</span>
                        </div>

                        <div className="flex items-center gap-2 rounded-full bg-sky-50 px-4 py-2 text-sm dark:bg-primary/10">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-600 text-white">
                                <span className="text-sm font-bold">{branding.logo_text}</span>
                            </div>
                            <span className="font-bold text-primary-600 dark:text-primary-400">{branding.company_name}</span>
                        </div>
                    </div>

                    <h3 className="mb-2 text-lg font-bold text-gray-900 dark:text-white">
                        {branding.copyright_text}
                    </h3>
                    <p className="mx-auto mb-4 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
                        {branding.company_description}
                    </p>
                </div>

                <div className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-3">
                    <div className="text-center md:text-left">
                        <h4 className="mb-3 font-semibold text-gray-900 dark:text-white">Layanan Kami</h4>
                        <ul className="space-y-1.5 text-sm text-gray-500 dark:text-gray-400">
                            <li>&bull; Pemasangan WiFi rumah & kantor</li>
                            <li>&bull; Instalasi CCTV</li>
                            <li>&bull; Monitoring CCTV online 24 jam</li>
                        </ul>
                    </div>

                    <div className="text-center">
                        <h4 className="mb-3 font-semibold text-gray-900 dark:text-white">Statistik</h4>
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
                        <h4 className="mb-2 font-semibold text-gray-900 dark:text-white">Hubungi Kami</h4>
                        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                            Butuh WiFi atau CCTV?
                        </p>
                        <a
                            href={whatsappLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-white shadow-lg shadow-green-500/30 transition-colors hover:bg-green-600"
                        >
                            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                            <span className="font-medium">WhatsApp</span>
                        </a>
                    </div>
                </div>

                <div className="mb-6 flex flex-wrap justify-center gap-2">
                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">WiFi Rumah</span>
                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">Pasang CCTV</span>
                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">HD Streaming</span>
                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">Multi-View</span>
                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">Playback</span>
                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">Gratis Akses</span>
                </div>

                {saweriaEnabled && (
                    <div className="mb-6 flex flex-col items-center gap-3">
                        <a
                            href={saweriaLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-3 font-semibold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:from-orange-600 hover:to-amber-600 hover:shadow-xl"
                        >
                            <span className="text-xl">Kopi</span>
                            <span>Traktir Kopi</span>
                        </a>
                        <p className="max-w-md text-center text-xs text-gray-500 dark:text-gray-400">
                            Dukung kami tambah CCTV di lokasi strategis
                        </p>
                    </div>
                )}

                <div className="mb-4 text-center">
                    <p className="text-[10px] text-gray-400 dark:text-gray-600">
                        {branding.meta_keywords}
                    </p>
                </div>

                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                    <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                        &copy; {new Date().getFullYear()} {branding.company_name} &bull; {branding.copyright_text}
                    </p>
                    {showPoweredBy && (
                        <p className="mt-1 text-center text-[10px] text-gray-400 dark:text-gray-600">
                            Powered by {branding.company_name || 'CCTV System'}
                        </p>
                    )}
                </div>
            </div>
        </footer>
    );
}
