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
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        role: 'admin',
    });
    const [passwordData, setPasswordData] = useState({
        password: '',
        confirmPassword: '',
    });
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
            if (response.success) {
                setUsers(response.data);
            }
        } catch (err) {
            console.error('Load users error:', err);
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingUser(null);
        setFormData({
            username: '',
            password: '',
            role: 'admin',
        });
        setError('');
        setShowModal(true);
    };

    const openEditModal = (user) => {
        setEditingUser(user);
        setFormData({
            username: user.username,
            password: '',
            role: user.role,
        });
        setError('');
        setShowModal(true);
    };

    const openPasswordModal = (user) => {
        setPasswordUser(user);
        setPasswordData({
            password: '',
            confirmPassword: '',
        });
        setPasswordError('');
        setShowPasswordModal(true);
    };

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value,
        });
    };

    const handlePasswordChange = (e) => {
        setPasswordData({
            ...passwordData,
            [e.target.name]: e.target.value,
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);

        try {
            let result;
            if (editingUser) {
                // Update user (without password)
                result = await userService.updateUser(editingUser.id, {
                    username: formData.username,
                    role: formData.role,
                });
            } else {
                // Create new user
                if (!formData.password) {
                    setError('Password is required for new users');
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
            alert('You cannot delete your own account');
            return;
        }

        if (!window.confirm(`Are you sure you want to delete user "${user.username}"?`)) return;

        try {
            const result = await userService.deleteUser(user.id);
            if (result.success) {
                loadUsers();
            } else {
                alert(result.message);
            }
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to delete user');
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
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></div>
                        <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.3em]">Access Control</span>
                    </div>
                    <h1 className="text-4xl font-black text-white tracking-tighter">User Management</h1>
                    <p className="text-dark-400 font-medium mt-1">Manage administrator accounts and permissions</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="px-8 py-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-primary-500/20 active:scale-95 flex items-center gap-3"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add New User
                </button>
            </div>

            {/* Main content */}
            <div className="space-y-6">
                {loading ? (
                    <div className="flex flex-col items-center justify-center min-h-[400px]">
                        <div className="w-12 h-12 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin"></div>
                    </div>
                ) : users.length === 0 ? (
                    <div className="text-center py-24 bg-dark-900/40 border border-white/5 rounded-[3rem] backdrop-blur-sm">
                        <div className="w-20 h-20 bg-dark-800 rounded-3xl flex items-center justify-center mx-auto mb-6 text-dark-600">
                            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-black text-white mb-2">No Users Found</h3>
                        <p className="text-dark-500 max-w-xs mx-auto mb-8">Start by adding your first administrator.</p>
                    </div>
                ) : (
                    <div className="bg-dark-900/40 border border-white/5 rounded-[2.5rem] overflow-hidden backdrop-blur-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-white/5">
                                        <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-dark-500">User</th>
                                        <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-dark-500">Role</th>
                                        <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-dark-500">Created</th>
                                        <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-dark-500 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {users.map((user) => (
                                        <tr key={user.id} className="group hover:bg-white/[0.02] transition-colors">
                                            <td className="px-8 py-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-gradient-to-br from-primary-500/20 to-accent-500/20 rounded-2xl flex items-center justify-center text-primary-500 font-black text-lg uppercase">
                                                        {user.username.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-white text-sm flex items-center gap-2">
                                                            {user.username}
                                                            {user.id === currentUser?.id && (
                                                                <span className="text-[9px] px-2 py-0.5 bg-primary-500/20 text-primary-400 rounded-full font-black">YOU</span>
                                                            )}
                                                        </p>
                                                        <p className="text-[10px] text-dark-500 font-black uppercase tracking-widest mt-0.5">ID: {user.id}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-8 py-6">
                                                <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                                                    user.role === 'admin' 
                                                        ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400'
                                                        : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                                                }`}>
                                                    {user.role}
                                                </span>
                                            </td>
                                            <td className="px-8 py-6">
                                                <p className="text-sm text-dark-300">{formatDate(user.created_at)}</p>
                                            </td>
                                            <td className="px-8 py-6">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => openEditModal(user)}
                                                        className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-dark-400 hover:bg-primary-500/10 hover:text-primary-500 transition-all"
                                                        title="Edit User"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => openPasswordModal(user)}
                                                        className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-dark-400 hover:bg-amber-500/10 hover:text-amber-500 transition-all"
                                                        title="Change Password"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                        </svg>
                                                    </button>
                                                    {user.id !== currentUser?.id && (
                                                        <button
                                                            onClick={() => handleDelete(user)}
                                                            className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-dark-400 hover:bg-red-500/10 hover:text-red-500 transition-all"
                                                            title="Delete User"
                                                        >
                                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
            </div>

            {/* Add/Edit User Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[200] p-6 animate-in fade-in duration-300">
                    <div className="bg-dark-900 max-w-md w-full rounded-[2.5rem] shadow-2xl border border-white/5 overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                            <div>
                                <h3 className="text-xl font-black text-white tracking-tight">
                                    {editingUser ? 'Edit User' : 'Add New User'}
                                </h3>
                                <p className="text-xs text-dark-500 mt-1">
                                    {editingUser ? 'Update user information' : 'Create a new administrator account'}
                                </p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-dark-400 hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-8 space-y-6">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3">
                                    <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-red-400 text-xs font-bold">{error}</p>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Username</label>
                                <input
                                    type="text"
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700"
                                    placeholder="Enter username"
                                    required
                                    minLength={3}
                                />
                            </div>

                            {!editingUser && (
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Password</label>
                                    <input
                                        type="password"
                                        name="password"
                                        value={formData.password}
                                        onChange={handleChange}
                                        className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700"
                                        placeholder="Enter password (min 6 characters)"
                                        required={!editingUser}
                                        minLength={6}
                                    />
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Role</label>
                                <select
                                    name="role"
                                    value={formData.role}
                                    onChange={handleChange}
                                    className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all appearance-none"
                                >
                                    <option value="admin">Admin</option>
                                    <option value="viewer">Viewer</option>
                                </select>
                            </div>

                            <div className="flex items-center gap-4 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-6 py-4 bg-dark-800 hover:bg-dark-700 text-dark-300 font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all"
                                    disabled={submitting}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-[2] px-6 py-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all shadow-xl shadow-primary-500/20 disabled:opacity-50"
                                    disabled={submitting}
                                >
                                    {submitting ? 'Processing...' : (editingUser ? 'Update User' : 'Create User')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Change Password Modal */}
            {showPasswordModal && passwordUser && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[200] p-6 animate-in fade-in duration-300">
                    <div className="bg-dark-900 max-w-md w-full rounded-[2.5rem] shadow-2xl border border-white/5 overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                            <div>
                                <h3 className="text-xl font-black text-white tracking-tight">Change Password</h3>
                                <p className="text-xs text-dark-500 mt-1">Set new password for {passwordUser.username}</p>
                            </div>
                            <button onClick={() => setShowPasswordModal(false)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-dark-400 hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handlePasswordSubmit} className="p-8 space-y-6">
                            {passwordError && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3">
                                    <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-red-400 text-xs font-bold">{passwordError}</p>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">New Password</label>
                                <input
                                    type="password"
                                    name="password"
                                    value={passwordData.password}
                                    onChange={handlePasswordChange}
                                    className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700"
                                    placeholder="Enter new password (min 6 characters)"
                                    required
                                    minLength={6}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Confirm Password</label>
                                <input
                                    type="password"
                                    name="confirmPassword"
                                    value={passwordData.confirmPassword}
                                    onChange={handlePasswordChange}
                                    className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700"
                                    placeholder="Confirm new password"
                                    required
                                    minLength={6}
                                />
                            </div>

                            <div className="flex items-center gap-4 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowPasswordModal(false)}
                                    className="flex-1 px-6 py-4 bg-dark-800 hover:bg-dark-700 text-dark-300 font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all"
                                    disabled={submitting}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-[2] px-6 py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all shadow-xl shadow-amber-500/20 disabled:opacity-50"
                                    disabled={submitting}
                                >
                                    {submitting ? 'Processing...' : 'Change Password'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
