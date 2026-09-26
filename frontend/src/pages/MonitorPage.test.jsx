// @vitest-environment jsdom

/*
 * Purpose: Verify the public "Mode Monitor" page — a pos-ronda style auto-cycling live wall.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library, vitest; CameraContext/Branding/useHlsLivePlayer/directStreamHelper mocks.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonitorPage from './MonitorPage.jsx';

const cameraState = {
    cameras: [],
    areas: [],
    loading: false,
    dataUnavailable: false,
    backgroundRefreshError: null,
    refreshData: vi.fn(),
};

vi.mock('../contexts/CameraContext', () => ({
    CameraProvider: ({ children }) => children,
    useCameras: () => cameraState,
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({ branding: { logo_text: 'R', company_name: 'RAF NET' } }),
}));

const playerState = { status: 'playing', kind: null, httpCode: null, message: '', needsGesture: false };

vi.mock('../hooks/useHlsLivePlayer', () => ({
    useHlsLivePlayer: () => playerState,
}));

// Mirror the real contract: streams resolve on demand (the public list carries none), and a
// camera without a resolvable HLS target cannot hold a wall slot.
vi.mock('../utils/directStreamHelper', () => ({
    resolveStreamUrl: (camera) => ({ targetUrl: camera?.streams?.hls || null, proxyFallbackUrl: null, isDirectStream: false }),
}));

import resolvePublicPopupCamera from '../services/publicCameraResolver';

vi.mock('../services/publicCameraResolver', () => ({
    default: vi.fn(async (camera) => camera),
}));

const AREA_GRESIK = { id: 10, name: 'KAB GRESIK', slug: 'kab-gresik', camera_count: 3 };
const AREA_DANDER = { id: 2, name: 'DS DANDER', slug: 'ds-dander', camera_count: 1 };

const CAM_A = { id: 1, name: 'Pos Ronda Utara', area_id: 10, area_name: 'Sekaran', status: 'active', is_online: 1, streams: { hls: 'https://x/a.m3u8' } };
const CAM_B = { id: 2, name: 'Balai Warga', area_id: 2, area_name: 'Genuk', status: 'active', is_online: 1, streams: { hls: 'https://x/b.m3u8' } };
const CAM_OFF = { id: 3, name: 'Gerbang Mati', area_id: 10, status: 'active', is_online: 0, streams: { hls: 'https://x/c.m3u8' } };
const CAM_MAINT = { id: 4, name: 'Lampu Perbaikan', area_id: 10, status: 'maintenance', is_online: 1, streams: { hls: 'https://x/d.m3u8' } };
const CAM_MJPEG = { id: 5, name: 'MJPEG Saja', area_id: 10, status: 'active', is_online: 1, delivery_type: 'external_mjpeg', streams: {} };

function renderMonitor(entries = ['/monitor?area=all&interval=10']) {
    return render(
        <MemoryRouter initialEntries={entries}>
            <Routes>
                <Route path="/monitor" element={<MonitorPage />} />
                <Route path="/" element={<div>BERANDA</div>} />
            </Routes>
        </MemoryRouter>
    );
}

describe('MonitorPage — Mode Monitor', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        cameraState.cameras = [CAM_A, CAM_B];
        cameraState.areas = [AREA_GRESIK, AREA_DANDER];
        cameraState.loading = false;
        cameraState.dataUnavailable = false;
        cameraState.backgroundRefreshError = null;
        playerState.status = 'playing';
        playerState.needsGesture = false;
        playerState.message = '';
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('memutar hanya kamera yang playable: offline, perbaikan, dan non-HLS dilewati', () => {
        cameraState.cameras = [CAM_A, CAM_OFF, CAM_MAINT, CAM_MJPEG, CAM_B];

        renderMonitor();

        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/2')).toBeTruthy();
        expect(screen.getByText(/Balai Warga/)).toBeTruthy();
        expect(screen.queryByText('Gerbang Mati')).toBeNull();
        expect(screen.queryByText('Lampu Perbaikan')).toBeNull();
        expect(screen.queryByText('MJPEG Saja')).toBeNull();
    });

    it('berpindah otomatis ke kamera berikutnya sesuai interval, lalu berputar dari awal', () => {
        renderMonitor();

        act(() => { vi.advanceTimersByTime(10000); });
        expect(screen.getByText('Balai Warga')).toBeTruthy();
        expect(screen.getByText('2/2')).toBeTruthy();

        act(() => { vi.advanceTimersByTime(10000); });
        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/2')).toBeTruthy();
    });

    it('menghentikan rotasi saat dijeda, dan kembali berputar saat dilanjutkan', () => {
        renderMonitor();

        fireEvent.click(screen.getByRole('button', { name: /jeda/i }));
        act(() => { vi.advanceTimersByTime(60000); });
        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/2')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /lanjutkan/i }));
        act(() => { vi.advanceTimersByTime(10000); });
        expect(screen.getByText('Balai Warga')).toBeTruthy();
    });

    it('melewati kamera yang stream-nya gagal setelah jeda singkat, bukan diam di layar error', () => {
        playerState.status = 'error';
        playerState.message = 'Stream terputus.';

        renderMonitor();

        act(() => { vi.advanceTimersByTime(5000); });
        expect(screen.getByText('Balai Warga')).toBeTruthy();
        expect(screen.getByText('2/2')).toBeTruthy();
    });

    it('menampilkan keadaan kosong jujur saat tidak ada kamera yang sedang online', () => {
        cameraState.cameras = [CAM_OFF, CAM_MAINT];

        renderMonitor();

        expect(screen.getByText(/tidak ada kamera yang sedang online/i)).toBeTruthy();
        expect(screen.queryByText('0/0')).toBeNull();
        expect(screen.getByRole('link', { name: /kembali/i }).getAttribute('href')).toBe('/');
    });

    it('menandai data kedaluwarsa (Menunda) saat refresh latar gagal — jujur seperti chip landing', () => {
        cameraState.backgroundRefreshError = new Error('timeout');

        renderMonitor();

        expect(screen.getByText('Menunda')).toBeTruthy();
        expect(screen.queryByText('Online')).toBeNull();
    });

    it('keyboard: panah pindah kamera, spasi jeda, Esc keluar ke beranda', () => {
        renderMonitor();

        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByText('Balai Warga')).toBeTruthy();
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();

        fireEvent.keyDown(window, { key: ' ' });
        act(() => { vi.advanceTimersByTime(60000); });
        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.getByText('BERANDA')).toBeTruthy();
    });

    it('menampilkan affordance ketuk-putar saat autoplay ditolak browser', () => {
        playerState.status = 'loading';
        playerState.needsGesture = true;

        renderMonitor();

        expect(screen.getByRole('button', { name: /ketuk untuk memutar/i })).toBeTruthy();
    });

    it('membatasi rotasi ke kamera satu area saat ?area=<slug> diberikan', () => {
        renderMonitor(['/monitor?area=kab-gresik&interval=10']);

        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/1')).toBeTruthy();
        expect(screen.queryByText('Balai Warga')).toBeNull();
    });

    it('tanpa ?area menampilkan pemilih area, bukan wall 800 kamera', () => {
        renderMonitor(['/monitor']);

        expect(screen.getByText(/pilih area/i)).toBeTruthy();
        expect(screen.getByRole('link', { name: /KAB GRESIK/ })).toBeTruthy();
        expect(screen.getByRole('link', { name: /DS DANDER/ })).toBeTruthy();
        expect(screen.getByRole('link', { name: /semua area/i })).toBeTruthy();
        expect(screen.queryByText('Pos Ronda Utara')).toBeNull();
    });

    it('?area=all memutar semua kamera playable seperti semula', () => {
        renderMonitor(['/monitor?area=all&interval=10']);

        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/2')).toBeTruthy();
    });

    it('dwell hanya berjalan saat siaran benar-benar diputar — loading tidak memakan slot', () => {
        playerState.status = 'loading';
        const view = renderMonitor(['/monitor?area=all&interval=10']);

        // 10 detik loading (di bawah batas macet) — belum pindah.
        act(() => { vi.advanceTimersByTime(10000); });
        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/2')).toBeTruthy();

        // Stream mulai diputar -> dwell 10 detik baru dihitung dari sini.
        act(() => { playerState.status = 'playing'; });
        view.rerender(
            <MemoryRouter initialEntries={['/monitor?area=all&interval=10']}>
                <Routes>
                    <Route path="/monitor" element={<MonitorPage />} />
                </Routes>
            </MemoryRouter>
        );
        act(() => { vi.advanceTimersByTime(10000); });
        expect(screen.getByText('Balai Warga')).toBeTruthy();
    });

    it('kamera yang loading macet dilewati setelah batas wajar, bukan membekukan wall', () => {
        playerState.status = 'loading';

        renderMonitor(['/monitor?area=all&interval=10']);
        act(() => { vi.advanceTimersByTime(15000); });

        expect(screen.getByText('Balai Warga')).toBeTruthy();
        expect(screen.getByText('2/2')).toBeTruthy();
    });

    it('pra-panaskan stream kamera berikutnya agar transisi tidak mulai dari nol', async () => {
        renderMonitor(['/monitor?area=all&interval=10']);
        await act(async () => { await Promise.resolve(); });

        expect(resolvePublicPopupCamera).toHaveBeenCalledWith(
            expect.objectContaining({ id: CAM_B.id }),
            expect.any(Array),
        );
    });
});
