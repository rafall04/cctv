import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { SecurityProvider } from './contexts/SecurityContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { BrandingProvider } from './contexts/BrandingContext';
import { ToastContainer } from './components/ui/ToastContainer';
import { ApiClientInitializer } from './components/ApiClientInitializer';
import ErrorBoundary from './components/ui/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';

// Lazy load admin pages for better code splitting
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const CameraManagement = lazy(() => import('./pages/CameraManagement'));
const ImportExport = lazy(() => import('./pages/admin/ImportExport'));
const BackupRestore = lazy(() => import('./pages/admin/BackupRestore'));
const HealthDebug = lazy(() => import('./pages/admin/HealthDebug'));
const AreaManagement = lazy(() => import('./pages/AreaManagement'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const FeedbackManagement = lazy(() => import('./pages/FeedbackManagement'));
const ViewerAnalytics = lazy(() => import('./pages/ViewerAnalytics'));
const UnifiedSettings = lazy(() => import('./pages/UnifiedSettings'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SponsorManagement = lazy(() => import('./pages/SponsorManagement'));
const RecordingDashboard = lazy(() => import('./pages/RecordingDashboard'));
const Playback = lazy(() => import('./pages/Playback'));

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
        <ApiClientInitializer>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ToastContainer />
            <Routes>
                {/* Public routes */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/playback" element={
                    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
                        <Playback />
                    </Suspense>
                } />
                <Route path="/admin/login" element={<LoginPage />} />

                {/* Protected admin routes */}
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
        </NotificationProvider>
        </SecurityProvider>
        </BrandingProvider>
        </ThemeProvider>
        </ErrorBoundary>
    );
}

export default App;
