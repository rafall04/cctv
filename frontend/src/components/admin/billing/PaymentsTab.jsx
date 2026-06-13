/*
 * Purpose: "Pembayaran" tab — top-up payment list with manual confirmation, a status filter,
 *          and the gateway failure reason for failed top-ups (so an admin can see WHY a
 *          customer's payment failed, e.g. "Suspicious buyer"). Responsive: table on md+,
 *          cards on mobile.
 * Caller: BillingManagement.
 * Deps: billingAdminService, billingFormat helpers.
 */

import { useMemo, useState } from 'react';
import billingAdminService from '../../../services/billingAdminService';
import { formatRupiah, formatDateTime, StatusBadge, PAY_STATUS_BADGES, DesktopTable } from './billingFormat';
import { useConfirm } from '../../../contexts/ConfirmContext';

const FILTERS = [
    { key: 'all', label: 'Semua' },
    { key: 'pending', label: 'Menunggu' },
    { key: 'paid', label: 'Berhasil' },
    { key: 'failed', label: 'Gagal' },
    { key: 'expired', label: 'Kedaluwarsa' },
];

export default function PaymentsTab({ payments, run, busy }) {
    const [filter, setFilter] = useState('all');
    const confirm = useConfirm();

    const counts = useMemo(() => {
        const c = {};
        for (const p of payments) c[p.status] = (c[p.status] || 0) + 1;
        return c;
    }, [payments]);

    const filtered = useMemo(
        () => (filter === 'all' ? payments : payments.filter((p) => p.status === filter)),
        [payments, filter]
    );

    const confirmPaid = async (payment) => {
        if (await confirm({ title: 'Konfirmasi pembayaran?', message: `${formatRupiah(payment.amount)} dari ${payment.username} — saldo akan dikreditkan.`, confirmLabel: 'Konfirmasi' })) {
            run(() => billingAdminService.markPaymentPaid(payment.id), 'Pembayaran dikonfirmasi');
        }
    };

    const ConfirmBtn = ({ payment, full }) => payment.status !== 'pending' ? null : (
        <button
            onClick={() => confirmPaid(payment)}
            disabled={busy}
            className={`whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 ${full ? 'w-full' : ''}`}
        >
            Konfirmasi Bayar
        </button>
    );

    const FilterBar = (
        <div className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
                const n = f.key === 'all' ? payments.length : (counts[f.key] || 0);
                const active = filter === f.key;
                return (
                    <button
                        key={f.key}
                        onClick={() => setFilter(f.key)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${active
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                    >
                        {f.label}{n ? ` (${n})` : ''}
                    </button>
                );
            })}
        </div>
    );

    if (payments.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                Belum ada pembayaran.
            </div>
        );
    }

    return (
        <div>
            {FilterBar}

            {filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    Tidak ada pembayaran berstatus ini.
                </div>
            ) : (
            <>
            {/* Desktop: table */}
            <DesktopTable minWidth="min-w-[680px]">
                <thead>
                    <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">Pelanggan</th>
                        <th className="px-3 py-2">Gateway</th>
                        <th className="px-3 py-2 text-right">Nominal</th>
                        <th className="px-3 py-2 text-center">Status</th>
                        <th className="px-3 py-2">Dibuat</th>
                        <th className="px-3 py-2 text-right">Aksi</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filtered.map((payment) => (
                        <tr key={payment.id} className="bg-white dark:bg-gray-900">
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">#{payment.id}</td>
                            <td className="px-3 py-2">
                                <span className="font-medium text-gray-900 dark:text-white">{payment.username || payment.user_id}</span>
                                {payment.failure_reason && (
                                    <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-red-500" title={payment.failure_reason}>
                                        ⚠ {payment.failure_reason}
                                    </p>
                                )}
                            </td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{payment.gateway}</td>
                            <td className="px-3 py-2 text-right font-semibold">{formatRupiah(payment.amount)}</td>
                            <td className="px-3 py-2 text-center"><StatusBadge className={PAY_STATUS_BADGES[payment.status] || ''}>{payment.status}</StatusBadge></td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">{formatDateTime(payment.created_at)}</td>
                            <td className="px-3 py-2 text-right"><ConfirmBtn payment={payment} /></td>
                        </tr>
                    ))}
                </tbody>
            </DesktopTable>

            {/* Mobile: cards */}
            <div className="space-y-3 md:hidden">
                {filtered.map((payment) => (
                    <div key={payment.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="truncate font-semibold text-gray-900 dark:text-white">{payment.username || payment.user_id}</p>
                                <p className="text-xs text-gray-400">#{payment.id} · {payment.gateway} · {formatDateTime(payment.created_at)}</p>
                            </div>
                            <StatusBadge className={PAY_STATUS_BADGES[payment.status] || ''}>{payment.status}</StatusBadge>
                        </div>
                        {payment.failure_reason && (
                            <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                ⚠ {payment.failure_reason}
                            </p>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-2">
                            <p className="font-bold text-gray-900 dark:text-white">{formatRupiah(payment.amount)}</p>
                            <ConfirmBtn payment={payment} full={false} />
                        </div>
                    </div>
                ))}
            </div>
            </>
            )}
        </div>
    );
}
