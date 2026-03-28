import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraService from '../services/cameraService.js';
import axios from 'axios';

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        create: vi.fn(() => ({
            get: vi.fn(),
            post: vi.fn(),
            delete: vi.fn(),
            patch: vi.fn(),
        })),
    },
}));

describe('cameraService import preview', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        axios.get.mockReset();
    });

    it('menandai duplicate name dan duplicate url sebelum apply import', async () => {
        vi.spyOn(connectionPool, 'query').mockReturnValue([
            {
                name: 'Existing Cam',
                private_rtsp_url: '',
                external_hls_url: null,
                external_stream_url: 'https://dup.example/live.m3u8',
                external_embed_url: null,
            },
        ]);

        const result = await cameraService.previewImportCameras({
            targetArea: 'Jombang',
            cameras: [
                { name: 'Existing Cam', url: 'https://valid.example/one.m3u8' },
                { name: 'Cam 2', url: 'https://dup.example/live.m3u8' },
                { title: 'Cam 3', url: 'https://valid.example/two.m3u8' },
            ],
            globalOverrides: {},
            importPolicy: {},
        });

        expect(result.canImport).toBe(true);
        expect(result.summary.importableCount).toBe(1);
        expect(result.summary.duplicateCount).toBe(2);
        expect(result.rows.map((row) => row.status)).toEqual([
            'duplicate_name',
            'duplicate_url',
            'importable',
        ]);
        expect(result.rows[2].resolvedDeliveryType).toBe('external_hls');
    });

    it('mengambil source preset Jombang v2 dan memetakannya ke MJPEG passive-first', async () => {
        vi.spyOn(connectionPool, 'query').mockReturnValue([]);
        axios.get.mockResolvedValue({
            data: `
                <html>
                    <script>
                        const cctvData = [{"id":"1","nama":"Perempatan A","lat":"-7.1","lng":"112.1","url":"https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=1&token=abc","kategori":"Persimpangan","status":"online"},{"id":"2","nama":"Perbatasan B","lat":"-7.2","lng":"112.2","url":"https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=2&token=def","kategori":"Perbatasan","status":"offline"}];
                    </script>
                </html>
            `,
        });

        const result = await cameraService.previewImportCameras({
            targetArea: 'Jombang',
            sourceProfile: 'jombang_mjpeg',
            globalOverrides: {},
            importPolicy: {
                filterSourceRows: 'all',
            },
        });

        expect(axios.get).toHaveBeenCalledWith(
            'https://cctv.jombangkab.go.id/v2/',
            expect.objectContaining({
                responseType: 'text',
            })
        );
        expect(result.summary.totalRows).toBe(2);
        expect(result.sourceStats.onlineCount).toBe(1);
        expect(result.sourceStats.offlineCount).toBe(1);
        expect(result.rows[0]).toEqual(expect.objectContaining({
            resolvedDeliveryType: 'external_mjpeg',
            resolvedHealthMode: 'passive_first',
            resolvedTlsMode: 'strict',
        }));
        expect(result.fieldMapping.name).toBe('nama');
        expect(result.warnings.some((warning) => warning.code === 'jombang_tokenized_source')).toBe(true);
    });
});
