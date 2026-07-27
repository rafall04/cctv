// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CameraLocationSection from './CameraLocationSection';

vi.mock('../../LocationPicker', () => ({
    default: () => <div data-testid="camera-location-picker">picker</div>,
}));

describe('CameraLocationSection dark mode readability', () => {
    it('memberi tone dark mode eksplisit pada heading lokasi dan subtitle tunnel', async () => {
        render(
            <CameraLocationSection
                latitude="-7.150700"
                longitude="111.881500"
                isSubmitting={false}
                onLocationChange={vi.fn()}
                isTunnel={false}
                onTunnelToggle={vi.fn()}
            />
        );

        expect(screen.getByText('Lokasi Kamera').className).toMatch(/text-content/);
        expect(screen.getByText('Pilih lokasi dengan GPS atau buka peta untuk menentukan titik kamera.').className)
            .toMatch(/text-content/);
        expect(screen.getByText('Loading...').parentElement.className)
            .toMatch(/bg-surface/);
        expect(screen.getByText('Koneksi Tunnel').className).toMatch(/text-content/);
        expect(screen.getByText('Kurang stabil').className).toMatch(/text-content/);
        expect(screen.getByText('Loading...').className).toMatch(/text-content/);
        expect(await screen.findByTestId('camera-location-picker')).toBeTruthy();
    });
});
