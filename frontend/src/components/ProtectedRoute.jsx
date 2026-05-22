import { Navigate } from 'react-router-dom';
import { authService } from '../services/authService';

/**
 * Route guard for the admin area.
 * - Unauthenticated users are sent to the login page.
 * - When `adminOnly` is set, non-admin (e.g. `viewer`) users are redirected to
 *   the dashboard so the page is genuinely admin-restricted. The backend
 *   enforces the same rule independently — this is the UX-side gate.
 */
export default function ProtectedRoute({ children, adminOnly = false }) {
    if (!authService.isAuthenticated()) {
        return <Navigate to="/admin/login" replace />;
    }

    if (adminOnly && !authService.isAdmin()) {
        return <Navigate to="/admin/dashboard" replace />;
    }

    return children;
}
