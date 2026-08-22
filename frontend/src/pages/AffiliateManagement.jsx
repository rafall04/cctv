/*
 * Purpose: Admin page for the affiliate feature — MITRA (the partner shop and its commercial
 *   deal) and BARANG (the product cards shown under a live camera), plus the per-offer counters.
 * Caller: App.jsx route /admin/affiliate (admin only; the route + menu entry are wired by hand).
 * Deps: affiliateAdminService, areaService, cameraService, AffiliatePartnerForm,
 *   AffiliateOfferForm, components/ui, ConfirmDialog, billingFormat.formatRupiah.
 * MainFuncs: AffiliateManagement.
 * SideEffects: Admin CRUD against /api/admin/affiliate/*.
 *
 * WHY EVERY URL ON THIS PAGE IS PLAIN TEXT AND NEVER A LIVE <a href>
 * -----------------------------------------------------------------
 * Partner and product URLs are OPERATOR INPUT that gets stored and then re-rendered in an ADMIN
 * session — the highest-privilege browser context this app has. The repo's global input sanitiser
 * misses `data:` URLs and does not catch a tab/LF/CR planted inside the scheme (`java\tscript:`),
 * both of which a browser happily strips and executes. Rendering that string as a clickable anchor
 * turns the list into a stored-XSS sink aimed at the admin.
 *
 * So URLs render as inert text (`UrlText` below): the operator can read and copy the link, and
 * nothing in this page ever navigates to it. SponsorManagement.jsx still renders `sponsor.url` as
 * a live href — that is the pattern this page deliberately does NOT copy. Visitors reach the shop
 * through the backend's /go redirector, which re-validates the URL on every single click; the
 * admin has no reason to need a shortcut that bypasses that.
 *
 * NOTE ON THE NUMBERS: the counters are directional, not billable. See STATS_HONESTY below.
 *
 * WHAT THE OFFER LIST SAYS ABOUT THE THREE OPTIONAL EXTRAS
 * --------------------------------------------------------
 * A photo, a price and a WhatsApp button are each switched on by being filled in and off by being
 * cleared — there is no show_x flag anywhere in this feature. A list that only showed the filled
 * ones would therefore be ambiguous ("did I not set a price, or is this row just not showing it?"),
 * so every offer row states all three either way, including the empty case in words. The photo is
 * shown as an actual thumbnail rather than a "punya foto" badge: the operator uploaded a picture
 * to be looked at, and a badge cannot tell them they attached the wrong one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    listPartners,
    createPartner,
    updatePartner,
    deletePartner,
    listOffers,
    createOffer,
    updateOffer,
    deleteOffer,
    getOfferStats,
    affiliateImageSrc,
    normalizePlacements,
    normalizeTargetIds,
} from '../services/affiliateAdminService';
import { areaService } from '../services/areaService';
import { cameraService } from '../services/cameraService';
import { useNotification } from '../contexts/NotificationContext';
import { Badge, Button, Card, PageHeader, Tabs, TabPanel } from '../components/ui';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import AffiliatePartnerForm from '../components/admin/affiliate/AffiliatePartnerForm';
import AffiliateOfferForm from '../components/admin/affiliate/AffiliateOfferForm';
// Reused rather than re-implemented: money renders identically to every other rupiah figure in
// admin (INTEGER rupiah, id-ID grouping, no decimals).
import { formatRupiah } from '../components/admin/billing/billingFormat';

const PLACEMENT_LABELS = {
    popup: 'Bawah video live',
    area: 'Halaman area',
    landing: 'Halaman depan',
    playback: 'Halaman rekaman',
};

const TARGET_LABELS = {
    all: 'Semua kamera',
    area: 'Area terpilih',
    camera: 'Kamera terpilih',
};

const STATS_HONESTY = 'Angka ini indikatif, bukan tagihan. Pengalihan link cuma satu permintaan GET '
    + 'biasa dan penyaring ganda hanya berlaku per-proses, jadi jangan diserahkan ke mitra sebagai '
    + 'dasar penagihan.';

/*
 * A URL is shown, never linked — see the header block. `break-all` because a long product URL is
 * one unbreakable token and would otherwise push the card wider than a phone viewport.
 */
