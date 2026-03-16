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

    it('still renders the thumbnail image when camera is offline but a thumbnail path exists', () => {
        render(
            <CameraThumbnail
                cameraId={2}
                thumbnailPath="/api/thumbnails/2.jpg"
                cameraName="Gerbang"
                isOffline={true}
            />
        );

        const image = screen.getByAltText('Gerbang preview');
        expect(image.getAttribute('src')).toBe('/api/thumbnails/2.jpg');
    });

    it('falls back when the image fails to load', () => {
        render(
            <CameraThumbnail
                cameraId={3}
                thumbnailPath="/api/thumbnails/3.jpg"
                cameraName="Pos"
                isOffline={true}
            />
        );

        const image = screen.getByAltText('Pos preview');
        fireEvent.error(image);

        expect(screen.queryByAltText('Pos preview')).toBeNull();
    });
});
