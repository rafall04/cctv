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

    // A `customer` JWT authenticates but must never render the admin shell. The backend denies the
    // data anyway (customerAccessPolicy), but 11 admin pages carry no `adminOnly` flag, so without
    // this a logged-in customer could open the admin frame. Send them to their portal — the mirror
    // image of CustomerRoute, which bounces staff out of /my. (Audit v1.2.0, M-01.)
    if (authService.getCurrentUser()?.role === 'customer') {
        return <Navigate to="/my" replace />;
    }

    if (adminOnly && !authService.isAdmin()) {
        return <Navigate to="/admin/dashboard" replace />;
    }

    return children;
}
