/*
 * Purpose: Render authenticated admin shell — grouped navigation, nav search, admin mobile dock,
 *   theme toggle, and account controls.
 * Caller: App.jsx AdminPageRoute.
 * Deps: React Router, authService, theme/notification/branding contexts, NetworkStatusBanner,
 *   layouts/adminNavigation.
 * MainFuncs: AdminLayout, AdminMobileDock.
 * SideEffects: Reads current user, listens for session/network changes, hides mobile dock while
 *   sidebar is open, performs logout navigation.
 *
 * Navigation model (labels, grouping, icons) lives in ./adminNavigation.jsx.
 */

import { useState, useEffect, useCallback, useMemo, useId, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { useTheme } from '../contexts/ThemeContext';
import { useNotification } from '../contexts/NotificationContext';
import { NetworkStatusBanner } from '../components/ui/NetworkStatusBanner';
import { useBranding } from '../contexts/BrandingContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { AdminIcons, DOCK_ACTIONS, filterNavGroups } from './adminNavigation';

function AdminMobileDock({ activePath, isAdmin }) {
    return (
        <nav
            data-testid="admin-pwa-quick-actions"
            className="fixed inset-x-3 bottom-3 z-dock rounded-card border border-edge bg-surface-overlay px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-e2 lg:hidden"
            aria-label="Navigasi cepat admin"
        >
            <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
                {DOCK_ACTIONS(isAdmin).map((action) => {
                    const active = action.path === activePath;
                    const Icon = action.icon;
                    return (
                        <Link
                            key={action.path}
                            to={action.path}
                            aria-current={active ? 'page' : undefined}
                            className={`flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-control px-1.5 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                                active ? 'bg-primary text-white' : 'text-content-muted hover:bg-surface-raised hover:text-content'
                            }`}
                        >
                            <Icon />
                            <span className="max-w-full truncate">{action.label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}

export default function AdminLayout({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { isDark, toggleTheme } = useTheme();
    const { success: showSuccess } = useNotification();
    const { branding } = useBranding();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [user, setUser] = useState(null);
    const [isOffline, setIsOffline] = useState(false);
    const [navQuery, setNavQuery] = useState('');
    const navSearchId = useId();

    useEffect(() => {
        const currentUser = authService.getCurrentUser();
        setUser(currentUser);

        const handleSessionExpired = () => {
            navigate('/admin/login?expired=true', { replace: true });
        };

        window.addEventListener('session-expired', handleSessionExpired);
        return () => {
            window.removeEventListener('session-expired', handleSessionExpired);
        };
    }, [navigate]);

    const handleOnline = useCallback(() => {
        setIsOffline(false);
        showSuccess('Connection Restored', 'You are back online. Data will refresh automatically.');
        window.dispatchEvent(new CustomEvent('network-reconnected'));
    }, [showSuccess]);

    const handleOffline = useCallback(() => {
        setIsOffline(true);
    }, []);

    const handleLogout = async () => {
        await authService.logout();
        navigate('/admin/login');
    };

    const isAdmin = user?.role === 'admin';
    const navGroups = useMemo(() => filterNavGroups(isAdmin, navQuery), [isAdmin, navQuery]);
    const isActive = (path) => location.pathname === path;

    const closeMobileMenu = useCallback(() => setIsMobileMenuOpen(false), []);

    // The drawer is an overlay on mobile: trap Tab inside it and close on Escape so keyboard
    // focus cannot fall through to the page behind the scrim. On lg the sidebar is permanent
    // (isMobileMenuOpen stays false), so the trap never engages there.
    const drawerRef = useRef(null);
    useFocusTrap(drawerRef, { active: isMobileMenuOpen, onEscape: closeMobileMenu });

    return (
        <div className="min-h-screen bg-surface-sunken transition-colors">
            <NetworkStatusBanner
                onOnline={handleOnline}
                onOffline={handleOffline}
                showSuccessOnReconnect={false}
            />

            <header className={`fixed left-0 right-0 z-shell border-b border-edge bg-surface transition-all lg:hidden ${isOffline ? 'top-12' : 'top-0'}`}>
                <div className="flex h-16 items-center justify-between px-4">
                    <Link to="/" className="flex min-w-0 items-center gap-3 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary text-white">
                            <AdminIcons.Camera />
                        </span>
                        <span className="truncate text-base font-bold text-content">{branding.company_name || 'CCTV System'}</span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleTheme}
                            aria-label={isDark ? 'Aktifkan light mode' : 'Aktifkan dark mode'}
                            className="flex h-11 w-11 items-center justify-center rounded-control border border-edge text-content-muted transition-colors hover:bg-surface-raised hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            {isDark ? <AdminIcons.Sun /> : <AdminIcons.Moon />}
                        </button>
                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            aria-label={isMobileMenuOpen ? 'Tutup menu admin' : 'Buka menu admin'}
                            aria-expanded={isMobileMenuOpen}
                            className="flex h-11 w-11 items-center justify-center rounded-control border border-edge text-content-muted transition-colors hover:bg-surface-raised hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            {isMobileMenuOpen ? <AdminIcons.Close /> : <AdminIcons.Menu />}
                        </button>
                    </div>
                </div>
            </header>

            <aside
                ref={drawerRef}
                className={`fixed inset-y-0 left-0 z-shell flex w-72 flex-col border-r border-edge bg-surface transition-transform duration-300 lg:translate-x-0 ${
                    isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
            >
                <div className="border-b border-edge p-4">
                    <Link to="/" className="flex min-w-0 items-center gap-3 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        <span className="relative shrink-0">
                            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-primary text-white">
                                <AdminIcons.Camera />
                            </span>
                            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-status-live ring-2 ring-surface" />
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate text-base font-bold text-content">{branding.company_name || 'CCTV System'}</span>
                            <span className="block text-xs text-content-subtle">Panel Admin</span>
                        </span>
                    </Link>

                    {/* 23 destinations is past the point where scanning beats typing. */}
                    <div className="relative mt-3">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle">
                            <AdminIcons.Search />
                        </span>
                        <input
                            id={navSearchId}
                            type="search"
                            value={navQuery}
                            onChange={(e) => setNavQuery(e.target.value)}
                            placeholder="Cari menu…"
                            aria-label="Cari menu admin"
                            className="w-full min-h-11 rounded-control border border-edge bg-surface-sunken pl-10 pr-3 text-sm text-content placeholder:text-content-subtle transition-colors hover:border-edge-strong focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        />
                    </div>
                </div>

                <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Navigasi admin">
                    {navGroups.map((group) => (
                        <div key={group.id} className="mb-4 last:mb-0">
                            <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-content-subtle">
                                {group.label}
                            </p>
                            <ul className="space-y-0.5">
                                {group.items.map((item) => {
                                    const active = isActive(item.path);
                                    const Icon = item.icon;
                                    return (
                                        <li key={item.path}>
                                            <Link
                                                to={item.path}
                                                onClick={closeMobileMenu}
                                                aria-current={active ? 'page' : undefined}
                                                className={`flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                                                    active
                                                        ? 'bg-primary text-white'
                                                        : 'text-content-muted hover:bg-surface-raised hover:text-content'
                                                }`}
                                            >
                                                <span className="shrink-0"><Icon /></span>
                                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}

                    {navGroups.length === 0 && (
                        <p className="px-2 py-6 text-center text-sm text-content-subtle">
                            Tidak ada menu cocok dengan “{navQuery}”.
                        </p>
                    )}
                </nav>

                <div className="space-y-2 border-t border-edge p-3">
                    <a
                        href="/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium text-content-muted transition-colors hover:bg-surface-raised hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                    >
                        <span className="shrink-0"><AdminIcons.Home /></span>
                        <span className="flex-1">Tampilan Publik</span>
                        <span className="shrink-0 text-content-subtle"><AdminIcons.External /></span>
                    </a>

                    <button
                        onClick={toggleTheme}
                        aria-label={isDark ? 'Aktifkan light mode' : 'Aktifkan dark mode'}
                        className="hidden min-h-11 w-full items-center gap-3 rounded-control px-3 text-sm font-medium text-content-muted transition-colors hover:bg-surface-raised hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary lg:flex"
                    >
                        <span className="shrink-0">{isDark ? <AdminIcons.Sun /> : <AdminIcons.Moon />}</span>
                        <span>{isDark ? 'Mode Terang' : 'Mode Gelap'}</span>
                    </button>

                    <div className="flex items-center gap-3 rounded-control border border-edge bg-surface-sunken px-3 py-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary text-sm font-semibold text-white">
                            {user?.username?.charAt(0).toUpperCase() || 'A'}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-content">{user?.username || 'Admin'}</span>
                            <span className="block text-xs text-content-subtle">{isAdmin ? 'Administrator' : 'Viewer'}</span>
                        </span>
                    </div>

                    <button
                        onClick={handleLogout}
                        aria-label="Logout"
                        className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-sm font-medium text-status-fault transition-colors hover:bg-status-fault/10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                    >
                        <span className="shrink-0"><AdminIcons.Logout /></span>
                        <span>Logout</span>
                    </button>
                </div>
            </aside>

            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 z-scrim bg-black/60 lg:hidden"
                    onClick={closeMobileMenu}
                    aria-hidden="true"
                />
            )}

            <main className="min-h-screen overflow-y-auto lg:ml-72">
                <div className={`px-4 pb-28 transition-all lg:px-8 lg:pb-8 ${isOffline ? 'pt-32 lg:pt-16' : 'pt-16 lg:pt-6'}`}>
                    <div className="mx-auto max-w-7xl">
                        {children}
                    </div>
                </div>
            </main>
            {!isMobileMenuOpen && <AdminMobileDock activePath={location.pathname} isAdmin={isAdmin} />}
        </div>
    );
}
