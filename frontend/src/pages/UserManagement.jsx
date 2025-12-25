import { useEffect, useState } from 'react';
import { userService } from '../services/userService';
import { authService } from '../services/authService';

export default function UserManagement() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [passwordUser, setPasswordUser] = useState(null);
    const [formData, setFormData] = useState({ username: '', password: '', role: 'admin' });
    const [passwordData, setPasswordData] = useState({ password: '', confirmPassword: '' });
    const [error, setError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const currentUser = authService.getCurrentUser();

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            setLoading(true);
            const response = await userService.getAllUsers();
            if (response.success) setUsers(response.data);
        } catch (err) {
            console.error('Load users error:', err);
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingUser(null);
        setFormData({ username: '', password: '', role: 'admin' });
        setError('');
        setShowModal(true);
    };

    const openEditModal = (user) => {
        setEditingUser(user);
        setFormData({ username: user.username, password: '', role: user.role });
        setError('');
        setShowModal(true);
    };

    const openPasswordModal = (user) => {
        setPasswordUser(user);
        setPasswordData({ password: '', confirmPassword: '' });
        setPasswordError('');
        setShowPasswordModal(true);
    };

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
    const handlePasswordChange = (e) => setPasswordData({ ...passwordData, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            let result;
            if (editingUser) {
                result = await userService.updateUser(editingUser.id, { username: formData.username, role: formData.role });
            } else {
                if (!formData.password) {
                    setError('Password is required');
                    setSubmitting(false);
                    return;
                }
                result = await userService.createUser(formData);
            }
            if (result.success) {
                setShowModal(false);
                loadUsers();
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        setPasswordError('');
        if (passwordData.password !== passwordData.confirmPassword) {
            setPasswordError('Passwords do not match');
            return;
        }
        if (passwordData.password.length < 6) {
            setPasswordError('Password must be at least 6 characters');
            return;
        }
        setSubmitting(true);
        try {
            const result = await userService.changeUserPassword(passwordUser.id, passwordData.password);
            if (result.success) {
                setShowPasswordModal(false);
                alert('Password changed successfully');
            } else {
                setPasswordError(result.message);
            }
        } catch (err) {
            setPasswordError(err.response?.data?.message || 'Failed to change password');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (user) => {
        if (user.id === currentUser?.id) {
            alert('Cannot delete your own account');
            return;
        }
        if (!window.confirm(`Delete user "${user.username}"?`)) return;
        try {
            const result = await userService.deleteUser(user.id);
            if (result.success) loadUsers();
            else alert(result.message);
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to delete');
        }
    };

    const formatDate = (dateString) => {
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(dateString + ' UTC'));
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-500 mb-1">Access Control</p>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">User Management</h1>
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
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
                </div>
            ) : users.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-400">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Users</h3>
                    <p className="text-gray-500 dark:text-gray-400">Add your first administrator</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-800">
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">User</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Role</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Created</th>
                                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                                {users.map((user) => (
                                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
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
                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                                                user.role === 'admin'
                                                    ? 'bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                                    : 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                            }`}>
                                                {user.role}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                                            {formatDate(user.created_at)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => openEditModal(user)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-all" title="Edit">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </button>
                                                <button onClick={() => openPasswordModal(user)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all" title="Change Password">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                    </svg>
                                                </button>
                                                {user.id !== currentUser?.id && (
                                                    <button onClick={() => handleDelete(user)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all" title="Delete">
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{editingUser ? 'Edit User' : 'Add User'}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{editingUser ? 'Update user info' : 'Create new admin'}</p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            {error && (
                                <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                                    <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Username</label>
                                <input type="text" name="username" value={formData.username} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Enter username" required minLength={3} />
                            </div>

                            {!editingUser && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Password</label>
                                    <input type="password" name="password" value={formData.password} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Min 6 characters" required minLength={6} />
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Role</label>
                                <select name="role" value={formData.role} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500">
                                    <option value="admin">Admin</option>
                                    <option value="viewer">Viewer</option>
                                </select>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" disabled={submitting}>Cancel</button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white font-medium rounded-xl shadow-lg shadow-sky-500/25 hover:from-sky-600 hover:to-blue-700 disabled:opacity-50 transition-all" disabled={submitting}>
                                    {submitting ? 'Saving...' : (editingUser ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Password Modal */}
            {showPasswordModal && passwordUser && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Change Password</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">For {passwordUser.username}</p>
                            </div>
                            <button onClick={() => setShowPasswordModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handlePasswordSubmit} className="p-6 space-y-5">
                            {passwordError && (
                                <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                                    <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-red-600 dark:text-red-400 text-sm">{passwordError}</p>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">New Password</label>
                                <input type="password" name="password" value={passwordData.password} onChange={handlePasswordChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Min 6 characters" required minLength={6} />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Confirm Password</label>
                                <input type="password" name="confirmPassword" value={passwordData.confirmPassword} onChange={handlePasswordChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Confirm password" required minLength={6} />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowPasswordModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" disabled={submitting}>Cancel</button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium rounded-xl shadow-lg shadow-amber-500/25 hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 transition-all" disabled={submitting}>
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
