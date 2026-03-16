import { render, screen } from '@testing-library/react';
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
});
