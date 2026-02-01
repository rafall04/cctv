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
import CameraManagement from './pages/CameraManagement';
import AreaManagement from './pages/AreaManagement';
import UserManagement from './pages/UserManagement';
import FeedbackManagement from './pages/FeedbackManagement';
import ViewerAnalytics from './pages/ViewerAnalytics';
import UnifiedSettings from './pages/UnifiedSettings';
import Dashboard from './pages/Dashboard';
import SponsorManagement from './pages/SponsorManagement';
import RecordingDashboard from './pages/RecordingDashboard';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';

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
                <Route path="/admin/login" element={<LoginPage />} />

                {/* Protected admin routes */}
                <Route
                    path="/admin/dashboard"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <Dashboard />
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/cameras"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <CameraManagement />
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/areas"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <AreaManagement />
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/users"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <UserManagement />
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/feedback"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <FeedbackManagement />
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/analytics"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <ViewerAnalytics />
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/settings"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <UnifiedSettings />
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/sponsors"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <SponsorManagement />
                            </AdminLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/recordings"
                    element={
                        <ProtectedRoute>
                            <AdminLayout>
                                <RecordingDashboard />
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
