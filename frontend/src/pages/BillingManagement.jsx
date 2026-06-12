/*
 * Purpose: Admin billing page shell — fetches billing data and renders responsive per-tab
 *          components (Persetujuan / Pelanggan / Langganan / Pembayaran / Paket / Gateway).
 *          Each data tab is a table on desktop and stacked cards on mobile.
 * Caller: App.jsx /admin/billing (adminOnly) inside AdminLayout (which already supplies page
 *         padding + bottom-dock spacing, so this page adds none horizontally).
 * Deps: billingAdminService, cameraService, per-tab components.
 * MainFuncs: BillingManagement.
 * SideEffects: Fetches billing data; mutations via billingAdminService through `run`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import billingAdminService from '../services/billingAdminService';
import { cameraService } from '../services/cameraService';
import { useNotification } from '../contexts/NotificationContext';
import BillingPlansTab from '../components/admin/BillingPlansTab';
import PaymentGatewayTab from '../components/admin/PaymentGatewayTab';
import RegistrationsTab from '../components/admin/billing/RegistrationsTab';
import CustomersTab from '../components/admin/billing/CustomersTab';
import SubscriptionsTab from '../components/admin/billing/SubscriptionsTab';
import PaymentsTab from '../components/admin/billing/PaymentsTab';

export default function BillingManagement() {
    const { success, error: showError } = useNotification();
    const [tab, setTab] = useState('customers');
    const [customers, setCustomers] = useState([]);
    const [subscriptions, setSubscriptions] = useState([]);
    const [payments, setPayments] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [plans, setPlans] = useState([]);
    const [regSettings, setRegSettings] = useState(null);
    const [registrations, setRegistrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [customersRes, subsRes, paymentsRes, camerasRes, plansRes, regRes, regsRes] = await Promise.all([
                billingAdminService.getCustomers(),
                billingAdminService.getSubscriptions(),
                billingAdminService.getPayments(),
                cameraService.getAllCameras(),
                billingAdminService.getPlans(),
                billingAdminService.getRegistrationSettings(),
                billingAdminService.getRegistrations(),
            ]);
            if (customersRes.success) setCustomers(customersRes.data || []);
            if (subsRes.success) setSubscriptions(subsRes.data || []);
            if (paymentsRes.success) setPayments(paymentsRes.data || []);
            if (camerasRes.success) setCameras(camerasRes.data || []);
            if (plansRes.success) setPlans(plansRes.data || []);
            if (regRes.success) setRegSettings(regRes.data || null);
            if (regsRes.success) setRegistrations(regsRes.data || []);
        } catch (err) {
            console.error('Load billing data error:', err);
            showError('Gagal memuat', 'Data billing tidak dapat dimuat.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        reload();
    }, [reload]);

    const run = useCallback(async (fn, successTitle) => {
        setBusy(true);
        try {
            const response = await fn();
            if (response.success) {
                success(successTitle, response.message || 'Berhasil');
                await reload();
                return true;
            }
            showError('Gagal', response.message || 'Operasi gagal');
            return false;
        } catch (err) {
            showError('Gagal', err.response?.data?.message || 'Operasi gagal');
            return false;
        } finally {
            setBusy(false);
        }
    }, [reload, success, showError]);

    const assignableCameras = useMemo(
        () => cameras.filter((camera) => (camera.camera_class || 'community') !== 'subscriber'
            || !subscriptions.some((s) => s.camera_id === camera.id && s.status !== 'cancelled')),
        [cameras, subscriptions]
    );

    const tabs = [
        { key: 'registrations', label: `Persetujuan${registrations.length ? ` (${registrations.length})` : ''}`, highlight: registrations.length > 0 },
        { key: 'customers', label: `Pelanggan (${customers.length})` },
        { key: 'subscriptions', label: `Langganan (${subscriptions.length})` },
        { key: 'payments', label: `Pembayaran (${payments.length})` },
        { key: 'plans', label: `Paket & Trial (${plans.length})` },
        { key: 'gateway', label: 'Gateway Pembayaran' },
    ];

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">Billing Pelanggan</h1>
                    <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                        Sewa CCTV prabayar — saldo dipotong harian, kamera ditangguhkan otomatis saat saldo habis.
                    </p>
                </div>
                <button
                    onClick={() => run(() => billingAdminService.runCharges(), 'Charge dijalankan')}
                    disabled={busy}
                    className="shrink-0 whitespace-nowrap rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                    Jalankan charge harian
                </button>
            </div>

            {/* Horizontally scrollable on small screens so all 6 tabs stay reachable without squishing. */}
            <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-gray-200 px-1 [scrollbar-width:none] dark:border-gray-800 [&::-webkit-scrollbar]:hidden">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`relative shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t.key
                            ? 'border-primary text-primary'
                            : `border-transparent hover:text-gray-800 dark:hover:text-gray-200 ${t.highlight ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`
                        }`}
                    >
                        {t.label}
                        {t.highlight && tab !== t.key && (
                            <span className="absolute right-0.5 top-1 h-2 w-2 rounded-full bg-amber-500" />
                        )}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat data billing…</div>
            ) : (
                <>
                    {tab === 'registrations' && <RegistrationsTab registrations={registrations} run={run} busy={busy} />}
                    {tab === 'customers' && <CustomersTab customers={customers} plans={plans} run={run} busy={busy} />}
                    {tab === 'subscriptions' && (
                        <SubscriptionsTab subscriptions={subscriptions} assignableCameras={assignableCameras} customers={customers} run={run} busy={busy} />
                    )}
                    {tab === 'payments' && <PaymentsTab payments={payments} run={run} busy={busy} />}
                    {tab === 'plans' && <BillingPlansTab plans={plans} regSettings={regSettings} run={run} busy={busy} />}
                    {tab === 'gateway' && <PaymentGatewayTab />}
                </>
            )}
        </div>
    );
}
