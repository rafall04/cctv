import { useState } from 'react';

/**
 * FormField Component
 * 
 * Enhanced form field with validation feedback, error display, and character count.
 * Supports text, password, email, textarea, and select input types.
 * 
 * Requirements: 7.1, 7.2, 7.5
 */

// Eye icons for password visibility toggle
const EyeIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
);

const EyeOffIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
);

/**
 * FormField component with validation display
 * @param {Object} props
 * @param {string} props.label - Field label
 * @param {string} props.name - Field name (for form handling)
 * @param {'text' | 'password' | 'email' | 'textarea' | 'select'} [props.type='text'] - Input type
 * @param {string} props.value - Current field value
 * @param {Function} props.onChange - Change handler
 * @param {Function} [props.onBlur] - Blur handler
 * @param {string} [props.error] - Error message to display
 * @param {string} [props.hint] - Hint text to display below field
 * @param {boolean} [props.required=false] - Whether field is required
 * @param {boolean} [props.disabled=false] - Whether field is disabled
 * @param {number} [props.maxLength] - Maximum character length
 * @param {boolean} [props.showCharCount=false] - Whether to show character count
 * @param {Array<{value: string, label: string}>} [props.options] - Options for select type
 * @param {string} [props.placeholder] - Placeholder text
 * @param {number} [props.rows=3] - Number of rows for textarea
 * @param {string} [props.className] - Additional CSS classes
 * @param {string} [props.autoComplete] - Autocomplete attribute
 */
export function FormField({
    label,
    name,
    type = 'text',
    value,
    onChange,
    onBlur,
    error,
    hint,
    required = false,
    disabled = false,
    maxLength,
    showCharCount = false,
    options = [],
    placeholder,
    rows = 3,
    className = '',
    autoComplete,
}) {
    const [showPassword, setShowPassword] = useState(false);
    
    const hasError = Boolean(error);
    const charCount = value?.length || 0;
    const isOverLimit = maxLength && charCount > maxLength;

    // Base input classes
    const baseInputClasses = `
        w-full px-3 py-2 
        bg-dark-800 border rounded-lg
        text-dark-200 placeholder-dark-400
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-dark-900
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-colors
    `;

    // Error/normal state classes
    const stateClasses = hasError
        ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
        : 'border-dark-700 focus:ring-primary-500 focus:border-primary-500';

    const inputClasses = `${baseInputClasses} ${stateClasses}`;

    // Determine actual input type for password fields
    const actualType = type === 'password' && showPassword ? 'text' : type;

    // Render the appropriate input element
    const renderInput = () => {
        if (type === 'textarea') {
            return (
                <textarea
                    id={name}
                    name={name}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    disabled={disabled}
                    placeholder={placeholder}
                    rows={rows}
                    maxLength={maxLength}
                    className={`${inputClasses} resize-none`}
                    aria-invalid={hasError}
                    aria-describedby={hasError ? `${name}-error` : hint ? `${name}-hint` : undefined}
                />
            );
        }

        if (type === 'select') {
            return (
                <select
                    id={name}
                    name={name}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    disabled={disabled}
                    className={inputClasses}
                    aria-invalid={hasError}
                    aria-describedby={hasError ? `${name}-error` : hint ? `${name}-hint` : undefined}
                >
                    {placeholder && (
                        <option value="" disabled>
                            {placeholder}
                        </option>
                    )}
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            );
        }

        // Text, password, email inputs
        return (
            <div className="relative">
                <input
                    id={name}
                    name={name}
                    type={actualType}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    disabled={disabled}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    autoComplete={autoComplete}
                    className={`${inputClasses} ${type === 'password' ? 'pr-10' : ''}`}
                    aria-invalid={hasError}
                    aria-describedby={hasError ? `${name}-error` : hint ? `${name}-hint` : undefined}
                />
                {type === 'password' && (
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200 focus:outline-none"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className={`space-y-1 ${className}`}>
            {/* Label */}
            <label 
                htmlFor={name}
                className="block text-sm font-medium text-dark-200"
            >
                {label}
                {required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {/* Input */}
            {renderInput()}

            {/* Error message, hint, or character count */}
            <div className="flex justify-between items-start min-h-[1.25rem]">
                <div className="flex-1">
                    {hasError ? (
                        <p 
                            id={`${name}-error`}
                            className="text-sm text-red-500"
                            role="alert"
                        >
                            {error}
                        </p>
                    ) : hint ? (
                        <p 
                            id={`${name}-hint`}
                            className="text-sm text-dark-400"
                        >
                            {hint}
                        </p>
                    ) : null}
                </div>

                {/* Character count */}
                {showCharCount && maxLength && (
                    <span 
                        className={`text-xs ml-2 ${
                            isOverLimit ? 'text-red-500' : 'text-dark-400'
                        }`}
                    >
                        {charCount}/{maxLength}
                    </span>
                )}
            </div>
        </div>
    );
}

/**
 * Get character count for a value
 * @param {string} value - The value to count
 * @returns {number} Character count
 */
export function getCharacterCount(value) {
    return value?.length || 0;
}

/**
 * Check if value exceeds max length
 * @param {string} value - The value to check
 * @param {number} maxLength - Maximum allowed length
 * @returns {boolean} True if over limit
 */
export function isOverCharacterLimit(value, maxLength) {
    if (!maxLength) return false;
    return getCharacterCount(value) > maxLength;
}

export default FormField;
