import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/config.js', () => ({
    buildApiAssetUrl: vi.fn((path) => path),
}));

import CameraThumbnail from './CameraThumbnail';

describe('CameraThumbnail', () => {
    it('renders relative thumbnail paths without forcing an absolute API host', () => {
        render(
            <CameraThumbnail
                cameraId={1}
                thumbnailPath="/api/thumbnails/1.jpg"
                cameraName="Lobby"
            />
        );

        const image = screen.getByAltText('Lobby preview');
        expect(image.getAttribute('src')).toBe('/api/thumbnails/1.jpg');
    });

    it('prioritizes above-the-fold public thumbnails when requested', () => {
        render(
            <CameraThumbnail
                cameraId={1}
                thumbnailPath="/api/thumbnails/1.jpg"
                cameraName="Lobby"
                priority={true}
            />
        );

        const image = screen.getByAltText('Lobby preview');
        expect(image.getAttribute('loading')).toBe('eager');
        expect(image.getAttribute('fetchpriority')).toBe('high');
        expect(image.getAttribute('decoding')).toBe('async');
    });

    it('falls back to the offline icon when camera is offline even if a thumbnail path exists', () => {
        render(
            <CameraThumbnail
                cameraId={2}
                thumbnailPath="/api/thumbnails/2.jpg"
                cameraName="Gerbang"
                isOffline={true}
            />
        );

        expect(screen.queryByAltText('Gerbang preview')).toBeNull();
    });

    it('falls back when the image fails to load', () => {
        render(
            <CameraThumbnail
                cameraId={3}
                thumbnailPath="/api/thumbnails/3.jpg"
                cameraName="Pos"
            />
        );

        const image = screen.getByAltText('Pos preview');
        fireEvent.error(image);

        expect(screen.queryByAltText('Pos preview')).toBeNull();
    });

    it('retries image rendering when thumbnail path changes after an error', () => {
        const { rerender, container } = render(
            <CameraThumbnail
                thumbnailPath="/api/thumbnails/failed.jpg"
                cameraName="Retry Camera"
            />
        );

        const firstImage = container.querySelector('img');
        fireEvent.error(firstImage);

        expect(container.querySelector('img')).toBeNull();

        rerender(
            <CameraThumbnail
                thumbnailPath="/api/thumbnails/recovered.jpg"
                cameraName="Retry Camera"
            />
        );

        const recoveredImage = container.querySelector('img');
        expect(recoveredImage).toBeTruthy();
        expect(recoveredImage.getAttribute('src')).toBe('/api/thumbnails/recovered.jpg');
    });

    it('falls back to the maintenance icon when camera is in maintenance mode', () => {
        render(
            <CameraThumbnail
                cameraId={4}
                thumbnailPath="/api/thumbnails/4.jpg"
                cameraName="Simpang"
                isMaintenance={true}
            />
        );

        expect(screen.queryByAltText('Simpang preview')).toBeNull();
    });
});
