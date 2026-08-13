/**
 * Purpose: Pin how a Ronda detector resolves each camera's video source.
 * Caller: Backend test gate.
 * Deps: vitest, mocked fs / child_process / connectionPool / rondaConfigService.
 * MainFuncs: listAvailableCameras + createDetector source tests.
 * SideEffects: none — docker and the DB are mocked.
 *
 * Ini menahan bug yang terbukti di produksi 13 Agustus 2026: URL sumber selalu dibangun sebagai
 * rtsp://127.0.0.1:8554/<stream_key>, padahal MediaMTX di sana berjalan dengan NOL path karena
 * kameranya HLS eksternal. Detektor yang ditambahkan dari panel akan menyambung ulang selamanya
 * ke alamat 404 — hidup, tapi buta, dan tidak ada satu pun pesan yang menjelaskan kenapa.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, queryMock } = vi.hoisted(() => ({
    execFileMock: vi.fn(() => ''),
    queryMock: vi.fn(() => []),
}));

vi.mock('fs', () => ({
    default: { existsSync: vi.fn(() => true), mkdirSync: vi.fn(), createReadStream: vi.fn() },
    existsSync: vi.fn(() => true),
}));

vi.mock('child_process', () => ({
    execFile: (cmd, args, opts, cb) => {
        const done = typeof opts === 'function' ? opts : cb;
        done(null, { stdout: execFileMock(cmd, args) ?? '', stderr: '' });
    },
}));

vi.mock('../database/connectionPool.js', () => ({
    query: (...a) => queryMock(...a),
    queryOne: vi.fn(() => null),
}));

const ditulis = [];
vi.mock('../services/rondaConfigService.js', () => ({
    default: {
        isAvailable: vi.fn(() => true),
        anyBotToken: vi.fn(() => 'token-bohongan'),
        listRaw: vi.fn(() => []),
        listNames: vi.fn(() => []),
        writeRaw: vi.fn((nama, cfg) => { ditulis.push({ nama, cfg }); return cfg; }),
        deleteRaw: vi.fn(),
        getCamera: vi.fn((nama) => ({ name: nama })),
    },
}));

const KAMERA_EKSTERNAL = {
    id: 15,
    name: 'PEREMPATAN JEMBATAN SOSRODILOGO',
    stream_key: '83b84770-19fb-485f-a68e-9cd63a6d56f9',
    stream_source: 'external',
    external_hls_url: 'https://contoh.go.id/live/local/abc.m3u8',
    private_rtsp_url: null,
};

const KAMERA_INTERNAL = {
    id: 7,
    name: 'GERBANG DEPAN',
    stream_key: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    stream_source: 'internal',
    private_rtsp_url: 'rtsp://192.168.1.9:554/stream1',
};

const KAMERA_EMBED = {
    id: 21,
    name: 'HANYA SEMATAN',
    stream_key: 'cccccccc-dddd-eeee-ffff-000000000000',
    stream_source: 'external',
    external_embed_url: 'https://contoh.go.id/embed/21',
};

async function muat() {
    return (await import('../services/rondaDetectorService.js')).default;
}

describe('rondaDetectorService — sumber kamera', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockReset();
        execFileMock.mockReset().mockReturnValue('');
        ditulis.length = 0;
        process.env.RONDA_RTSP_BASE = 'rtsp://127.0.0.1:8554';
    });

    it('kamera HLS eksternal memakai URL aslinya, bukan alamat MediaMTX', async () => {
        queryMock.mockReturnValue([KAMERA_EKSTERNAL]);
        const svc = await muat();
        await svc.createDetector({ camera_id: 15, area: 'Kota' });

        expect(ditulis).toHaveLength(1);
        expect(ditulis[0].cfg.source_url).toBe(KAMERA_EKSTERNAL.external_hls_url);
        expect(ditulis[0].cfg.source_type).toBe('external_hls');

        const argv = execFileMock.mock.calls.at(-1)[1];
        const rtsp = argv[argv.indexOf('RTSP_URL=' + KAMERA_EKSTERNAL.external_hls_url)];
        expect(rtsp).toBe(`RTSP_URL=${KAMERA_EKSTERNAL.external_hls_url}`);
        expect(argv.join(' ')).not.toContain('rtsp://127.0.0.1:8554');
    });

    it('kamera RTSP internal tetap lewat MediaMTX di bawah stream key-nya', async () => {
        queryMock.mockReturnValue([KAMERA_INTERNAL]);
        const svc = await muat();
        await svc.createDetector({ camera_id: 7 });

        expect(ditulis[0].cfg.source_url).toBe(`rtsp://127.0.0.1:8554/${KAMERA_INTERNAL.stream_key}`);
        expect(ditulis[0].cfg.source_type).toBe('internal_hls');
    });

    /*
     * Menolak lebih awal jauh lebih baik daripada membiarkan container berputar tanpa gambar:
     * kegagalannya jadi satu pesan yang bisa dibaca, bukan detektor bisu yang tampak rusak.
     */
    it('menolak kamera yang siarannya tidak bisa dibaca (sematan/embed)', async () => {
        queryMock.mockReturnValue([KAMERA_EMBED]);
        const svc = await muat();
        await expect(svc.createDetector({ camera_id: 21 })).rejects.toThrow(/belum bisa dipantau/i);
        expect(ditulis).toHaveLength(0);
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('daftar kamera yang bisa ditambahkan menyaring yang sumbernya tidak terbaca', async () => {
        queryMock.mockReturnValue([KAMERA_EKSTERNAL, KAMERA_INTERNAL, KAMERA_EMBED]);
        const svc = await muat();
        const tersedia = svc.listAvailableCameras();

        expect(tersedia.map((c) => c.id).sort((a, b) => a - b)).toEqual([7, 15]);
    });
});
