import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { useTheme } from '../contexts/ThemeContext';
import { useNotification } from '../contexts/NotificationContext';

// Icons
const Icons = {
    Lock: () => (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
    ),
    User: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
    ),
    Key: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
        </svg>
    ),
    Eye: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
    ),
    EyeOff: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
        </svg>
    ),
    ArrowLeft: () => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
    ),
    Alert: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
    ),
    Warning: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
    ),
    Clock: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
    Sun: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        </svg>
    ),
    Moon: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
    ),
    Loader: () => (
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
        </svg>
    ),
};

/**
 * Format seconds into human-readable time
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
    if (seconds < 60) {
        return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    return `${minutes}m ${remainingSeconds}s`;
}

export default function LoginPage() {
    const navigate = useNavigate();
    const { isDark, toggleTheme } = useTheme();
    const { success: showSuccess } = useNotification();
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    
    // Field-level validation errors (Requirements: 2.1, 2.2, 2.9)
    const [fieldErrors, setFieldErrors] = useState({ username: '', password: '' });
    
    // Password expiry warning (Requirements: 2.8)
    const [passwordExpiryDays, setPasswordExpiryDays] = useState(null);
    
    // Rate limiting / lockout state
    const [isRateLimited, setIsRateLimited] = useState(false);
    const [retryCountdown, setRetryCountdown] = useState(0);
    const [attemptsRemaining, setAttemptsRemaining] = useState(null);
    
    // Lockout state (Requirements: 2.4)
    const [isLocked, setIsLocked] = useState(false);
    const [lockoutCountdown, setLockoutCountdown] = useState(0);

    // Countdown timer for rate limiting
    useEffect(() => {
        if (retryCountdown > 0) {
            const timer = setTimeout(() => {
                setRetryCountdown(prev => prev - 1);
            }, 1000);
            return () => clearTimeout(timer);
        } else if (retryCountdown === 0 && isRateLimited) {
            setIsRateLimited(false);
            setError('');
        }
    }, [retryCountdown, isRateLimited]);

    // Countdown timer for account lockout (Requirements: 2.4)
    useEffect(() => {
        if (lockoutCountdown > 0) {
            const timer = setTimeout(() => {
                setLockoutCountdown(prev => prev - 1);
            }, 1000);
            return () => clearTimeout(timer);
        } else if (lockoutCountdown === 0 && isLocked) {
            setIsLocked(false);
            setError('');
        }
    }, [lockoutCountdown, isLocked]);

    // Clear field error when user starts typing (Requirements: 2.9)
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
        
        // Clear field-specific error when user types
        if (fieldErrors[name]) {
            setFieldErrors(prev => ({ ...prev, [name]: '' }));
        }
        
        setError('');
        setWarning('');
    };

    // Validate individual field (Requirements: 2.1, 2.2)
    const validateField = (name, value) => {
        if (name === 'username' && !value.trim()) {
            return 'Username is required';
        }
        if (name === 'password' && !value) {
            return 'Password is required';
        }
        return '';
    };

    // Handle field blur for validation highlighting (Requirements: 2.9)
    const handleBlur = (e) => {
        const { name, value } = e.target;
        const error = validateField(name, value);
        setFieldErrors(prev => ({ ...prev, [name]: error }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Don't allow submission if rate limited or locked
        if ((isRateLimited && retryCountdown > 0) || (isLocked && lockoutCountdown > 0)) {
            return;
        }
        
        // Field-level validation (Requirements: 2.1, 2.2)
        const usernameError = validateField('username', formData.username);
        const passwordError = validateField('password', formData.password);
        
        if (usernameError || passwordError) {
            setFieldErrors({
                username: usernameError,
                password: passwordError
            });
            return;
        }
        
        setLoading(true);
        setError('');
        setWarning('');
        setFieldErrors({ username: '', password: '' });
        
        try {
            const result = await authService.login(formData.username, formData.password);
            
            if (result.success) {
                // Check for password expiry warning (Requirements: 2.8)
                if (result.passwordExpiryWarning) {
                    sessionStorage.setItem('passwordExpiryWarning', result.passwordExpiryWarning);
                    // Extract days from warning message if available
                    const daysMatch = result.passwordExpiryWarning.match(/(\d+)\s*day/i);
                    if (daysMatch) {
                        setPasswordExpiryDays(parseInt(daysMatch[1], 10));
                    }
                }
                
                // Show success toast (Requirements: 2.10)
                showSuccess('Login Successful', 'Welcome back! Redirecting to dashboard...');
                
                // Small delay to show the toast before redirect
                setTimeout(() => {
                    navigate('/admin/dashboard');
                }, 500);
            } else {
                handleLoginError(result);
                setLoading(false);
            }
        } catch (err) {
            // Network error handling (Requirements: 2.6)
            if (!navigator.onLine || err.message === 'Network Error') {
                setError('Unable to connect to server. Please check your connection.');
            } else {
                // Server error handling (Requirements: 2.7)
                setError('Server error occurred. Please try again later.');
            }
            setLoading(false);
        }
    };

    // Handle different login error types (Requirements: 2.3, 2.4, 2.5, 2.6, 2.7)
    const handleLoginError = (result) => {
        // Handle rate limiting (Requirements: 2.5)
        if (result.isRateLimited) {
            setIsRateLimited(true);
            const retryTime = result.retryAfter || 60;
            setRetryCountdown(retryTime);
            setError(`Too many attempts. Please wait ${formatTime(retryTime)}.`);
            return;
        }
        
        // Handle account lockout (Requirements: 2.4)
        if (result.isLocked) {
            setIsLocked(true);
            const lockoutSeconds = result.lockoutRemaining 
                ? Math.ceil(result.lockoutRemaining / 1000)
                : 1800; // Default 30 minutes
            setLockoutCountdown(lockoutSeconds);
            setError(`Account temporarily locked due to too many failed attempts.`);
            return;
        }
        
        // Handle progressive delay warning
        if (result.attemptsRemaining !== null && result.attemptsRemaining <= 2) {
            setWarning(`Warning: ${result.attemptsRemaining} attempt${result.attemptsRemaining !== 1 ? 's' : ''} remaining before lockout.`);
            setAttemptsRemaining(result.attemptsRemaining);
        }
        
        // Handle security errors (CSRF, API key issues)
        if (result.isSecurityError) {
            setError(result.message || 'Security validation failed. Please refresh the page.');
            setWarning('If this persists, please refresh the page.');
            return;
        }
        
        // Handle invalid credentials (Requirements: 2.3)
        if (result.message?.toLowerCase().includes('invalid') || 
            result.message?.toLowerCase().includes('credentials')) {
            setError('Invalid username or password. Please check your credentials.');
            return;
        }
        
        // Default error message
        setError(result.message || 'Login failed. Please try again.');
    };

    const isSubmitDisabled = loading || (isRateLimited && retryCountdown > 0) || (isLocked && lockoutCountdown > 0);

    // Get field error class for styling (Requirements: 2.9)
    const getFieldClass = (fieldName) => {
        const baseClass = "w-full pl-12 pr-4 py-3.5 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed";
        
        if (fieldErrors[fieldName]) {
            return `${baseClass} border-red-500 dark:border-red-500 focus:ring-red-500`;
        }
        return `${baseClass} border-gray-200 dark:border-gray-700/50 focus:ring-sky-500`;
    };

    // Password field needs different padding for the eye button
    const getPasswordFieldClass = () => {
        const baseClass = "w-full pl-12 pr-12 py-3.5 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed";
        
        if (fieldErrors.password) {
            return `${baseClass} border-red-500 dark:border-red-500 focus:ring-red-500`;
        }
        return `${baseClass} border-gray-200 dark:border-gray-700/50 focus:ring-sky-500`;
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 px-4 py-8 transition-colors">
            {/* Background decoration */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
            </div>
            
            {/* Theme Toggle */}
            <button
                onClick={toggleTheme}
                className="fixed top-4 right-4 p-3 rounded-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm shadow-lg border border-gray-200/50 dark:border-gray-700/50 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-all z-50"
            >
                {isDark ? <Icons.Sun /> : <Icons.Moon />}
            </button>

            <div className="relative w-full max-w-md">
                {/* Logo & Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-sky-500 to-blue-600 rounded-2xl shadow-2xl shadow-sky-500/30 mb-6 text-white">
                        <Icons.Lock />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Welcome Back
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400">
                        Sign in to RAF NET Admin Panel
                    </p>
                </div>

                {/* Login Card */}
                <div className="bg-white/80 dark:bg-gray-800/50 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-8">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Error Alert */}
                        {error && (
                            <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl">
                                <div className="text-red-500 flex-shrink-0">
                                    {(isRateLimited || isLocked) ? <Icons.Clock /> : <Icons.Alert />}
                                </div>
                                <div className="flex-1">
                                    <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
                                    {/* Rate limit countdown (Requirements: 2.5) */}
                                    {isRateLimited && retryCountdown > 0 && (
                                        <p className="text-red-500 dark:text-red-300 text-xs mt-1">
                                            Retry in: <span className="font-mono font-semibold">{formatTime(retryCountdown)}</span>
                                        </p>
                                    )}
                                    {/* Lockout countdown (Requirements: 2.4) */}
                                    {isLocked && lockoutCountdown > 0 && (
                                        <p className="text-red-500 dark:text-red-300 text-xs mt-1">
                                            Try again in: <span className="font-mono font-semibold">{formatTime(lockoutCountdown)}</span>
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Warning Alert */}
                        {warning && (
                            <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl">
                                <div className="text-amber-500 flex-shrink-0"><Icons.Warning /></div>
                                <div className="flex-1">
                                    <p className="text-amber-600 dark:text-amber-400 text-sm font-medium">{warning}</p>
                                    {attemptsRemaining !== null && attemptsRemaining <= 2 && (
                                        <p className="text-amber-500 dark:text-amber-300 text-xs mt-1">
                                            Attempts remaining: <span className="font-semibold">{attemptsRemaining}</span>
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Password Expiry Warning (Requirements: 2.8) */}
                        {passwordExpiryDays !== null && passwordExpiryDays <= 7 && (
                            <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl">
                                <div className="text-amber-500 flex-shrink-0"><Icons.Warning /></div>
                                <div className="flex-1">
                                    <p className="text-amber-600 dark:text-amber-400 text-sm font-medium">
                                        Password Expiring Soon
                                    </p>
                                    <p className="text-amber-500 dark:text-amber-300 text-xs mt-1">
                                        Your password will expire in {passwordExpiryDays} day{passwordExpiryDays !== 1 ? 's' : ''}. 
                                        Please change it after logging in.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Username Field */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Username
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 dark:text-gray-500">
                                    <Icons.User />
                                </div>
                                <input
                                    type="text"
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    onBlur={handleBlur}
                                    className={getFieldClass('username')}
                                    placeholder="Enter your username"
                                    disabled={isSubmitDisabled}
                                    autoComplete="username"
                                />
                            </div>
                            {/* Field-level error (Requirements: 2.1, 2.9) */}
                            {fieldErrors.username && (
                                <p className="mt-1.5 text-sm text-red-500 dark:text-red-400 flex items-center gap-1">
                                    <Icons.Alert />
                                    {fieldErrors.username}
                                </p>
                            )}
                        </div>

                        {/* Password Field */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 dark:text-gray-500">
                                    <Icons.Key />
                                </div>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    onBlur={handleBlur}
                                    className={getPasswordFieldClass()}
                                    placeholder="Enter your password"
                                    disabled={isSubmitDisabled}
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
                                    disabled={isSubmitDisabled}
                                >
                                    {showPassword ? <Icons.EyeOff /> : <Icons.Eye />}
                                </button>
                            </div>
                            {/* Field-level error (Requirements: 2.2, 2.9) */}
                            {fieldErrors.password && (
                                <p className="mt-1.5 text-sm text-red-500 dark:text-red-400 flex items-center gap-1">
                                    <Icons.Alert />
                                    {fieldErrors.password}
                                </p>
                            )}
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isSubmitDisabled}
                            className="w-full flex items-center justify-center gap-2 py-4 px-4 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-sky-500/30 hover:shadow-xl hover:shadow-sky-500/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-sky-500 disabled:hover:to-blue-600 transition-all"
                        >
                            {loading ? (
                                <>
                                    <Icons.Loader />
                                    <span>Signing in...</span>
                                </>
                            ) : isLocked && lockoutCountdown > 0 ? (
                                <>
                                    <Icons.Clock />
                                    <span>Locked - {formatTime(lockoutCountdown)}</span>
                                </>
                            ) : isRateLimited && retryCountdown > 0 ? (
                                <>
                                    <Icons.Clock />
                                    <span>Wait {formatTime(retryCountdown)}</span>
                                </>
                            ) : (
                                <span>Sign In</span>
                            )}
                        </button>
                    </form>

                    {/* Back Link */}
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700/50">
                        <a
                            href="/"
                            className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-sky-500 dark:hover:text-sky-400 transition-colors"
                        >
                            <Icons.ArrowLeft />
                            <span>Back to public view</span>
                        </a>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-gray-400 dark:text-gray-600 text-xs mt-6">
                    Authorized personnel only. All access is logged.
                </p>
            </div>
        </div>
    );
}
