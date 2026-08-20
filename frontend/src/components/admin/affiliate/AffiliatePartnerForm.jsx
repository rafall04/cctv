/*
 * Purpose: Editor for one affiliate MITRA — the shop and the commercial deal behind it
 *          (store name, store link, internal note, lifetime-vs-term contract, price, active).
 * Caller: pages/AffiliateManagement.jsx.
 * Deps: components/ui (Field, Button, inputClasses), NotificationContext.
 * MainFuncs: AffiliatePartnerForm.
 * SideEffects: None of its own — it hands a plain payload to the caller's onSubmit.
 *
 * THREE THINGS HERE ARE DELIBERATE AND MUST NOT BE "TIDIED UP"
 * -----------------------------------------------------------
 * 1. Rp0 IS A VALID PRICE. The operator runs their own shop's promo through the same machinery
 *    for free, so there is no "a paid deal cannot be zero" rule anywhere in this form — the field
 *    even says so in its helper line. (Money is INTEGER rupiah: the input carries thousand
 *    separators for the human, and submits a bare integer.)
 * 2. "Selamanya" HIDES AND CLEARS the end date. Storing the mode instead of inferring it from a
 *    NULL end_date is what keeps "this deal never expires" distinguishable from "somebody forgot
 *    to fill the end date in" — and a stale end_date left behind a hidden field would silently
 *    expire a lifetime partner.
 *    "Mulai" stays visible in BOTH modes on purpose: a start date that is hidden but still
 *    submitted is exactly how an offer disappears for a week with nothing on screen to explain it.
 * 3. The https check is `describeOutboundUrlProblem` from the shared client — `new URL()`, not a
 *    `^https://` prefix test. The backend (utils/outboundUrlPolicy.js) is the authority and
 *    re-validates; this only gets the operator the message before a round trip.
 */

import { useEffect, useMemo, useState } from 'react';
import { Field, Button, inputClasses } from '../../ui';
import { describeOutboundUrlProblem } from '../../../services/affiliateAdminService';
import { useNotification } from '../../../contexts/NotificationContext';

const EMPTY = {
    store_name: '',
    store_url: '',
    contact_note: '',
    billing_mode: 'term',
    price_rupiah: 0,
    start_date: '',
    end_date: '',
    active: true,
};

const BILLING_OPTIONS = [
    {
        key: 'lifetime',
        label: 'Selamanya (lifetime)',
        hint: 'Sekali bayar, tidak pernah kedaluwarsa sendiri.',
    },
    {
        key: 'term',
        label: 'Berjangka',
        hint: 'Berhenti tayang otomatis di tanggal berakhir.',
    },
];

/** Digits only — the display grouping is cosmetic, the payload is a plain integer. */
function digitsOf(value) {
    return String(value ?? '').replace(/\D+/g, '');
}

function groupDigits(digits) {
    if (!digits) {
        return '';
    }
    return Number.parseInt(digits, 10).toLocaleString('id-ID');
}

