/*
 * Purpose: Shared formatting + badge helpers for the admin Billing Pelanggan tabs so every tab
 *          (table on desktop, cards on mobile) renders money/status/dates identically.
 * Caller: BillingManagement + components/admin/billing/* tabs.
 * MainFuncs: formatRupiah, formatDateTime, StatusBadge, SUB_STATUS_BADGES, PAY_STATUS_BADGES.
 * SideEffects: None (pure presentational helpers).
 */

export function formatRupiah(value) {
    return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

// Backend timestamps are "YYYY-MM-DD HH:MM:SS" — show date + HH:MM, drop seconds.
export function formatDateTime(raw) {
    if (!raw) return '—';
    return String(raw).replace('T', ' ').slice(0, 16);
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

export const cardClass = 'bg-surface border border-edge rounded-2xl p-4';
export const inputClass = 'w-full px-3 py-2 bg-surface-sunken border border-edge rounded-xl text-sm text-content focus:outline-none focus:ring-2 focus:ring-primary';

// Wrapper for the desktop table half of each tab: horizontal scroll is a safety net for
// tablet widths; `min-w` on the inner <table> is what actually lets it scroll instead of
// crushing the columns. Mobile uses cards instead (see each tab's md:hidden block).
export function DesktopTable({ children, minWidth = 'min-w-[640px]' }) {
    return (
        <div className="hidden overflow-x-auto md:block">
            <table className={`w-full ${minWidth} text-sm`}>{children}</table>
        </div>
    );
}
