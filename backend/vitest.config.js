import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['__tests__/**/*.test.js', '__tests__/**/*.property.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            // Ratchet, not a target: floors are the 2026-09-21 measured baseline
            // (lines 70.1 / stmts 68.7 / funcs 72.1 / branches 63.8) rounded down.
            // Coverage may only go UP from here — when it does, raise the floor in
            // the same commit. A PR that lowers coverage fails CI.
            thresholds: {
                lines: 70,
                statements: 68,
                functions: 72,
                branches: 63,
            },
        },
    },
});
