import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../pages/UserManagement';

/**
 * Feature: admin-ux-improvement
 * Property Tests for Password Validation
 * 
 * Property 6.3: Password Requirements Validation
 * Validates: Requirements 6.3
 * 
 * WHEN password doesn't meet requirements, THE User_Management SHALL display 
 * specific requirement that failed
 */

describe('Password Validation', () => {
    /**
     * Feature: admin-ux-improvement
     * Property 6.3: Password Requirements Validation
     * Validates: Requirements 6.3
     * 
     * For any password string, the validation SHALL correctly identify:
     * - Whether minimum length requirement is met
     * - Whether uppercase letter requirement is met
     * - Whether lowercase letter requirement is met
     * - Whether number requirement is met
     */
    it('Property 6.3: should correctly validate minimum length requirement', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 50 }),
                (password) => {
                    const result = validatePassword(password);
                    const meetsMinLength = password.length >= PASSWORD_REQUIREMENTS.minLength;
                    
                    expect(result.requirements.minLength).toBe(meetsMinLength);
                    
                    if (!meetsMinLength && password.length > 0) {
                        expect(result.isValid).toBe(false);
                        expect(result.errors.some(e => e.includes('at least'))).toBe(true);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('Property 6.3: should correctly validate uppercase letter requirement', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 50 }),
                (password) => {
                    const result = validatePassword(password);
                    const hasUppercase = /[A-Z]/.test(password);
                    
                    expect(result.requirements.hasUppercase).toBe(hasUppercase);
                    
                    if (!hasUppercase && PASSWORD_REQUIREMENTS.requireUppercase) {
                        expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('Property 6.3: should correctly validate lowercase letter requirement', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 50 }),
                (password) => {
                    const result = validatePassword(password);
                    const hasLowercase = /[a-z]/.test(password);
                    
                    expect(result.requirements.hasLowercase).toBe(hasLowercase);
                    
                    if (!hasLowercase && PASSWORD_REQUIREMENTS.requireLowercase) {
                        expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('Property 6.3: should correctly validate number requirement', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 50 }),
                (password) => {
                    const result = validatePassword(password);
                    const hasNumber = /[0-9]/.test(password);
                    
                    expect(result.requirements.hasNumber).toBe(hasNumber);
                    
                    if (!hasNumber && PASSWORD_REQUIREMENTS.requireNumber) {
                        expect(result.errors.some(e => e.includes('number'))).toBe(true);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('Property 6.3: valid passwords should pass all requirements', () => {
        // Generate valid passwords that meet all requirements
        const validPasswordArb = fc.tuple(
            fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), { minLength: 1, maxLength: 5 }),
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 1, maxLength: 5 }),
            fc.stringOf(fc.constantFrom(...'0123456789'), { minLength: 1, maxLength: 5 }),
            fc.string({ minLength: 0, maxLength: 10 })
        ).map(([upper, lower, num, extra]) => upper + lower + num + extra);

        fc.assert(
            fc.property(
                validPasswordArb,
                (password) => {
                    // Only test if password meets minimum length
                    if (password.length < PASSWORD_REQUIREMENTS.minLength) {
                        return true; // Skip this case
                    }
                    
                    const result = validatePassword(password);
                    
                    // Should have all requirements met
                    expect(result.requirements.minLength).toBe(true);
                    expect(result.requirements.hasUppercase).toBe(true);
                    expect(result.requirements.hasLowercase).toBe(true);
                    expect(result.requirements.hasNumber).toBe(true);
                    expect(result.isValid).toBe(true);
                    expect(result.errors).toHaveLength(0);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('Property 6.3: empty password should return required error', () => {
        const result = validatePassword('');
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Password is required');
    });

    it('Property 6.3: null/undefined password should return required error', () => {
        expect(validatePassword(null).isValid).toBe(false);
        expect(validatePassword(undefined).isValid).toBe(false);
        expect(validatePassword(null).errors).toContain('Password is required');
    });

    it('Property 6.3: errors array should contain specific failed requirements', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 50 }),
                (password) => {
                    const result = validatePassword(password);
                    
                    // Count expected errors
                    let expectedErrorCount = 0;
                    if (password.length < PASSWORD_REQUIREMENTS.minLength) expectedErrorCount++;
                    if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) expectedErrorCount++;
                    if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) expectedErrorCount++;
                    if (PASSWORD_REQUIREMENTS.requireNumber && !/[0-9]/.test(password)) expectedErrorCount++;
                    
                    expect(result.errors.length).toBe(expectedErrorCount);
                    expect(result.isValid).toBe(expectedErrorCount === 0);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
