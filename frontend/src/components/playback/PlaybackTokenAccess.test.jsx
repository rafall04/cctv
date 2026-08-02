// @vitest-environment jsdom

/*
 * Purpose: Prove the access panel states plainly whether access is held, how far it reaches, and
 *          that a visitor can swap tokens or sign out without guessing.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * The defects this pins:
 *   - a visitor already holding access was still shown a password box and "Aktifkan";
 *   - a returning visitor on a live cookie (no key in the URL, so no tokenStatus) was told to enter
 *     a token they already held;
 *   - the way out was labelled "Hapus", which reads as destroying the token itself;
 *   - the facts arrived as one run-on sentence instead of findable values.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackTokenAccess from './PlaybackTokenAccess';

vi.mock('./PlaybackAccessPanel.jsx', () => ({
    default: () => <div data-testid="access-panel" />,
}));

/*
 * Stubbed so the cases below stay about token state. Whether anything is on sale is a separate
 * question, asserted on its own at the end of this file.
 */
let offerState = { ready: true, offered: true };
vi.mock('../../hooks/playback/usePlaybackAccessOffer', () => ({
    default: () => offerState,
}));

beforeEach(() => {
    offerState = { ready: true, offered: true };
});

const TOKEN_POLICY = { accessMode: 'token_full', playbackWindowHours: 4 };

function setup(props = {}) {
    const handlers = {
        onTokenInputChange: vi.fn(),
        onActivate: vi.fn(),
        onClear: vi.fn(),
    };
    const view = render(
        <PlaybackTokenAccess tokenInput="" isBusy={false} tokenStatus={null} message="" {...handlers} {...props} />,
    );
    return { ...handlers, ...view };
}

describe('PlaybackTokenAccess when access is held', () => {
    it('recognises access from the server policy alone, with no activation this page load', () => {
        // The returning visitor: a live cookie, no key in the URL, so tokenStatus is null.
        setup({ playbackPolicy: TOKEN_POLICY });

        expect(screen.getByText('Akses playback aktif')).toBeTruthy();
        // The form must be gone — asking for a token they already hold is the original defect.
        expect(screen.queryByPlaceholderText('Masukkan token akses')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Aktifkan' })).toBeNull();
    });

    it('states the reach, the coverage and the expiry as separate labelled facts', () => {
        setup({
            playbackPolicy: TOKEN_POLICY,
            tokenStatus: { allowed_camera_ids: [1, 2, 3], expires_at: '04 Agu 2026, 10.02' },
        });

        expect(screen.getByText('Jangkauan')).toBeTruthy();
        expect(screen.getByText('4 jam terakhir')).toBeTruthy();
        expect(screen.getByText('3 kamera')).toBeTruthy();
        expect(screen.getByText('Sampai 04 Agu 2026, 10.02')).toBeTruthy();
    });

    it('says so plainly when nothing limits the reach, rather than leaving it blank', () => {
        setup({
            playbackPolicy: { accessMode: 'token_full', playbackWindowHours: null },
            tokenStatus: { scope_type: 'all' },
        });

        expect(screen.getByText('Semua rekaman')).toBeTruthy();
        expect(screen.getByText('Selamanya')).toBeTruthy();
    });

    /*
     * Caught in production: an AREA token, opened without a key in the URL, was announced as
     * "Cakupan: Semua kamera" and "Berlaku: Selamanya". Both came from filling unknown blanks with
     * defaults, and both were false. Coverage and expiry are known only from the activation payload.
     */
    it('states nothing about coverage or expiry it cannot actually know', () => {
        setup({ playbackPolicy: TOKEN_POLICY, tokenStatus: null });

        expect(screen.getByText('Akses playback aktif')).toBeTruthy();
        // The reach is still shown: the server resolves it per camera on every request.
        expect(screen.getByText('4 jam terakhir')).toBeTruthy();

        expect(screen.queryByText('Cakupan')).toBeNull();
        expect(screen.queryByText('Semua kamera')).toBeNull();
        expect(screen.queryByText('Berlaku')).toBeNull();
        expect(screen.queryByText('Selamanya')).toBeNull();
    });

    it('prefers the server verdict over the activation payload when the two disagree', () => {
        // The policy is per-camera truth; the activation payload describes the token as a whole.
        setup({
            playbackPolicy: TOKEN_POLICY,
            tokenStatus: { playback_window_hours: 72 },
        });

        expect(screen.getByText('4 jam terakhir')).toBeTruthy();
        expect(screen.queryByText('72 jam terakhir')).toBeNull();
    });

    it('names the exit "Keluar dari token", not "Hapus"', () => {
        const { onClear } = setup({ playbackPolicy: TOKEN_POLICY });

        expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Keluar dari token' }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });
});

describe('PlaybackTokenAccess swapping tokens', () => {
    it('brings the form back on demand and clears whatever was typed before', () => {
        const { onTokenInputChange } = setup({ playbackPolicy: TOKEN_POLICY });

        fireEvent.click(screen.getByRole('button', { name: 'Ganti token' }));

        expect(screen.getByPlaceholderText('Masukkan token akses')).toBeTruthy();
        expect(screen.getByText('Ganti ke token lain')).toBeTruthy();
        expect(onTokenInputChange).toHaveBeenCalledWith('');
    });

    it('offers a way back, so swapping is never a dead end while access still works', () => {
        setup({ playbackPolicy: TOKEN_POLICY });

        fireEvent.click(screen.getByRole('button', { name: 'Ganti token' }));
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }));

        expect(screen.getByText('Akses playback aktif')).toBeTruthy();
    });

    it('does not push the trial offer at someone who already has a token', () => {
        setup({ playbackPolicy: TOKEN_POLICY });
        fireEvent.click(screen.getByRole('button', { name: 'Ganti token' }));

        expect(screen.queryByText(/Belum punya token/)).toBeNull();
    });

    it('closes the swap form once access is gone, so the sign-out does not look like it failed', () => {
        const { rerender } = setup({ playbackPolicy: TOKEN_POLICY });
        fireEvent.click(screen.getByRole('button', { name: 'Ganti token' }));
        expect(screen.getByText('Ganti ke token lain')).toBeTruthy();

        rerender(
            <PlaybackTokenAccess
                tokenInput=""
                isBusy={false}
                tokenStatus={null}
                message="Token playback dibersihkan"
                playbackPolicy={{ accessMode: 'public_preview' }}
                onTokenInputChange={vi.fn()}
                onActivate={vi.fn()}
                onClear={vi.fn()}
            />,
        );

        expect(screen.queryByText('Ganti ke token lain')).toBeNull();
        expect(screen.getByText('Token playback')).toBeTruthy();
    });
});

