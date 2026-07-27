/**
 * Purpose: Cover the Telegram archive routing service — validation, atomic persistence, target
 *          resolution, and the chat-verification path the admin form leans on.
 * Deps: vitest, node:fs (real temp dir), mocked connectionPool.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const CAMERAS = [
    { id: 1435, name: 'CCTV LAPANGAN DANDER BARAT', areaId: 2, areaName: 'DS DANDER' },
    { id: 1441, name: 'CCTV SELATAN AHASS DANDER', areaId: 2, areaName: 'DS DANDER' },
    { id: 7, name: 'CCTV UTARA PASAR NGITIK 1', areaId: 3, areaName: 'DS TANJUNGHARJO' },
];

vi.mock('../database/connectionPool.js', () => ({
    query: vi.fn((sql, params) => {
        if (sql.includes('FROM cameras')) return CAMERAS;
        if (sql.includes('FROM areas WHERE id')) {
            return [2, 3].includes(Number(params?.[0])) ? [{ id: Number(params[0]) }] : [];
        }
        if (sql.includes('FROM areas')) return [{ id: 2, name: 'DS DANDER' }, { id: 3, name: 'DS TANJUNGHARJO' }];
        return [];
    }),
}));

let tmpDir;
let service;
let resolveTargets;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-archive-'));
    process.env.TG_ARCHIVE_DIR = tmpDir;
    process.env.TG_ARCHIVE_ROUTES_FILE = path.join(tmpDir, 'routes.json');
    process.env.TG_ARCHIVE_STATE_DB = path.join(tmpDir, 'state.db');
    process.env.TG_ARCHIVE_ENV_FILE = path.join(tmpDir, '.env');
    vi.resetModules();
    const mod = await import('../services/telegramArchiveService.js');
    service = mod.default;
    resolveTargets = mod.resolveTargets;
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
});

describe('createRoute validation', () => {
    it('creates a camera route and persists it to disk', () => {
        const route = service.createRoute({
            scope: 'camera', cameraId: 1441, chatId: '-5510674082', label: 'Arsip Selatan AHASS',
        });

        expect(route).toMatchObject({
            scope: 'camera', cameraId: 1441, chatId: '-5510674082', enabled: true,
        });
        expect(route.id).toBe('arsip-selatan-ahass');

        const onDisk = JSON.parse(fs.readFileSync(process.env.TG_ARCHIVE_ROUTES_FILE, 'utf8'));
        expect(onDisk.routes).toHaveLength(1);
        expect(onDisk.routes[0].chatId).toBe('-5510674082');
    });

    it.each([
        ['bukan-angka', 'ID grup Telegram tidak valid'],
        ['', 'ID grup Telegram tidak valid'],
        ['-12', 'ID grup Telegram tidak valid'],
        ['-5510674082 ', null],
    ])('validates chat id %s', (chatId, expectedError) => {
        const call = () => service.createRoute({ scope: 'camera', cameraId: 1441, chatId });
        if (expectedError) {
            expect(call).toThrow(expectedError);
        } else {
            expect(call().chatId).toBe('-5510674082');   // trimmed, not rejected
        }
    });

    it('rejects an unknown scope', () => {
        expect(() => service.createRoute({ scope: 'planet', chatId: '-5510674082' }))
            .toThrow("Cakupan harus 'camera', 'area', atau 'all'");
    });

    it('rejects a camera that is not recording', () => {
        expect(() => service.createRoute({ scope: 'camera', cameraId: 999, chatId: '-5510674082' }))
            .toThrow('Kamera tidak ditemukan atau perekamannya tidak aktif');
    });

    it('rejects an area route with an unknown area', () => {
        expect(() => service.createRoute({ scope: 'area', areaId: 88, chatId: '-5510674082' }))
            .toThrow('Area tidak ditemukan');
    });

    it('requires a camera to be chosen for camera scope', () => {
        expect(() => service.createRoute({ scope: 'camera', chatId: '-5510674082' }))
            .toThrow('Pilih kamera terlebih dahulu');
    });

    it('refuses an exact duplicate route', () => {
        const payload = { scope: 'camera', cameraId: 1441, chatId: '-5510674082' };
        service.createRoute(payload);
        expect(() => service.createRoute(payload)).toThrow('Rute yang sama persis sudah ada');
    });

    it('generates unique ids when labels collide', () => {
        const first = service.createRoute({ scope: 'camera', cameraId: 1441, chatId: '-111111111', label: 'Arsip' });
        const second = service.createRoute({ scope: 'camera', cameraId: 1435, chatId: '-222222222', label: 'Arsip' });
        expect(first.id).toBe('arsip');
        expect(second.id).toBe('arsip-2');
    });
});

describe('updateRoute / deleteRoute', () => {
    it('updates in place and keeps the id stable', () => {
        const created = service.createRoute({ scope: 'camera', cameraId: 1441, chatId: '-5510674082', label: 'Awal' });
        const updated = service.updateRoute(created.id, { enabled: false, label: 'Baru' });

        expect(updated).toMatchObject({ id: created.id, enabled: false, label: 'Baru', cameraId: 1441 });
        expect(service.overview().routes).toHaveLength(1);
    });

    it('404s on an unknown route', () => {
        expect(() => service.updateRoute('tidak-ada', { scope: 'all', chatId: '-5510674082' }))
            .toThrow('Rute tidak ditemukan');
        expect(() => service.deleteRoute('tidak-ada')).toThrow('Rute tidak ditemukan');
    });

    it('deletes and stops routing that camera', () => {
        const created = service.createRoute({ scope: 'camera', cameraId: 1441, chatId: '-5510674082' });
        service.deleteRoute(created.id);

        const camera = service.overview().cameras.find((c) => c.id === 1441);
        expect(camera.targets).toEqual([]);
    });
});

describe('resolveTargets', () => {
    const routes = [
        { id: 'area-dander', enabled: true, scope: 'area', areaId: 2, chatId: '-200', label: 'Area' },
        { id: 'cam-ahass', enabled: true, scope: 'camera', cameraId: 1441, chatId: '-100', label: 'Kamera' },
        { id: 'semua', enabled: true, scope: 'all', chatId: '-300', label: 'Semua' },
        { id: 'mati', enabled: false, scope: 'camera', cameraId: 1441, chatId: '-400', label: 'Mati' },
    ];

    it('orders camera before area before all, and marks only the first as the uploader', () => {
        const targets = resolveTargets(routes, 1441, 2);
        expect(targets.map((t) => t.chatId)).toEqual(['-100', '-200', '-300']);
        expect(targets.map((t) => t.mode)).toEqual(['upload', 'copy', 'copy']);
    });

    it('skips disabled routes', () => {
        expect(resolveTargets(routes, 1441, 2).map((t) => t.id)).not.toContain('mati');
    });

    it('de-duplicates when two routes point at the same group', () => {
        const dupes = [
            { id: 'a', enabled: true, scope: 'camera', cameraId: 1441, chatId: '-100' },
            { id: 'b', enabled: true, scope: 'area', areaId: 2, chatId: '-100' },
        ];
        expect(resolveTargets(dupes, 1441, 2)).toHaveLength(1);
    });

    it('returns nothing for a camera no route covers', () => {
        const cameraOnly = [{ id: 'a', enabled: true, scope: 'camera', cameraId: 1441, chatId: '-100' }];
        expect(resolveTargets(cameraOnly, 7, 3)).toEqual([]);
    });

    it('does not match an area route when the camera has no area', () => {
        const areaOnly = [{ id: 'a', enabled: true, scope: 'area', areaId: 2, chatId: '-100' }];
        expect(resolveTargets(areaOnly, 1441, null)).toEqual([]);
    });
});

describe('overview', () => {
    it('reports availability and resolves every recording camera', () => {
        service.createRoute({ scope: 'area', areaId: 3, chatId: '-5562560753', label: 'Tanjungharjo' });
        const overview = service.overview();

        expect(overview.available).toBe(true);
        expect(overview.cameras).toHaveLength(3);
        expect(overview.cameras.find((c) => c.id === 7).targets[0].chatId).toBe('-5562560753');
        expect(overview.cameras.find((c) => c.id === 1441).targets).toEqual([]);
    });

    it('survives a missing routes file', () => {
        expect(service.overview().routes).toEqual([]);
    });
});

describe('verifyChat', () => {
    beforeEach(() => {
        fs.writeFileSync(process.env.TG_ARCHIVE_ENV_FILE,
            'TG_BOT_TOKEN=123:ABC\nTG_API_BASE=http://127.0.0.1:8092\n');
    });

    it('returns the resolved group and never leaks the token', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            json: async () => ({
                ok: true,
                result: {
                    id: -5510674082,
                    title: 'CCTV SELATAN AHASS DANDER',
                    type: 'group',
                    permissions: { can_send_documents: true },
                },
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await service.verifyChat('-5510674082');
        expect(result).toEqual({
            chatId: '-5510674082',
            title: 'CCTV SELATAN AHASS DANDER',
            type: 'group',
            canSendDocuments: true,
        });
        expect(JSON.stringify(result)).not.toContain('123:ABC');
    });

    it('flags a group the bot cannot post documents to', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({
                ok: true,
                result: { id: -1, title: 'Grup', type: 'group', permissions: { can_send_documents: false } },
            }),
        }));
        expect((await service.verifyChat('-5510674082')).canSendDocuments).toBe(false);
    });

    it('surfaces the Telegram error verbatim', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ ok: false, description: 'chat not found' }),
        }));
        await expect(service.verifyChat('-5510674082')).rejects.toThrow('Telegram menolak: chat not found');
    });

    it('rejects a malformed chat id before touching the network', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(service.verifyChat('halo')).rejects.toThrow('ID grup Telegram tidak valid');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('explains when the bot is not configured on this host', async () => {
        fs.rmSync(process.env.TG_ARCHIVE_ENV_FILE);
        await expect(service.verifyChat('-5510674082'))
            .rejects.toThrow('Bot arsip belum dikonfigurasi di server');
    });
});

describe('activity', () => {
    it('reports unavailable rather than throwing when the sidecar never ran', () => {
        expect(service.activity()).toEqual({ available: false, totals: [], recent: [] });
    });
});

describe('discovered groups', () => {
    function seedChats(rows) {
        const db = new Database(process.env.TG_ARCHIVE_STATE_DB);
        db.exec(`CREATE TABLE chats (chat_id TEXT PRIMARY KEY, title TEXT, type TEXT,
                 status TEXT, can_send INTEGER, discovered_at TEXT, updated_at TEXT)`);
        const stmt = db.prepare('INSERT INTO chats VALUES (?,?,?,?,?,?,?)');
        rows.forEach((r) => stmt.run(r.chatId, r.title, r.type, r.status, r.canSend, '', ''));
        db.close();
    }

    it('returns nothing when the sidecar has not run yet', () => {
        expect(service.groups()).toEqual([]);
        expect(service.overview().groups).toEqual([]);
    });

    it('lists groups the bot is still in, with permission resolved to a boolean', () => {
        seedChats([
            { chatId: '-5510674082', title: 'CCTV SELATAN AHASS', type: 'group', status: 'member', canSend: 1 },
            { chatId: '-5599990000', title: 'Grup Terkunci', type: 'group', status: 'member', canSend: 0 },
        ]);
        const groups = service.groups();
        expect(groups).toHaveLength(2);
        expect(groups.find((g) => g.chatId === '-5510674082').canSend).toBe(true);
        expect(groups.find((g) => g.chatId === '-5599990000').canSend).toBe(false);
    });

    it('hides groups the bot was removed from, so they cannot be picked', () => {
        seedChats([
            { chatId: '-1', title: 'Masih Ikut', type: 'group', status: 'member', canSend: 1 },
            { chatId: '-2', title: 'Sudah Keluar', type: 'group', status: 'left', canSend: 1 },
            { chatId: '-3', title: 'Dikeluarkan', type: 'group', status: 'kicked', canSend: 1 },
            { chatId: '-4', title: 'Tak Terjangkau', type: 'group', status: 'unreachable', canSend: 1 },
        ]);
        expect(service.groups().map((g) => g.title)).toEqual(['Masih Ikut']);
    });

    it('keeps an unknown permission as null rather than guessing', () => {
        seedChats([{ chatId: '-1', title: 'Baru', type: 'group', status: 'member', canSend: null }]);
        expect(service.groups()[0].canSend).toBeNull();
    });
});
