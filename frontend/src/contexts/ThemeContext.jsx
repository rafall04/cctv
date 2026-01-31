import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
    // Track if user has manually set theme preference
    const [isManualTheme, setIsManualTheme] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('themeManual') === 'true';
        }
        return false;
    });

    const [theme, setTheme] = useState(() => {
        if (typeof window !== 'undefined') {
            // Check if user has manually set theme
            const isManual = localStorage.getItem('themeManual') === 'true';
            
            if (isManual) {
                // Use saved manual preference
                const savedTheme = localStorage.getItem('theme');
                if (savedTheme) {
                    return savedTheme;
                }
            }
            
            // Otherwise, use system preference
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                return 'dark';
            }
            
            return 'light';
        }
        return 'dark';
    });

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(theme);
        
        // Only save to localStorage if manually set
        if (isManualTheme) {
            localStorage.setItem('theme', theme);
        }
    }, [theme, isManualTheme]);

    // Listen for system theme changes
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        const handleChange = (e) => {
            // Only auto-switch if user hasn't manually set a preference
            if (!isManualTheme) {
                setTheme(e.matches ? 'dark' : 'light');
            }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [isManualTheme]);

    const toggleTheme = () => {
        // Mark as manual theme selection
        setIsManualTheme(true);
        localStorage.setItem('themeManual', 'true');
        
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
    };

    const isDark = theme === 'dark';

    return (
        <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export const useTheme = () => useContext(ThemeContext);

