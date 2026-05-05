/*
 * Purpose: Verify backend SQLite timestamps are parsed consistently before timezone display.
 * Caller: Frontend focused timezone test gate.
 * Deps: vitest, TimezoneContext date parser.
 * MainFuncs: parseBackendDateInput behavior tests.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { parseBackendDateInput } from './TimezoneContext.jsx';

describe('TimezoneContext date parsing', () => {
    it('treats SQLite CURRENT_TIMESTAMP strings as UTC instead of browser local time', () => {
        expect(parseBackendDateInput('2026-05-05 07:25:00').toISOString()).toBe('2026-05-05T07:25:00.000Z');
    });
});
