import { useEffect, useState } from 'react';
import { userService } from '../services/userService';
import { authService } from '../services/authService';
import { useNotification } from '../contexts/NotificationContext';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState, NoUsersEmptyState } from '../components/ui/EmptyState';
import { Alert } from '../components/ui/Alert';

/**
 * Password validation requirements
 * Requirements: 6.3
 */
export const PASSWORD_REQUIREMENTS = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
};

/**
 * Validate password against requirements
 * @param {string} password - Password to validate
 * @returns {{ isValid: boolean, errors: string[], requirements: Object }}
 */
export function validatePassword(password) {
    const errors = [];
    const requirements = {
        minLength: false,
        hasUppercase: false,
        hasLowercase: false,
        hasNumber: false,
        hasSpecial: false,
    };

    if (!password) {
        return { isValid: false, errors: ['Password is required'], requirements };
    }

    // Check minimum length
    if (password.length >= PASSWORD_REQUIREMENTS.minLength) {
        requirements.minLength = true;
    } else {
        errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
    }

    // Check uppercase
    if (PASSWORD_REQUIREMENTS.requireUppercase) {
        if (/[A-Z]/.test(password)) {
            requirements.hasUppercase = true;
        } else {
            errors.push('Password must contain at least one uppercase letter');
        }
    }

    // Check lowercase
    if (PASSWORD_REQUIREMENTS.requireLowercase) {
        if (/[a-z]/.test(password)) {
            requirements.hasLowercase = true;
        } else {
            errors.push('Password must contain at least one lowercase letter');
        }
    }

    // Check number
    if (PASSWORD_REQUIREMENTS.requireNumber) {
        if (/[0-9]/.test(password)) {
            requirements.hasNumber = true;
        } else {
            errors.push('Password must contain at least one number');
        }
    }

    // Check special character
    if (PASSWORD_REQUIREMENTS.requireSpecial) {
        if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
            requirements.hasSpecial = true;
        } else {
            errors.push('Password must contain at least one special character');
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        requirements,
    };
}

/**
 * Check if attempting to delete own account
 * @param {number} userId - User ID to delete
 * @param {number} currentUserId - Current logged-in user ID
 * @returns {boolean} True if attempting self-deletion
 */
export function isSelfDeletion(userId, currentUserId) {
    return userId === currentUserId;
}

/**
 * Password Requirements Display Component
 */
