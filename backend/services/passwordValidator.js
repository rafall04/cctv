import { getSecuritySettings } from './securitySettingsService.js';

/**
 * Password Validator Service
 * Validates passwords against security policies.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4
 * 
 * - Minimum 12 characters
 * - Require uppercase, lowercase, numbers, special chars
 * - Check against common password list (top 10000)
 * - Check password doesn't contain username
 */

/**
 * Password policy configuration
 */
/*
 * DEFAULTS ONLY. minLength / maxAge / historyCount used to be the live policy here while
 * PASSWORD_MIN_LENGTH, PASSWORD_MAX_AGE_DAYS and PASSWORD_HISTORY_COUNT sat in .env being read by
 * nothing — an operator could set PASSWORD_MIN_LENGTH=20 and passwords of 12 kept being accepted.
 * getPasswordPolicy() below is the live one (admin panel -> .env -> these).
 *
 * The character-class requirements stay fixed on purpose: they are not worth a knob, and every one
 * of them is mirrored by frontend UserManagement's live checklist, which cannot ask the server per
 * keystroke.
 */
export const PASSWORD_POLICY = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecial: true,
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days in milliseconds
    historyCount: 5,
    specialChars: '!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~'
};

/**
 * The password policy in force right now. Re-read per call so a change saved in the admin panel
 * applies to the very next password set.
 * @returns {typeof PASSWORD_POLICY}
 */
export function getPasswordPolicy() {
    const s = getSecuritySettings();
    return {
        ...PASSWORD_POLICY,
        minLength: s.passwordMinLength,
        maxAge: s.passwordMaxAgeDays * 24 * 60 * 60 * 1000,
        historyCount: s.passwordHistoryCount,
    };
}

/**
 * Top 100 most common passwords (subset of top 10000)
 * In production, this would be loaded from a file with 10000 entries
 */
const COMMON_PASSWORDS = new Set([
    'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', '1234567',
    'letmein', 'trustno1', 'dragon', 'baseball', 'iloveyou', 'master', 'sunshine',
    'ashley', 'bailey', 'passw0rd', 'shadow', '123123', '654321', 'superman',
    'qazwsx', 'michael', 'football', 'password1', 'password123', 'batman',
    'login', 'admin', 'admin123', 'root', 'toor', 'pass', 'test', 'guest',
    'master123', 'changeme', 'welcome', 'welcome1', 'welcome123', 'p@ssw0rd',
    'p@ssword', 'passw0rd!', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
    '1234567890', '0987654321', 'password!', 'password1!', 'letmein123',
    'access', 'access123', 'mustang', 'shadow123', 'michael1', 'jennifer',
    'hunter', 'hunter2', 'harley', 'ranger', 'thomas', 'robert', 'jordan',
    'daniel', 'andrew', 'joshua', 'matthew', 'anthony', 'william', 'david',
    'richard', 'charles', 'joseph', 'christopher', 'jessica', 'amanda',
    'melissa', 'sarah', 'nicole', 'stephanie', 'heather', 'elizabeth',
    'michelle', 'samantha', 'ashley1', 'nicole1', 'jessica1', 'computer',
    'internet', 'server', 'network', 'security', 'secret', 'private',
    'public', 'default', 'system', 'administrator', 'user', 'username',
    '111111', '222222', '333333', '444444', '555555', '666666', '777777',
    '888888', '999999', '000000', 'aaaaaa', 'abcdef', 'abcd1234'
]);

/**
 * Validate password against all policy requirements
 * @param {string} password - Password to validate
 * @param {string} username - Username (to check if password contains it)
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validatePassword(password, username = '') {
    const errors = [];
    
    // Check if password is provided
    // Indonesian: these strings are shown verbatim to the user on the public /daftar
    // form and in the admin password-change flow, both of which are Indonesian.
    if (!password || typeof password !== 'string') {
        return { valid: false, errors: ['Kata sandi wajib diisi'] };
    }

    // Check minimum length (Requirement 6.1)
    if (password.length < getPasswordPolicy().minLength) {
        errors.push(`Kata sandi minimal ${getPasswordPolicy().minLength} karakter`);
    }

    // Check for uppercase letter (Requirement 6.2)
    if (getPasswordPolicy().requireUppercase && !/[A-Z]/.test(password)) {
        errors.push('Kata sandi harus memuat minimal satu huruf besar');
    }

    // Check for lowercase letter (Requirement 6.2)
    if (getPasswordPolicy().requireLowercase && !/[a-z]/.test(password)) {
        errors.push('Kata sandi harus memuat minimal satu huruf kecil');
    }

    // Check for number (Requirement 6.2)
    if (getPasswordPolicy().requireNumbers && !/[0-9]/.test(password)) {
        errors.push('Kata sandi harus memuat minimal satu angka');
    }

    // Check for special character (Requirement 6.2)
    if (getPasswordPolicy().requireSpecial) {
        const specialCharRegex = /[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/`~]/;
        if (!specialCharRegex.test(password)) {
            errors.push('Kata sandi harus memuat minimal satu karakter spesial (!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~)');
        }
    }

    // Check against common passwords (Requirement 6.3)
    if (isCommonPassword(password)) {
        errors.push('Kata sandi terlalu umum. Pilih kata sandi yang lebih unik');
    }

    // Check if password contains username (Requirement 6.4)
    if (username && containsUsername(password, username)) {
        errors.push('Kata sandi tidak boleh memuat username Anda');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Check if password is in common password list
 * @param {string} password - Password to check
 * @returns {boolean} True if password is common
 */