function UrlText({ value, empty = '—' }) {
    if (!value) {
        return <span className="text-content-subtle">{empty}</span>;
    }
    return (
        <span className="block break-all font-mono text-xs text-content-muted" title={String(value)}>
            {String(value)}
        </span>
    );
}

function Row({ label, children }) {
    return (
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-content-subtle">
            <span className="shrink-0">{label}</span>
            <span className="min-w-0 flex-1 text-content-muted">{children}</span>
        </p>
    );
}

/* ------------------------------------------------------------------ partners */

function PartnerRow({ partner, offerCount, onEdit, onDelete }) {
    const lifetime = partner.billing_mode === 'lifetime';
    const price = Number(partner.price_rupiah) || 0;

    return (
        <Card>
            <div className="flex flex-col gap-4 sm:flex-row">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 title={partner.store_name} className="min-w-0 truncate text-base font-semibold text-content">{partner.store_name}</h3>
                        {partner.active
                            ? <Badge tone="live" dot>Aktif</Badge>
                            : <Badge tone="idle" dot>Nonaktif</Badge>}
                        <Badge>{lifetime ? 'Selamanya' : 'Berjangka'}</Badge>
                        {/* Rp0 is a real, deliberate value — the operator's own shop runs free. */}
                        <Badge tone="data" mono>{price === 0 ? 'Rp0 · gratis' : formatRupiah(price)}</Badge>
                    </div>

                    <Row label="Link toko:"><UrlText value={partner.store_url} empty="belum ada" /></Row>
                    <Row label="Masa kerjasama:">
                        {lifetime
                            ? `tanpa batas${partner.start_date ? ` (mulai ${partner.start_date})` : ''}`
                            : `${partner.start_date || '…'} → ${partner.end_date || '…'}`}
                    </Row>
                    <Row label="Barang:">{offerCount} barang terdaftar</Row>
                    {partner.contact_note && <Row label="Catatan:">{partner.contact_note}</Row>}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
                    <Button size="sm" onClick={() => onEdit(partner)}>Ubah</Button>
                    <Button size="sm" variant="dangerGhost" onClick={() => onDelete(partner)}>Hapus</Button>
                </div>
            </div>
        </Card>
    );
}

/* -------------------------------------------------------------------- offers */

function OfferStatsPanel({ offerId }) {
    const [state, setState] = useState({ loading: true, error: null, totals: null, days: 0 });

    useEffect(() => {
        let cancelled = false;
        setState({ loading: true, error: null, totals: null, days: 0 });

        getOfferStats(offerId, 30).then((result) => {
            if (cancelled) {
                return;
            }
            if (!result.success) {
                setState({ loading: false, error: result.message, totals: null, days: 0 });
                return;
            }
            /*
             * Accepts either a bare array of daily rows or { rows, totals } — the daily rollup is
             * the storage shape, and which of the two the endpoint returns must not decide whether
             * this panel renders at all.
             */
            const payload = result.data;
            const rows = Array.isArray(payload)
                ? payload
                : (Array.isArray(payload?.rows) ? payload.rows : []);
            const totals = payload?.totals || rows.reduce((acc, row) => ({
                impressions: acc.impressions + (Number(row.impressions) || 0),
                product_clicks: acc.product_clicks + (Number(row.product_clicks) || 0),
                store_clicks: acc.store_clicks + (Number(row.store_clicks) || 0),
                whatsapp_clicks: acc.whatsapp_clicks + (Number(row.whatsapp_clicks) || 0),
            }), { impressions: 0, product_clicks: 0, store_clicks: 0, whatsapp_clicks: 0 });

            setState({ loading: false, error: null, totals, days: rows.length });
        });

        return () => { cancelled = true; };
    }, [offerId]);

    if (state.loading) {
        return <p className="mt-3 text-xs text-content-subtle">Memuat statistik…</p>;
    }
    if (state.error) {
        return <p className="mt-3 text-xs text-status-warn">{state.error}</p>;
    }

    /*
     * Every counter is read through Number(...) || 0 rather than destructured raw: `whatsapp_clicks`
     * arrived later than the other three, so a stats row written before that migration — or a
     * backend that pre-computes `totals` without it — would otherwise render an empty cell where a
     * zero belongs. A missing number and a genuine zero look identical to an operator; only one of
     * them is true.
     *
     * Four across is deliberately two-by-two on a phone: four columns of tabular numerals in a
     * 320px card either wrap mid-label or force the row wider than the viewport.
     */
    const readCount = (key) => Number(state.totals?.[key]) || 0;

    return (
        <div id={`offer-stats-${offerId}`} className="mt-3 rounded-card border border-edge bg-surface-sunken p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                    { label: 'Tayang', value: readCount('impressions') },
                    { label: 'Klik barang', value: readCount('product_clicks') },
                    { label: 'Klik toko', value: readCount('store_clicks') },
                    { label: 'Klik WA', value: readCount('whatsapp_clicks') },
                ].map((stat) => (
                    <div key={stat.label} className="min-w-0">
                        <p className="truncate text-xs text-content-subtle">{stat.label}</p>
                        <p className="font-mono text-lg tabular-nums text-content">{stat.value}</p>
                    </div>
                ))}
            </div>
            <p className="mt-2 text-xs text-content-subtle">
                30 hari terakhir{state.days ? ` · ${state.days} hari ada datanya` : ' · belum ada data'}. {STATS_HONESTY}
            </p>
        </div>
    );
}

