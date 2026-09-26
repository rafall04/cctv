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

// Mirror the real contract: a camera without a resolvable HLS target is not wallable.
vi.mock('../utils/directStreamHelper', () => ({
    resolveStreamUrl: (camera) => ({ targetUrl: camera?.streams?.hls || null, proxyFallbackUrl: null, isDirectStream: false }),
}));

const CAM_A = { id: 1, name: 'Pos Ronda Utara', area_name: 'Sekaran', status: 'active', is_online: 1, streams: { hls: 'https://x/a.m3u8' } };
const CAM_B = { id: 2, name: 'Balai Warga', area_name: 'Genuk', status: 'active', is_online: 1, streams: { hls: 'https://x/b.m3u8' } };
const CAM_OFF = { id: 3, name: 'Gerbang Mati', status: 'active', is_online: 0, streams: { hls: 'https://x/c.m3u8' } };
const CAM_MAINT = { id: 4, name: 'Lampu Perbaikan', status: 'maintenance', is_online: 1, streams: { hls: 'https://x/d.m3u8' } };
const CAM_NOSTREAM = { id: 5, name: 'Tanpa Stream', status: 'active', is_online: 1, streams: {} };

function renderMonitor(entries = ['/monitor?interval=10']) {
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

    it('memutar hanya kamera yang playable: offline, perbaikan, dan tanpa stream dilewati', () => {
        cameraState.cameras = [CAM_A, CAM_OFF, CAM_MAINT, CAM_NOSTREAM, CAM_B];

        renderMonitor();

        expect(screen.getByText('Pos Ronda Utara')).toBeTruthy();
        expect(screen.getByText('1/2')).toBeTruthy();
        expect(screen.getByText(/Balai Warga/)).toBeTruthy();
        expect(screen.queryByText('Gerbang Mati')).toBeNull();
        expect(screen.queryByText('Lampu Perbaikan')).toBeNull();
        expect(screen.queryByText('Tanpa Stream')).toBeNull();
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
});
