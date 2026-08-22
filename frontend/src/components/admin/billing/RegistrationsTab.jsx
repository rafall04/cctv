/*
 * Purpose: "Persetujuan" tab — pending self-registrations with approve/reject. Responsive:
 *          table on md+, stacked cards on mobile.
 * Caller: BillingManagement.
 * Deps: billingAdminService, billingFormat helpers.
 */

import billingAdminService from '../../../services/billingAdminService';
import { DesktopTable, formatDateTime } from './billingFormat';
import { useConfirm } from '../../../contexts/ConfirmContext';

function PlanTag({ reg }) {
    if (!reg.plan_name) return <span className="text-content-subtle">—</span>;
    return (
        <span>
            {reg.plan_name}
            {reg.plan_is_trial === 1 && reg.plan_trial_days ? (
                <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">trial {reg.plan_trial_days} hari</span>
            ) : null}
        </span>
    );
}


// Module level: defined inside the tab this was a new component type per render, so every
// row's action pair remounted on each `busy`/filter change.
function ActionButtons({ reg, full, busy, onApprove, onReject }) {
    return (
        <div className={`flex gap-1 ${full ? 'w-full' : 'justify-end'}`}>
            <button
                type="button"
                onClick={() => onApprove(reg)}
                disabled={busy}
                className={`whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 ${full ? 'flex-1' : ''}`}
            >
                Setujui
            </button>
            <button
                type="button"
                onClick={() => onReject(reg)}
                disabled={busy}
                className={`whitespace-nowrap rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-900/30 ${full ? 'flex-1' : ''}`}
            >
                Tolak
            </button>
        </div>
    );
}

export default function RegistrationsTab({ registrations, run, busy }) {
    const confirm = useConfirm();
    const approve = (reg) => run(() => billingAdminService.approveRegistration(reg.id), 'Pendaftaran disetujui');
    const reject = async (reg) => {
        if (await confirm({ title: `Tolak pendaftaran ${reg.username}?`, message: 'Akun tidak akan bisa login.', confirmLabel: 'Tolak', tone: 'danger' })) {
            run(() => billingAdminService.rejectRegistration(reg.id), 'Pendaftaran ditolak');
        }
    };

    return (
        <div>
            <p className="mb-3 text-sm text-content-muted">
                Pendaftar baru lewat halaman <code>/daftar</code> menunggu persetujuan. Mereka belum bisa login sampai disetujui; masa trial baru mulai saat disetujui.
            </p>

            {registrations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-edge px-4 py-12 text-center text-sm text-content-muted">
                    Tidak ada pendaftaran yang menunggu persetujuan. 🎉
                </div>
            ) : (
                <>
                    {/* Desktop: table */}
                    <DesktopTable minWidth="min-w-[560px]">
                        <thead>
                            <tr className="text-left text-xs uppercase text-content-muted">
                                <th className="px-3 py-2">Calon Pelanggan</th>
                                <th className="px-3 py-2">Kontak</th>
                                <th className="px-3 py-2">Paket Dipilih</th>
                                <th className="px-3 py-2">Daftar</th>
                                <th className="px-3 py-2 text-right">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-edge">
                            {registrations.map((reg) => (
                                <tr key={reg.id} className="bg-surface">
                                    <td className="px-3 py-2 font-medium text-content">{reg.username}</td>
                                    <td className="px-3 py-2 text-content-muted">{reg.phone || reg.email || '—'}</td>
                                    <td className="px-3 py-2 text-content-muted"><PlanTag reg={reg} /></td>
                                    <td className="px-3 py-2 text-content-muted">{formatDateTime(reg.created_at)}</td>
                                    <td className="px-3 py-2"><ActionButtons reg={reg} busy={busy} onApprove={approve} onReject={reject} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </DesktopTable>

                    {/* Mobile: cards */}
                    <div className="space-y-3 md:hidden">
                        {registrations.map((reg) => (
                            <div key={reg.id} className="rounded-2xl border border-edge bg-surface p-4">
                                <p className="break-words font-semibold text-content">{reg.username}</p>
                                <p className="mt-0.5 break-words text-sm text-content-muted">{reg.phone || reg.email || '—'}</p>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-content-muted">
                                    <PlanTag reg={reg} />
                                    <span className="text-xs text-content-subtle">{formatDateTime(reg.created_at)}</span>
                                </div>
                                <div className="mt-3"><ActionButtons reg={reg} full busy={busy} onApprove={approve} onReject={reject} /></div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
