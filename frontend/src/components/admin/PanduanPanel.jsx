/*
 * Purpose: Collapsible in-page guide so an operator can answer their own questions without asking.
 * Caller: pages/VehicleCountSettings.jsx, pages/RondaSettings.jsx.
 * Deps: none beyond React — content is passed in, so the copy lives next to the page it describes.
 * MainFuncs: PanduanPanel.
 * SideEffects: none.
 *
 * Tertutup secara bawaan, dan itu disengaja: di layar HP panduan yang terbuka mendorong kendali
 * yang sebenarnya dicari turun jauh ke bawah. Yang sudah hafal tidak perlu melewatinya tiap kali,
 * yang belum tahu tetap menemukannya di tempat pertama yang ia lihat.
 *
 * Memakai <details>, bukan state React: bisa dicari dengan Ctrl+F oleh peramban, tetap terbuka
 * saat halaman dicetak, dan tidak menambah satu pun penyimpan keadaan ke halaman yang sudah ramai.
 */

export default function PanduanPanel({ judul = 'Panduan', bagian = [], catatan }) {
    if (bagian.length === 0) return null;

    return (
        <details className="rounded-card border border-edge bg-surface">
            <summary
                className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2
                           text-sm font-medium text-content sm:min-h-0"
            >
                <span aria-hidden="true" className="text-content-subtle">?</span>
                {judul}
                <span className="ml-auto text-xs font-normal text-content-subtle">ketuk untuk buka</span>
            </summary>

            <div className="flex flex-col gap-3 border-t border-edge px-3 py-3">
                {bagian.map((b) => (
                    <div key={b.tanya}>
                        <h3 className="text-sm font-medium text-content">{b.tanya}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-content-muted">{b.jawab}</p>
                    </div>
                ))}
                {catatan && (
                    <p className="rounded-control bg-surface-sunken px-3 py-2 text-xs text-content-subtle">
                        {catatan}
                    </p>
                )}
            </div>
        </details>
    );
}
