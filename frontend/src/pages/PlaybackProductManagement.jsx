/*
 * Purpose: Admin page for the public playback-access catalogue — price, depth, validity, and whether
 *          each package is sold at all.
 * Caller: App.jsx protected admin route (/admin/playback-products).
 * Deps: usePlaybackProductManagementPage, admin playback-product components, components/ui.
 * MainFuncs: PlaybackProductManagement.
 * SideEffects: Delegates catalogue API calls to the page hook.
 *
 * Before this page the catalogue could only be changed by writing SQL against the production
 * database — the service had the functions, nothing called them. Pricing is an ordinary commercial
 * decision and should not require the one operation AGENTS.md forbids on production.
 */

import { useState } from 'react';
import { Alert, Button, Card, Field, Modal, PageHeader } from '../components/ui';
import PlaybackProductCard from '../components/admin/playback-products/PlaybackProductCard.jsx';
import { usePlaybackProductManagementPage } from '../hooks/admin/usePlaybackProductManagementPage.js';
import { hoursToText } from '../utils/durationText';

const EMPTY_DRAFT = {
    key: '',
    label: '',
    description: '',
    price_rupiah: '',
    window_hours: '',
    validity_days: '',
    sort_order: '',
};

const toInt = (v) => (String(v).trim() === '' ? NaN : Number(v));

/**
 * Where the depth on offer actually comes from, in the operator's terms.
 *
 * The stale branch is the one worth reading twice: an archive that stopped does not shorten, it
 * develops a HOLE between where local retention has rolled past and where the uploads ended. That
 * is a fault to go and fix, not a smaller number to accept.
 */
function coverageDetail(coverage) {
    if (coverage.archiveContinuous) {
        return `Arsip Telegram menjangkau ${hoursToText(coverage.archiveHours)} untuk ${coverage.camerasArchived} dari ${coverage.camerasRecording} kamera perekam; disk lokal menahan ${hoursToText(coverage.localHours)} terakhir.`;
    }
    if (coverage.archiveStaleHours !== null) {
        return `Arsip Telegram tidak ikut dihitung: upload terakhir ${hoursToText(coverage.archiveStaleHours)} lalu, lebih lama dari retensi lokal ${hoursToText(coverage.localHours)} — rentang di antaranya tidak tersimpan di mana pun. Periksa sidecar tg-archive.`;
    }
    return `Belum ada arsip Telegram, jadi yang tersedia hanya ${hoursToText(coverage.localHours)} di disk lokal.`;
}

