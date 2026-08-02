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

const PREVIEW_POLICY = {
    accessMode: 'public_preview',
    previewMinutes: 10,
    notice: { enabled: true, title: 'Akses Playback Publik Terbatas', text: 'Hanya 10 menit terakhir.' },
};

/** The component reads `?t=` off the address bar; jsdom lets us put one there. */
const visitWithMoment = (ms) => window.history.replaceState({}, '', ms === null ? '/playback' : `/playback?t=${ms}`);

beforeEach(() => {
    offerState = { ready: true, offered: true };
    visitWithMoment(null);
});

/*
 * The bug these cases exist for: when `?t=` falls outside the accessible segments,
 * selectInitialSegment silently substitutes the LATEST one. A visitor who followed a shared link
 * then watches recent footage believing it is the moment they were sent, and concludes the moment
 * was nothing. Saying so is the fix; the offer is what makes saying so useful.
 */
describe('PlaybackOptions — a shared moment out of reach', () => {
    const HOUR_AGO = () => Date.now() - 60 * 60 * 1000;

    it('says the shared moment is not what is playing', () => {
        visitWithMoment(HOUR_AGO());
        render(<PlaybackOptions {...base} showPublicNotice playbackPolicy={PREVIEW_POLICY} />);

        expect(screen.getByText('Momen yang dibagikan belum bisa dibuka')).toBeTruthy();
        expect(screen.getByText(/Yang tampil sekarang rekaman terbaru, bukan momen tersebut/)).toBeTruthy();
    });

    it('offers the way to reach it, worded for that moment', () => {
        visitWithMoment(HOUR_AGO());
        render(<PlaybackOptions {...base} showPublicNotice playbackPolicy={PREVIEW_POLICY} />);

        expect(screen.getByRole('button', { name: 'Buka akses ke momen ini' })).toBeTruthy();
    });

    /* Both blocks explain the same limit and offer the same button; one of them is enough. */
    it('replaces the general preview notice rather than stacking on it', () => {
        visitWithMoment(HOUR_AGO());
        render(<PlaybackOptions {...base} showPublicNotice playbackPolicy={PREVIEW_POLICY} />);

        expect(screen.queryByText('Akses Playback Publik Terbatas')).toBeNull();
    });

    it('stays quiet when the shared moment is still inside the preview', () => {
        visitWithMoment(Date.now() - 60 * 1000);
        render(<PlaybackOptions {...base} showPublicNotice playbackPolicy={PREVIEW_POLICY} />);

        expect(screen.queryByText('Momen yang dibagikan belum bisa dibuka')).toBeNull();
        expect(screen.getByText('Akses Playback Publik Terbatas')).toBeTruthy();
    });

    /** A token holder's reach is enforced by the backend, which 403s an out-of-window segment. */
    it('says nothing to a token holder, whose limit is enforced elsewhere', () => {
        visitWithMoment(HOUR_AGO());
        render(<PlaybackOptions {...base} playbackPolicy={{ accessMode: 'token_full', playbackWindowHours: 24 }} />);

        expect(screen.queryByText('Momen yang dibagikan belum bisa dibuka')).toBeNull();
    });

    it('says nothing when no moment was requested at all', () => {
        render(<PlaybackOptions {...base} showPublicNotice playbackPolicy={PREVIEW_POLICY} />);

        expect(screen.queryByText('Momen yang dibagikan belum bisa dibuka')).toBeNull();
    });

    /* Nothing on sale means the invitation cannot be kept — same rule as the general notice. */
    it('states the problem but offers nothing when no package is sold', () => {
        offerState = { ready: true, offered: false };
        visitWithMoment(HOUR_AGO());
        render(<PlaybackOptions {...base} showPublicNotice playbackPolicy={PREVIEW_POLICY} />);

        expect(screen.getByText('Momen yang dibagikan belum bisa dibuka')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Buka akses ke momen ini' })).toBeNull();
    });
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
