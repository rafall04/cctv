/*
 * Purpose: Searchable multi-select for the affiliate offer editor — which AREAS, or which CAMERAS,
 *          one barang appears under.
 * Caller: components/admin/affiliate/AffiliateOfferForm.jsx.
 * Deps: components/ui (inputClasses).
 * MainFuncs: AffiliateTargetPicker.
 * SideEffects: None. The search term is local; the selection belongs to the caller.
 *
 * WHY IT LIVES IN ITS OWN FILE
 * ---------------------------
 * Lifted verbatim out of AffiliateOfferForm.jsx when that form moved into ui/Modal. The form sat at
 * 793 lines against the 800-line ratchet, and this is the one block in it that owns no form state:
 * pure props in, one local useState for the search box, nothing reaching back into the form. So the
 * cut is mechanical rather than a redesign — the behaviour below is byte-for-byte what it was.
 *
 * The `min-w-0` on the label and the `truncate` on every option are load-bearing, not decoration:
 * an admin-overflow run found this picker pushing a 320px viewport to 689px, because a <fieldset>
 * keeps the UA default `min-inline-size: min-content` that Tailwind preflight never resets.
 */

import { useMemo, useState } from 'react';
import { inputClasses } from '../../ui';

/**
 * Searchable multi-select, same shape as the promo banner's picker. Cameras number in the
 * hundreds, so the list is filtered and capped — an unfiltered 750-row checkbox list is both
 * unusable and slow to render.
 */
export default function AffiliateTargetPicker({ label, options, selected, onChange, searchable }) {
    const [term, setTerm] = useState('');

    const visible = useMemo(() => {
        const needle = term.trim().toLowerCase();
        const matched = needle
            ? options.filter((option) => option.label.toLowerCase().includes(needle))
            : options;
        return matched.slice(0, 200);
    }, [options, term]);

    const toggle = (id) => {
        onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
    };

    return (
        <div className="rounded-card border border-edge bg-surface-sunken p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-semibold text-content-muted">{label}</span>
                <span role="status" className="shrink-0 font-mono text-xs tabular-nums text-content-subtle">{selected.length} dipilih</span>
            </div>

            {searchable && (
                <input
                    type="search"
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder="Cari nama…"
                    aria-label={`Cari ${label}`}
                    className={inputClasses({ className: 'mb-2' })}
                />
            )}

            <div className="max-h-56 space-y-1 overflow-y-auto">
                {visible.length === 0 && <p role="status" className="py-2 text-xs text-content-subtle">Tidak ada yang cocok.</p>}
                {visible.map((option) => (
                    <label
                        key={option.id}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-sm text-content-muted hover:bg-surface-raised"
                    >
                        <input
                            type="checkbox"
                            checked={selected.includes(option.id)}
                            onChange={() => toggle(option.id)}
                            className="h-4 w-4 shrink-0"
                        />
                        <span className="min-w-0 truncate">{option.label}</span>
                    </label>
                ))}
            </div>

            {options.length > visible.length && (
                <p className="mt-2 text-xs text-content-subtle">
                    Menampilkan {visible.length} dari {options.length}. Gunakan pencarian untuk mempersempit.
                </p>
            )}
        </div>
    );
}
