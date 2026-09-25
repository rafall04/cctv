import apiClient from './apiClient';

export const userService = {
    // Get all users (admin only)
    async getAllUsers() {
        try {
            const response = await apiClient.get('/api/users');
            return response.data;
        } catch (error) {
            console.error('Get all users error:', error);
            throw error;
        }
    },

    // Get user by ID (admin only)
    async getUserById(id) {
        try {
            const response = await apiClient.get(`/api/users/${id}`);
            return response.data;
        } catch (error) {
            console.error('Get user by ID error:', error);
            throw error;
        }
    },

    // Create user (admin only)
    async createUser(userData) {
        try {
            const response = await apiClient.post('/api/users', userData);
            return response.data;
        } catch (error) {
            console.error('Create user error:', error);
            throw error;
        }
    },

    // Update user (admin only)
    async updateUser(id, userData) {
        try {
            const response = await apiClient.put(`/api/users/${id}`, userData);
            return response.data;
        } catch (error) {
            console.error('Update user error:', error);
            throw error;
        }
    },

    // Change user password (admin only)
    async changeUserPassword(id, password) {
        try {
            const response = await apiClient.put(`/api/users/${id}/password`, { password });
            return response.data;
        } catch (error) {
            console.error('Change user password error:', error);
            throw error;
        }
    },

    // Delete user (admin only)
    async deleteUser(id) {
        try {
            const response = await apiClient.delete(`/api/users/${id}`);
            return response.data;
        } catch (error) {
            console.error('Delete user error:', error);
            throw error;
        }
    },

    // Get current user profile
    async getProfile() {
        try {
            const response = await apiClient.get('/api/users/profile');
            return response.data;
        } catch (error) {
            console.error('Get profile error:', error);
            throw error;
        }
    },

    // Update current user profile
    async updateProfile(profileData) {
        try {
            const response = await apiClient.put('/api/users/profile', profileData);
            return response.data;
        } catch (error) {
            console.error('Update profile error:', error);
            throw error;
        }
    },

    // Change own password
    async changeOwnPassword(currentPassword, newPassword) {
        try {
            const response = await apiClient.put('/api/users/profile/password', {
                current_password: currentPassword,
                new_password: newPassword,
            });
            return response.data;
        } catch (error) {
            console.error('Change own password error:', error);
            throw error;
        }
    },

    // ---- TOTP self-service (own account only — any authenticated role) ----
    // Same {success, message} contract as the rest of the profile calls so callers can
    // render errors without try/catch.
    async getTotpStatus() {
        try {
            const response = await apiClient.get('/api/users/totp/status');
            return response.data;
        } catch (error) {
            return { success: false, message: error.response?.data?.message || 'Gagal membaca status 2FA' };
        }
    },

    async startTotpSetup() {
        try {
            const response = await apiClient.post('/api/users/totp/setup');
            return response.data;
        } catch (error) {
            return { success: false, message: error.response?.data?.message || 'Gagal memulai setup 2FA' };
        }
    },

    async confirmTotpSetup(code) {
        try {
            const response = await apiClient.post('/api/users/totp/confirm', { code });
            return response.data;
        } catch (error) {
            return { success: false, message: error.response?.data?.message || 'Kode verifikasi salah' };
        }
    },

    async disableTotp(code) {
        try {
            const response = await apiClient.post('/api/users/totp/disable', { code });
            return response.data;
        } catch (error) {
            return { success: false, message: error.response?.data?.message || 'Kode salah' };
        }
    },

    // Password policy requirements (public endpoint — no auth)
    async getPasswordRequirements() {
        try {
            const response = await apiClient.get('/api/users/password-requirements');
            return response.data;
        } catch (error) {
            console.error('Get password requirements error:', error);
            throw error;
        }
    },
};

export default userService;
