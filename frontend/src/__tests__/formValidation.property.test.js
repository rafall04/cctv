import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderHook, act } from '@testing-library/react';
import { useFormValidation, getCharacterCount, isOverCharacterLimit } from '../hooks/useFormValidation';

/**
 * Feature: admin-ux-improvement
 * Property Tests for useFormValidation Hook
 * 
 * Tests the form validation hook functionality including:
 * - Form validation state consistency
 * - Form submission state management
 * - Character count accuracy
 * 
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6, 7.7
 */

describe('useFormValidation', () => {
    /**
     * Feature: admin-ux-improvement
     * Property 4: Form Validation State Consistency
     * Validates: Requirements 7.1, 7.2, 7.3, 7.4
     * 
     * For any form with validation rules, when a field value changes:
     * - If the value violates a rule, the error state for that field SHALL be set
     * - If the value satisfies all rules, the error state SHALL be cleared
     * - The form's overall validity SHALL equal the conjunction of all field validities
     */
    it('Property 4: should maintain consistent validation state when field values change', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 50 }),
                fc.boolean(),
                (fieldValue, isRequired) => {
                    const validationRules = isRequired 
                        ? { testField: { required: 'Field is required' } }
                        : {};
                    
                    const { result } = renderHook(() => 
                        useFormValidation({ testField: '' }, validationRules)
                    );

                    // Simulate field change and blur
                    act(() => {
                        result.current.handleChange({
                            target: { name: 'testField', value: fieldValue, type: 'text' }
                        });
                    });

                    act(() => {
                        result.current.handleBlur({
                            target: { name: 'testField' }
                        });
                    });

                    // Check validation state consistency
                    const isEmpty = fieldValue === '' || fieldValue.trim() === '';
                    const shouldHaveError = isRequired && isEmpty;
                    
                    if (shouldHaveError) {
                        expect(result.current.errors.testField).toBeTruthy();
                        expect(result.current.isValid).toBe(false);
                    } else {
                        expect(result.current.errors.testField).toBeFalsy();
                        expect(result.current.isValid).toBe(true);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: admin-ux-improvement
     * Property 4 (continued): Min/Max length validation consistency
     */
    it('Property 4: should validate min/max length rules consistently', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 100 }),
                fc.integer({ min: 1, max: 20 }),
                fc.integer({ min: 21, max: 50 }),
                (fieldValue, minLength, maxLength) => {
                    const validationRules = {
                        testField: {
                            minLength: { value: minLength, message: `Min ${minLength} chars` },
                            maxLength: { value: maxLength, message: `Max ${maxLength} chars` }
                        }
                    };

                    const { result } = renderHook(() => 
                        useFormValidation({ testField: '' }, validationRules)
                    );

                    // Set value and validate
                    act(() => {
                        result.current.handleChange({
                            target: { name: 'testField', value: fieldValue, type: 'text' }
                        });
                    });

                    act(() => {
                        result.current.handleBlur({
                            target: { name: 'testField' }
                        });
                    });

                    // Check validation consistency
                    const valueLength = fieldValue.length;
                    
                    if (fieldValue === '') {
                        // Empty non-required field should be valid
                        expect(result.current.errors.testField).toBeFalsy();
                    } else if (valueLength < minLength) {
                        expect(result.current.errors.testField).toBeTruthy();
                    } else if (valueLength > maxLength) {
                        expect(result.current.errors.testField).toBeTruthy();
                    } else {
                        expect(result.current.errors.testField).toBeFalsy();
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: admin-ux-improvement
     * Property 4 (continued): Pattern validation consistency
     */
    it('Property 4: should validate pattern rules consistently', () => {
        // Test email pattern validation
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.emailAddress(), // Valid emails
                    fc.string({ minLength: 1, maxLength: 50 }) // Random strings
                ),
                (fieldValue) => {
                    const validationRules = {
                        email: {
                            pattern: { value: emailPattern, message: 'Invalid email format' }
                        }
                    };

                    const { result } = renderHook(() => 
                        useFormValidation({ email: '' }, validationRules)
                    );

                    act(() => {
                        result.current.handleChange({
                            target: { name: 'email', value: fieldValue, type: 'text' }
                        });
                    });

                    act(() => {
                        result.current.handleBlur({
                            target: { name: 'email' }
                        });
                    });

                    const isValidEmail = emailPattern.test(fieldValue);
                    
                    if (fieldValue === '') {
                        // Empty non-required field should be valid
                        expect(result.current.errors.email).toBeFalsy();
                    } else if (isValidEmail) {
                        expect(result.current.errors.email).toBeFalsy();
                    } else {
                        expect(result.current.errors.email).toBeTruthy();
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: admin-ux-improvement
     * Property 5: Form Submission State Management
     * Validates: Requirements 7.6, 7.7
     * 
     * For any form during submission, all input fields SHALL be disabled,
     * the submit button SHALL show loading state, and upon failure, all
     * fields SHALL be re-enabled with their values preserved.
     */
    it('Property 5: should manage submission state correctly', () => {
        fc.assert(
            fc.property(
                fc.record({
                    username: fc.string({ minLength: 1, maxLength: 30 }),
                    password: fc.string({ minLength: 1, maxLength: 30 }),
                }),
                (formValues) => {
                    const { result } = renderHook(() => 
                        useFormValidation(formValues, {})
                    );

                    // Initial state - not submitting
                    expect(result.current.isSubmitting).toBe(false);

                    // Start submission
                    act(() => {
                        result.current.setSubmitting(true);
                    });

                    // During submission
                    expect(result.current.isSubmitting).toBe(true);
                    // Values should be preserved
                    expect(result.current.values.username).toBe(formValues.username);
                    expect(result.current.values.password).toBe(formValues.password);

                    // End submission (simulating failure)
                    act(() => {
                        result.current.setSubmitting(false);
                    });

                    // After submission failure
                    expect(result.current.isSubmitting).toBe(false);
                    // Values should still be preserved
                    expect(result.current.values.username).toBe(formValues.username);
                    expect(result.current.values.password).toBe(formValues.password);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: admin-ux-improvement
     * Property 5 (continued): Form reset should clear all state
     */
    it('Property 5: should reset form state correctly', () => {
        fc.assert(
            fc.property(
                fc.record({
                    field1: fc.string({ minLength: 0, maxLength: 30 }),
                    field2: fc.string({ minLength: 0, maxLength: 30 }),
                }),
                fc.record({
                    field1: fc.string({ minLength: 0, maxLength: 30 }),
                    field2: fc.string({ minLength: 0, maxLength: 30 }),
                }),
                (initialValues, newValues) => {
                    const { result } = renderHook(() => 
                        useFormValidation(initialValues, {
                            field1: { required: true },
                            field2: { required: true }
                        })
                    );

                    // Change values
                    act(() => {
                        result.current.handleChange({
                            target: { name: 'field1', value: newValues.field1, type: 'text' }
                        });
                        result.current.handleChange({
                            target: { name: 'field2', value: newValues.field2, type: 'text' }
                        });
                    });

                    // Touch fields
                    act(() => {
                        result.current.handleBlur({ target: { name: 'field1' } });
                        result.current.handleBlur({ target: { name: 'field2' } });
                    });

                    // Reset form
                    act(() => {
                        result.current.reset();
                    });

                    // After reset, values should be back to initial
                    expect(result.current.values.field1).toBe(initialValues.field1);
                    expect(result.current.values.field2).toBe(initialValues.field2);
                    // Errors should be cleared
                    expect(result.current.errors).toEqual({});
                    // Touched should be cleared
                    expect(result.current.touched).toEqual({});
                    // Submitting should be false
                    expect(result.current.isSubmitting).toBe(false);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: admin-ux-improvement
     * Property 6: Character Count Accuracy
     * Validates: Requirements 7.5
     * 
     * For any input field with maxLength configured and showCharCount enabled,
     * the displayed character count SHALL equal the actual length of the input
     * value, and SHALL not exceed maxLength.
     */
    it('Property 6: should accurately count characters', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 500 }),
                (value) => {
                    const count = getCharacterCount(value);
                    
                    // Character count should equal actual string length
                    expect(count).toBe(value.length);
                    
                    // Count should be non-negative
                    expect(count).toBeGreaterThanOrEqual(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6 (continued): Character limit detection
     */
    it('Property 6: should correctly detect when character limit is exceeded', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 200 }),
                fc.integer({ min: 1, max: 100 }),
                (value, maxLength) => {
                    const isOver = isOverCharacterLimit(value, maxLength);
                    const actualLength = value.length;
                    
                    if (actualLength > maxLength) {
                        expect(isOver).toBe(true);
                    } else {
                        expect(isOver).toBe(false);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6 (continued): Edge cases for character count
     */
    it('Property 6: should handle null/undefined values for character count', () => {
        expect(getCharacterCount(null)).toBe(0);
        expect(getCharacterCount(undefined)).toBe(0);
        expect(getCharacterCount('')).toBe(0);
    });

    /**
     * Property 6 (continued): Edge cases for character limit
     */
    it('Property 6: should handle edge cases for character limit', () => {
        expect(isOverCharacterLimit('test', 0)).toBe(false);
        expect(isOverCharacterLimit('test', -1)).toBe(false);
        expect(isOverCharacterLimit('test', null)).toBe(false);
        expect(isOverCharacterLimit('test', undefined)).toBe(false);
    });

    /**
     * Additional: validateForm should validate all fields
     */
    it('should validate all fields when validateForm is called', () => {
        fc.assert(
            fc.property(
                fc.record({
                    username: fc.string({ minLength: 0, maxLength: 30 }),
                    email: fc.string({ minLength: 0, maxLength: 50 }),
                }),
                (formValues) => {
                    const validationRules = {
                        username: { required: 'Username is required' },
                        email: { required: 'Email is required' }
                    };

                    const { result } = renderHook(() => 
                        useFormValidation(formValues, validationRules)
                    );

                    let isValid;
                    act(() => {
                        isValid = result.current.validateForm();
                    });

                    const usernameEmpty = !formValues.username || formValues.username.trim() === '';
                    const emailEmpty = !formValues.email || formValues.email.trim() === '';
                    const expectedValid = !usernameEmpty && !emailEmpty;

                    expect(isValid).toBe(expectedValid);
                    expect(result.current.isValid).toBe(expectedValid);

                    // All fields should be touched after validateForm
                    expect(result.current.touched.username).toBe(true);
                    expect(result.current.touched.email).toBe(true);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Additional: Custom validation rules
     */
    it('should support custom validation rules', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 30 }),
                fc.string({ minLength: 0, maxLength: 30 }),
                (password, confirmPassword) => {
                    const validationRules = {
                        password: { required: true },
                        confirmPassword: {
                            custom: (value, allValues) => {
                                if (value !== allValues.password) {
                                    return 'Passwords do not match';
                                }
                                return undefined;
                            }
                        }
                    };

                    const { result } = renderHook(() => 
                        useFormValidation({ password: '', confirmPassword: '' }, validationRules)
                    );

                    // Set both values
                    act(() => {
                        result.current.setFieldValue('password', password);
                        result.current.setFieldValue('confirmPassword', confirmPassword);
                    });

                    // Validate
                    act(() => {
                        result.current.validateForm();
                    });

                    // Check custom validation
                    if (password !== confirmPassword && confirmPassword !== '') {
                        expect(result.current.errors.confirmPassword).toBe('Passwords do not match');
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