/*
 * The three optional extras as the list sees them: photo, price, WhatsApp. Each is reported even
 * when it is unset, in words, because "empty" is a real configuration here rather than a gap — the
 * empty state IS the off switch, so a row that stayed silent about it would be hiding half the
 * setting. The photo is the exception to the wording rule: when there is one, the thumbnail says
 * it better than any label could, so the "Foto:" line only appears when there is nothing to show.
 */
function OfferExtras({ offer }) {
    // 160px is the small rendition — the list shows dozens of these, and the 320px file is for the
    // form's preview where the operator is actually inspecting the picture.
    const thumb = affiliateImageSrc(offer.image_base, '160');
    const price = Number.isInteger(offer.product_price_rupiah) ? offer.product_price_rupiah : null;
    const whatsapp = String(offer.whatsapp_number || '').trim();

    return (
        <div className="mt-2 flex flex-wrap items-start gap-3">
            {thumb && (
                <img
                    src={thumb}
                    alt={`Foto ${offer.product_title}`}
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-card border border-edge object-cover"
                />
            )}
            <div className="min-w-0 flex-1">
                {!thumb && <Row label="Foto:"><span className="text-content-subtle">tidak ditampilkan</span></Row>}
                <Row label="Harga:">
                    {price === null
                        ? <span className="text-content-subtle">tidak ditampilkan</span>
                        // Rp0 is a real, deliberate value and reads as "gratis" to a visitor — it is
                        // NOT the same as leaving the price empty, so the list never renders it as
                        // a bare "Rp0" that could be mistaken for "unset".
                        : (price === 0 ? 'Rp0 · gratis' : formatRupiah(price))}
                </Row>
                <Row label="WhatsApp:">
                    {whatsapp
                        ? <span className="font-mono">{whatsapp}</span>
                        : <span className="text-content-subtle">tombol tidak ditampilkan</span>}
                </Row>
            </div>
        </div>
    );
}