describe('PlaybackTokenAccess without access', () => {
    it('asks for a token and offers the way to get one', () => {
        setup({ playbackPolicy: { accessMode: 'public_preview' } });

        expect(screen.getByPlaceholderText('Masukkan token akses')).toBeTruthy();
        expect(screen.getByText(/Belum punya token/)).toBeTruthy();
    });

    it('keeps Aktifkan inert until something has been typed', () => {
        const { rerender } = setup({ playbackPolicy: null });
        expect(screen.getByRole('button', { name: 'Aktifkan' }).disabled).toBe(true);

        rerender(
            <PlaybackTokenAccess
                tokenInput="rafpb_x"
                isBusy={false}
                tokenStatus={null}
                message=""
                onTokenInputChange={vi.fn()}
                onActivate={vi.fn()}
                onClear={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'Aktifkan' }).disabled).toBe(false);
    });

    it('submits the typed token', () => {
        const { onActivate } = setup({ tokenInput: 'rafpb_demo' });

        fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));

        expect(onActivate).toHaveBeenCalledWith('rafpb_demo');
    });
});

/*
 * Seen on a phone: "Akses Playback Publik Terbatas — Coba gratis 3 hari" rendered directly above
 * "Akses playback aktif — 4 jam terakhir — 14 kamera". Both panels were describing different
 * things — one the camera on screen, the other the token in hand — and read as a contradiction.
 */
