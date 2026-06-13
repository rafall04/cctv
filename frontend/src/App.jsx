/*
Purpose: Define React provider tree, route table, protected admin shell, public/admin playback scopes, and public PWA install prompt.
Caller: main.jsx after runtime config loads.
Deps: React Router, context providers, ErrorBoundary, PwaInstallPrompt, AdminLayout, page components, lazyWithRetry.
MainFuncs: App, AdminPageRoute.
SideEffects: Registers client-side routes, renders global toast/provider structure, and surfaces public PWA install capability.
*/

import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { SecurityProvider } from './contexts/SecurityContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { BrandingProvider } from './contexts/BrandingContext';
import { TimezoneProvider } from './contexts/TimezoneContext';
import { ToastContainer } from './components/ui/ToastContainer';
import { ApiClientInitializer } from './components/ApiClientInitializer';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { NetworkStatusBanner } from './components/ui/NetworkStatusBanner';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import CustomerRoute from './components/CustomerRoute';
import lazyWithRetry from './utils/lazyWithRetry';

// Lazy load admin pages for better code splitting
const AdminLayout = lazyWithRetry(() => import('./layouts/AdminLayout'), 'admin-layout');
const CameraManagement = lazyWithRetry(() => import('./pages/CameraManagement'), 'camera-management');
const ImportExport = lazyWithRetry(() => import('./pages/admin/ImportExport'), 'import-export');
const BackupRestore = lazyWithRetry(() => import('./pages/admin/BackupRestore'), 'backup-restore');
const HealthDebug = lazyWithRetry(() => import('./pages/admin/HealthDebug'), 'health-debug');
const SecurityActivity = lazyWithRetry(() => import('./pages/admin/SecurityActivity'), 'security-activity');
const AreaManagement = lazyWithRetry(() => import('./pages/AreaManagement'), 'area-management');
const UserManagement = lazyWithRetry(() => import('./pages/UserManagement'), 'user-management');
const FeedbackManagement = lazyWithRetry(() => import('./pages/FeedbackManagement'), 'feedback-management');
const ViewerAnalytics = lazyWithRetry(() => import('./pages/ViewerAnalytics'), 'viewer-analytics');
const PlaybackAnalytics = lazyWithRetry(() => import('./pages/PlaybackAnalytics'), 'playback-analytics');
const PlaybackTokenManagement = lazyWithRetry(() => import('./pages/PlaybackTokenManagement'), 'playback-token-management');
const NotificationDiagnostics = lazyWithRetry(() => import('./pages/NotificationDiagnostics'), 'notification-diagnostics');
const UnifiedSettings = lazyWithRetry(() => import('./pages/UnifiedSettings'), 'unified-settings');
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'), 'dashboard');
const SponsorManagement = lazyWithRetry(() => import('./pages/SponsorManagement'), 'sponsor-management');
const AdsManagement = lazyWithRetry(() => import('./pages/AdsManagement'), 'ads-management');
const RecordingDashboard = lazyWithRetry(() => import('./pages/RecordingDashboard'), 'recording-dashboard');
const AreaPublicPage = lazyWithRetry(() => import('./pages/AreaPublicPage'), 'area-public-page');
const BillingManagement = lazyWithRetry(() => import('./pages/BillingManagement'), 'billing-management');
const CustomerCameraIPs = lazyWithRetry(() => import('./pages/CustomerCameraIPs'), 'customer-camera-ips');
const CustomerLayout = lazyWithRetry(() => import('./layouts/CustomerLayout'), 'customer-layout');
const MyCameras = lazyWithRetry(() => import('./pages/customer/MyCameras'), 'my-cameras');
const MyWallet = lazyWithRetry(() => import('./pages/customer/MyWallet'), 'my-wallet');
const MyPlan = lazyWithRetry(() => import('./pages/customer/MyPlan'), 'my-plan');
const MyAccount = lazyWithRetry(() => import('./pages/customer/MyAccount'), 'my-account');
const RegisterPage = lazyWithRetry(() => import('./pages/RegisterPage'), 'register-page');
// Playback (recordingService + full playback component/hook tree, ~72 KB raw) is lazy so it stays OUT
// of the eager App chunk that every public-landing visit downloads + parses. Both the public /playback
// and admin /admin/playback routes already render it inside <Suspense>, and LandingCamerasSection also
// imports it dynamically — so Vite splits it into its own chunk loaded only when playback is opened.
const Playback = lazyWithRetry(() => import('./pages/Playback'), 'playback');

// Public visitor routes: own ErrorBoundary so a crash in one public page
// (e.g. a bad camera record in the landing/map/playback subtree) shows a
// contained fallback instead of white-screening the whole app, plus the
// offline banner so mobile visitors on flaky connections get feedback.
function PublicPageRoute({ children }) {
    return (
        <ErrorBoundary>
            <NetworkStatusBanner />
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Memuat…</div>}>
                {children}
            </Suspense>
        </ErrorBoundary>
    );
}

