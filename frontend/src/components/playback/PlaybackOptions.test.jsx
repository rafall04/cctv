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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackOptions from './PlaybackOptions';

/*
 * The catalogue lookup is stubbed so these cases stay about the NOTICE. Its real behaviour — the
 * button disappearing when nothing is on sale — is asserted in its own case below and in
 * usePlaybackAccessOffer.test.js.
 */
let offerState = { ready: true, offered: true };
vi.mock('../../hooks/playback/usePlaybackAccessOffer', () => ({
    default: () => offerState,
}));

const base = { autoPlayEnabled: false, onAutoPlayToggle: vi.fn() };

beforeEach(() => {
    offerState = { ready: true, offered: true };
});

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

describe('PlaybackOptions notice honesty', () => {
    it('drops the public-preview pitch once the visitor holds a working token', () => {
        render(
            <PlaybackOptions
                {...base}
                showPublicNotice
                playbackPolicy={{
                    accessMode: 'token_full',
                    playbackWindowHours: 4,
                    previewMinutes: 10,
                    notice: { enabled: true, title: 'Akses Playback Publik Terbatas', text: 'x' },
                }}
            />,
        );

        expect(screen.queryByText('Akses Playback Publik Terbatas')).toBeNull();
        expect(screen.queryByRole('button', { name: /Coba gratis 3 hari/ })).toBeNull();
    });

    /*
     * The operator disabled every package. The limit itself is still true and still worth stating —
     * it is the sales pitch that would be a lie, because the panel behind it is empty and the server
     * refuses both the trial and any order.
     */
    it('keeps the limit but drops the sales pitch when no package is on sale', () => {
        offerState = { ready: true, offered: false };

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
        expect(screen.getByText('Hanya 10 menit terakhir.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Coba gratis 3 hari/ })).toBeNull();
    });
});