export default function PlaybackProductManagement() {
    const page = usePlaybackProductManagementPage();
    const [draft, setDraft] = useState(EMPTY_DRAFT);

    const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

    function openCreate() {
        setDraft(EMPTY_DRAFT);
        page.setShowCreate(true);
    }

    async function submitCreate(event) {
        event.preventDefault();
        await page.createProduct({
            key: draft.key,
            label: draft.label,
            description: draft.description,
            price_rupiah: toInt(draft.price_rupiah),
            window_hours: toInt(draft.window_hours),
            validity_days: toInt(draft.validity_days),
            sort_order: String(draft.sort_order).trim() === '' ? 99 : toInt(draft.sort_order),
            enabled: 1,
        });
    }

    const sellingCount = page.products.filter((p) => p.enabled).length;
    const coverage = page.coverage;
    /*
     * Only ENABLED packages. A disabled package that over-promises is a draft, not a broken offer —
     * flagging it at the top would cry wolf about something nobody can currently buy.
     */
    const overPromising = page.products.filter((p) => p.enabled && p.exceeds_coverage);

    return (
        <div className="space-y-6 py-6">
            <PageHeader
                title="Paket Akses Playback"
                description="Apa yang ditawarkan di halaman publik saat pengunjung menekan “coba gratis atau beli akses”."
                actions={<Button variant="primary" size="sm" onClick={openCreate}>Tambah paket</Button>}
            />

            {/*
              * Said once, at the top, because it is the thing an operator gets wrong: the two numbers
              * on every package answer different questions, and swapping them sells 30 days of access
              * to the last hour of footage instead of the other way round.
              */}
            <Card padding="sm">
                <p className="text-xs leading-5 text-content-muted">
                    <span className="font-semibold text-content">Lihat ke belakang</span> = sejauh apa pembeli boleh
                    mundur. <span className="font-semibold text-content">Masa berlaku</span> = berapa lama tokennya
                    hidup. Keduanya berdiri sendiri. Menonaktifkan paket langsung menghilangkannya dari halaman publik
                    — katalog, klaim coba gratis, dan pembuatan order semuanya ikut menolak. Paket tidak bisa dihapus
                    karena riwayat pembayaran menunjuk ke barisnya; “Matikan” adalah cara menghapusnya.
                </p>
            </Card>

            {/*
              * The number every package on this page is judged against. Stated before the catalogue
              * because `window_hours` is a promise and this is the fact — an operator reading the
              * list without it has no way to tell which of the two they are looking at.
              */}
            {coverage?.measurable && (
                <Card padding="sm">
                    <p className="text-xs leading-5 text-content-muted">
                        <span className="font-semibold text-content">
                            Rekaman yang benar-benar bisa diputar sekarang: {hoursToText(coverage.coverageHours)} ke belakang.
                        </span>{' '}
                        {coverageDetail(coverage)}
                    </p>
                </Card>
            )}

            {overPromising.length > 0 && (
                <Alert
                    type="warning"
                    title={`${overPromising.length} paket menjanjikan lebih dalam dari rekaman yang ada`}
                    message={`${overPromising.map((p) => `${p.label} (${hoursToText(p.window_hours)})`).join(', ')} melebihi ${hoursToText(coverage?.coverageHours)} yang tersedia. Paket tetap bisa dibeli dan halaman publik menyebut angka sebenarnya, tapi pembeli tidak akan menemukan rekaman selebih itu sampai arsip cukup dalam.`}
                />
            )}

            {page.loadError && <Alert type="error" title="Gagal memuat" message={page.loadError} />}

            {/*
              * Zero enabled packages is a legitimate configuration (the operator may simply not be
              * selling right now), so it is stated as fact rather than flagged as a problem.
              */}
            {!page.loading && !page.loadError && sellingCount === 0 && page.products.length > 0 && (
                <Alert
                    type="info"
                    title="Tidak ada paket yang dijual"
                    message="Halaman publik tidak menawarkan akses sama sekali — tombol “coba gratis atau beli akses” ikut disembunyikan. Aktifkan salah satu paket untuk mulai menawarkan lagi."
                />
            )}

            {page.loading ? (
                <p className="text-sm text-content-muted">Memuat paket…</p>
            ) : (
                <div className="space-y-3">
                    {page.products.map((product) => (
                        <PlaybackProductCard
                            key={product.id}
                            product={product}
                            saving={page.savingId === product.id}
                            onSave={page.saveProduct}
                            onToggleEnabled={page.toggleEnabled}
                        />
                    ))}
                    {page.products.length === 0 && (
                        <p className="text-sm text-content-muted">Belum ada paket.</p>
                    )}
                </div>
            )}

            {page.showCreate && (
                <Modal
                    title="Tambah paket berbayar"
                    description="Paket baru selalu berbayar — paket coba gratis hanya ada satu dan sudah disediakan sistem."
                    onClose={() => page.setShowCreate(false)}
                    size="md"
                >
                    <form onSubmit={submitCreate} className="space-y-3">
                        <Field
                            label="Kode paket"
                            value={draft.key}
                            onChange={(e) => set({ key: e.target.value })}
                            required
                            hint="Huruf kecil, angka, - dan _ saja. Dipakai sistem, tidak dilihat pembeli. Contoh: dua_minggu"
                        />
                        <Field
                            label="Nama paket"
                            value={draft.label}
                            onChange={(e) => set({ label: e.target.value })}
                            required
                            hint="Yang dibaca pembeli. Contoh: Dua Minggu"
                        />
                        <Field
                            label="Keterangan"
                            as="textarea"
                            rows={2}
                            value={draft.description}
                            onChange={(e) => set({ description: e.target.value })}
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field
                                label="Harga (rupiah)"
                                type="number"
                                min={1}
                                step={1}
                                value={draft.price_rupiah}
                                onChange={(e) => set({ price_rupiah: e.target.value })}
                                required
                                hint="Bilangan bulat, tanpa titik."
                            />
                            <Field
                                label="Urutan tampil"
                                type="number"
                                step={1}
                                value={draft.sort_order}
                                onChange={(e) => set({ sort_order: e.target.value })}
                                hint="Kosongkan untuk menaruhnya di akhir."
                            />
                            <Field
                                label="Lihat ke belakang (jam)"
                                type="number"
                                min={1}
                                step={1}
                                value={draft.window_hours}
                                onChange={(e) => set({ window_hours: e.target.value })}
                                required
                            />
                            <Field
                                label="Masa berlaku (hari)"
                                type="number"
                                min={1}
                                step={1}
                                value={draft.validity_days}
                                onChange={(e) => set({ validity_days: e.target.value })}
                                required
                            />
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-3">
                            <Button type="button" variant="ghost" size="sm" onClick={() => page.setShowCreate(false)}>
                                Batal
                            </Button>
                            <Button type="submit" variant="primary" size="sm" loading={page.creating}>
                                Buat paket
                            </Button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
