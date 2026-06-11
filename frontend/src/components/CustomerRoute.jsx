import { Navigate } from 'react-router-dom';
import { authService } from '../services/authService';

/**
 * Route guard for the customer portal (/my/*).
 * - Unauthenticated users go to the shared login page.
 * - Staff `viewer` accounts have no portal data (it is scoped by owner id), so
 *   they are sent to the admin dashboard; admins may pass through to inspect.
 * The backend enforces the same rules independently (requireCustomerOrAdmin).
 */
export default function CustomerRoute({ children }) {
    if (!authService.isAuthenticated()) {
        return <Navigate to="/admin/login" replace />;
    }

    const role = authService.getCurrentUser()?.role;
    if (role !== 'customer' && role !== 'admin') {
        return <Navigate to="/admin/dashboard" replace />;
    }

    return children;
}
