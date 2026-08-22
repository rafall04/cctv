/*
 * Purpose: Shared formatting + badge helpers for the admin Billing Pelanggan tabs so every tab
 *          (table on desktop, cards on mobile) renders money/status/dates identically.
 * Caller: BillingManagement + components/admin/billing/* tabs.
 * MainFuncs: formatRupiah, formatDateTime, StatusBadge, SUB_STATUS_BADGES, PAY_STATUS_BADGES.
 * SideEffects: None (pure presentational helpers).
 */

import { parseBackendDateInput, TIMESTAMP_STORAGE } from '../../../contexts/TimezoneContext';

export function formatRupiah(value) {
    return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

/*
 * Backend timestamps are SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS" in UTC, with no zone
 * marker. This used to slice the string and print it as-is, so every payment and registration date
 * in the billing tabs was shown 7 hours behind WIB — a money surface reading the wrong clock.
 * Parse as UTC, then render in the operator's timezone.
 */
export function formatDateTime(raw, timezone = 'Asia/Jakarta') {
    if (!raw) return '—';
    const date = parseBackendDateInput(String(raw), { storage: TIMESTAMP_STORAGE.UTC_SQL });
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return String(raw).replace('T', ' ').slice(0, 16);
    }
    return date.toLocaleString('id-ID', {
        timeZone: timezone,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export const SUB_STATUS_BADGES = {
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    cancelled: 'bg-surface-sunken text-content-muted',
};

export const PAY_STATUS_BADGES = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    expired: 'bg-surface-sunken text-content-muted',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    cancelled: 'bg-surface-sunken text-content-muted',
};

export function StatusBadge({ className = '', children }) {
    return (
        <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
            {children}
        </span>
    );
}

/*
 * cardClass / inputClass / DesktopTable used to live here — a private mini design system that
 * duplicated components/ui Card, Field.inputClasses and TableShell, and was re-declared verbatim in
 * three more files. They are gone; import the real primitives instead. cardClass also used
 * rounded-2xl, so every billing panel had a different corner radius from the rest of admin.
 */
