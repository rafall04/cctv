/*
Purpose: Define React provider tree, route table, protected admin shell, and public/admin playback scopes.
Caller: main.jsx after runtime config loads.
Deps: React Router, context providers, ErrorBoundary, AdminLayout, page components, lazyWithRetry.
MainFuncs: App, AdminPageRoute.
SideEffects: Registers client-side routes and renders global toast/provider structure.
*/

import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { SecurityProvider } from './contexts/SecurityContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { BrandingProvider } from './contexts/BrandingContext';
import { TimezoneProvider } from './contexts/TimezoneContext';
import { ToastContainer } from './components/ui/ToastContainer';
import { ApiClientInitializer } from './components/ApiClientInitializer';
import ErrorBoundary from './components/ui/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import Playback from './pages/Playback';
import ProtectedRoute from './components/ProtectedRoute';
import lazyWithRetry from './utils/lazyWithRetry';

// Lazy load admin pages for better code splitting
const AdminLayout = lazyWithRetry(() => import('./layouts/AdminLayout'), 'admin-layout');
const CameraManagement = lazyWithRetry(() => import('./pages/CameraManagement'), 'camera-management');
const ImportExport = lazyWithRetry(() => import('./pages/admin/ImportExport'), 'import-export');
const BackupRestore = lazyWithRetry(() => import('./pages/admin/BackupRestore'), 'backup-restore');
const HealthDebug = lazyWithRetry(() => import('./pages/admin/HealthDebug'), 'health-debug');
const AreaManagement = lazyWithRetry(() => import('./pages/AreaManagement'), 'area-management');
const UserManagement = lazyWithRetry(() => import('./pages/UserManagement'), 'user-management');
const FeedbackManagement = lazyWithRetry(() => import('./pages/FeedbackManagement'), 'feedback-management');
const ViewerAnalytics = lazyWithRetry(() => import('./pages/ViewerAnalytics'), 'viewer-analytics');
const PlaybackAnalytics = lazyWithRetry(() => import('./pages/PlaybackAnalytics'), 'playback-analytics');
const PlaybackTokenManagement = lazyWithRetry(() => import('./pages/PlaybackTokenManagement'), 'playback-token-management');
const UnifiedSettings = lazyWithRetry(() => import('./pages/UnifiedSettings'), 'unified-settings');
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'), 'dashboard');
const SponsorManagement = lazyWithRetry(() => import('./pages/SponsorManagement'), 'sponsor-management');
const RecordingDashboard = lazyWithRetry(() => import('./pages/RecordingDashboard'), 'recording-dashboard');
const AreaPublicPage = lazyWithRetry(() => import('./pages/AreaPublicPage'), 'area-public-page');

function AdminPageRoute({ children }) {
    return (
        <ProtectedRoute>
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
        <TimezoneProvider>
        <ApiClientInitializer>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ToastContainer />
            <Routes>
                {/* Public routes */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/area/:areaSlug" element={
                    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
                        <AreaPublicPage />
                    </Suspense>
                } />
                <Route path="/playback" element={
                    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
                        <Playback accessScope="public_preview" />
                    </Suspense>
                } />
                <Route path="/admin/login" element={<LoginPage />} />

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
                    path="/admin/import-export"
                    element={
                        <AdminPageRoute>
                            <ImportExport />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/backup-restore"
                    element={
                        <AdminPageRoute>
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
                        <AdminPageRoute>
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
                        <AdminPageRoute>
                            <PlaybackTokenManagement />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/settings"
                    element={
                        <AdminPageRoute>
                            <UnifiedSettings />
                        </AdminPageRoute>
                    }
                />
                <Route
                    path="/admin/sponsors"
                    element={
                        <AdminPageRoute>
                            <SponsorManagement />
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

                {/* Redirect /admin to /admin/dashboard */}
                <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

                {/* 404 - redirect to home */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
        </ApiClientInitializer>
        </TimezoneProvider>
        </NotificationProvider>
        </SecurityProvider>
        </BrandingProvider>
        </ThemeProvider>
        </ErrorBoundary>
    );
}

export default App;
