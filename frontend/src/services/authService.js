import apiClient from './apiClient';

export const authService = {
    // Login
    async login(username, password) {
        try {
            const response = await apiClient.post('/api/auth/login', {
                username,
                password,
            });

            if (response.data.success) {
                const { token, user } = response.data.data;
                localStorage.setItem('token', token);
                localStorage.setItem('user', JSON.stringify(user));
                return { success: true, user };
            }

            return { success: false, message: response.data.message };
        } catch (error) {
            return {
                success: false,
                message: error.response?.data?.message || 'Login failed',
            };
        }
    },

    // Logout
    async logout() {
        try {
            await apiClient.post('/api/auth/logout');
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    },

    // Verify token
    async verifyToken() {
        try {
            const response = await apiClient.get('/api/auth/verify');
            return response.data.success;
        } catch (error) {
            return false;
        }
    },

    // Get current user
    getCurrentUser() {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    },

    // Check if user is authenticated
    isAuthenticated() {
        return !!localStorage.getItem('token');
    },
};

export default authService;
