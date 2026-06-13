/*
 * Purpose: Customer-portal shell — brand header, saldo chip, Kamera/Saldo tabs, logout,
 *          session-expired redirect.
 * Caller: App.jsx customer routes (/my, /my/wallet).
 * Deps: React Router, authService, customerService, BrandingContext.
 * MainFuncs: CustomerLayout.
 * SideEffects: Reads current user, polls nothing; logout clears session and navigates.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import customerService from '../services/customerService';
import { useBranding } from '../contexts/BrandingContext';

export function formatRupiah(value) {
    return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

export default function CustomerLayout({ children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { branding } = useBranding() || {};
    const user = authService.getCurrentUser();
    const [summary, setSummary] = useState(null);

    const refreshSummary = useCallback(async () => {
        try {
            const response = await customerService.getSummary();
            if (response.success) {
                setSummary(response.data);
            }
        } catch {
            // Saldo chip is best-effort; pages surface their own errors.
        }
    }, []);

    useEffect(() => {
        refreshSummary();
    }, [refreshSummary, location.pathname]);

    useEffect(() => {
        const onSessionExpired = () => navigate('/admin/login');
        window.addEventListener('session-expired', onSessionExpired);
        return () => window.removeEventListener('session-expired', onSessionExpired);
    }, [navigate]);

    const handleLogout = async () => {
        await authService.logout();
        navigate('/admin/login');
    };

    const tabs = [
        { label: 'Kamera Saya', path: '/my' },
        { label: 'Paket', path: '/my/paket' },
        { label: 'Saldo & Tagihan', path: '/my/wallet' },
        { label: 'Akun', path: '/my/akun' },
    ];

    return (
        <div className="min-h-screen bg-gray-100 transition-colors dark:bg-gray-950">
            <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-lg font-bold text-gray-900 dark:text-white">
                            {branding?.company_name || 'RAF NET CCTV'}
                        </h1>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                            Portal Pelanggan{user?.username ? ` — ${user.username}` : ''}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {summary && (
                            <Link
                                to="/my/wallet"
                                className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${summary.low_balance
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                }`}
                            >
                                {formatRupiah(summary.balance)}
                            </Link>
                        )}
                        <button
                            onClick={handleLogout}
                            className="rounded-xl px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                            Keluar
                        </button>
                    </div>
                </div>
                <nav className="mx-auto flex max-w-5xl gap-1 px-4">
                    {tabs.map((tab) => (
                        <Link
                            key={tab.path}
                            to={tab.path}
                            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${location.pathname === tab.path
                                ? 'border-primary text-primary'
                                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                            }`}
                        >
                            {tab.label}
                        </Link>
                    ))}
                </nav>
            </header>
            <main className="mx-auto max-w-5xl px-4 py-6">
                {summary?.low_balance && location.pathname !== '/my/wallet' && (
                    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                        ⚠️ Saldo menipis (sisa ±{summary.estimated_days_left} hari).{' '}
                        <Link to="/my/wallet" className="font-semibold underline">Isi saldo sekarang</Link>{' '}
                        agar kamera tidak ditangguhkan.
                    </div>
                )}
                {children}
            </main>
        </div>
    );
}