function OfferRow({ offer, partner, areaNameById, onEdit, onDelete }) {
    const [showStats, setShowStats] = useState(false);

    const placements = normalizePlacements(offer.placements);
    const areaIds = normalizeTargetIds(offer, 'area');
    const cameraIds = normalizeTargetIds(offer, 'camera');

    const targetSummary = offer.target_mode === 'area'
        ? (areaIds.map((id) => areaNameById.get(id) || `#${id}`).join(', ') || 'belum dipilih')
        : offer.target_mode === 'camera'
            ? `${cameraIds.length} kamera`
            : 'semua kamera';

    // "Aktif" is only the operator's switch on the BARANG. A partner that is switched off (or whose
    // term has run out) stops the offer too, and that second gate is evaluated on the server, so it
    // is reported here as a separate line rather than folded into one green badge that would lie.
    const partnerBlocked = partner && !partner.active;

    return (
        <Card>
            <div className="flex flex-col gap-4 sm:flex-row">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 title={offer.product_title} className="min-w-0 truncate text-base font-semibold text-content">{offer.product_title}</h3>
                        {offer.active
                            ? <Badge tone="live" dot>Aktif</Badge>
                            : <Badge tone="idle" dot>Nonaktif</Badge>}
                        <Badge>{TARGET_LABELS[offer.target_mode] || offer.target_mode}</Badge>
                        {placements.map((placement) => (
                            <Badge key={placement}>{PLACEMENT_LABELS[placement] || placement}</Badge>
                        ))}
                    </div>

                    <Row label="Mitra:">
                        {partner?.store_name || offer.store_name || `#${offer.partner_id}`}
                    </Row>
                    <Row label="Target:">{targetSummary}</Row>
                    <Row label="Link barang:"><UrlText value={offer.product_url} /></Row>
                    {offer.description && <Row label="Deskripsi:">{offer.description}</Row>}
                    <Row label="Prioritas:">{offer.priority ?? 100}</Row>

                    <OfferExtras offer={offer} />

                    {partnerBlocked && (
                        <p className="mt-2 rounded-control border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-xs text-status-warn">
                            Mitranya sedang nonaktif, jadi barang ini tidak tampil walaupun tombol Aktif di sini menyala.
                        </p>
                    )}

                    {showStats && <OfferStatsPanel offerId={offer.id} />}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
                    <Button
                        size="sm"
                        onClick={() => setShowStats((current) => !current)}
                        aria-expanded={showStats}
                        aria-controls={`offer-stats-${offer.id}`}
                    >
                        {showStats ? 'Tutup statistik' : 'Statistik'}
                    </Button>
                    <Button size="sm" onClick={() => onEdit(offer)}>Ubah</Button>
                    <Button size="sm" variant="dangerGhost" onClick={() => onDelete(offer)}>Hapus</Button>
                </div>
            </div>
        </Card>
    );
}

/* ---------------------------------------------------------------------- page */

