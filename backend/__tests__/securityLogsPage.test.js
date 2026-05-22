/**
 * Purpose: Verify getSecurityLogsPage paginates, filters, and clamps inputs.
 * Caller: Vitest backend suite.
 * Deps: services/securityAuditLogger.js with a mocked connectionPool.
 * MainFuncs: getSecurityLogsPage.
 * SideEffects: None — DB layer is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, queryOneMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    queryOneMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    execute: vi.fn(),
    query: queryMock,
    queryOne: queryOneMock,
}));

const { getSecurityLogsPage } = await import('../services/securityAuditLogger.js');

describe('getSecurityLogsPage', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryOneMock.mockReset();
    });

    it('returns paginated results with correct page math', () => {
        queryOneMock.mockReturnValue({ count: 25 });
        queryMock.mockReturnValue([{ id: 1, event_type: 'AUTH_FAILURE' }]);

        const result = getSecurityLogsPage({ page: 2, limit: 10 });

        expect(result.pagination).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
        // LIMIT 10 OFFSET 10 for page 2.
        const [, params] = queryMock.mock.calls[0];
        expect(params).toEqual([10, 10]);
    });

    it('applies an event-type filter and a text search to the WHERE clause', () => {
        queryOneMock.mockReturnValue({ count: 0 });
        queryMock.mockReturnValue([]);

        getSecurityLogsPage({ eventType: 'CSRF_INVALID', search: '1.2.3.4' });

        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain('event_type = ?');
        expect(sql).toContain('LIKE ?');
        expect(params[0]).toBe('CSRF_INVALID');
        expect(params).toContain('%1.2.3.4%');
    });

    it('clamps an oversized limit to 200', () => {
        queryOneMock.mockReturnValue({ count: 0 });
        queryMock.mockReturnValue([]);

        const result = getSecurityLogsPage({ limit: 99999 });

        expect(result.pagination.limit).toBe(200);
    });

    it('degrades to an empty page when the query throws', () => {
        queryOneMock.mockImplementation(() => { throw new Error('no table'); });

        const result = getSecurityLogsPage({ page: 1, limit: 50 });

        expect(result.logs).toEqual([]);
        expect(result.pagination.total).toBe(0);
    });
});
