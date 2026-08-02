/**
 * Purpose: Verify operational table retention prunes the right tables and spares the archive index.
 * Caller: Vitest backend suite.
 * Deps: services/operationalRetentionService with mocked connectionPool.
 * MainFuncs: pruneOperationalTables.
 * SideEffects: None; execute() is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    execute: (...args) => executeMock(...args),
}));

vi.mock('../config/config.js', () => ({
    config: { auditLogRetentionDays: 90 },
}));

describe('operationalRetentionService', () => {
    beforeEach(() => {
        vi.resetModules();
        executeMock.mockReset();
        executeMock.mockReturnValue({ changes: 0 });
    });

    it('prunes audit_logs using the previously dead AUDIT_LOG_RETENTION_DAYS setting', async () => {
        const { pruneOperationalTables } = await import('../services/operationalRetentionService.js');
        pruneOperationalTables();

        const auditCall = executeMock.mock.calls.find(([sql]) => sql.includes('audit_logs'));
        expect(auditCall).toBeDefined();
        expect(auditCall[0]).toContain('DELETE FROM audit_logs');
        expect(auditCall[0]).toContain('created_at < ?');

        // 90 days back, in the 'YYYY-MM-DD HH:MM:SS' shape these columns are stored in.
        const cutoff = auditCall[1][0];
        expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        const ageDays = (Date.now() - new Date(`${cutoff}Z`).getTime()) / 86400000;
        expect(ageDays).toBeGreaterThan(89);
        expect(ageDays).toBeLessThan(91);
    });

    it('prunes restart_logs', async () => {
        const { pruneOperationalTables } = await import('../services/operationalRetentionService.js');
        pruneOperationalTables();

        expect(executeMock.mock.calls.some(([sql]) => sql.includes('DELETE FROM restart_logs'))).toBe(true);
    });

    /*
     * THE IMPORTANT ONE.
     *
     * telegram_archive_uploads grows faster than either pruned table (~4,800
     * rows/day) and reads like an upload journal, which makes it the obvious next
     * candidate for anyone extending this service. It is not one. It is the index
     * into the Telegram archive: local recordings are deleted after 4 hours, and
     * archivedSegmentSourceService reaches everything older through the file_id
     * stored here. On production every row is status='ok' with a live file_id —
     * there is no failed-upload subset to reclaim. A DELETE here does not free
     * garbage, it makes a recording permanently unreachable.
     */
    it('NEVER deletes from telegram_archive_uploads', async () => {
        const { pruneOperationalTables } = await import('../services/operationalRetentionService.js');
        pruneOperationalTables();

        expect(executeMock.mock.calls.some(([sql]) => sql.includes('telegram_archive_uploads'))).toBe(false);
    });

    it('survives a table that does not exist on an older database', async () => {
        executeMock.mockImplementation((sql) => {
            if (sql.includes('restart_logs')) {
                throw new Error('no such table: restart_logs');
            }
            return { changes: 3 };
        });

        const { pruneOperationalTables } = await import('../services/operationalRetentionService.js');
        expect(() => pruneOperationalTables()).not.toThrow();

        // The healthy table is still pruned despite the broken one.
        const results = pruneOperationalTables();
        expect(results).toContainEqual({ table: 'audit_logs', deleted: 3 });
    });

    it('stays silent when there is nothing to prune', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { pruneOperationalTables } = await import('../services/operationalRetentionService.js');
        pruneOperationalTables();

        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });
});
