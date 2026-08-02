/*
 * Purpose: One playback-access package — read it at a glance, switch it on/off, or edit it in place.
 * Caller: pages/PlaybackProductManagement.jsx.
 * Deps: components/ui primitives.
 * MainFuncs: PlaybackProductCard.
 * SideEffects: None; every mutation is a prop callback.
 *
 * The draft lives here rather than in the page hook so a keystroke re-renders one card, not the
 * whole catalogue, and "Batal" is just throwing this component's state away.
 *
 * A DISABLED package is `idle`, never `fault`. Red means something is broken; an operator who
 * deliberately stopped selling the monthly package has broken nothing. (docs/frontend-guide.md)
 */

import { useState } from 'react';
import { Badge, Button, Card, CardHeader, Field } from '../../ui';
import { hoursToText } from '../../../utils/durationText';

const rupiah = (v) => `Rp ${Number(v || 0).toLocaleString('id-ID')}`;
const depth = hoursToText;

/** Empty string must not silently become 0 — send NaN so the backend's own validator rejects it. */
const toInt = (v) => (String(v).trim() === '' ? NaN : Number(v));

function Fact({ label, value }) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">{label}</dt>
            <dd className="truncate text-sm font-medium text-content">{value}</dd>
        </div>
    );
}

export default function PlaybackProductCard({ product, saving = false, onSave, onToggleEnabled }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(product);

    const isTrial = !!product.is_trial;
    const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

    function beginEdit() {
        setDraft(product);
        setEditing(true);
    }

    async function submit(event) {
        event.preventDefault();
        const ok = await onSave(product.id, {
            label: draft.label,
            description: draft.description,
            // The trial's price is structurally 0; sending anything else is rejected server-side.
            price_rupiah: isTrial ? 0 : toInt(draft.price_rupiah),
            window_hours: toInt(draft.window_hours),
            validity_days: toInt(draft.validity_days),
            sort_order: toInt(draft.sort_order),
            enabled: draft.enabled ? 1 : 0,
        });
        if (ok) setEditing(false);
    }

    return (
        <Card>
            <CardHeader
                title={(
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-content">{product.label}</span>
                        <Badge tone="data" mono>{product.key}</Badge>
                        {isTrial && <Badge tone="brand">Coba gratis</Badge>}
                        <Badge tone={product.enabled ? 'live' : 'idle'} dot>
                            {product.enabled ? 'Dijual' : 'Tidak dijual'}
                        </Badge>
                        {/*
                          * `warn`, not `fault`. Nothing is broken — the archive simply has not been
                          * running long enough yet, and it closes the gap by one hour every hour.
                          */}
                        {product.exceeds_coverage && (
                            <Badge tone="warn">Melebihi rekaman yang ada</Badge>
                        )}
                    </span>
                )}
                description={product.description || null}
                actions={!editing ? (
                    <>
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={saving}
                            onClick={() => onToggleEnabled(product)}
                        >
                            {product.enabled ? 'Matikan' : 'Aktifkan'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={beginEdit}>Ubah</Button>
                    </>
                ) : null}
            />

            {!editing ? (
                <>
                    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Fact label="Harga" value={isTrial ? 'Gratis' : rupiah(product.price_rupiah)} />
                        <Fact label="Lihat ke belakang" value={depth(product.window_hours)} />
                        <Fact label="Masa berlaku" value={`${product.validity_days} hari`} />
                        <Fact label="Urutan" value={product.sort_order} />
                    </dl>
                    {product.exceeds_coverage && (
                        <p className="mt-3 rounded-control border border-edge border-l-2 border-l-status-warn bg-surface-raised px-3 py-2 text-xs leading-5 text-content-muted">
                            Menjanjikan {depth(product.window_hours)} ke belakang, sementara rekaman yang
                            benar-benar bisa diputar baru sampai {depth(product.coverage_hours)}. Paket ini tetap
                            dijual dan halaman publik menyebut angka sebenarnya — peringatan ini hilang sendiri
                            begitu arsip cukup dalam.
                        </p>
                    )}
                </>
            ) : (
                <form onSubmit={submit} className="mt-4 space-y-3">
                    <Field
                        label="Nama paket"
                        value={draft.label ?? ''}
                        onChange={(e) => set({ label: e.target.value })}
                        required
                    />
                    <Field
                        label="Keterangan"
                        as="textarea"
                        rows={2}
                        value={draft.description ?? ''}
                        onChange={(e) => set({ description: e.target.value })}
                        hint="Kalimat yang dibaca calon pembeli di halaman publik."
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                            label="Harga (rupiah)"
                            type="number"
                            min={isTrial ? 0 : 1}
                            step={1}
                            value={isTrial ? 0 : (draft.price_rupiah ?? '')}
                            onChange={(e) => set({ price_rupiah: e.target.value })}
                            disabled={isTrial}
                            hint={isTrial
                                ? 'Paket coba gratis selalu 0 — alur trial memang tidak pernah menagih.'
                                : 'Bilangan bulat, tanpa titik. Paket berbayar tidak boleh 0.'}
                        />
                        <Field
                            label="Urutan tampil"
                            type="number"
                            step={1}
                            value={draft.sort_order ?? ''}
                            onChange={(e) => set({ sort_order: e.target.value })}
                            hint="Makin kecil, makin di atas."
                        />
                        <Field
                            label="Lihat ke belakang (jam)"
                            type="number"
                            min={1}
                            step={1}
                            value={draft.window_hours ?? ''}
                            onChange={(e) => set({ window_hours: e.target.value })}
                            hint={product.coverage_hours
                                ? `Sejauh apa pembeli boleh mundur. Rekaman yang tersedia sekarang: ${depth(product.coverage_hours)}.`
                                : 'Sejauh apa pembeli boleh mundur. 24 = sehari, 720 = 30 hari.'}
                        />
                        <Field
                            label="Masa berlaku (hari)"
                            type="number"
                            min={1}
                            step={1}
                            value={draft.validity_days ?? ''}
                            onChange={(e) => set({ validity_days: e.target.value })}
                            hint="Berapa lama tokennya hidup. Beda dari kedalaman di sebelah."
                        />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-content">
                        <input
                            type="checkbox"
                            checked={!!draft.enabled}
                            onChange={(e) => set({ enabled: e.target.checked })}
                            className="h-4 w-4 rounded border-edge text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        />
                        Dijual di halaman publik
                    </label>

                    <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-3">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                            Batal
                        </Button>
                        <Button type="submit" variant="primary" size="sm" loading={saving}>
                            Simpan
                        </Button>
                    </div>
                </form>
            )}
        </Card>
    );
}
