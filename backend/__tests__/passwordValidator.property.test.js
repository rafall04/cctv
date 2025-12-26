/**
 * Property-Based Tests for Password Validation
 * 
 * **Property 9: Password Complexity Validation**
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
 * 
 * Feature: api-security-hardening, Property 9: Password Complexity Validation
 * 
 * For any password submitted for creation or change, the password SHALL be rejected if it:
 * - has fewer than 12 characters
 * - lacks uppercase letters
 * - lacks lowercase letters
 * - lacks numbers
 * - lacks special characters
 * - matches a common password
 * - contains the username
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    PASSWORD_POLICY,
    validatePassword,
    isCommonPassword,
    containsUsername,
    getPasswordStrength,
    getPasswordRequirements
} from '../services/passwordValidator.js';

describe('Password Validator Property Tests', () => {
    /**
     * Property 9: Password Complexity Validation
     * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
     */
    describe('Property 9: Password Complexity Validation', () => {
        
        /**
         * Property 9.1: Passwords shorter than 12 characters are rejected
         * **Validates: Requirement 6.1**
         */
        it('Passwords shorter than 12 characters are always rejected', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 11 }),
                    (length) => {
                        const password = 'a'.repeat(length);
                        const result = validatePassword(password, 'testuser');
                        
                        expect(result.valid).toBe(false);
                        expect(result.errors.some(e => e.includes('12'))).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 9.2: Passwords without uppercase letters are rejected
         * **Validates: Requirement 6.2**
         */
        it('Passwords without uppercase letters are rejected', () => {
            // Test with specific passwords that lack uppercase
            const passwordsWithoutUppercase = [
                'abcd1234!@#$',
                'lowercase123!',
                'nouppercasehere1!',
                'test12345678!@'
            ];
            
            for (const password of passwordsWithoutUppercase) {
                const result = validatePassword(password, 'testuser');
                expect(result.valid).toBe(false);
                expect(result.errors.some(e => e.toLowerCase().includes('uppercase'))).toBe(true);
            }
        });

        /**
         * Property 9.3: Passwords without lowercase letters are rejected
         * **Validates: Requirement 6.2**
         */
        it('Passwords without lowercase letters are rejected', () => {
            const passwordsWithoutLowercase = [
                'ABCD1234!@#$',
                'UPPERCASE123!',
                'NOLOWERCASEHERE1!',
                'TEST12345678!@'
            ];
            
            for (const password of passwordsWithoutLowercase) {
                const result = validatePassword(password, 'testuser');
                expect(result.valid).toBe(false);
                expect(result.errors.some(e => e.toLowerCase().includes('lowercase'))).toBe(true);
            }
        });

        /**
         * Property 9.4: Passwords without numbers are rejected
         * **Validates: Requirement 6.2**
         */
        it('Passwords without numbers are rejected', () => {
            const passwordsWithoutNumbers = [
                'ABCDabcd!@#$',
                'NoNumbersHere!',
                'TestPassword!@#',
                'MixedCaseOnly!!'
            ];
            
            for (const password of passwordsWithoutNumbers) {
                const result = validatePassword(password, 'testuser');
                expect(result.valid).toBe(false);
                expect(result.errors.some(e => e.toLowerCase().includes('number'))).toBe(true);
            }
        });

        /**
         * Property 9.5: Passwords without special characters are rejected
         * **Validates: Requirement 6.2**
         */
        it('Passwords without special characters are rejected', () => {
            const passwordsWithoutSpecial = [
                'ABCDabcd1234',
                'NoSpecialChars1',
                'TestPassword123',
                'MixedCase12345'
            ];
            
            for (const password of passwordsWithoutSpecial) {
                const result = validatePassword(password, 'testuser');
                expect(result.valid).toBe(false);
                expect(result.errors.some(e => e.toLowerCase().includes('special'))).toBe(true);
            }
        });

        /**
         * Property 9.6: Passwords containing username are rejected
         * **Validates: Requirement 6.4**
         */
        it('Passwords containing username are rejected', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('admin', 'john', 'testuser', 'alice', 'bob123'),
                    (username) => {
                        const password = `${username}Aa1!${username}Bb2@`;
                        const result = validatePassword(password, username);
                        
                        expect(result.valid).toBe(false);
                        expect(result.errors.some(e => e.toLowerCase().includes('username'))).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 9.7: Valid passwords meeting all requirements are accepted
         */
        it('Valid passwords meeting all requirements are accepted', () => {
            const validPasswords = [
                'SecurePass1!xyz',
                'MyP@ssw0rd123!',
                'Str0ng!Pass#99',
                'C0mplex!ty@123',
                'V@lid8Password!'
            ];
            
            for (const password of validPasswords) {
                const result = validatePassword(password, 'zzzzuniqueuserzzz');
                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            }
        });

        /**
         * Property 9.8: Common passwords are always rejected
         * **Validates: Requirement 6.3**
         */
        it('Common passwords are always rejected', () => {
            const commonPasswords = [
                'password', 'password123', 'admin123', 'letmein', 
                'qwerty123', 'welcome1', 'changeme'
            ];
            
            for (const password of commonPasswords) {
                expect(isCommonPassword(password)).toBe(true);
            }
        });
    });

    /**
     * Property: containsUsername correctly detects username in password
     */
    describe('containsUsername function', () => {
        it('Detects username in password (case-insensitive)', () => {
            expect(containsUsername('prefixadminsuffix', 'admin')).toBe(true);
            expect(containsUsername('myJOHNpassword', 'john')).toBe(true);
            expect(containsUsername('TESTing123', 'test')).toBe(true);
        });

        it('Does not falsely detect username when not present', () => {
            expect(containsUsername('12345!@#$%67890', 'admin')).toBe(false);
            expect(containsUsername('xyz123!@#abc456', 'john')).toBe(false);
            expect(containsUsername('!@#$%^&*()_+=-', 'alice')).toBe(false);
        });
    });

    /**
     * Property: Password strength scoring is consistent
     */
    describe('getPasswordStrength function', () => {
        it('Returns score between 0 and 4', () => {
            const passwords = ['', 'a', 'abc', 'abcdef', 'Abcdef1!', 'Aa1!Bb2@Cc3#Dd4$'];
            
            for (const password of passwords) {
                const strength = getPasswordStrength(password);
                expect(strength.score).toBeGreaterThanOrEqual(0);
                expect(strength.score).toBeLessThanOrEqual(4);
                expect(['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong']).toContain(strength.label);
            }
        });

        it('Longer passwords with more variety have higher scores', () => {
            const simpleStrength = getPasswordStrength('aaaaaa');
            const complexStrength = getPasswordStrength('Aa1!Bb2@Cc3#Dd4$');
            expect(complexStrength.score).toBeGreaterThan(simpleStrength.score);
        });
    });

    /**
     * Property: getPasswordRequirements returns consistent list
     */
    describe('getPasswordRequirements function', () => {
        it('Returns non-empty array of requirements', () => {
            const requirements = getPasswordRequirements();
            
            expect(Array.isArray(requirements)).toBe(true);
            expect(requirements.length).toBeGreaterThan(0);
            
            const requirementsText = requirements.join(' ').toLowerCase();
            expect(requirementsText).toContain('12');
            expect(requirementsText).toContain('uppercase');
            expect(requirementsText).toContain('lowercase');
            expect(requirementsText).toContain('number');
            expect(requirementsText).toContain('special');
            expect(requirementsText).toContain('username');
        });
    });

    /**
     * Property: PASSWORD_POLICY configuration is valid
     */
    describe('PASSWORD_POLICY configuration', () => {
        it('Has valid configuration values', () => {
            expect(PASSWORD_POLICY.minLength).toBe(12);
            expect(PASSWORD_POLICY.requireUppercase).toBe(true);
            expect(PASSWORD_POLICY.requireLowercase).toBe(true);
            expect(PASSWORD_POLICY.requireNumbers).toBe(true);
            expect(PASSWORD_POLICY.requireSpecial).toBe(true);
            expect(PASSWORD_POLICY.maxAge).toBe(90 * 24 * 60 * 60 * 1000);
            expect(PASSWORD_POLICY.historyCount).toBe(5);
        });
    });
});
