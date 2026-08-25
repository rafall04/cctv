/*
Purpose: Lock the public error fallback to a human sentence — raw JS error text stays in DEV only.
Caller: Frontend Vitest suite.
Deps: Vitest, @testing-library/react, ErrorBoundary.
MainFuncs: ErrorBoundary production/development fallback tests.
SideEffects: Silences the console.error React emits when a boundary catches.
*/

import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

/*
 * PublicPageRoute renders this boundary with NO fallback prop, so whatever it shows is what a
 * visitor on the landing/map/share-link sees. The raw text of a production React error is
 * "Minified React error #310" plus asset URLs — noise to a visitor, and a map of the build to
 * anyone else. It was printed unconditionally while the stack trace right below it was correctly
 * gated on import.meta.env.DEV.
 */
const RAW = 'Minified React error #310; visit https://react.dev/errors/310';

function Boom() {
    throw new Error(RAW);
}

describe('ErrorBoundary default fallback', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('shows a visitor a plain Indonesian sentence, never the raw error text', () => {
        vi.stubEnv('DEV', false);

        render(<ErrorBoundary><Boom /></ErrorBoundary>);

        expect(screen.queryByText(/Minified React error/)).toBeNull();
        expect(screen.queryByText(/react\.dev/)).toBeNull();
        expect(screen.queryByText(/Error Message/)).toBeNull();
        expect(screen.getByText(/gagal ditampilkan/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Coba Lagi/i })).toBeTruthy();
    });

    it('still hands a developer the raw error, so gating it costs nothing in DEV', () => {
        vi.stubEnv('DEV', true);

        render(<ErrorBoundary><Boom /></ErrorBoundary>);

        expect(screen.getByText(new RegExp(RAW.slice(0, 24)))).toBeTruthy();
    });
});