export function isCommonPassword(password) {
    if (!password) return false;
    
    // Check lowercase version
    const lowerPassword = password.toLowerCase();
    
    // Direct match
    if (COMMON_PASSWORDS.has(lowerPassword)) {
        return true;
    }
    
    // Check without numbers at the end (e.g., "password123" -> "password")
    const withoutTrailingNumbers = lowerPassword.replace(/\d+$/, '');
    if (withoutTrailingNumbers !== lowerPassword && COMMON_PASSWORDS.has(withoutTrailingNumbers)) {
        return true;
    }
    
    // Check without special chars at the end (e.g., "password!" -> "password")
    const withoutTrailingSpecial = lowerPassword.replace(/[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/`~]+$/, '');
    if (withoutTrailingSpecial !== lowerPassword && COMMON_PASSWORDS.has(withoutTrailingSpecial)) {
        return true;
    }
    
    return false;
}

/**
 * Check if password contains username (case-insensitive)
 * @param {string} password - Password to check
 * @param {string} username - Username to check against
 * @returns {boolean} True if password contains username
 */
export function containsUsername(password, username) {
    if (!password || !username) return false;
    
    // Case-insensitive check
    const lowerPassword = password.toLowerCase();
    const lowerUsername = username.toLowerCase();
    
    // Check if password contains username
    if (lowerPassword.includes(lowerUsername)) {
        return true;
    }
    
    // Check if password contains reversed username (for longer usernames)
    if (lowerUsername.length >= 4) {
        const reversedUsername = lowerUsername.split('').reverse().join('');
        if (lowerPassword.includes(reversedUsername)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Check password strength (for UI feedback)
 * @param {string} password - Password to check
 * @returns {Object} { score: number (0-4), label: string }
 */
export function getPasswordStrength(password) {
    if (!password) {
        return { score: 0, label: 'Very Weak' };
    }
    
    let score = 0;
    
    // Length scoring
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (password.length >= 16) score++;
    
    // Character variety scoring
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/`~]/.test(password)) score++;
    
    // Penalty for common patterns
    if (isCommonPassword(password)) score = Math.max(0, score - 2);
    if (/^[a-zA-Z]+$/.test(password)) score = Math.max(0, score - 1);
    if (/^[0-9]+$/.test(password)) score = Math.max(0, score - 1);
    
    // Normalize score to 0-4
    score = Math.min(4, Math.max(0, Math.floor(score / 2)));
    
    const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
    
    return {
        score,
        label: labels[score]
    };
}

/**
 * Get password policy requirements as human-readable list
 * @returns {string[]} List of requirements
 */
export function getPasswordRequirements() {
    // Indonesian: this list is rendered verbatim on the PUBLIC /daftar form, where an
    // English policy block sat in the middle of an otherwise Indonesian page.
    const requirements = [];

    requirements.push(`Minimal ${getPasswordPolicy().minLength} karakter`);

    if (getPasswordPolicy().requireUppercase) {
        requirements.push('Ada huruf besar (A-Z)');
    }

    if (getPasswordPolicy().requireLowercase) {
        requirements.push('Ada huruf kecil (a-z)');
    }

    if (getPasswordPolicy().requireNumbers) {
        requirements.push('Ada angka (0-9)');
    }

    if (getPasswordPolicy().requireSpecial) {
        requirements.push('Ada karakter spesial (!@#$%^&*...)');
    }

    requirements.push('Bukan kata sandi yang umum dipakai');
    requirements.push('Tidak boleh memuat username Anda');

    return requirements;
}

export default {
    PASSWORD_POLICY,
    validatePassword,
    isCommonPassword,
    containsUsername,
    getPasswordStrength,
    getPasswordRequirements
};
