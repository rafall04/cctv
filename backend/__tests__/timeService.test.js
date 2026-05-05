/**
 * Purpose: Verify shared backend timestamp helpers for configured local SQL and UTC SQL semantics.
 * Caller: Backend Vitest suite for services/timeService.js.
 * Deps: Vitest and mocked timezoneService.
 * MainFuncs: nowLocalSql, getLocalDate, getLocalDateWithOffset, diffLocalSqlSeconds, toUtcSql.
 * SideEffects: None.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

import {
    diffLocalSqlSeconds,
    getLocalDate,
    getLocalDateWithOffset,
    nowLocalSql,
    parseUtcSql,
    resolveLocalSqlTimestamp,
    toUtcSql,
} from '../services/timeService.js';

describe('timeService', () => {
    it('formats instants into configured timezone local SQL strings', () => {
        expect(nowLocalSql(new Date('2026-05-05T07:25:00.000Z'))).toBe('2026-05-05 14:25:00');
        expect(getLocalDate(new Date('2026-05-05T17:30:00.000Z'))).toBe('2026-05-06');
        expect(getLocalDateWithOffset(-1, new Date('2026-05-05T17:30:00.000Z'))).toBe('2026-05-05');
    });

    it('calculates local SQL duration without relying on process timezone parsing', () => {
        expect(diffLocalSqlSeconds('2026-05-05 00:00:00', '2026-05-05 00:00:10')).toBe(10);
        expect(resolveLocalSqlTimestamp('2026-05-05 00:00:20')).toBe('2026-05-05 00:00:20');
    });

    it('formats UTC SQL explicitly for token and audit storage', () => {
        expect(toUtcSql(new Date('2026-05-05T07:25:00.000Z'))).toBe('2026-05-05 07:25:00');
        expect(parseUtcSql('2026-05-05 07:25:00').toISOString()).toBe('2026-05-05T07:25:00.000Z');
    });
});
