/*
 * Purpose: Keep the playback header to its three jobs — title, share, camera picker.
 * Caller: `npm test -- src/components/playback/PlaybackHeader.test.jsx`.
 * Deps: vitest, @testing-library/react, ./PlaybackHeader.jsx.
 * MainFuncs: Tests for PlaybackHeader.
 * SideEffects: None.
 *
 * The picker's own behaviour is covered by PlaybackCameraPicker.test.jsx, and its matching rules by
 * utils/playbackCameraPicker.test.js — this file only checks the wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlaybackHeader from './PlaybackHeader.jsx';

const CAMERAS = [
    { id: 1, name: 'S4_Ngariboyo', area_name: 'KAB MAGETAN' },
    { id: 2, name: 'SIMPANG 4 BUNDARAN JETAK', area_name: 'KEC BOJONEGORO DAN SEKITARNYA' },
];

describe('PlaybackHeader', () => {
    it('renders the title and mounts the picker on the selected camera', () => {
        render(<PlaybackHeader cameras={CAMERAS} selectedCamera={CAMERAS[1]} onCameraChange={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'Playback Recording' })).toBeTruthy();
        expect(screen.getByRole('button', { expanded: false }).textContent).toContain('SIMPANG 4 BUNDARAN JETAK');
    });

    it('passes the camera choice straight through to its caller', () => {
        const onCameraChange = vi.fn();
        render(<PlaybackHeader cameras={CAMERAS} selectedCamera={CAMERAS[0]} onCameraChange={onCameraChange} />);

        fireEvent.click(screen.getByRole('button', { expanded: false }));
        const row = screen.getAllByRole('button').find((b) => b.textContent.includes('BUNDARAN JETAK'));
        fireEvent.click(row);

        expect(onCameraChange).toHaveBeenCalledWith(CAMERAS[1]);
    });

    it('offers the share action only when a handler is supplied', () => {
        const onShare = vi.fn();
        const { rerender } = render(
            <PlaybackHeader cameras={CAMERAS} selectedCamera={CAMERAS[0]} onCameraChange={vi.fn()} onShare={onShare} />,
        );
        fireEvent.click(screen.getByTitle('Bagikan tautan playback'));
        expect(onShare).toHaveBeenCalled();

        rerender(<PlaybackHeader cameras={CAMERAS} selectedCamera={CAMERAS[0]} onCameraChange={vi.fn()} />);
        expect(screen.queryByTitle('Bagikan tautan playback')).toBeNull();
    });
});