export default function AffiliateManagement() {
    const [tab, setTab] = useState('partners');
    const [partners, setPartners] = useState([]);
    const [offers, setOffers] = useState([]);
    const [areas, setAreas] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingPartner, setEditingPartner] = useState(null);
    const [editingOffer, setEditingOffer] = useState(null);
    const [pendingDelete, setPendingDelete] = useState(null);
    const { showNotification } = useNotification();

    const reloadPartners = useCallback(async () => {
        const result = await listPartners();
        if (result.success) {
            setPartners(result.data || []);
        } else {
            showNotification({ type: 'error', title: 'Gagal memuat mitra', message: result.message });
        }
    }, [showNotification]);

    const reloadOffers = useCallback(async () => {
        const result = await listOffers();
        if (result.success) {
            setOffers(result.data || []);
        } else {
            showNotification({ type: 'error', title: 'Gagal memuat barang', message: result.message });
        }
    }, [showNotification]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            /*
             * Each request is settled individually. cameraService.getAllCameras THROWS on failure
             * instead of returning { success: false }, so a bare Promise.all would reject and leave
             * the whole page stuck on "Memuat…" — including the partner list, which does not depend
             * on cameras at all.
             */
            const settle = (promise) => promise.then(
                (value) => value,
                (error) => ({ success: false, message: error?.message || 'Gagal memuat' })
            );
            const [partnerResult, offerResult, areaResult, cameraResult] = await Promise.all([
                settle(listPartners()),
                settle(listOffers()),
                settle(areaService.getAllAreas()),
                settle(cameraService.getAllCameras()),
            ]);
            if (cancelled) {
                return;
            }
            if (partnerResult.success) {
                setPartners(partnerResult.data || []);
            } else {
                showNotification({ type: 'error', title: 'Gagal memuat mitra', message: partnerResult.message });
            }
            if (offerResult.success) {
                setOffers(offerResult.data || []);
            } else {
                showNotification({ type: 'error', title: 'Gagal memuat barang', message: offerResult.message });
            }
            if (areaResult.success) {
                setAreas(areaResult.data || []);
            }
            if (cameraResult.success) {
                setCameras(cameraResult.data || []);
            }
            setLoading(false);
        };

        load();
        return () => { cancelled = true; };
    }, [showNotification]);

    const areaNameById = useMemo(() => new Map(areas.map((area) => [area.id, area.name])), [areas]);
    const partnerById = useMemo(
        () => new Map(partners.map((partner) => [String(partner.id), partner])),
        [partners]
    );
    const offerCountByPartner = useMemo(() => {
        const counts = new Map();
        for (const offer of offers) {
            const key = String(offer.partner_id);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return counts;
    }, [offers]);

    const handlePartnerSubmit = async (payload) => {
        setSaving(true);
        const result = editingPartner?.id
            ? await updatePartner(editingPartner.id, payload)
            : await createPartner(payload);
        setSaving(false);

        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menyimpan mitra', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: editingPartner?.id ? 'Mitra diperbarui' : 'Mitra dibuat' });
        setEditingPartner(null);
        await reloadPartners();
        // An offer row shows its partner's state, so a partner edit changes what the other tab says.
        await reloadOffers();
    };

    /*
     * Returns the saved row, and — unlike the partner form — leaves the editor OPEN on it.
     *
     * Both facts are load-bearing for the product photo. The image endpoint needs an offer id, so
     * a photo picked while the offer was still a draft can only be uploaded after this save; the
     * form flushes it from its own closure the moment onSubmit resolves. Closing the editor here
     * would unmount that form mid-upload, and the operator would lose the progress line and the
     * preview of the picture they just attached. Staying on the saved offer is also what the promo
     * banner page does, so the two upload flows behave the same way.
     */
    const handleOfferSubmit = async (payload) => {
        setSaving(true);
        const result = editingOffer?.id
            ? await updateOffer(editingOffer.id, payload)
            : await createOffer(payload);
        setSaving(false);

        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menyimpan barang', message: result.message });
            return null;
        }
        showNotification({ type: 'success', title: editingOffer?.id ? 'Barang diperbarui' : 'Barang dibuat' });
        await reloadOffers();
        setEditingOffer(result.data || null);
        return result.data || null;
    };

    const handleDelete = async () => {
        if (!pendingDelete) {
            return;
        }
        const { kind, row } = pendingDelete;
        const result = kind === 'partner' ? await deletePartner(row.id) : await deleteOffer(row.id);
        setPendingDelete(null);

        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menghapus', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: kind === 'partner' ? 'Mitra dihapus' : 'Barang dihapus' });
        if (kind === 'partner') {
            if (editingPartner?.id === row.id) {
                setEditingPartner(null);
            }
            await reloadPartners();
            // Deleting a partner cascades to its offers, so the other list is stale too.
            await reloadOffers();
        } else {
            if (editingOffer?.id === row.id) {
                setEditingOffer(null);
            }
            await reloadOffers();
        }
    };

    const deleteMessage = () => {
        if (!pendingDelete) {
            return '';
        }
        const { kind, row } = pendingDelete;
        if (kind === 'partner') {
            const count = offerCountByPartner.get(String(row.id)) || 0;
            return `"${row.store_name}" akan dihapus permanen`
                + (count > 0 ? `, beserta ${count} barang dan seluruh statistiknya.` : '.');
        }
        return `"${row.product_title}" beserta statistiknya akan dihapus permanen.`;
    };

    const tabs = [
        { id: 'partners', label: 'Mitra', badge: <Badge mono>{partners.length}</Badge> },
        { id: 'offers', label: 'Barang', badge: <Badge mono>{offers.length}</Badge> },
    ];

    return (
        <div className="space-y-6">
            <PageHeader
                title="Toko Rekanan"
                description={
                    'Link toko dan barang milik mitra yang tampil di bawah video live, ditandai label '
                    + '"Toko rekanan" ke pengunjung. Terpisah dari Promo Pemasangan (milik sendiri), '
                    + 'Sponsor (logo), dan Iklan (jaringan iklan).'
                }
                actions={
                    tab === 'partners'
                        ? !editingPartner && (
                            <Button variant="primary" onClick={() => setEditingPartner({})}>Tambah mitra</Button>
                        )
                        : !editingOffer && (
                            <Button
                                variant="primary"
                                onClick={() => setEditingOffer({})}
                                disabled={partners.length === 0}
                                title={partners.length === 0 ? 'Buat mitra dulu — setiap barang menempel pada satu mitra.' : undefined}
                            >
                                Tambah barang
                            </Button>
                        )
                }
            />

            <Tabs tabs={tabs} activeId={tab} onChange={setTab} idPrefix="affiliate" />

            {loading && <p className="text-sm text-content-muted">Memuat…</p>}

            {!loading && tab === 'partners' && (
                <TabPanel id="partners" idPrefix="affiliate" className="space-y-3">
                    {editingPartner && (
                        <Card>
                            <h2 className="mb-4 text-sm font-semibold text-content">
                                {editingPartner.id ? `Ubah mitra: ${editingPartner.store_name}` : 'Mitra baru'}
                            </h2>
                            <AffiliatePartnerForm
                                partner={editingPartner.id ? editingPartner : null}
                                saving={saving}
                                onSubmit={handlePartnerSubmit}
                                onCancel={() => setEditingPartner(null)}
                            />
                        </Card>
                    )}

                    {partners.length === 0 && !editingPartner && (
                        <div className="rounded-card border border-dashed border-edge bg-surface-sunken p-8 text-center">
                            <p className="text-sm text-content-muted">Belum ada mitra.</p>
                            <p className="mt-1 text-xs text-content-subtle">
                                Mulai dari toko dan kesepakatannya — barang menyusul setelah mitranya ada.
                            </p>
                        </div>
                    )}

                    {partners.map((partner) => (
                        <PartnerRow
                            key={partner.id}
                            partner={partner}
                            offerCount={offerCountByPartner.get(String(partner.id)) || 0}
                            onEdit={setEditingPartner}
                            onDelete={(row) => setPendingDelete({ kind: 'partner', row })}
                        />
                    ))}
                </TabPanel>
            )}

            {!loading && tab === 'offers' && (
                <TabPanel id="offers" idPrefix="affiliate" className="space-y-3">
                    {editingOffer && (
                        <Card>
                            <h2 className="mb-4 text-sm font-semibold text-content">
                                {editingOffer.id ? `Ubah barang: ${editingOffer.product_title}` : 'Barang baru'}
                            </h2>
                            <AffiliateOfferForm
                                offer={editingOffer.id ? editingOffer : null}
                                partners={partners}
                                areas={areas}
                                cameras={cameras}
                                saving={saving}
                                onSubmit={handleOfferSubmit}
                                onCancel={() => setEditingOffer(null)}
                                // A photo upload (or removal) writes the offer row without going
                                // through onSubmit, so the list would keep showing the old
                                // thumbnail until something else refetched it.
                                onUploaded={reloadOffers}
                            />
                        </Card>
                    )}

                    {offers.length === 0 && !editingOffer && (
                        <div className="rounded-card border border-dashed border-edge bg-surface-sunken p-8 text-center">
                            <p className="text-sm text-content-muted">Belum ada barang.</p>
                            <p className="mt-1 text-xs text-content-subtle">
                                {partners.length === 0
                                    ? 'Buat mitra dulu, lalu daftarkan barangnya di sini.'
                                    : 'Pilih mitranya, isi judul dan link barang, lalu tentukan kamera tempatnya tampil.'}
                            </p>
                        </div>
                    )}

                    {offers.map((offer) => (
                        <OfferRow
                            key={offer.id}
                            offer={offer}
                            partner={partnerById.get(String(offer.partner_id)) || null}
                            areaNameById={areaNameById}
                            onEdit={setEditingOffer}
                            onDelete={(row) => setPendingDelete({ kind: 'offer', row })}
                        />
                    ))}
                </TabPanel>
            )}

            {pendingDelete && (
                <ConfirmDialog
                    title={pendingDelete.kind === 'partner' ? 'Hapus mitra?' : 'Hapus barang?'}
                    message={deleteMessage()}
                    confirmLabel="Hapus"
                    cancelLabel="Batal"
                    tone="danger"
                    onConfirm={handleDelete}
                    onCancel={() => setPendingDelete(null)}
                />
            )}
        </div>
    );
}
