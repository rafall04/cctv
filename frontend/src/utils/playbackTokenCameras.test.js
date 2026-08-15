/*
 * Purpose: Lock the merge that lets a share link render a camera the public list cannot hold —
 *          and lock it shut for everyone who did not get that camera from the server.
 * Caller: frontend test gate.
 *
 * The bug this replaces: a valid owner-issued link opened a playback page whose picker filtered
 * down to nothing, because the only camera the token covered was private and therefore absent from
 * the public list. The token worked, the segments were being served, and there was nothing to click.
 */
import { describe, it, expect } from 'vitest';
import { resolveTokenScopedCameras } from './playbackTokenCameras';

const PUBLIK = { id: 1, name: 'Alun-alun', delivery_type: 'internal_hls' };
const PUBLIK_LAIN = { id: 2, name: 'Pasar', delivery_type: 'internal_hls' };
const PRIVAT = { id: 90, name: 'Rumah', delivery_type: 'internal_hls', camera_class: 'owner_private' };

describe('tanpa token, daftar publik lewat apa adanya', () => {
    it('mengembalikan daftar yang sama persis (identitas terjaga untuk memo hilir)', () => {
        const cameras = [PUBLIK, PUBLIK_LAIN];
        expect(resolveTokenScopedCameras({ cameras, tokenCameras: null })).toBe(cameras);
    });

    it('argumen kosong tidak meledak', () => {
        expect(resolveTokenScopedCameras()).toEqual([]);
        expect(resolveTokenScopedCameras({})).toEqual([]);
    });
});

describe('kamera privat yang dicakup token', () => {
    const args = {
        cameras: [PUBLIK],
        tokenCameras: [PRIVAT],
        allowedCameraIds: [90],
        scopeType: 'selected',
    };

    it('muncul di picker meski tidak pernah ada di daftar publik', () => {
        expect(resolveTokenScopedCameras(args).map((camera) => camera.id)).toEqual([90]);
    });

    it('tetap muncul saat token juga mencakup kamera publik, publik lebih dulu', () => {
        const hasil = resolveTokenScopedCameras({ ...args, allowedCameraIds: [1, 90] });
        expect(hasil.map((camera) => camera.id)).toEqual([1, 90]);
    });

    it('tidak diduplikasi kalau ternyata sudah ada di daftar publik', () => {
        const hasil = resolveTokenScopedCameras({
            cameras: [PUBLIK], tokenCameras: [PUBLIK], allowedCameraIds: [1], scopeType: 'selected',
        });
        expect(hasil).toHaveLength(1);
    });

    it('diabaikan kalau deliverynya tidak bisa diputar ulang', () => {
        // Entri picker yang gagal begitu dipilih terbaca sebagai tautan rusak, bukan batasan.
        const hasil = resolveTokenScopedCameras({
            ...args,
            tokenCameras: [{ ...PRIVAT, delivery_type: 'external_mjpeg' }],
        });
        expect(hasil).toEqual([]);
    });

    it('entri tanpa id yang sah dibuang', () => {
        const hasil = resolveTokenScopedCameras({
            ...args,
            tokenCameras: [{ name: 'Tanpa id' }, { id: 0, name: 'Nol' }, PRIVAT],
        });
        expect(hasil.map((camera) => camera.id)).toEqual([90]);
    });
});

describe('cakupan selected tetap membatasi', () => {
    it('kamera publik di luar cakupan token disaring keluar', () => {
        const hasil = resolveTokenScopedCameras({
            cameras: [PUBLIK, PUBLIK_LAIN], tokenCameras: [], allowedCameraIds: [2], scopeType: 'selected',
        });
        expect(hasil.map((camera) => camera.id)).toEqual([2]);
    });

    it('id bertipe string dari server tetap cocok', () => {
        const hasil = resolveTokenScopedCameras({
            cameras: [PUBLIK, PUBLIK_LAIN], tokenCameras: [], allowedCameraIds: ['2'], scopeType: 'selected',
        });
        expect(hasil.map((camera) => camera.id)).toEqual([2]);
    });

    it("cakupan 'all' tidak menyaring apa pun", () => {
        const cameras = [PUBLIK, PUBLIK_LAIN];
        expect(resolveTokenScopedCameras({ cameras, allowedCameraIds: [1], scopeType: 'all' }))
            .toHaveLength(2);
    });
});
