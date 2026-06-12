/*
 * Purpose: "Pembayaran" tab — top-up payment list with manual confirmation. Responsive:
 *          table on md+, cards on mobile.
 * Caller: BillingManagement.
 * Deps: billingAdminService, billingFormat helpers.
 */

import billingAdminService from '../../../services/billingAdminService';
import { formatRupiah, formatDateTime, StatusBadge, PAY_STATUS_BADGES, DesktopTable } from './billingFormat';

export default function PaymentsTab({ payments, run, busy }) {
    const confirmPaid = (payment) => {
        if (window.confirm(`Konfirmasi pembayaran ${formatRupiah(payment.amount)} dari ${payment.username}? Saldo akan dikreditkan.`)) {
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

    if (payments.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                Belum ada pembayaran.
            </div>
        );
    }

    return (
        <div>
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
                    {payments.map((payment) => (
                        <tr key={payment.id} className="bg-white dark:bg-gray-900">
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">#{payment.id}</td>
                            <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{payment.username || payment.user_id}</td>
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
                {payments.map((payment) => (
                    <div key={payment.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="truncate font-semibold text-gray-900 dark:text-white">{payment.username || payment.user_id}</p>
                                <p className="text-xs text-gray-400">#{payment.id} · {payment.gateway} · {formatDateTime(payment.created_at)}</p>
                            </div>
                            <StatusBadge className={PAY_STATUS_BADGES[payment.status] || ''}>{payment.status}</StatusBadge>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                            <p className="font-bold text-gray-900 dark:text-white">{formatRupiah(payment.amount)}</p>
                            <ConfirmBtn payment={payment} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
