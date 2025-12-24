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
};

export default userService;
