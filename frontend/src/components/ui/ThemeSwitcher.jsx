import { useTheme } from '../../contexts/ThemeContext';

/**
 * Theme Switcher Component
 * Toggle between dark and light themes
 * Requirements: Phase 1 Task 5 - Add theme switcher in UI
 */
export default function ThemeSwitcher({ className = '' }) {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <button
            onClick={toggleTheme}
            className={`relative inline-flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200 ${
                isDark 
                    ? 'bg-gray-800 hover:bg-gray-700 text-yellow-400' 
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            } ${className}`}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
            {/* Sun Icon (Light Mode) */}
            <svg
                className={`absolute w-5 h-5 transition-all duration-300 ${
                    isDark 
                        ? 'opacity-0 rotate-90 scale-0' 
                        : 'opacity-100 rotate-0 scale-100'
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
            </svg>

            {/* Moon Icon (Dark Mode) */}
            <svg
                className={`absolute w-5 h-5 transition-all duration-300 ${
                    isDark 
                        ? 'opacity-100 rotate-0 scale-100' 
                        : 'opacity-0 -rotate-90 scale-0'
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
            </svg>
        </button>
    );
}

/**
 * Theme Switcher with Label
 * Larger version with text label
 */
export function ThemeSwitcherWithLabel({ className = '' }) {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <button
            onClick={toggleTheme}
            className={`inline-flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 ${
                isDark 
                    ? 'bg-gray-800 hover:bg-gray-700 text-white' 
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
            } ${className}`}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
            {/* Icon */}
            <div className="relative w-5 h-5">
                {/* Sun Icon */}
                <svg
                    className={`absolute inset-0 w-5 h-5 transition-all duration-300 ${
                        isDark 
                            ? 'opacity-0 rotate-90 scale-0' 
                            : 'opacity-100 rotate-0 scale-100 text-yellow-500'
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                </svg>

                {/* Moon Icon */}
                <svg
                    className={`absolute inset-0 w-5 h-5 transition-all duration-300 ${
                        isDark 
                            ? 'opacity-100 rotate-0 scale-100 text-yellow-400' 
                            : 'opacity-0 -rotate-90 scale-0'
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                    />
                </svg>
            </div>

            {/* Label */}
            <span className="text-sm font-medium">
                {isDark ? 'Mode Gelap' : 'Mode Terang'}
            </span>
        </button>
    );
}

/**
 * Theme Toggle Switch
 * iOS-style toggle switch
 */
export function ThemeToggleSwitch({ className = '' }) {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <button
            onClick={toggleTheme}
            className={`relative inline-flex items-center h-8 w-14 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                isDark 
                    ? 'bg-gray-700 focus:ring-gray-500' 
                    : 'bg-gray-300 focus:ring-gray-400'
            } ${className}`}
            role="switch"
            aria-checked={isDark}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
            <span
                className={`inline-flex items-center justify-center h-6 w-6 rounded-full bg-white shadow-lg transform transition-transform duration-200 ${
                    isDark ? 'translate-x-7' : 'translate-x-1'
                }`}
            >
                {isDark ? (
                    <svg className="w-3 h-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                ) : (
                    <svg className="w-3 h-3 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                )}
            </span>
        </button>
    );
}
