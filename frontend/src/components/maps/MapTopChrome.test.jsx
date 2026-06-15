/*
 * Purpose: Verify public map top chrome controls and decorative overlay behavior.
 * Caller: Frontend Vitest suite for MapView extracted presentation components.
 * Deps: React Testing Library, Vitest, MapTopChrome.
 * MainFuncs: Renders area filter, reset control, and zoom hint pointer-event contract.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MapTopChrome from './MapTopChrome.jsx';

describe('MapTopChrome', () => {
    const defaultProps = {
        showAreaFilter: true,
        selectedAreaValue: 'all',
        mapName: 'Semua Lokasi',
        camerasWithCoordsCount: 30,
        areaNames: ['Area A', 'Area B'],
        areaCounts: new Map([
            ['Area A', 10],
            ['Area B', 20],
        ]),
        shouldShowZoomHint: true,
        onAreaChange: vi.fn(),
        onResetView: vi.fn(),
    };

    it('keeps decorative zoom hint transparent while area filter remains clickable', () => {
        render(<MapTopChrome {...defaultProps} />);

        const zoomHint = screen.getByTestId('map-zoom-hint');
        const areaFilterPanel = screen.getByTestId('map-area-filter-panel');
        const topChromeControls = screen.getByTestId('map-top-chrome-controls');

        expect(screen.getByText('Zoom in untuk lihat kamera individual')).toBeTruthy();
        expect(topChromeControls.className).toContain('pointer-events-none');
        expect(zoomHint.className).toContain('pointer-events-none');
        expect(areaFilterPanel.className).toContain('pointer-events-auto');
    });

    it('emits area and reset actions through props', () => {
        const onAreaChange = vi.fn();
        const onResetView = vi.fn();

        render(
            <MapTopChrome
                {...defaultProps}
                onAreaChange={onAreaChange}
                onResetView={onResetView}
            />
        );

        fireEvent.change(screen.getByTestId('map-area-select'), {
            target: { value: 'Area B' },
        });
        fireEvent.click(screen.getByTestId('map-reset-view'));

        expect(onAreaChange).toHaveBeenCalledTimes(1);
        expect(onResetView).toHaveBeenCalledTimes(1);
    });

    it('omits the GPS locate panel when onLocateMe is not provided', () => {
        render(<MapTopChrome {...defaultProps} />);
        expect(screen.queryByTestId('map-locate-panel')).toBeNull();
        expect(screen.queryByTestId('map-locate-me')).toBeNull();
    });

    it('renders a clickable GPS locate control in a pointer-events-auto panel', () => {
        const onLocateMe = vi.fn();
        render(<MapTopChrome {...defaultProps} onLocateMe={onLocateMe} />);

        const panel = screen.getByTestId('map-locate-panel');
        expect(panel.className).toContain('pointer-events-auto');

        fireEvent.click(screen.getByTestId('map-locate-me'));
        expect(onLocateMe).toHaveBeenCalledTimes(1);
    });

    it('shows a loading label and disables the control while locating', () => {
        render(<MapTopChrome {...defaultProps} onLocateMe={vi.fn()} isLocating />);
        const button = screen.getByTestId('map-locate-me');
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.textContent).toContain('Mencari lokasi');
    });

    it('renders locate error and hides the nearby message when an error is present', () => {
        render(
            <MapTopChrome
                {...defaultProps}
                onLocateMe={vi.fn()}
                locateError="Akses GPS ditolak. Izinkan akses lokasi di browser."
                nearbyMessage="3 CCTV dalam 5,0 km · terdekat Lobby (120 m)"
            />
        );
        expect(screen.getByTestId('map-locate-error').textContent).toContain('Akses GPS ditolak');
        expect(screen.queryByTestId('map-locate-nearby')).toBeNull();
    });

    it('renders the nearby summary as a polite status with a straight-line qualifier', () => {
        render(
            <MapTopChrome
                {...defaultProps}
                onLocateMe={vi.fn()}
                nearbyMessage="3 CCTV dalam 5 km · terdekat Lobby (120 m)"
            />
        );
        const nearby = screen.getByTestId('map-locate-nearby');
        expect(nearby.textContent).toContain('terdekat Lobby');
        expect(nearby.getAttribute('role')).toBe('status');
        expect(nearby.getAttribute('aria-live')).toBe('polite');
        expect(nearby.getAttribute('title')).toContain('garis lurus');
    });
});
