// @vitest-environment jsdom

/*
 * Purpose: Prove the options strip carries the public-preview notice and the auto-play toggle — and
 *          no longer duplicates the token's reach.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * The token's reach was briefly announced here AND in PlaybackTokenAccess, a screen apart. It now
 * lives only beside the buttons that act on that token; see PlaybackTokenAccess.test.jsx.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackOptions from './PlaybackOptions';

const base = { autoPlayEnabled: false, onAutoPlayToggle: vi.fn() };

describe('PlaybackOptions', () => {
    it('leaves the token reach to the access panel instead of repeating it', () => {
        render(<PlaybackOptions {...base} playbackPolicy={{ accessMode: 'token_full', playbackWindowHours: 24 }} />);

        expect(screen.queryByText('Akses token aktif')).toBeNull();
        expect(screen.queryByText('Rekaman 24 jam terakhir')).toBeNull();
    });

    it('warns a public visitor how short the preview is, with a way out', () => {
        render(
            <PlaybackOptions
                {...base}
                showPublicNotice
                playbackPolicy={{
                    accessMode: 'public_preview',
                    previewMinutes: 10,
                    notice: { enabled: true, title: 'Akses Playback Publik Terbatas', text: 'Hanya 10 menit terakhir.' },
                }}
            />,
        );

        expect(screen.getByText('Akses Playback Publik Terbatas')).toBeTruthy();
        expect(screen.getByText('Preview 10 Menit')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Coba gratis 3 hari/ })).toBeTruthy();
    });

    it('keeps that notice off admin playback, which is not preview-limited', () => {
        render(
            <PlaybackOptions
                {...base}
                showPublicNotice={false}
                playbackPolicy={{ accessMode: 'admin_full', notice: { enabled: true, text: 'x' } }}
            />,
        );

        expect(screen.queryByText(/Akses Playback Publik Terbatas/)).toBeNull();
    });

    it('reports the auto-play state and toggles it', () => {
        const onAutoPlayToggle = vi.fn();
        render(<PlaybackOptions autoPlayEnabled onAutoPlayToggle={onAutoPlayToggle} />);

        const toggle = screen.getByRole('switch', { name: 'Toggle auto-play' });
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByText('Video akan otomatis lanjut ke segment berikutnya')).toBeTruthy();

        fireEvent.click(toggle);
        expect(onAutoPlayToggle).toHaveBeenCalledTimes(1);
    });
});
