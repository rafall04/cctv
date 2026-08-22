/*
 * Purpose: Admin user management page for creating, editing, deleting, and password-updating users.
 * Caller: Protected admin users route.
 * Deps: React hooks, user/auth services, notification context, TimezoneContext, UI primitives.
 * MainFuncs: UserManagement, validatePassword, isSelfDeletion.
 * SideEffects: Fetches and mutates user records through API calls.
 */

import { useEffect, useState } from 'react';
import { userService } from '../services/userService';
import { authService } from '../services/authService';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { TableSkeleton } from '../components/ui/Skeleton';
import { NoUsersEmptyState } from '../components/ui/EmptyState';
import { Alert } from '../components/ui/Alert';
import {
    Badge, Button, Card, Field, IconButton, Modal, PageHeader,
    Table, TableShell, TBody, TD, TH, THead, TR,
} from '../components/ui';
import { TIMESTAMP_STORAGE, useTimezone } from '../contexts/TimezoneContext';

const icon = (d) => function RowIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={d} />
        </svg>
    );
};
const PlusIcon = icon('M12 4v16m8-8H4');
const EditIcon = icon('M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z');
const KeyIcon = icon('M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z');
const TrashIcon = icon('M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16');

/**
 * Password validation requirements
 * Requirements: 6.3
 */
// Mirrors the backend policy (services/passwordValidator.js) so the "green" meter can't
// pass a password the server will reject. Backend also enforces not-common + no-reuse
// (last 5) — those are server-only and surfaced via the API error message on submit.
export const PASSWORD_REQUIREMENTS = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
};

/**
 * Validate password against requirements
 * @param {string} password - Password to validate
 * @returns {{ isValid: boolean, errors: string[], requirements: Object }}
 */
