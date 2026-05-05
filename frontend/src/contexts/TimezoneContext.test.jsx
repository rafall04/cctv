/*
 * Purpose: Verify backend timestamp storage modes are parsed consistently before timezone display.
 * Caller: Frontend focused timezone test gate.
 * Deps: vitest, React Testing Library, TimezoneContext date parser/provider.
 * MainFuncs: parseBackendDateInput, getLocalDateInputValue, and public timezone loading behavior tests.
 * SideEffects: Mocks timezone API reads during provider tests.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminGetMock } = vi.hoisted(() => ({
    adminGetMock: vi.fn(),
}));

vi.mock('../services/api', () => ({
    adminAPI: {
        get: adminGetMock,
    },
}));

import {
    TIMESTAMP_STORAGE,
    TimezoneProvider,
    getLocalDateInputValue,
    parseBackendDateInput,
    useTimezone,
} from './TimezoneContext.jsx';

function TimezoneProbe() {
    const { timezone } = useTimezone();
    return <span data-testid="timezone">{timezone}</span>;
}

beforeEach(() => {
    adminGetMock.mockReset();
});

describe('TimezoneContext date parsing', () => {
    it('treats SQLite CURRENT_TIMESTAMP strings as UTC instead of browser local time', () => {
        expect(parseBackendDateInput('2026-05-05 07:25:00', { storage: TIMESTAMP_STORAGE.UTC_SQL }).toISOString()).toBe('2026-05-05T07:25:00.000Z');
    });

    it('keeps ISO timestamps stable without an explicit storage mode', () => {
        expect(parseBackendDateInput('2026-05-05T07:25:00.000Z').toISOString()).toBe('2026-05-05T07:25:00.000Z');
    });

    it('parses local SQL strings explicitly instead of relying on browser-specific space parsing', () => {
        expect(Number.isNaN(parseBackendDateInput('2026-05-05 07:25:00', { storage: TIMESTAMP_STORAGE.LOCAL_SQL }).getTime())).toBe(false);
    });

    it('builds date input values from the configured timezone day', () => {
        expect(getLocalDateInputValue(new Date('2026-05-05T17:30:00.000Z'), 'Asia/Jakarta')).toBe('2026-05-06');
    });

    it('loads timezone from the public settings endpoint without auth refresh side effects', async () => {
        adminGetMock.mockResolvedValue({
            data: {
                data: {
                    timezone: 'Asia/Makassar',
                },
            },
        });

        render(
            <TimezoneProvider>
                <TimezoneProbe />
            </TimezoneProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('timezone').textContent).toBe('Asia/Makassar');
        });

        expect(adminGetMock).toHaveBeenCalledWith('/api/settings/timezone', {
            skipGlobalErrorNotification: true,
            skipAuthRefresh: true,
        });
    });
});
