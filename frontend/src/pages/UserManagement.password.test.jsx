/*
 * Purpose: Guard that the admin password meter mirrors the backend policy — so a "green"
 *          password can't be rejected by the server. Covers the 12-char + special rule and
 *          the "must not contain the username" rule (the actual prod failure).
 * Caller: Frontend focused test gate.
 * Deps: vitest; imports the pure validators exported from UserManagement.
 */

import { describe, it, expect } from 'vitest';
import { validatePassword, PASSWORD_REQUIREMENTS } from './UserManagement';

describe('UserManagement.validatePassword (mirrors backend policy)', () => {
    it('enforces 12+ chars with upper/lower/number/special', () => {
        expect(PASSWORD_REQUIREMENTS.minLength).toBe(12);
        expect(PASSWORD_REQUIREMENTS.requireSpecial).toBe(true);
        expect(validatePassword('Short1!').isValid).toBe(false);        // too short
        expect(validatePassword('alllowercase1!').isValid).toBe(false); // no uppercase
        expect(validatePassword('NoSpecialChar1').isValid).toBe(false); // no special char
        expect(validatePassword('ValidPass123!').isValid).toBe(true);   // 13 chars, all classes
    });

    it('rejects a password containing the username (the "green but rejected" case)', () => {
        const res = validatePassword('Admin1234567!', 'admin');
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Password cannot contain the username');
        expect(res.requirements.noUsername).toBe(false);
        // The same password is fine for an unrelated username.
        expect(validatePassword('Admin1234567!', 'budi').isValid).toBe(true);
    });
});
