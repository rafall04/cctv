/**
 * Purpose: Lock down local DB-snapshot retention — keep window, deploy-backup cap, due logic.
 *          Regression guard for the "50 backup files ate 28 GB" incident class.
 * Caller: backend test gate.
 * Deps: vitest, tmp dirs; connectionPool mocked (service imports it transitively).
 * SideEffects: creates/deletes files under os.tmpdir only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connectionPool.js', () => ({
    pool: { getWriteConnection: () => ({ prepare: () => ({ run: () => ({}) }) }) },
    query: vi.fn(), queryOne: vi.fn(), execute: vi.fn(),
}));
vi.mock('../services/settingsService.js', () => ({ default: { getSetting: () => null, updateSetting: vi.fn() } }));

import {
    listLocalSnapshots,
    pruneLocalSnapshots,
    isLocalBackupDue,
    LOCAL_BACKUP_KEEP,
    DEPLOY_BACKUP_KEEP,
} from '../services/localBackupService.js';

let backupDir, dataDir;
const touch = (dir, name, ageMs = 0, bytes = 10) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, Buffer.alloc(bytes));
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(p, t, t);
    return p;
};
const snapName = (i) => `cctv_2026-09-${String(i + 1).padStart(2, '0')}T00-00-00.db.gz`;

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-data-'));
    backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir);
});
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('localBackupService — retention', () => {
    it('listLocalSnapshots returns only cctv_*.db.gz, newest first', () => {
        touch(backupDir, snapName(0), 2000);
        touch(backupDir, snapName(1), 1000);
        touch(backupDir, 'snapshot_2026-09-03T00-00-00.db.gz', 500); // temp name — not a kept snapshot
        touch(backupDir, 'notes.txt', 0);
        const list = listLocalSnapshots(backupDir);
        expect(list.map((s) => s.file)).toEqual([snapName(1), snapName(0)]);
    });

    it('isLocalBackupDue: due when empty or newest is older than 24h, not due when fresh', () => {
        expect(isLocalBackupDue(Date.now(), backupDir)).toBe(true);
        touch(backupDir, snapName(0), 60 * 1000);
        expect(isLocalBackupDue(Date.now(), backupDir)).toBe(false);
        touch(backupDir, snapName(1), 25 * 60 * 60 * 1000);
        // newest file decides — the 1-minute-old file still wins
        expect(isLocalBackupDue(Date.now(), backupDir)).toBe(false);
    });

    it('isLocalBackupDue: due again once the newest snapshot ages past the interval', () => {
        touch(backupDir, snapName(0), 26 * 60 * 60 * 1000);
        expect(isLocalBackupDue(Date.now(), backupDir)).toBe(true);
    });

    it('prune keeps the newest LOCAL_BACKUP_KEEP snapshots and deletes the rest', () => {
        for (let i = 0; i < LOCAL_BACKUP_KEEP + 4; i++) touch(backupDir, snapName(i), (LOCAL_BACKUP_KEEP + 4 - i) * 1000);
        const deleted = pruneLocalSnapshots({ backupDir, dataDir });
        expect(deleted).toBe(4);
        expect(listLocalSnapshots(backupDir)).toHaveLength(LOCAL_BACKUP_KEEP);
        // newest survived
        expect(fs.existsSync(path.join(backupDir, snapName(LOCAL_BACKUP_KEEP + 3)))).toBe(true);
    });

    it('prune also caps data/cctv.db.backup-* deploy copies at DEPLOY_BACKUP_KEEP', () => {
        for (let i = 0; i < DEPLOY_BACKUP_KEEP + 3; i++) {
            touch(dataDir, `cctv.db.backup-202609${String(i + 10)}-0000${String(i).padStart(2, '0')}`, (DEPLOY_BACKUP_KEEP + 3 - i) * 1000);
        }
        const deleted = pruneLocalSnapshots({ backupDir, dataDir });
        expect(deleted).toBe(3);
        expect(fs.readdirSync(dataDir).filter((f) => f.startsWith('cctv.db.backup-'))).toHaveLength(DEPLOY_BACKUP_KEEP);
    });

    it('prune on an empty dir is a no-op, not a crash', () => {
        expect(pruneLocalSnapshots({ backupDir, dataDir })).toBe(0);
    });
});
