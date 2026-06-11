// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CameraGrid from './CameraGrid';

function buildCameras(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Cam ${i + 1}`,
        enabled: 1,
        status: 'active',
        availability_state: 'online',
        stream_source: 'internal',
        delivery_type: 'internal_hls',
        is_tunnel: 0,
    }));
}

const noop = vi.fn();
const handlers = {
    onEdit: noop, onDelete: noop, onToggleEnabled: noop,
    onToggleMaintenance: noop, onRefreshStream: noop,
};

describe('CameraGrid pagination', () => {
    it('renders only the first page (24) and no controls when under one page', () => {
        render(<CameraGrid cameras={buildCameras(10)} {...handlers} />);
        expect(screen.getByText('Cam 10')).toBeTruthy();
        expect(screen.queryByText(/Halaman/)).toBeNull();
    });

    it('caps a large fleet to 24 cards and pages through the rest', () => {
        render(<CameraGrid cameras={buildCameras(30)} {...handlers} />);

        // Page 1: first 24 only.
        expect(screen.getByText('Cam 24')).toBeTruthy();
        expect(screen.queryByText('Cam 25')).toBeNull();
        expect(screen.getByText(/Halaman 1 dari 2 · 30 kamera/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Berikutnya/ }));

        // Page 2: the remainder.
        expect(screen.getByText('Cam 25')).toBeTruthy();
        expect(screen.queryByText('Cam 24')).toBeNull();
    });

    it('clamps back to page 1 when the filtered set shrinks below the current page', () => {
        const { rerender } = render(<CameraGrid cameras={buildCameras(30)} {...handlers} />);
        fireEvent.click(screen.getByRole('button', { name: /Berikutnya/ }));
        expect(screen.getByText('Cam 25')).toBeTruthy();

        // Simulate a filter narrowing results to a single page.
        rerender(<CameraGrid cameras={buildCameras(5)} {...handlers} />);
        expect(screen.getByText('Cam 1')).toBeTruthy();
        expect(screen.queryByText(/Halaman/)).toBeNull();
    });
});
