/**
 * Purpose: Lock what a playback token is allowed to TELL a visitor about cameras, which is a
 *          strictly narrower question than what it lets them watch.
 * Caller: backend test gate.
 * Deps: vitest, mocked connectionPool + playbackTokenService.
 * SideEffects: None.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This catalog was added so an owner-issued share link can render a picker for a camera that is on
 * no public list. That is exactly the shape of an enumeration oracle if it drifts: describe one
 * camera the segment gate would refuse and a private camera's existence, name and area leak to
 * whoever holds any token at all.
 *
 * So the permissive case is one test and the rest are the ways it could leak. The load-bearing
 * assertion is that the catalog and rentalPlaybackAccessPolicy answer identically — every refusal
 * below is a refusal the segment gate also makes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn(() => []) }));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: vi.fn(() => null),
    execute: vi.fn(() => ({ changes: 0 })),
}));
vi.mock('../services/playbackTokenService.js', () => ({
    default: { validateRequestForCamera: vi.fn(() => null) },
}));

const { listTokenPlayableCameras } = await import('../services/playbackTokenCameraCatalog.js');

const KAMERA = (isi = {}) => ({
    id: 7,
    name: 'Rumah Depan',
    area_id: null,
    area_name: null,
    camera_class: 'community',
    owner_user_id: null,
    billing_status: null,
    delivery_type: 'internal_hls',
    stream_source: 'internal',
    enable_recording: 1,
    ...isi,
});

/** created_by 1 = the admin who also owns the private camera in these tests. */
const TOKEN = (isi = {}) => ({
    id: 5, scope_type: 'selected', created_by: 1, allowed_camera_ids: [7], ...isi,
});

beforeEach(() => {
    queryMock.mockReset().mockReturnValue([]);
});

describe('cakupan token yang dilaporkan ke penonton', () => {
    it('kamera komunitas dalam cakupan dilaporkan', () => {
        queryMock.mockReturnValue([KAMERA()]);
        const hasil = listTokenPlayableCameras(TOKEN());

        expect(hasil).toHaveLength(1);
        expect(hasil[0]).toMatchObject({ id: 7, name: 'Rumah Depan', camera_class: 'community' });
    });

    it('kamera owner_private dilaporkan HANYA kepada tautan terbitan pemiliknya', () => {
        queryMock.mockReturnValue([KAMERA({ camera_class: 'owner_private', owner_user_id: 1 })]);

        expect(listTokenPlayableCameras(TOKEN())).toHaveLength(1);
        // Token terbitan orang lain: kamera yang sama harus lenyap sama sekali, bukan sekadar
        // ditolak saat diputar — daftar yang menyebutkannya sudah membocorkan keberadaannya.
        expect(listTokenPlayableCameras(TOKEN({ created_by: 99 }))).toEqual([]);
    });

    it('tidak pernah mengembalikan owner_user_id atau billing_status', () => {
        queryMock.mockReturnValue([KAMERA({ camera_class: 'owner_private', owner_user_id: 1 })]);
        const [kamera] = listTokenPlayableCameras(TOKEN());

        // Dibaca untuk mengambil keputusan, lalu dibuang. Penonton dapat entri picker,
        // bukan catatan kepemilikan kamera.
        expect(kamera).not.toHaveProperty('owner_user_id');
        expect(kamera).not.toHaveProperty('billing_status');
    });

    it('kamera sewa yang ditangguhkan tidak dilaporkan — sama seperti gerbang segmennya', () => {
        queryMock.mockReturnValue([
            KAMERA({ camera_class: 'subscriber', owner_user_id: 1, billing_status: 'suspended' }),
        ]);
        expect(listTokenPlayableCameras(TOKEN())).toEqual([]);
    });

    it('kamera sewa yang masih aktif dan diterbitkan pemiliknya tetap dilaporkan', () => {
        queryMock.mockReturnValue([
            KAMERA({ camera_class: 'subscriber', owner_user_id: 1, billing_status: 'active' }),
        ]);
        expect(listTokenPlayableCameras(TOKEN())).toHaveLength(1);
    });
});

describe('cakupan selain selected tidak boleh melebar', () => {
    it.each(['all', 'area'])("scope '%s' tidak melaporkan apa pun dan tidak menyentuh DB", (scope) => {
        // Cakupan luas tak pernah bisa menjangkau kamera non-komunitas, jadi daftar kedua di sini
        // hanya akan jadi kesempatan untuk berbeda pendapat dengan daftar publik.
        expect(listTokenPlayableCameras(TOKEN({ scope_type: scope }))).toEqual([]);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('token kosong/null aman', () => {
        expect(listTokenPlayableCameras(null)).toEqual([]);
        expect(listTokenPlayableCameras(TOKEN({ allowed_camera_ids: [] }))).toEqual([]);
        expect(queryMock).not.toHaveBeenCalled();
    });
});

describe('id yang dikirim ke SQL', () => {
    it('dibersihkan jadi bilangan bulat positif dan diparameterkan', () => {
        listTokenPlayableCameras(TOKEN({ allowed_camera_ids: [7, '8', -1, 0, null, 'x', 7] }));

        const [sql, params] = queryMock.mock.calls[0];
        expect(params).toEqual([7, 8]);
        // Satu placeholder per id — tidak ada nilai yang diinterpolasi ke dalam SQL.
        expect(sql).toContain('c.id IN (?, ?)');
    });

    it('dibatasi supaya token salah konfigurasi tidak membangun IN(...) raksasa', () => {
        const banyak = Array.from({ length: 500 }, (_, index) => index + 1);
        listTokenPlayableCameras(TOKEN({ allowed_camera_ids: banyak }));

        expect(queryMock.mock.calls[0][1]).toHaveLength(200);
    });

    it('hanya meminta kamera aktif yang benar-benar merekam', () => {
        listTokenPlayableCameras(TOKEN());

        const [sql] = queryMock.mock.calls[0];
        expect(sql).toContain('c.enabled = 1');
        expect(sql).toContain('c.enable_recording = 1');
    });
});
