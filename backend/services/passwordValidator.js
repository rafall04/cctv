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
    if (!password || typeof password !== 'string') {
        return { valid: false, errors: ['Password is required'] };
    }
    
    // Check minimum length (Requirement 6.1)
    if (password.length < PASSWORD_POLICY.minLength) {
        errors.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters`);
    }
    
    // Check for uppercase letter (Requirement 6.2)
    if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    
    // Check for lowercase letter (Requirement 6.2)
    if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    
    // Check for number (Requirement 6.2)
    if (PASSWORD_POLICY.requireNumbers && !/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    
    // Check for special character (Requirement 6.2)
    if (PASSWORD_POLICY.requireSpecial) {
        const specialCharRegex = /[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/`~]/;
        if (!specialCharRegex.test(password)) {
            errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~)');
        }
    }
    
    // Check against common passwords (Requirement 6.3)
    if (isCommonPassword(password)) {
        errors.push('Password is too common. Please choose a more unique password');
    }
    
    // Check if password contains username (Requirement 6.4)
    if (username && containsUsername(password, username)) {
        errors.push('Password cannot contain your username');
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
    const requirements = [];
    
    requirements.push(`At least ${PASSWORD_POLICY.minLength} characters`);
    
    if (PASSWORD_POLICY.requireUppercase) {
        requirements.push('At least one uppercase letter (A-Z)');
    }
    
    if (PASSWORD_POLICY.requireLowercase) {
        requirements.push('At least one lowercase letter (a-z)');
    }
    
    if (PASSWORD_POLICY.requireNumbers) {
        requirements.push('At least one number (0-9)');
    }
    
    if (PASSWORD_POLICY.requireSpecial) {
        requirements.push('At least one special character (!@#$%^&*...)');
    }
    
    requirements.push('Cannot be a commonly used password');
    requirements.push('Cannot contain your username');
    
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