function PasswordRequirementsDisplay({ password }) {
    const { requirements } = validatePassword(password || '');
    
    const items = [
        { key: 'minLength', label: `At least ${PASSWORD_REQUIREMENTS.minLength} characters`, met: requirements.minLength },
        { key: 'hasUppercase', label: 'One uppercase letter', met: requirements.hasUppercase },
        { key: 'hasLowercase', label: 'One lowercase letter', met: requirements.hasLowercase },
        { key: 'hasNumber', label: 'One number', met: requirements.hasNumber },
    ];

    if (PASSWORD_REQUIREMENTS.requireSpecial) {
        items.push({ key: 'hasSpecial', label: 'One special character', met: requirements.hasSpecial });
    }

    return (
        <div className="mt-2 space-y-1">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Password requirements:</p>
            <ul className="space-y-1">
                {items.map(item => (
                    <li key={item.key} className="flex items-center gap-2 text-xs">
                        {item.met ? (
                            <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                        ) : (
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        )}
                        <span className={item.met ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}>
                            {item.label}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function UserManagement() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showSelfDeleteWarning, setShowSelfDeleteWarning] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [passwordUser, setPasswordUser] = useState(null);
    const [formData, setFormData] = useState({ username: '', password: '', role: 'admin' });
    const [passwordData, setPasswordData] = useState({ password: '', confirmPassword: '' });
    const [error, setError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});
    const currentUser = authService.getCurrentUser();
    const { success, error: showError } = useNotification();

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            setLoading(true);
            setLoadError(null);
            const response = await userService.getAllUsers();
            if (response.success) setUsers(response.data);
        } catch (err) {
            console.error('Load users error:', err);
            setLoadError('Failed to load users. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingUser(null);
        setFormData({ username: '', password: '', role: 'admin' });
        setError('');
        setFieldErrors({});
        setShowModal(true);
    };

    const openEditModal = (user) => {
        setEditingUser(user);
        setFormData({ username: user.username, password: '', role: user.role });
        setError('');
        setFieldErrors({});
        setShowModal(true);
    };

    const openPasswordModal = (user) => {
        setPasswordUser(user);
        setPasswordData({ password: '', confirmPassword: '' });
        setPasswordError('');
        setShowPasswordModal(true);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
        // Clear field error when user starts typing
        if (fieldErrors[name]) {
            setFieldErrors({ ...fieldErrors, [name]: '' });
        }
    };

    const handlePasswordChange = (e) => {
        const { name, value } = e.target;
        setPasswordData({ ...passwordData, [name]: value });
        // Clear error when user starts typing
        if (passwordError) setPasswordError('');
    };

    const validateForm = () => {
        const errors = {};
        
        // Username validation
        if (!formData.username || formData.username.trim() === '') {
            errors.username = 'Username is required';
        } else if (formData.username.length < 3) {
            errors.username = 'Username must be at least 3 characters';
        } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
            errors.username = 'Username can only contain letters, numbers, and underscores';
        }

        // Password validation (only for new users)
        if (!editingUser) {
            const passwordValidation = validatePassword(formData.password);
            if (!passwordValidation.isValid) {
                errors.password = passwordValidation.errors[0];
            }
        }

        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        
        if (!validateForm()) return;
        
        setSubmitting(true);
        try {
            let result;
            if (editingUser) {
                result = await userService.updateUser(editingUser.id, { 
                    username: formData.username, 
                    role: formData.role 
                });
                if (result.success) {
                    success('User Updated', `${formData.username} has been updated successfully`);
                    setShowModal(false);
                    loadUsers();
                } else {
                    // Handle duplicate username
                    if (result.message?.toLowerCase().includes('username')) {
                        setFieldErrors({ ...fieldErrors, username: 'Username already taken' });
                    } else {
                        setError(result.message);
                    }
                    showError('Update Failed', result.message || 'Failed to update user');
                }
            } else {
                result = await userService.createUser(formData);
                if (result.success) {
                    success('User Created', `${formData.username} has been created successfully`);
                    setShowModal(false);
                    loadUsers();
                } else {
                    // Handle duplicate username
                    if (result.message?.toLowerCase().includes('username')) {
                        setFieldErrors({ ...fieldErrors, username: 'Username already taken' });
                    } else {
                        setError(result.message);
                    }
                    showError('Creation Failed', result.message || 'Failed to create user');
                }
            }
        } catch (err) {
            const errorMsg = err.response?.data?.message || 'Something went wrong';
            // Handle duplicate username from API error
            if (errorMsg.toLowerCase().includes('username')) {
                setFieldErrors({ ...fieldErrors, username: 'Username already taken' });
            } else {
                setError(errorMsg);
            }
            showError('Error', errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        setPasswordError('');
        
        // Validate password match
        if (passwordData.password !== passwordData.confirmPassword) {
            setPasswordError('Passwords do not match');
            return;
        }
        
        // Validate password requirements
        const passwordValidation = validatePassword(passwordData.password);
        if (!passwordValidation.isValid) {
            setPasswordError(passwordValidation.errors[0]);
            return;
        }
        
        setSubmitting(true);
        try {
            const result = await userService.changeUserPassword(passwordUser.id, passwordData.password);
            if (result.success) {
                success('Password Changed', `Password for ${passwordUser.username} has been updated`);
                setShowPasswordModal(false);
            } else {
                setPasswordError(result.message);
                showError('Password Change Failed', result.message || 'Failed to change password');
            }
        } catch (err) {
            const errorMsg = err.response?.data?.message || 'Failed to change password';
            setPasswordError(errorMsg);
            showError('Error', errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeleteAttempt = (user) => {
        // Check for self-deletion - Requirements: 6.5
        if (isSelfDeletion(user.id, currentUser?.id)) {
            setShowSelfDeleteWarning(true);
            return;
        }
        handleDelete(user);
    };

    const handleDelete = async (user) => {
        if (!window.confirm(`Delete user "${user.username}"? This action cannot be undone.`)) return;
        try {
            const result = await userService.deleteUser(user.id);
            if (result.success) {
                success('User Deleted', `${user.username} has been removed`);
                loadUsers();
            } else {
                showError('Delete Failed', result.message || 'Failed to delete user');
            }
        } catch (err) {
            const errorMsg = err.response?.data?.message || 'Failed to delete user';
            showError('Error', errorMsg);
        }
    };

    const formatDate = (dateString) => {
        return new Intl.DateTimeFormat('id-ID', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(dateString + ' UTC'));
    };

    // Users icon for empty state
    const UsersIcon = () => (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
    );

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-500 mb-1">Access Control</p>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Manage administrator accounts</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-sky-500/25 transition-all"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add User
                </button>
            </div>

            {/* Content */}
            {loading ? (
                <TableSkeleton rows={5} columns={4} />
            ) : loadError ? (
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-8">
                    <Alert 
                        type="error" 
                        title="Failed to Load Users" 
                        message={loadError}
                        className="mb-4"
                    />
                    <button
                        onClick={loadUsers}
                        className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-medium rounded-lg transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Retry
                    </button>
                </div>
            ) : users.length === 0 ? (
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
                    <NoUsersEmptyState onAddUser={openAddModal} />
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50">
                                    <th className="px-6 py-4 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
                                    <th className="px-6 py-4 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
                                    <th className="px-6 py-4 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
                                    <th className="px-6 py-4 text-right text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700/50">
                                {users.map((user) => (
                                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-sky-500/20">
                                                    {user.username.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                                        {user.username}
                                                        {user.id === currentUser?.id && (
                                                            <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 rounded font-bold">YOU</span>
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">ID: {user.id}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                                user.role === 'admin'
                                                    ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400'
                                                    : 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400'
                                            }`}>
                                                {user.role}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                                            {formatDate(user.created_at)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => openEditModal(user)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-all" title="Edit">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </button>
                                                <button onClick={() => openPasswordModal(user)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all" title="Change Password">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                    </svg>
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteAttempt(user)} 
                                                    className={`p-2 rounded-lg transition-all ${
                                                        user.id === currentUser?.id 
                                                            ? 'bg-gray-100 dark:bg-gray-700/50 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                                            : 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
                                                    }`} 
                                                    title={user.id === currentUser?.id ? "Cannot delete your own account" : "Delete"}
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Self-Deletion Warning Modal - Requirements: 6.5 */}
            {showSelfDeleteWarning && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50">
                        <div className="p-6">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center">
                                    <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Cannot Delete Own Account</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">This action is not allowed</p>
                                </div>
                            </div>
                            <p className="text-gray-600 dark:text-gray-300 mb-6">
                                You cannot delete your own account while logged in. If you need to remove this account, please ask another administrator to do so.
                            </p>
                            <button
                                onClick={() => setShowSelfDeleteWarning(false)}
                                className="w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                                I Understand
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{editingUser ? 'Edit User' : 'Add User'}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{editingUser ? 'Update user info' : 'Create new admin'}</p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            {error && (
                                <Alert type="error" message={error} dismissible onDismiss={() => setError('')} />
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Username</label>
                                <input 
                                    type="text" 
                                    name="username" 
                                    value={formData.username} 
                                    onChange={handleChange} 
                                    className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                                        fieldErrors.username 
                                            ? 'border-red-500 dark:border-red-500' 
                                            : 'border-gray-200 dark:border-gray-700/50'
                                    }`} 
                                    placeholder="Enter username" 
                                    required 
                                    minLength={3} 
                                />
                                {fieldErrors.username && (
                                    <p className="mt-1 text-sm text-red-500">{fieldErrors.username}</p>
                                )}
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Letters, numbers, and underscores only</p>
                            </div>

                            {!editingUser && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Password</label>
                                    <input 
                                        type="password" 
                                        name="password" 
                                        value={formData.password} 
                                        onChange={handleChange} 
                                        className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                                            fieldErrors.password 
                                                ? 'border-red-500 dark:border-red-500' 
                                                : 'border-gray-200 dark:border-gray-700/50'
                                        }`} 
                                        placeholder="Enter password" 
                                        required 
                                    />
                                    {fieldErrors.password && (
                                        <p className="mt-1 text-sm text-red-500">{fieldErrors.password}</p>
                                    )}
                                    <PasswordRequirementsDisplay password={formData.password} />
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Role</label>
                                <select name="role" value={formData.role} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500">
                                    <option value="admin">Admin</option>
                                    <option value="viewer">Viewer</option>
                                </select>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" disabled={submitting}>Cancel</button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white font-medium rounded-xl shadow-lg shadow-sky-500/30 hover:from-sky-600 hover:to-blue-700 disabled:opacity-50 transition-all" disabled={submitting}>
                                    {submitting ? 'Saving...' : (editingUser ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Password Modal */}
            {showPasswordModal && passwordUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Change Password</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">For {passwordUser.username}</p>
                            </div>
                            <button onClick={() => setShowPasswordModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handlePasswordSubmit} className="p-6 space-y-5">
                            {passwordError && (
                                <Alert type="error" message={passwordError} dismissible onDismiss={() => setPasswordError('')} />
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">New Password</label>
                                <input 
                                    type="password" 
                                    name="password" 
                                    value={passwordData.password} 
                                    onChange={handlePasswordChange} 
                                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500" 
                                    placeholder="Enter new password" 
                                    required 
                                />
                                <PasswordRequirementsDisplay password={passwordData.password} />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Confirm Password</label>
                                <input 
                                    type="password" 
                                    name="confirmPassword" 
                                    value={passwordData.confirmPassword} 
                                    onChange={handlePasswordChange} 
                                    className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                                        passwordData.confirmPassword && passwordData.password !== passwordData.confirmPassword
                                            ? 'border-red-500 dark:border-red-500'
                                            : 'border-gray-200 dark:border-gray-700/50'
                                    }`} 
                                    placeholder="Confirm password" 
                                    required 
                                />
                                {passwordData.confirmPassword && passwordData.password !== passwordData.confirmPassword && (
                                    <p className="mt-1 text-sm text-red-500">Passwords do not match</p>
                                )}
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowPasswordModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" disabled={submitting}>Cancel</button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium rounded-xl shadow-lg shadow-amber-500/30 hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 transition-all" disabled={submitting}>
                                    {submitting ? 'Saving...' : 'Change Password'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
