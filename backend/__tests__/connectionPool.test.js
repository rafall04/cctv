/**
 * Purpose: Verify SQLite connection pool safety pragmas for concurrent token/session writes.
 * Caller: Backend focused and full Vitest gates.
 * Deps: vitest, database connectionPool singleton.
 * MainFuncs: connectionPool pragma behavior tests.
 * SideEffects: Opens and closes the local SQLite test/development database connection.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { closeAll, pool } from '../database/connectionPool.js';

describe('connectionPool', () => {
    afterEach(() => {
        closeAll();
    });

    it('sets a non-zero SQLite busy timeout on the write connection', () => {
        const connection = pool.getWriteConnection();

        expect(connection.pragma('busy_timeout', { simple: true })).toBeGreaterThanOrEqual(5000);
    });

    it('preserves transaction callback arguments while exposing the write connection last', () => {
        const transaction = pool.transaction((value, connection) => ({
            value,
            hasPrepare: typeof connection.prepare === 'function',
        }));

        expect(transaction('payload')).toEqual({
            value: 'payload',
            hasPrepare: true,
        });
    });
});
