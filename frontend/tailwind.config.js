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
                    DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
                    sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
                    raised: 'rgb(var(--surface-raised) / <alpha-value>)',
                    overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
                },
                edge: {
                    DEFAULT: 'rgb(var(--edge) / <alpha-value>)',
                    strong: 'rgb(var(--edge-strong) / <alpha-value>)',
                },
                content: {
                    DEFAULT: 'rgb(var(--content) / <alpha-value>)',
                    muted: 'rgb(var(--content-muted) / <alpha-value>)',
                    subtle: 'rgb(var(--content-subtle) / <alpha-value>)',
                },
                status: {
                    live: 'rgb(var(--status-live) / <alpha-value>)',
                    warn: 'rgb(var(--status-warn) / <alpha-value>)',
                    fault: 'rgb(var(--status-fault) / <alpha-value>)',
                    idle: 'rgb(var(--status-idle) / <alpha-value>)',
                },
                // Data accent (not a status). See --data in index.css.
                data: 'rgb(var(--data) / <alpha-value>)',
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
            // Named layering scale. Before this, 18 different z values were in
            // play — including `z-[1000000]` and `z-[999999]` — because every
            // surface guessed a number big enough to win. Worse, admin dialogs
            // and the admin sidebar BOTH sat at 50, so which one covered the
            // other depended on DOM order rather than intent.
            //
            // The numbers below are the existing effective layers, just named.
            // The four-digit-and-up tiers exist because Leaflet paints its own
            // controls at 1000: anything floating over a map has to clear that.
            zIndex: {
                raised: '10',      // lift inside a panel (sticky column, hover chip)
                sticky: '20',      // sticky sub-header inside page content
                dock: '30',        // mobile bottom dock
                scrim: '40',       // dim layer behind the shell drawer
                shell: '50',       // app shell: sidebar, mobile top bar, net banner
                modal: '60',       // dialogs — deliberately ABOVE the shell
                toast: '70',       // transient feedback outranks everything local
                'map-chrome': '1100', // floating chrome over Leaflet (its controls: 1000)
                popup: '1000000',  // full-screen video popup
                dialog: '1000010', // confirm/alert — the last word, over the popup
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