export function validatePassword(password, username = '') {
    const errors = [];
    const requirements = {
        minLength: false,
        hasUppercase: false,
        hasLowercase: false,
        hasNumber: false,
        hasSpecial: false,
        noUsername: true,
    };

    if (!password) {
        return { isValid: false, errors: ['Kata sandi wajib diisi'], requirements };
    }

    // Check minimum length
    if (password.length >= PASSWORD_REQUIREMENTS.minLength) {
        requirements.minLength = true;
    } else {
        errors.push(`Kata sandi minimal ${PASSWORD_REQUIREMENTS.minLength} karakter`);
    }

    // Check uppercase
    if (PASSWORD_REQUIREMENTS.requireUppercase) {
        if (/[A-Z]/.test(password)) {
            requirements.hasUppercase = true;
        } else {
            errors.push('Kata sandi harus memuat minimal satu huruf besar');
        }
    }

    // Check lowercase
    if (PASSWORD_REQUIREMENTS.requireLowercase) {
        if (/[a-z]/.test(password)) {
            requirements.hasLowercase = true;
        } else {
            errors.push('Kata sandi harus memuat minimal satu huruf kecil');
        }
    }

    // Check number
    if (PASSWORD_REQUIREMENTS.requireNumber) {
        if (/[0-9]/.test(password)) {
            requirements.hasNumber = true;
        } else {
            errors.push('Kata sandi harus memuat minimal satu angka');
        }
    }

    // Check special character (same set the backend accepts)
    if (PASSWORD_REQUIREMENTS.requireSpecial) {
        if (/[!@#$%^&*()_+\-=[\]{}|;:'",.<>?/`~]/.test(password)) {
            requirements.hasSpecial = true;
        } else {
            errors.push('Kata sandi harus memuat minimal satu karakter spesial');
        }
    }

    // Must not contain the username (case-insensitive) — the backend rule that most often
    // rejects an otherwise-"green" password. Only meaningful for usernames of 3+ chars.
    const uname = String(username || '').trim().toLowerCase();
    if (uname.length >= 3 && password.toLowerCase().includes(uname)) {
        requirements.noUsername = false;
        errors.push('Kata sandi tidak boleh memuat username Anda');
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
function PasswordRequirementsDisplay({ password, username = '' }) {
    const { requirements } = validatePassword(password || '', username);

    const items = [
        { key: 'minLength', label: `Minimal ${PASSWORD_REQUIREMENTS.minLength} karakter`, met: requirements.minLength },
        { key: 'hasUppercase', label: 'Ada huruf besar', met: requirements.hasUppercase },
        { key: 'hasLowercase', label: 'Ada huruf kecil', met: requirements.hasLowercase },
        { key: 'hasNumber', label: 'Ada angka', met: requirements.hasNumber },
    ];

    if (PASSWORD_REQUIREMENTS.requireSpecial) {
        items.push({ key: 'hasSpecial', label: 'Ada karakter spesial', met: requirements.hasSpecial });
    }

    if (username) {
        items.push({ key: 'noUsername', label: 'Tidak memuat username', met: requirements.noUsername });
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
                            <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        )}
                        <span className={item.met ? 'text-emerald-600 dark:text-emerald-400' : 'text-content-muted'}>
                            {item.label}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function UserManagement() {
    const { formatDateTime } = useTimezone();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showSelfDeleteWarning, setShowSelfDeleteWarning] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [passwordUser, setPasswordUser] = useState(null);
    const [formData, setFormData] = useState({ username: '', password: '', role: 'admin', phone: '', email: '' });
    const [passwordData, setPasswordData] = useState({ password: '', confirmPassword: '' });
    const [error, setError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});
    const currentUser = authService.getCurrentUser();
    const { success, error: showError } = useNotification();
    const confirm = useConfirm();

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
            setLoadError('Gagal memuat daftar pengguna. Coba lagi.');
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingUser(null);
        setFormData({ username: '', password: '', role: 'admin', phone: '', email: '' });
        setError('');
        setFieldErrors({});
        setShowModal(true);
    };

    const openEditModal = (user) => {
        setEditingUser(user);
        setFormData({ username: user.username, password: '', role: user.role, phone: user.phone || '', email: user.email || '' });
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
            errors.username = 'Username wajib diisi';
        } else if (formData.username.length < 3) {
            errors.username = 'Username minimal 3 karakter';
        } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
            errors.username = 'Username hanya boleh berisi huruf, angka, dan garis bawah';
        }

        // Password validation (only for new users)
        if (!editingUser) {
            const passwordValidation = validatePassword(formData.password, formData.username);
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
                    role: formData.role,
                    phone: formData.phone || undefined,
                    email: formData.email || undefined,
                });
                if (result.success) {
                    success('Pengguna Diperbarui', `${formData.username} berhasil diperbarui`);
                    setShowModal(false);
                    loadUsers();
                } else {
                    // Handle duplicate username
                    if (result.message?.toLowerCase().includes('username')) {
                        setFieldErrors({ ...fieldErrors, username: 'Username sudah dipakai' });
                    } else {
                        setError(result.message);
                    }
                    showError('Gagal Memperbarui', result.message || 'Gagal memperbarui pengguna');
                }
            } else {
                result = await userService.createUser(formData);
                if (result.success) {
                    success('Pengguna Dibuat', `${formData.username} berhasil dibuat`);
                    setShowModal(false);
                    loadUsers();
                } else {
                    // Handle duplicate username
                    if (result.message?.toLowerCase().includes('username')) {
                        setFieldErrors({ ...fieldErrors, username: 'Username sudah dipakai' });
                    } else {
                        setError(result.message);
                    }
                    showError('Gagal Membuat', result.message || 'Gagal membuat pengguna');
                }
            }
        } catch (err) {
            const errorMsg = err.response?.data?.message || 'Terjadi kesalahan';
            // Handle duplicate username from API error
            if (errorMsg.toLowerCase().includes('username')) {
                setFieldErrors({ ...fieldErrors, username: 'Username sudah dipakai' });
            } else {
                setError(errorMsg);
            }
            showError('Kesalahan', errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        setPasswordError('');
        
        // Validate password match
        if (passwordData.password !== passwordData.confirmPassword) {
            setPasswordError('Kata sandi tidak cocok');
            return;
        }
        
        // Validate password requirements (incl. "not containing the username")
        const passwordValidation = validatePassword(passwordData.password, passwordUser?.username);
        if (!passwordValidation.isValid) {
            setPasswordError(passwordValidation.errors[0]);
            return;
        }

        setSubmitting(true);
        try {
            const result = await userService.changeUserPassword(passwordUser.id, passwordData.password);
            if (result.success) {
                success('Kata Sandi Diubah', `Kata sandi ${passwordUser.username} berhasil diubah`);
                setShowPasswordModal(false);
            } else {
                const msg = result.errors?.[0] || result.message;
                setPasswordError(msg);
                showError('Gagal Mengubah Kata Sandi', msg || 'Gagal mengubah kata sandi');
            }
        } catch (err) {
            const data = err.response?.data;
            // Surface the SPECIFIC backend reason (e.g. "Password has been used recently",
            // common-password) instead of the generic "does not meet requirements".
            const errorMsg = (Array.isArray(data?.errors) && data.errors[0]) || data?.message || 'Failed to change password';
            setPasswordError(errorMsg);
            showError('Kesalahan', errorMsg);
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
        if (!(await confirm({ title: `Hapus pengguna "${user.username}"?`, message: 'Tindakan ini tidak bisa dibatalkan.', confirmLabel: 'Hapus', tone: 'danger' }))) return;
        try {
            const result = await userService.deleteUser(user.id);
            if (result.success) {
                success('Pengguna Dihapus', `${user.username} berhasil dihapus`);
                loadUsers();
            } else {
                showError('Gagal Menghapus', result.message || 'Gagal menghapus pengguna');
            }
        } catch (err) {
            const errorMsg = err.response?.data?.message || 'Failed to delete user';
            showError('Kesalahan', errorMsg);
        }
    };

    const formatDate = (dateString) => {
        return formatDateTime(dateString, {
            storage: TIMESTAMP_STORAGE.UTC_SQL,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const roleTone = (role) => (role === 'admin' ? 'brand' : role === 'customer' ? 'data' : 'neutral');

    return (
        <div className="space-y-5">
            <PageHeader
                title="Pengguna"
                description="Kelola akun administrator, viewer, dan pelanggan."
                actions={(
                    <Button variant="primary" onClick={openAddModal} icon={<PlusIcon />}>
                        Tambah Pengguna
                    </Button>
                )}
            />

            {loading ? (
                <TableSkeleton rows={5} columns={4} />
            ) : loadError ? (
                <Card padding="lg">
                    <Alert type="error" title="Gagal memuat pengguna" message={loadError} className="mb-4" />
                    <Button onClick={loadUsers}>Coba lagi</Button>
                </Card>
            ) : users.length === 0 ? (
                <Card padding="none">
                    <NoUsersEmptyState onAddUser={openAddModal} />
                </Card>
            ) : (
                <TableShell>
                    <Table>
                        <THead>
                            <TR>
                                <TH>Pengguna</TH>
                                <TH>Peran</TH>
                                <TH>Dibuat</TH>
                                <TH align="right">Aksi</TH>
                            </TR>
                        </THead>
                        <TBody>
                            {users.map((user) => {
                                const isSelf = user.id === currentUser?.id;
                                return (
                                    <TR key={user.id} interactive>
                                        <TD>
                                            <div className="flex items-center gap-3">
                                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                                                    {user.username.charAt(0).toUpperCase()}
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="flex items-center gap-2 font-semibold text-content">
                                                        <span className="truncate">{user.username}</span>
                                                        {isSelf && <Badge tone="brand">Anda</Badge>}
                                                    </p>
                                                    <p className="font-mono text-xs tabular-nums text-content-subtle">ID {user.id}</p>
                                                </div>
                                            </div>
                                        </TD>
                                        <TD>
                                            <Badge tone={roleTone(user.role)}>{user.role}</Badge>
                                        </TD>
                                        <TD mono className="text-xs text-content-muted">
                                            {formatDate(user.created_at)}
                                        </TD>
                                        <TD align="right">
                                            <div className="flex items-center justify-end gap-1">
                                                <IconButton label={'Ubah ' + user.username} size="sm" onClick={() => openEditModal(user)}>
                                                    <EditIcon />
                                                </IconButton>
                                                <IconButton label={'Ganti kata sandi ' + user.username} size="sm" onClick={() => openPasswordModal(user)}>
                                                    <KeyIcon />
                                                </IconButton>
                                                <IconButton
                                                    label={isSelf ? 'Tidak bisa menghapus akun sendiri' : 'Hapus ' + user.username}
                                                    size="sm"
                                                    variant={isSelf ? 'ghost' : 'dangerGhost'}
                                                    disabled={isSelf}
                                                    onClick={() => handleDeleteAttempt(user)}
                                                >
                                                    <TrashIcon />
                                                </IconButton>
                                            </div>
                                        </TD>
                                    </TR>
                                );
                            })}
                        </TBody>
                    </Table>
                </TableShell>
            )}

            {showSelfDeleteWarning && (
                <Modal
                    title="Tidak bisa menghapus akun sendiri"
                    description="Tindakan ini tidak diizinkan"
                    size="sm"
                    onClose={() => setShowSelfDeleteWarning(false)}
                    footer={<Button variant="primary" onClick={() => setShowSelfDeleteWarning(false)}>Saya mengerti</Button>}
                >
                    <p className="text-sm text-content-muted">
                        Anda tidak bisa menghapus akun yang sedang dipakai untuk login. Minta administrator lain
                        melakukannya jika akun ini memang harus dihapus.
                    </p>
                </Modal>
            )}

            {showModal && (
                <Modal
                    title={editingUser ? 'Ubah Pengguna' : 'Tambah Pengguna'}
                    description={editingUser ? 'Perbarui data pengguna' : 'Buat akun baru'}
                    size="md"
                    onClose={() => setShowModal(false)}
                    footer={(
                        <>
                            <Button onClick={() => setShowModal(false)} disabled={submitting}>Batal</Button>
                            <Button type="submit" form="user-form" variant="primary" loading={submitting}>
                                {editingUser ? 'Simpan' : 'Buat'}
                            </Button>
                        </>
                    )}
                >
                    <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
                        {error && <Alert type="error" message={error} dismissible onDismiss={() => setError('')} />}

                        <Field
                            label="Nama pengguna"
                            name="username"
                            value={formData.username}
                            onChange={handleChange}
                            error={fieldErrors.username}
                            hint="Huruf, angka, dan garis bawah saja"
                            placeholder="Masukkan nama pengguna"
                            required
                            minLength={3}
                        />

                        {!editingUser && (
                            <div>
                                <Field
                                    label="Kata sandi"
                                    name="password"
                                    type="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    error={fieldErrors.password}
                                    placeholder="Masukkan kata sandi"
                                    required
                                />
                                <PasswordRequirementsDisplay password={formData.password} username={formData.username} />
                            </div>
                        )}

                        <Field
                            as="select"
                            label="Peran"
                            name="role"
                            value={formData.role}
                            onChange={handleChange}
                            hint={formData.role === 'customer'
                                ? 'Pelanggan hanya bisa mengakses portal /my (kamera miliknya + saldo), tidak bisa membuka halaman admin.'
                                : undefined}
                        >
                            <option value="admin">Admin</option>
                            <option value="viewer">Viewer</option>
                            <option value="customer">Customer (Pelanggan Sewa)</option>
                        </Field>

                        {formData.role === 'customer' && (
                            <>
                                <Field
                                    label="No. HP (untuk tagihan)"
                                    name="phone"
                                    type="tel"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    placeholder="08xxxxxxxxxx"
                                />
                                <Field
                                    label="Email (opsional)"
                                    name="email"
                                    type="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    placeholder="pelanggan@email.com"
                                />
                            </>
                        )}
                    </form>
                </Modal>
            )}

            {showPasswordModal && passwordUser && (
                <Modal
                    title="Ganti Kata Sandi"
                    description={'Untuk ' + passwordUser.username}
                    size="md"
                    onClose={() => setShowPasswordModal(false)}
                    footer={(
                        <>
                            <Button onClick={() => setShowPasswordModal(false)} disabled={submitting}>Batal</Button>
                            <Button type="submit" form="password-form" variant="primary" loading={submitting}>
                                Ganti Kata Sandi
                            </Button>
                        </>
                    )}
                >
                    <form id="password-form" onSubmit={handlePasswordSubmit} className="space-y-4">
                        {passwordError && (
                            <Alert type="error" message={passwordError} dismissible onDismiss={() => setPasswordError('')} />
                        )}

                        <div>
                            <Field
                                label="Kata sandi baru"
                                name="password"
                                type="password"
                                value={passwordData.password}
                                onChange={handlePasswordChange}
                                placeholder="Masukkan kata sandi baru"
                                required
                            />
                            <PasswordRequirementsDisplay password={passwordData.password} username={passwordUser?.username} />
                        </div>

                        <Field
                            label="Konfirmasi kata sandi"
                            name="confirmPassword"
                            type="password"
                            value={passwordData.confirmPassword}
                            onChange={handlePasswordChange}
                            error={passwordData.confirmPassword && passwordData.password !== passwordData.confirmPassword
                                ? 'Kata sandi tidak cocok'
                                : undefined}
                            placeholder="Ulangi kata sandi"
                            required
                        />
                    </form>
                </Modal>
            )}
        </div>
    );
}
