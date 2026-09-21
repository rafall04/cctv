import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/__tests__/setup.js'],
        include: ['src/**/*.{test,spec}.{js,jsx}'],
        coverage: {
            reporter: ['text', 'json', 'html'],
            // Ratchet floor ~2pt under the measured baseline (62.2/73.3/58.7/62.2 on
            // 2026-09-21). A PR that LOWERS coverage fails CI; raise these numbers as
            // coverage improves — never lower them to make a red suite pass.
            thresholds: {
                lines: 60,
                branches: 71,
                functions: 56,
                statements: 60,
            },
        },
    },
});