function CustomerPageRoute({ children }) {
    return (
        <CustomerRoute>
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
                <CustomerLayout>
                    <ErrorBoundary>
                        <Suspense fallback={<div className="p-6">Loading...</div>}>
                            {children}
                        </Suspense>
                    </ErrorBoundary>
                </CustomerLayout>
            </Suspense>
        </CustomerRoute>
    );
}

function AdminPageRoute({ children, adminOnly = false }) {
    return (
        <ProtectedRoute adminOnly={adminOnly}>
            <AdminLayout>
                <ErrorBoundary>
                    <Suspense fallback={<div className="p-6">Loading...</div>}>
                        {children}
                    </Suspense>
                </ErrorBoundary>
            </AdminLayout>
        </ProtectedRoute>
    );
}

function App() {
    return (
        <ErrorBoundary>
        <ThemeProvider>
        <BrandingProvider>
        <SecurityProvider>
        <NotificationProvider>
        <ConfirmProvider>
        <TimezoneProvider>
        <ApiClientInitializer>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ToastContainer />
            <PwaInstallPrompt />
            <Routes>
                {/* Public routes */}
                <Route path="/" element={<PublicPageRoute><LandingPage /></PublicPageRoute>} />
                <Route path="/area/:areaSlug" element={
                    <PublicPageRoute><AreaPublicPage /></PublicPageRoute>
                } />
                <Route path="/playback" element={
                    <PublicPageRoute><Playback accessScope="public_preview" /></PublicPageRoute>
                } />
                <Route path="/admin/login" element={<LoginPage />} />
                <Route path="/daftar" element={
                    <PublicPageRoute><RegisterPage /></PublicPageRoute>
                } />

                {/* Customer portal (role: customer) */}
                <Route
                    path="/my"
                    element={
                        <CustomerPageRoute>
                            <MyCameras />
                        </CustomerPageRoute>
                    }
                />
                <Route
                    path="/my/paket"
                    element={
                        <CustomerPageRoute>
                            <MyPlan />
                        </CustomerPageRoute>
                    }
                />
                <Route
                    path="/my/wallet"
                    element={
                        <CustomerPageRoute>
                            <MyWallet />
                        </CustomerPageRoute>
                    }
                />
                <Route
                    path="/my/akun"
                    element={
                        <CustomerPageRoute>
                            <MyAccount />
                        </CustomerPageRoute>
                    }
                />

                {/* Protected admin routes */}
                <Route
                    path="/admin/playback"
                    element={
                        <AdminPageRoute>
                            <Playback accessScope="admin_full" />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/dashboard"
                    element={
                        <AdminPageRoute>
                            <Dashboard />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/cameras"
                    element={
                        <AdminPageRoute>
                            <CameraManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/health-debug"
                    element={
                        <AdminPageRoute>
                            <HealthDebug />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/security"
                    element={
                        <AdminPageRoute adminOnly>
                            <SecurityActivity />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/import-export"
                    element={
                        <AdminPageRoute adminOnly>
                            <ImportExport />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/backup-restore"
                    element={
                        <AdminPageRoute adminOnly>
                            <BackupRestore />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/areas"
                    element={
                        <AdminPageRoute>
                            <AreaManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/users"
                    element={
                        <AdminPageRoute adminOnly>
                            <UserManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/feedback"
                    element={
                        <AdminPageRoute>
                            <FeedbackManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/analytics"
                    element={
                        <AdminPageRoute>
                            <ViewerAnalytics />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/playback-analytics"
                    element={
                        <AdminPageRoute>
                            <PlaybackAnalytics />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/playback-tokens"
                    element={
                        <AdminPageRoute adminOnly>
                            <PlaybackTokenManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/notification-diagnostics"
                    element={
                        <AdminPageRoute adminOnly>
                            <NotificationDiagnostics />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/settings"
                    element={
                        <AdminPageRoute adminOnly>
                            <UnifiedSettings />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/sponsors"
                    element={
                        <AdminPageRoute adminOnly>
                            <SponsorManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/ads"
                    element={
                        <AdminPageRoute adminOnly>
                            <AdsManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/recordings"
                    element={
                        <AdminPageRoute>
                            <RecordingDashboard />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/billing"
                    element={
                        <AdminPageRoute adminOnly>
                            <BillingManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/customer-ips"
                    element={
                        <AdminPageRoute adminOnly>
                            <CustomerCameraIPs />
                        </AdminPageRoute>
                    }
                />

                {/* Redirect /admin to /admin/dashboard */}
                <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

                {/* 404 - redirect to home */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
        </ApiClientInitializer>
        </TimezoneProvider>
        </ConfirmProvider>
        </NotificationProvider>
        </SecurityProvider>
        </BrandingProvider>
        </ThemeProvider>
        </ErrorBoundary>
    );
}

export default App;
