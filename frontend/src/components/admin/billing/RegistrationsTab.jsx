/*
 * Purpose: "Persetujuan" tab — pending self-registrations with approve/reject. Responsive:
 *          table on md+, stacked cards on mobile.
 * Caller: BillingManagement.
 * Deps: billingAdminService, billingFormat helpers.
 */

import billingAdminService from '../../../services/billingAdminService';
import { DesktopTable, formatDateTime } from './billingFormat';

function PlanTag({ reg }) {
    if (!reg.plan_name) return <span className="text-gray-400">—</span>;
    return (
        <span>
            {reg.plan_name}
            {reg.plan_is_trial === 1 && reg.plan_trial_days ? (
                <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">trial {reg.plan_trial_days} hari</span>
            ) : null}
        </span>
    );
}

export default function RegistrationsTab({ registrations, run, busy }) {
    const approve = (reg) => run(() => billingAdminService.approveRegistration(reg.id), 'Pendaftaran disetujui');
    const reject = (reg) => {
        if (window.confirm(`Tolak pendaftaran ${reg.username}? Akun tidak akan bisa login.`)) {
            run(() => billingAdminService.rejectRegistration(reg.id), 'Pendaftaran ditolak');
        }
    };

    const ActionButtons = ({ reg, full }) => (
        <div className={`flex gap-1 ${full ? 'w-full' : 'justify-end'}`}>
            <button
                onClick={() => approve(reg)}
                disabled={busy}
                className={`whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 ${full ? 'flex-1' : ''}`}
            >
                Setujui
            </button>
            <button
                onClick={() => reject(reg)}
                disabled={busy}
                className={`whitespace-nowrap rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-900/30 ${full ? 'flex-1' : ''}`}
            >
                Tolak
            </button>
        </div>
    );

    return (
        <div>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                Pendaftar baru lewat halaman <code>/daftar</code> menunggu persetujuan. Mereka belum bisa login sampai disetujui; masa trial baru mulai saat disetujui.
            </p>

            {registrations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    Tidak ada pendaftaran yang menunggu persetujuan. 🎉
                </div>
            ) : (
                <>
                    {/* Desktop: table */}
                    <DesktopTable minWidth="min-w-[560px]">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                                <th className="px-3 py-2">Calon Pelanggan</th>
                                <th className="px-3 py-2">Kontak</th>
                                <th className="px-3 py-2">Paket Dipilih</th>
                                <th className="px-3 py-2">Daftar</th>
                                <th className="px-3 py-2 text-right">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {registrations.map((reg) => (
                                <tr key={reg.id} className="bg-white dark:bg-gray-900">
                                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{reg.username}</td>
                                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{reg.phone || reg.email || '—'}</td>
                                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300"><PlanTag reg={reg} /></td>
                                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{formatDateTime(reg.created_at)}</td>
                                    <td className="px-3 py-2"><ActionButtons reg={reg} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </DesktopTable>

                    {/* Mobile: cards */}
                    <div className="space-y-3 md:hidden">
                        {registrations.map((reg) => (
                            <div key={reg.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                                <p className="font-semibold text-gray-900 dark:text-white">{reg.username}</p>
                                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{reg.phone || reg.email || '—'}</p>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-300">
                                    <PlanTag reg={reg} />
                                    <span className="text-xs text-gray-400">{formatDateTime(reg.created_at)}</span>
                                </div>
                                <div className="mt-3"><ActionButtons reg={reg} full /></div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
