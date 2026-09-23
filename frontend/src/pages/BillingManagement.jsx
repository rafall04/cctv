/*
 * Purpose: Admin billing page shell — fetches billing data and renders responsive per-tab
 *          components (Persetujuan / Pelanggan / Langganan / Pembayaran / Paket / Gateway).
 *          Each data tab is a table on desktop and stacked cards on mobile.
 * Caller: App.jsx /admin/billing (adminOnly) inside AdminLayout (which already supplies page
 *         padding + bottom-dock spacing, so this page adds none horizontally).
 * Deps: billingAdminService, cameraService, components/ui (PageHeader/Button/Tabs/TabPanel), per-tab components.
 * MainFuncs: BillingManagement.
 * SideEffects: Fetches billing data; mutations via billingAdminService through `run`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, PageHeader, Tabs, TabPanel } from '../components/ui';
import billingAdminService from '../services/billingAdminService';
import { cameraService } from '../services/cameraService';
import { useNotification } from '../contexts/NotificationContext';
import BillingPlansTab from '../components/admin/BillingPlansTab';
import PaymentGatewayTab from '../components/admin/PaymentGatewayTab';
import PromoTab from '../components/admin/PromoTab';
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
    // A failed load must not render the tabs with empty arrays — "Pembayaran (0)" and
    // "Belum ada pembayaran" would claim there is no data when the fetch simply failed.
    const [loadError, setLoadError] = useState(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
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
            const failed = [];
            if (customersRes.success) setCustomers(customersRes.data || []); else failed.push('pelanggan');
            if (subsRes.success) setSubscriptions(subsRes.data || []); else failed.push('langganan');
            if (paymentsRes.success) setPayments(paymentsRes.data || []); else failed.push('pembayaran');
            if (camerasRes.success) setCameras(camerasRes.data || []); else failed.push('kamera');
            if (plansRes.success) setPlans(plansRes.data || []); else failed.push('paket');
            if (regRes.success) setRegSettings(regRes.data || null); else failed.push('pengaturan persetujuan');
            if (regsRes.success) setRegistrations(regsRes.data || []); else failed.push('persetujuan');
            // Any failed slice would otherwise render as a fabricated empty list/count.
            if (failed.length) setLoadError(`Sebagian data gagal dimuat: ${failed.join(', ')}.`);
        } catch (err) {
            console.error('Load billing data error:', err);
            setLoadError('Data billing tidak dapat dimuat.');
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

    // The "ada persetujuan menunggu" dot rides in the Tabs `badge` slot instead of being absolutely
    // positioned in the button's corner: the primitive's tab is already a flex row, so an inline dot
    // needs no `relative` parent. That is a data-shape change, not a change to the shared component.
    // It also carries an sr-only word — the amber dot used to be colour-only, so a screen reader was
    // told nothing at all about pending approvals.
    const pendingBadge = registrations.length > 0 && tab !== 'registrations' ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-status-warn">
            <span className="sr-only">perlu ditinjau</span>
        </span>
    ) : null;

    const tabs = [
        { id: 'registrations', label: `Persetujuan${registrations.length ? ` (${registrations.length})` : ''}`, badge: pendingBadge },
        { id: 'customers', label: `Pelanggan (${customers.length})` },
        { id: 'subscriptions', label: `Langganan (${subscriptions.length})` },
        { id: 'payments', label: `Pembayaran (${payments.length})` },
        { id: 'plans', label: `Paket & Trial (${plans.length})` },
        { id: 'promos', label: 'Promo' },
        { id: 'gateway', label: 'Gateway Pembayaran' },
    ];

    return (
        <div className="space-y-5">
            {/* This page had already hand-rolled `text-xl sm:text-2xl` — the exact pair PageHeader
                settled on — so adopting the primitive is a pixel-identical title and one less copy
                of the header layout to keep in step. */}
            <PageHeader
                title="Billing Pelanggan"
                description="Sewa CCTV prabayar — saldo dipotong harian, kamera ditangguhkan otomatis saat saldo habis."
                actions={(
                    <Button
                        onClick={() => run(() => billingAdminService.runCharges(), 'Charge dijalankan')}
                        disabled={busy}
                    >
                        Jalankan charge harian
                    </Button>
                )}
            />

            {/* Shared primitive: role=tablist/tab + aria-selected + roving tabindex + Arrow/Home/End,
                44px targets, and it still scrolls horizontally so all seven stay reachable on a phone. */}
            <Tabs tabs={tabs} activeId={tab} onChange={setTab} idPrefix="billing" />

            {/* One panel, keyed by the active tab, so aria-controls always resolves — including while
                the data is still loading. */}
            <TabPanel id={tab} idPrefix="billing">
                {loading ? (
                    <div className="py-16 text-center text-content-muted">Memuat data billing…</div>
                ) : loadError ? (
                    <div className="py-16 text-center">
                        <p className="text-sm text-status-fault">{loadError}</p>
                        <button type="button" onClick={reload} className="mt-3 rounded-xl border border-edge-strong px-4 py-2 text-sm text-content-muted hover:bg-surface-sunken">
                            Coba lagi
                        </button>
                    </div>
                ) : (
                    <>
                        {tab === 'registrations' && <RegistrationsTab registrations={registrations} run={run} busy={busy} />}
                        {tab === 'customers' && <CustomersTab customers={customers} plans={plans} run={run} busy={busy} />}
                        {tab === 'subscriptions' && (
                            <SubscriptionsTab subscriptions={subscriptions} assignableCameras={assignableCameras} customers={customers} run={run} busy={busy} />
                        )}
                        {tab === 'payments' && <PaymentsTab payments={payments} run={run} busy={busy} />}
                        {tab === 'plans' && <BillingPlansTab plans={plans} regSettings={regSettings} run={run} busy={busy} />}
                        {tab === 'promos' && <PromoTab />}
                        {tab === 'gateway' && <PaymentGatewayTab />}
                    </>
                )}
            </TabPanel>
        </div>
    );
}