describe('PlaybackTokenAccess when the token does not reach this camera', () => {
    const OUT_OF_SCOPE = { accessMode: 'public_preview', previewMinutes: 10 };

    it('believes the camera policy over the activation payload', () => {
        setup({ playbackPolicy: OUT_OF_SCOPE, tokenStatus: { id: 5, scope_type: 'area' } });

        expect(screen.queryByText('Akses playback aktif')).toBeNull();
    });

    it('explains WHY rather than selling a trial to someone who already paid', () => {
        setup({ playbackPolicy: OUT_OF_SCOPE, tokenStatus: { id: 5, scope_type: 'area' } });

        expect(screen.getByText(/tidak mencakup kamera ini/)).toBeTruthy();
        expect(screen.queryByText(/Belum punya token/)).toBeNull();
    });

    it('still offers the trial to a visitor who genuinely holds nothing', () => {
        setup({ playbackPolicy: OUT_OF_SCOPE, tokenStatus: null });

        expect(screen.queryByText(/tidak mencakup kamera ini/)).toBeNull();
        expect(screen.getByText(/Belum punya token/)).toBeTruthy();
    });

    it('falls back to the activation payload only while no policy has arrived', () => {
        setup({ playbackPolicy: null, tokenStatus: { id: 5 } });

        expect(screen.getByText('Akses playback aktif')).toBeTruthy();
    });
});

/*
 * With every package disabled, "Belum punya token? Coba gratis 3 hari atau beli akses" opened a
 * panel with nothing in it — the invitation could not be kept. The catalogue decides whether the
 * invitation is extended at all.
 */
describe('PlaybackTokenAccess when nothing is on sale', () => {
    it('withdraws the invitation entirely rather than opening an empty panel', () => {
        offerState = { ready: true, offered: false };

        setup({ playbackPolicy: { accessMode: 'public_preview', previewMinutes: 10 }, tokenStatus: null });

        expect(screen.queryByText(/Belum punya token/)).toBeNull();
        expect(screen.queryByText(/Coba gratis 3 hari atau beli akses/)).toBeNull();
    });

    /*
     * Nothing about the catalogue should disturb someone who already holds access: their token keeps
     * working, and the panel is not part of that story.
     */
    it('leaves an existing token holder untouched', () => {
        offerState = { ready: true, offered: false };

        setup({ playbackPolicy: TOKEN_POLICY });

        expect(screen.getByText('Akses playback aktif')).toBeTruthy();
    });
});

/*
 * "14 kamera" is half an answer: it says how many, never which. A viewer holding an area token had
 * no way to learn what else the token let them watch except by trying cameras one at a time.
 */
describe('PlaybackTokenAccess camera coverage', () => {
    const CAMERAS = [
        { id: 1, name: 'SIMPANG 3 JAMBEAN', area_name: 'KEC BOJONEGORO' },
        { id: 2, name: 'PEREMPATAN SOSRODILOGO', area_name: 'KEC BOJONEGORO' },
        { id: 9, name: 'DI LUAR TOKEN', area_name: 'KAB MAGETAN' },
    ];
    const withCoverage = (extra = {}) => setup({
        playbackPolicy: TOKEN_POLICY,
        tokenStatus: { allowed_camera_ids: [1, 2] },
        cameras: CAMERAS,
        ...extra,
    });

    it('keeps the list closed until asked', () => {
        withCoverage();

        expect(screen.getByRole('button', { name: /2 kamera/ }).getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('SIMPANG 3 JAMBEAN')).toBeNull();
    });

    it('names exactly the cameras the token covers, and no others', () => {
        withCoverage();

        fireEvent.click(screen.getByRole('button', { name: /2 kamera/ }));

        expect(screen.getByText('SIMPANG 3 JAMBEAN')).toBeTruthy();
        expect(screen.getByText('PEREMPATAN SOSRODILOGO')).toBeTruthy();
        expect(screen.queryByText('DI LUAR TOKEN')).toBeNull();
    });

    it('switches to a camera when its name is chosen', () => {
        const onSelectCamera = vi.fn();
        withCoverage({ onSelectCamera });

        fireEvent.click(screen.getByRole('button', { name: /2 kamera/ }));
        fireEvent.click(screen.getByRole('button', { name: /PEREMPATAN SOSRODILOGO/ }));

        expect(onSelectCamera).toHaveBeenCalledWith(CAMERAS[1]);
    });

    it('stays plain text when no camera can be named, rather than a button that opens nothing', () => {
        setup({ playbackPolicy: TOKEN_POLICY, tokenStatus: { allowed_camera_ids: [77] }, cameras: CAMERAS });

        expect(screen.queryByRole('button', { name: /1 kamera/ })).toBeNull();
        expect(screen.getByText('1 kamera')).toBeTruthy();
    });
});
