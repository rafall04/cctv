import { useState, useCallback, useMemo } from 'react';

/**
 * useFormValidation Hook
 * 
 * A comprehensive form validation hook that handles values, errors, touched states,
 * and supports custom validation rules.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4
 * 
 * @param {Object} initialValues - Initial form values
 * @param {Object} validationRules - Validation rules for each field
 * @returns {Object} Form validation state and methods
 */
export function useFormValidation(initialValues = {}, validationRules = {}) {
    const [values, setValues] = useState(initialValues);
    const [errors, setErrors] = useState({});
    const [touched, setTouched] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    /**
     * Validate a single field against its rules
     * @param {string} name - Field name
     * @param {any} value - Field value
     * @param {Object} allValues - All form values (for cross-field validation)
     * @returns {string} Error message or empty string
     */
    const validateFieldValue = useCallback((name, value, allValues) => {
        const rules = validationRules[name];
        if (!rules) return '';

        // Required validation
        if (rules.required) {
            const isEmpty = value === undefined || value === null || value === '' || 
                (typeof value === 'string' && value.trim() === '');
            if (isEmpty) {
                return typeof rules.required === 'string' 
                    ? rules.required 
                    : `${name} is required`;
            }
        }

        // Skip other validations if value is empty and not required
        if (value === undefined || value === null || value === '') {
            return '';
        }

        const stringValue = String(value);

        // Min length validation
        if (rules.minLength) {
            if (stringValue.length < rules.minLength.value) {
                return rules.minLength.message || 
                    `${name} must be at least ${rules.minLength.value} characters`;
            }
        }

        // Max length validation
        if (rules.maxLength) {
            if (stringValue.length > rules.maxLength.value) {
                return rules.maxLength.message || 
                    `${name} must not exceed ${rules.maxLength.value} characters`;
            }
        }

        // Pattern validation
        if (rules.pattern) {
            if (!rules.pattern.value.test(stringValue)) {
                return rules.pattern.message || `${name} format is invalid`;
            }
        }

        // Custom validation
        if (rules.custom) {
            const customError = rules.custom(value, allValues);
            if (customError) {
                return customError;
            }
        }

        return '';
    }, [validationRules]);

    /**
     * Validate a single field and update error state
     * @param {string} name - Field name
     * @returns {boolean} True if field is valid
     */
    const validateField = useCallback((name) => {
        const error = validateFieldValue(name, values[name], values);
        setErrors(prev => ({
            ...prev,
            [name]: error
        }));
        return error === '';
    }, [values, validateFieldValue]);

    /**
     * Validate all fields and update error state
     * @returns {boolean} True if all fields are valid
     */
    const validateForm = useCallback(() => {
        const newErrors = {};
        let isValid = true;

        // Validate all fields with rules
        Object.keys(validationRules).forEach(name => {
            const error = validateFieldValue(name, values[name], values);
            newErrors[name] = error;
            if (error) {
                isValid = false;
            }
        });

        setErrors(newErrors);
        
        // Mark all fields as touched
        const allTouched = {};
        Object.keys(validationRules).forEach(name => {
            allTouched[name] = true;
        });
        setTouched(allTouched);

        return isValid;
    }, [values, validationRules, validateFieldValue]);

    /**
     * Handle input change
     * @param {Event} e - Change event
     */
    const handleChange = useCallback((e) => {
        const { name, value, type, checked } = e.target;
        const newValue = type === 'checkbox' ? checked : value;
        
        setValues(prev => ({
            ...prev,
            [name]: newValue
        }));

        // Clear error when user starts typing (if field was touched)
        if (touched[name]) {
            const error = validateFieldValue(name, newValue, { ...values, [name]: newValue });
            setErrors(prev => ({
                ...prev,
                [name]: error
            }));
        }
    }, [touched, values, validateFieldValue]);

    /**
     * Handle input blur
     * @param {Event} e - Blur event
     */
    const handleBlur = useCallback((e) => {
        const { name } = e.target;
        
        setTouched(prev => ({
            ...prev,
            [name]: true
        }));

        // Validate on blur
        const error = validateFieldValue(name, values[name], values);
        setErrors(prev => ({
            ...prev,
            [name]: error
        }));
    }, [values, validateFieldValue]);

    /**
     * Set a specific field value programmatically
     * @param {string} name - Field name
     * @param {any} value - New value
     */
    const setFieldValue = useCallback((name, value) => {
        setValues(prev => ({
            ...prev,
            [name]: value
        }));
    }, []);

    /**
     * Set a specific field error programmatically
     * @param {string} name - Field name
     * @param {string} error - Error message
     */
    const setFieldError = useCallback((name, error) => {
        setErrors(prev => ({
            ...prev,
            [name]: error
        }));
    }, []);

    /**
     * Set touched state for a field
     * @param {string} name - Field name
     * @param {boolean} isTouched - Touched state
     */
    const setFieldTouched = useCallback((name, isTouched = true) => {
        setTouched(prev => ({
            ...prev,
            [name]: isTouched
        }));
    }, []);

    /**
     * Reset form to initial values
     */
    const reset = useCallback(() => {
        setValues(initialValues);
        setErrors({});
        setTouched({});
        setIsSubmitting(false);
    }, [initialValues]);

    /**
     * Reset form with new initial values
     * @param {Object} newValues - New initial values
     */
    const resetWith = useCallback((newValues) => {
        setValues(newValues);
        setErrors({});
        setTouched({});
        setIsSubmitting(false);
    }, []);

    /**
     * Set submitting state
     * @param {boolean} submitting - Submitting state
     */
    const setSubmitting = useCallback((submitting) => {
        setIsSubmitting(submitting);
    }, []);

    // Compute derived state
    const isValid = useMemo(() => {
        return Object.values(errors).every(error => !error);
    }, [errors]);

    const isDirty = useMemo(() => {
        return Object.keys(values).some(key => values[key] !== initialValues[key]);
    }, [values, initialValues]);

    const errorCount = useMemo(() => {
        return Object.values(errors).filter(error => error).length;
    }, [errors]);

    const hasErrors = errorCount > 0;

    return {
        // State
        values,
        errors,
        touched,
        isValid,
        isDirty,
        isSubmitting,
        errorCount,
        hasErrors,
        
        // Methods
        handleChange,
        handleBlur,
        setFieldValue,
        setFieldError,
        setFieldTouched,
        validateField,
        validateForm,
        reset,
        resetWith,
        setSubmitting,
        
        // Utility for getting field props
        getFieldProps: (name) => ({
            name,
            value: values[name] || '',
            onChange: handleChange,
            onBlur: handleBlur,
            error: touched[name] ? errors[name] : '',
        }),
    };
}

/**
 * Get character count for a value
 * @param {string} value - The value to count
 * @returns {number} Character count
 */
export function getCharacterCount(value) {
    if (value === null || value === undefined) return 0;
    return String(value).length;
}

/**
 * Check if value exceeds max length
 * @param {string} value - The value to check
 * @param {number} maxLength - Maximum allowed length
 * @returns {boolean} True if over limit
 */
export function isOverCharacterLimit(value, maxLength) {
    if (!maxLength || maxLength <= 0) return false;
    return getCharacterCount(value) > maxLength;
}

export default useFormValidation;