export default function AffiliatePartnerForm({ partner, saving, onSubmit, onCancel }) {
    const [form, setForm] = useState(EMPTY);
    // Held as a digit string so the caret does not jump while the operator types into a
    // separator-formatted field.
    const [priceDigits, setPriceDigits] = useState('0');
    const { showNotification } = useNotification();

    useEffect(() => {
        if (!partner) {
            setForm(EMPTY);
            setPriceDigits('0');
            return;
        }
        setForm({
            ...EMPTY,
            ...partner,
            store_url: partner.store_url || '',
            contact_note: partner.contact_note || '',
            billing_mode: partner.billing_mode === 'lifetime' ? 'lifetime' : 'term',
            start_date: partner.start_date || '',
            end_date: partner.end_date || '',
            active: Boolean(partner.active),
        });
        setPriceDigits(digitsOf(partner.price_rupiah ?? 0) || '0');
    }, [partner]);

    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

    const urlProblem = useMemo(() => describeOutboundUrlProblem(form.store_url), [form.store_url]);

    const chooseBillingMode = (mode) => {
        setForm((current) => ({
            ...current,
            billing_mode: mode,
            // Clearing here, not at submit time, so the operator SEES the end date go away when
            // they pick "Selamanya" instead of discovering it later in the list.
            end_date: mode === 'lifetime' ? '' : current.end_date,
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!form.store_name.trim()) {
            showNotification({ type: 'warning', title: 'Nama toko kosong', message: 'Isi nama tokonya dulu.' });
            return;
        }
        if (urlProblem) {
            showNotification({ type: 'warning', title: 'Link toko ditolak', message: urlProblem });
            return;
        }
        if (form.billing_mode === 'term' && form.start_date && form.end_date && form.end_date < form.start_date) {
            showNotification({
                type: 'warning',
                title: 'Tanggal terbalik',
                message: 'Tanggal berakhir lebih awal dari tanggal mulai — barang mitra ini tidak akan pernah tayang.',
            });
            return;
        }

        await onSubmit({
            store_name: form.store_name.trim(),
            store_url: form.store_url.trim() || null,
            contact_note: form.contact_note.trim() || null,
            billing_mode: form.billing_mode,
            // Rp0 is legitimate; `|| 0` here only covers an empty field, it never rejects a zero.
            price_rupiah: Number.parseInt(priceDigits || '0', 10) || 0,
            start_date: form.start_date || null,
            end_date: form.billing_mode === 'lifetime' ? null : (form.end_date || null),
            active: Boolean(form.active),
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <Field
                label="Nama toko"
                required
                value={form.store_name}
                onChange={(event) => set('store_name', event.target.value)}
                placeholder="Toko Bangun Jaya"
                hint="Nama ini tampil ke pengunjung di bawah video."
            />

            <Field
                label="Link toko (opsional)"
                type="url"
                inputMode="url"
                value={form.store_url}
                onChange={(event) => set('store_url', event.target.value)}
                placeholder="https://tokoku.example.com"
                error={urlProblem || undefined}
                hint="Wajib https. Kosongkan kalau mitra belum punya etalase online — tombol 'Kunjungi toko' otomatis tidak ditampilkan."
            />

            <Field
                as="textarea"
                rows={2}
                label="Catatan internal"
                value={form.contact_note}
                onChange={(event) => set('contact_note', event.target.value)}
                placeholder="Kontak Pak Budi 0812…, bayar tiap tanggal 5"
                hint="Hanya untuk Anda. Tidak pernah dikirim ke halaman publik."
            />

            {/* -------------------------------------------------------- kerjasama */}
            <fieldset className="space-y-3">
                <legend className="text-xs font-semibold text-content-muted">Jenis kerjasama</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                    {BILLING_OPTIONS.map((option) => (
                        <label
                            key={option.key}
                            className="flex min-h-[40px] cursor-pointer items-start gap-2 rounded-card border border-edge bg-surface p-3 text-sm hover:border-edge-strong sm:min-h-0"
                        >
                            <input
                                type="radio"
                                name="billing_mode"
                                checked={form.billing_mode === option.key}
                                onChange={() => chooseBillingMode(option.key)}
                                className="mt-0.5 h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0">
                                <span className="block text-content">{option.label}</span>
                                <span className="block text-xs text-content-subtle">{option.hint}</span>
                            </span>
                        </label>
                    ))}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                        label="Mulai"
                        type="date"
                        value={form.start_date}
                        onChange={(event) => set('start_date', event.target.value)}
                        hint="Kosong = langsung tayang."
                    />
                    {form.billing_mode === 'term' && (
                        <Field
                            label="Berakhir"
                            type="date"
                            value={form.end_date}
                            onChange={(event) => set('end_date', event.target.value)}
                            hint="Lewat tanggal ini, barang mitra berhenti tampil."
                        />
                    )}
                </div>
            </fieldset>

            {/* ------------------------------------------------------------ harga */}
            <div>
                {/*
                  * Hand-rolled instead of <Field> because of the "Rp" adornment: the value in the
                  * box is a GROUPED string for the human ("1.500.000") while the payload stays an
                  * integer. The label/hint wiring below mirrors what Field does, so the control is
                  * still named and described for a screen reader.
                  */}
                <label htmlFor="affiliate-partner-price" className="mb-1.5 block text-xs font-semibold text-content-muted">
                    Harga kerjasama
                </label>
                <div className="flex items-stretch gap-2">
                    <span aria-hidden="true" className="flex min-h-11 shrink-0 items-center rounded-control border border-edge bg-surface-sunken px-3 text-sm font-medium text-content-muted">
                        Rp
                    </span>
                    <input
                        id="affiliate-partner-price"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={groupDigits(priceDigits)}
                        onChange={(event) => setPriceDigits(digitsOf(event.target.value))}
                        onBlur={() => setPriceDigits((current) => current || '0')}
                        placeholder="0"
                        aria-describedby="affiliate-partner-price-hint"
                        className={inputClasses({ className: 'font-mono tabular-nums' })}
                    />
                </div>
                <p id="affiliate-partner-price-hint" className="mt-1 text-xs text-content-subtle">
                    Isi 0 untuk promo toko sendiri (gratis). Angka bulat rupiah, tanpa koma.
                </p>
            </div>

            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-content sm:min-h-0">
                <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => set('active', event.target.checked)}
                    className="h-4 w-4 shrink-0"
                />
                <span className="min-w-0">Aktif</span>
            </label>
            <p className="-mt-3 text-xs text-content-subtle">
                Mematikan mitra langsung menghentikan semua barangnya, termasuk link keluar yang
                sudah tersebar — link itu dicek ulang setiap kali diklik.
            </p>

            <div className="flex flex-wrap gap-2 border-t border-edge pt-4">
                <Button type="submit" variant="primary" loading={saving}>
                    {saving ? 'Menyimpan…' : 'Simpan mitra'}
                </Button>
                <Button type="button" onClick={onCancel}>Batal</Button>
            </div>
        </form>
    );
}
