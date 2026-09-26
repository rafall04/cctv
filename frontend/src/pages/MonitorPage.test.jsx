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

// Two slots each run their own useHlsLivePlayer instance — the mock must be able to answer
// per resetKey (camera id), not with one global state.
const { hookSpy, playerStates } = vi.hoisted(() => ({
    hookSpy: vi.fn(),
    playerStates: {},
}));

const P = (over = {}) => ({ status: 'playing', kind: null, httpCode: null, message: '', needsGesture: false, ...over });

vi.mock('../hooks/useHlsLivePlayer', () => ({
    useHlsLivePlayer: (opts) => hookSpy(opts),
}));

// Mirror the real contract: streams resolve on demand (the public list carries none), and a
// camera without a resolvable HLS target cannot hold a wall slot.
vi.mock('../utils/directStreamHelper', () => ({
    resolveStreamUrl: (camera) => ({ targetUrl: camera?.streams?.hls || null, proxyFallbackUrl: null, isDirectStream: false }),
}));

vi.mock('../services/publicCameraResolver', () => ({
    default: vi.fn(async (camera) => camera),
}));

const AREA_GRESIK = { id: 10, name: 'KAB GRESIK', slug: 'kab-gresik', camera_count: 3, monitor_enabled: 1 };
const AREA_DANDER = { id: 2, name: 'DS DANDER', slug: 'ds-dander', camera_count: 1, monitor_enabled: 1 };
const AREA_PAGAR = { id: 20, name: 'DS PAGAR', slug: 'ds-pagar', camera_count: 1, monitor_enabled: 0 };

const CAM_A = { id: 1, name: 'Pos Ronda Utara', area_id: 10, area_name: 'Sekaran', status: 'active', is_online: 1, streams: { hls: 'https://x/a.m3u8' } };
const CAM_B = { id: 2, name: 'Balai Warga', area_id: 2, area_name: 'Genuk', status: 'active', is_online: 1, streams: { hls: 'https://x/b.m3u8' } };
const CAM_OFF = { id: 3, name: 'Gerbang Mati', area_id: 10, status: 'active', is_online: 0, streams: { hls: 'https://x/c.m3u8' } };
const CAM_MAINT = { id: 4, name: 'Lampu Perbaikan', area_id: 10, status: 'maintenance', is_online: 1, streams: { hls: 'https://x/d.m3u8' } };
const CAM_MJPEG = { id: 5, name: 'MJPEG Saja', area_id: 10, status: 'active', is_online: 1, delivery_type: 'external_mjpeg', streams: {} };
const CAM_PAGAR = { id: 9, name: 'Kamera Pagar', area_id: 20, area_name: 'Pagar', status: 'active', is_online: 1, streams: { hls: 'https://x/p.m3u8' } };

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
        Object.keys(playerStates).forEach((key) => delete playerStates[key]);
        hookSpy.mockReset();
        // Stable object per resetKey — the real hook returns the same state object between
        // renders; a fresh P() every call would make the slot re-report forever (render loop).
        hookSpy.mockImplementation((opts) => {
            if (!playerStates[opts.resetKey]) playerStates[opts.resetKey] = P();
            return playerStates[opts.resetKey];
        });
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
        playerStates[CAM_A.id] = P({ status: 'error', message: 'Stream terputus.' });

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
        playerStates[CAM_A.id] = P({ status: 'loading', needsGesture: true });

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

    it('pemilih hanya menampilkan area yang diaktifkan admin (monitor_enabled)', () => {
        cameraState.areas = [AREA_GRESIK, AREA_DANDER, AREA_PAGAR];

        renderMonitor(['/monitor']);

        expect(screen.getByRole('link', { name: /KAB GRESIK/ })).toBeTruthy();
        expect(screen.getByRole('link', { name: /DS DANDER/ })).toBeTruthy();
        expect(screen.queryByRole('link', { name: /DS PAGAR/ })).toBeNull();
    });

    it('?area=<slug area nonaktif> jatuh kembali ke pemilih, bukan wall', () => {
        cameraState.areas = [AREA_GRESIK, AREA_PAGAR];
        cameraState.cameras = [CAM_A, CAM_PAGAR];

        renderMonitor(['/monitor?area=ds-pagar&interval=10']);

        expect(screen.getByText(/pilih area/i)).toBeTruthy();
        expect(screen.queryByText('Kamera Pagar')).toBeNull();
    });

    it('?area=all hanya memutar kamera dari area yang diaktifkan admin', () => {
        cameraState.areas = [AREA_GRESIK, AREA_PAGAR];
        cameraState.cameras = [CAM_A, CAM_PAGAR];

        renderMonitor(['/monitor?area=all&interval=10']);

        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/1')).toBeTruthy();
        expect(screen.queryByText('Kamera Pagar')).toBeNull();
    });

    it('dwell hanya berjalan saat siaran benar-benar diputar — loading tidak memakan slot', () => {
        playerStates[CAM_A.id] = P({ status: 'loading' });
        const view = renderMonitor(['/monitor?area=all&interval=10']);

        // 10 detik loading (di bawah batas macet) — belum pindah.
        act(() => { vi.advanceTimersByTime(10000); });
        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/2')).toBeTruthy();

        // Stream mulai diputar -> dwell 10 detik baru dihitung dari sini.
        act(() => { playerStates[CAM_A.id] = P(); });
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
        playerStates[CAM_A.id] = P({ status: 'loading' });

        renderMonitor(['/monitor?area=all&interval=10']);
        act(() => { vi.advanceTimersByTime(15000); });

        expect(screen.getByText('Balai Warga')).toBeTruthy();
        expect(screen.getByText('2/2')).toBeTruthy();
    });

    it('menjalankan dua slot: kamera tampil + kamera berikutnya diputar penuh di latar', () => {
        renderMonitor();

        const videos = document.querySelectorAll('video');
        expect(videos).toHaveLength(2);
        const ids = [...videos].map((video) => video.dataset.cameraId);
        expect(ids).toContain(String(CAM_A.id));
        expect(ids).toContain(String(CAM_B.id));

        // Kedua slot memakai player live sungguhan (active) — slot belakang benar-benar
        // streaming (muxer tetap hangat + frame sudah ter-decode), bukan fetch playlist sekali.
        const calls = hookSpy.mock.calls.map((call) => call[0]);
        expect(calls.some((opts) => opts.resetKey === CAM_A.id && opts.active)).toBe(true);
        expect(calls.some((opts) => opts.resetKey === CAM_B.id && opts.active)).toBe(true);
    });

    it('rotasi hanya menukar visibilitas — kamera berikutnya sudah diputar, tanpa jeda memuat', () => {
        renderMonitor();

        // Slot belakang sudah 'playing' jauh sebelum gilirannya (default P()).
        act(() => { vi.advanceTimersByTime(10000); });

        const videos = [...document.querySelectorAll('video')];
        const visible = videos.filter((video) => video.getAttribute('aria-hidden') !== 'true');
        expect(visible).toHaveLength(1);
        expect(visible[0].dataset.cameraId).toBe(String(CAM_B.id));
        expect(screen.queryByText(/Memuat siaran/)).toBeNull();
    });

    it('hanya merender satu slot saat kamera playable tinggal satu', () => {
        cameraState.cameras = [CAM_A];

        renderMonitor();

        expect(document.querySelectorAll('video')).toHaveLength(1);
    });
});
