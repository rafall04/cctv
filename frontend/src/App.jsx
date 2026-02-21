import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { SecurityProvider } from './contexts/SecurityContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { BrandingProvider } from './contexts/BrandingContext';
import { ToastContainer } from './components/ui/ToastContainer';
import { ApiClientInitializer } from './components/ApiClientInitializer';
import ErrorBoundary, { InlineErrorBoundary } from './components/ui/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';

// Lazy load admin pages for better code splitting
const CameraManagement = lazy(() => import('./pages/CameraManagement'));
const AreaManagement = lazy(() => import('./pages/AreaManagement'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const FeedbackManagement = lazy(() => import('./pages/FeedbackManagement'));
const ViewerAnalytics = lazy(() => import('./pages/ViewerAnalytics'));
const UnifiedSettings = lazy(() => import('./pages/UnifiedSettings'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SponsorManagement = lazy(() => import('./pages/SponsorManagement'));
const RecordingDashboard = lazy(() => import('./pages/RecordingDashboard'));
const Playback = lazy(() => import('./pages/Playback'));

function App() {
    return (
        <ErrorBoundary>
        <ThemeProvider>
        <BrandingProvider>
        <SecurityProvider>
        <NotificationProvider>
        <ApiClientInitializer>
        <BrowserRouter>
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
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <Dashboard />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/cameras"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <CameraManagement />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/areas"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <AreaManagement />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/users"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <UserManagement />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/feedback"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <FeedbackManagement />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/analytics"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <ViewerAnalytics />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/settings"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <UnifiedSettings />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/sponsors"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <SponsorManagement />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/recordings"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Suspense fallback={<div className="p-6">Loading...</div>}>
                                    <RecordingDashboard />
                                </Suspense>
                            </AdminLayout>
                        </ProtectedRoute>
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
