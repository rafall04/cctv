/*
 * Purpose: Lock that the route list answers "which CCTV goes to this group", not just "which id".
 * Caller: frontend test gate.
 *
 * The row headline is the route LABEL — free text an operator types, which can name a different
 * camera entirely than the one the route carries. That is not hypothetical: a private home camera
 * was routed into a group labelled after a neighbourhood camera, and the list showed nothing at all
 * to reveal it. The camera name is the fact; these tests keep it on screen.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RouteList } from './RouteList';
import { resolveRouteTarget } from './archiveUi';

const CAMERAS = [
    { id: 1443, name: 'Rumah Aldi (Privat)', areaId: null, areaName: null },
    { id: 2, name: 'CCTV TIMUR KALI APUR', areaId: 3, areaName: 'DANDER' },
    { id: 9, name: 'CCTV DEPAN RUMAH ARAH JALAN', areaId: 3, areaName: 'DANDER' },
];
const AREAS = [{ id: 3, name: 'DANDER' }];

const ROUTE = (isi = {}) => ({
    id: 'r1', enabled: true, scope: 'camera', cameraId: 1443,
    chatId: '-5457813762', label: 'CCTV DEPAN RUMAH ARAH MUSHOLLA', ...isi,
});

function tampilkan(routes) {
    render(
        <RouteList
            routes={routes}
            cameras={CAMERAS}
            areas={AREAS}
            busyId={null}
            onToggle={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
        />
    );
}

describe('RouteList menyebut kamera yang sebenarnya', () => {
    it('menampilkan NAMA kamera, bukan cuma id', () => {
        tampilkan([ROUTE()]);

        expect(screen.getByText('Rumah Aldi (Privat)')).toBeTruthy();
        expect(screen.getByText('#1443')).toBeTruthy();
    });

    it('label rute yang menyesatkan tidak lagi menutupi kamera aslinya', () => {
        // Inilah kasus nyatanya: label bilang MUSHOLLA, kameranya rumah pribadi.
        tampilkan([ROUTE()]);

        const baris = screen.getByRole('listitem');
        expect(within(baris).getByText('CCTV DEPAN RUMAH ARAH MUSHOLLA')).toBeTruthy();
        expect(within(baris).getByText('Rumah Aldi (Privat)')).toBeTruthy();
    });

    it('menyebut areanya, dan "Tanpa area" kalau memang kosong', () => {
        tampilkan([ROUTE(), ROUTE({ id: 'r2', cameraId: 2 })]);

        expect(screen.getByText('Tanpa area')).toBeTruthy();
        expect(screen.getByText('DANDER')).toBeTruthy();
    });

    it('chat id tetap ditampilkan', () => {
        tampilkan([ROUTE()]);
        expect(screen.getByText('-5457813762')).toBeTruthy();
    });
});

describe('rute yang menunjuk ke sesuatu yang sudah hilang', () => {
    it('kamera terhapus dibaca sebagai kerusakan, bukan id biasa', () => {
        // Rute ke kamera yang sudah tidak ada mengarsipkan NOL, selamanya, tanpa mengeluh.
        tampilkan([ROUTE({ cameraId: 999 })]);
        expect(screen.getByText(/#999 sudah tidak ada/i)).toBeTruthy();
    });

    it('area terhapus juga', () => {
        tampilkan([ROUTE({ scope: 'area', areaId: 77, cameraId: undefined })]);
        expect(screen.getByText(/#77 sudah tidak ada/i)).toBeTruthy();
    });
});

describe('resolveRouteTarget', () => {
    it('cakupan area menyebut nama area dan jumlah kameranya', () => {
        const t = resolveRouteTarget({ scope: 'area', areaId: 3 }, { cameras: CAMERAS, areas: AREAS });
        expect(t).toMatchObject({ name: 'Area DANDER', detail: '2 kamera perekam', missing: false });
    });

    it('cakupan semua menyebut jumlah total', () => {
        const t = resolveRouteTarget({ scope: 'all' }, { cameras: CAMERAS, areas: AREAS });
        expect(t).toMatchObject({ name: 'Semua kamera', detail: '3 kamera perekam' });
    });

    it('id bertipe string dari JSON tetap cocok', () => {
        const t = resolveRouteTarget({ scope: 'camera', cameraId: '2' }, { cameras: CAMERAS, areas: AREAS });
        expect(t.name).toBe('CCTV TIMUR KALI APUR');
    });

    it('tanpa data lookup tidak meledak', () => {
        expect(resolveRouteTarget({ scope: 'camera', cameraId: 1 }).missing).toBe(true);
        expect(resolveRouteTarget({ scope: 'all' }).name).toBe('Semua kamera');
    });
});
