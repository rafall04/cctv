import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { SecurityProvider } from './contexts/SecurityContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ToastContainer } from './components/ui/ToastContainer';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import CameraManagement from './pages/CameraManagement';
import AreaManagement from './pages/AreaManagement';
import UserManagement from './pages/UserManagement';
import Dashboard from './pages/Dashboard';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';

function App() {
    return (
        <ThemeProvider>
        <SecurityProvider>
        <NotificationProvider>
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

                {/* Redirect /admin to /admin/dashboard */}
                <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

                {/* 404 - redirect to home */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
        </NotificationProvider>
        </SecurityProvider>
        </ThemeProvider>
    );
}

export default App;
