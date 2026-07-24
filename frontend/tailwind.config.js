/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                // Operational redesign: all data (metrics, timestamps, camera
                // codes, viewer counts) renders in mono for an "instrument"
                // read. System stack only — zero font downloads, so it stays
                // light on mobile / Telegram in-app WebView.
                mono: ['ui-monospace', 'Cascadia Code', 'SFMono-Regular', 'Menlo', 'Consolas', 'Roboto Mono', 'monospace'],
            },
            colors: {
                // Semantic roles — prefer these over `dark-*`/`light-*` in new work.
                // Definitions and usage rules live in src/index.css.
                surface: {
                    DEFAULT: 'var(--surface)',
                    sunken: 'var(--surface-sunken)',
                    raised: 'var(--surface-raised)',
                    overlay: 'var(--surface-overlay)',
                },
                edge: {
                    DEFAULT: 'var(--edge)',
                    strong: 'var(--edge-strong)',
                },
                content: {
                    DEFAULT: 'var(--content)',
                    muted: 'var(--content-muted)',
                    subtle: 'var(--content-subtle)',
                },
                status: {
                    live: 'var(--status-live)',
                    warn: 'var(--status-warn)',
                    fault: 'var(--status-fault)',
                    idle: 'var(--status-idle)',
                },
                // Data accent (not a status). See --data in index.css.
                data: 'var(--data)',
                primary: {
                    DEFAULT: 'var(--primary-color)',
                    50: 'rgba(var(--primary-color-rgb), 0.05)',
                    100: 'rgba(var(--primary-color-rgb), 0.1)',
                    200: 'rgba(var(--primary-color-rgb), 0.2)',
                    300: 'rgba(var(--primary-color-rgb), 0.3)',
                    400: 'rgba(var(--primary-color-rgb), 0.4)',
                    500: 'var(--primary-color)',
                    600: 'rgba(var(--primary-color-rgb), 0.8)',
                    700: 'rgba(var(--primary-color-rgb), 0.9)',
                },
                // Legacy grey ramps. Kept so the existing ~200 usages keep working,
                // but they are not semantic — `light-700/800/900` are byte-identical
                // to `dark-700/800/900`. Do not reach for these in new work; use the
                // `surface` / `edge` / `content` roles above.
                dark: {
                    200: '#e5e7eb',
                    300: '#d1d5db',
                    400: '#9ca3af',
                    700: '#374151',
                    800: '#1f2937',
                    900: '#111827',
                    950: '#030712',
                },
                light: {
                    50: '#f9fafb',
                    100: '#f3f4f6',
                    200: '#e5e7eb',
                    300: '#d1d5db',
                    400: '#9ca3af',
                    500: '#6b7280',
                    600: '#4b5563',
                    700: '#374151',
                    800: '#1f2937',
                    900: '#111827',
                },
            },
            borderRadius: {
                control: 'var(--radius-control)',
                card: 'var(--radius-card)',
            },
            boxShadow: {
                // Two elevation steps total. If a component needs a third, the
                // layout is doing the work a surface step should be doing.
                e1: 'var(--elevation-1)',
                e2: 'var(--elevation-2)',
            },
            animation: {
                'slide-down': 'slideDown 0.3s ease-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'fade-in': 'fadeIn 0.2s ease-out',
                'fade-out': 'fadeOut 0.2s ease-out forwards',
                'shimmer': 'shimmer 2s infinite',
            },
            keyframes: {
                slideDown: {
                    '0%': { transform: 'translate(-50%, -100%)', opacity: '0' },
                    '100%': { transform: 'translate(-50%, 0)', opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(100%)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                slideInRight: {
                    '0%': { transform: 'translateX(100%)', opacity: '0' },
                    '100%': { transform: 'translateX(0)', opacity: '1' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                fadeOut: {
                    '0%': { opacity: '1' },
                    '100%': { opacity: '0' },
                },
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
            },
        },
    },
    plugins: [],
};
