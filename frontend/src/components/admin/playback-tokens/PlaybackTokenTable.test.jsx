// @vitest-environment jsdom

/*
 * Purpose: Prove the token list is usable — every token is identifiable, and a dead trial token can
 *          actually be cleared away.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * The two defects this pins:
 *   - the name was invisible on a phone (column 1 of a 6-column overflowing table), so every row
 *     read alike while "Cabut" stayed in reach;
 *   - a revoked token had NO actions at all, so trial tokens became permanent debris.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackTokenTable from './PlaybackTokenTable';

const ACTIVE = {
    id: 1,
    label: 'Token Pelanggan A',
    token_prefix: 'rafpb_aaa',
    scope_type: 'all',
    is_active: true,
    expires_at: '2026-08-04 10:02:00',
    session_timeout_seconds: 60,
    active_session_count: 2,
};

const REVOKED = {
    id: 2,
    label: 'Uji Coba Lama',
    token_prefix: 'rafpb_bbb',
    scope_type: 'selected',
    camera_ids: [3, 4],
    is_active: false,
    expires_at: null,
    session_timeout_seconds: 60,
    active_session_count: 0,
};

function setup(props = {}) {
    const handlers = {
        onRefresh: vi.fn(),
        onEdit: vi.fn(),
        onCancelEdit: vi.fn(),
        onUpdateEditForm: vi.fn(),
        onUpdateEditCameraSearch: vi.fn(),
        onToggleEditCameraRule: vi.fn(),
        onUpdateEditCameraRule: vi.fn(),
        onUpdateToken: vi.fn(),
        onRepeatShare: vi.fn(),
        onClearSessions: vi.fn(),
        onRevoke: vi.fn(),
        onDelete: vi.fn(),
    };
    render(
        <PlaybackTokenTable
            tokens={[ACTIVE, REVOKED]}
            loading={false}
            editingTokenId={null}
            updatingTokenId={null}
            sharingTokenId={null}
            editForm={{ label: '', scope_type: 'all', camera_rules: {}, max_active_sessions: '', session_limit_mode: 'unlimited', session_timeout_seconds: 60, share_template: '' }}
            selectedEditCameraIds={new Set()}
            cameras={[]}
            formatTokenDate={(value) => (value ? '04 Agu 2026, 10.02' : 'Selamanya')}
            {...handlers}
            {...props}
        />,
    );
    return handlers;
}

/** The card for a token, found by its name — which is the point. */
const cardFor = (label) => screen.getByText(label).closest('li');

describe('PlaybackTokenTable identity', () => {
    it('shows every token name in full, so two rows can never look alike', () => {
        setup();

        expect(screen.getByText('Token Pelanggan A')).toBeTruthy();
        expect(screen.getByText('Uji Coba Lama')).toBeTruthy();
        // The prefix disambiguates two tokens that share a name.
        expect(screen.getByText(/rafpb_aaa/)).toBeTruthy();
        expect(screen.getByText(/rafpb_bbb/)).toBeTruthy();
    });

    it('does not put the list in a horizontally scrolling box, which is what hid the name', () => {
        const { container } = render(
            <PlaybackTokenTable
                tokens={[ACTIVE]}
                loading={false}
                editingTokenId={null}
                editForm={{ label: '', scope_type: 'all', camera_rules: {} }}
                selectedEditCameraIds={new Set()}
                cameras={[]}
                formatTokenDate={() => 'Selamanya'}
                onDelete={vi.fn()}
            />,
        );

        expect(container.querySelector('.overflow-x-auto')).toBeNull();
        expect(container.querySelector('table')).toBeNull();
    });

    it('labels each value, so a number is never left to be guessed at', () => {
        setup();
        const card = cardFor('Token Pelanggan A');

        expect(within(card).getByText('Akses')).toBeTruthy();
        expect(within(card).getByText('Berlaku')).toBeTruthy();
        expect(within(card).getByText('Sesi')).toBeTruthy();
        expect(within(card).getByText('Timeout')).toBeTruthy();
    });
});

describe('PlaybackTokenTable actions', () => {
    it('offers Hapus on a REVOKED token — the row that previously had no actions at all', () => {
        const { onDelete } = setup();
        const card = cardFor('Uji Coba Lama');

        // Everything else is meaningless once revoked, and is correctly absent.
        expect(within(card).queryByRole('button', { name: 'Cabut' })).toBeNull();
        expect(within(card).queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(within(card).queryByRole('button', { name: 'Bagikan' })).toBeNull();

        fireEvent.click(within(card).getByRole('button', { name: 'Hapus' }));
        expect(onDelete).toHaveBeenCalledWith(REVOKED.id);
    });

    it('offers Hapus on an ACTIVE token too, alongside the reversible actions', () => {
        const { onDelete, onRevoke, onRepeatShare } = setup();
        const card = cardFor('Token Pelanggan A');

        fireEvent.click(within(card).getByRole('button', { name: 'Bagikan' }));
        expect(onRepeatShare).toHaveBeenCalledWith(ACTIVE.id);

        fireEvent.click(within(card).getByRole('button', { name: 'Cabut' }));
        expect(onRevoke).toHaveBeenCalledWith(ACTIVE.id);

        fireEvent.click(within(card).getByRole('button', { name: 'Hapus' }));
        expect(onDelete).toHaveBeenCalledWith(ACTIVE.id);
    });

    it('names the session count on the reset button instead of hiding it behind a generic label', () => {
        setup();
        const card = cardFor('Token Pelanggan A');

        expect(within(card).getByRole('button', { name: 'Reset sesi (2)' })).toBeTruthy();
        // No sessions to reset on the revoked one, so the button is absent rather than inert.
        expect(within(cardFor('Uji Coba Lama')).queryByRole('button', { name: /Reset sesi/ })).toBeNull();
    });

    it('swaps the card body for the edit form only on the token being edited', () => {
        setup({
            editingTokenId: ACTIVE.id,
            editForm: {
                label: 'Token Pelanggan A', scope_type: 'all', camera_rules: {},
                max_active_sessions: '', session_limit_mode: 'unlimited',
                session_timeout_seconds: 60, share_template: 'Halo',
            },
        });

        expect(within(cardFor('Token Pelanggan A')).getByText('Nama token')).toBeTruthy();
        expect(within(cardFor('Uji Coba Lama')).queryByText('Nama token')).toBeNull();
    });

    it('says so plainly when there is nothing to list', () => {
        render(
            <PlaybackTokenTable
                tokens={[]}
                loading={false}
                editForm={{ label: '', scope_type: 'all', camera_rules: {} }}
                selectedEditCameraIds={new Set()}
                cameras={[]}
                formatTokenDate={() => ''}
            />,
        );

        expect(screen.getByText('Belum ada token playback.')).toBeTruthy();
    });
});

/*
 * "berapa jam ke belakang" was configurable all along (playback_window_hours, enforced in
 * recordingPlaybackService), but the card never showed it — so the only way to learn a token was
 * capped to one hour was to open the edit form and read a field labelled "Window Jam".
 */
describe('PlaybackTokenTable reach limit', () => {
    it('states how far back a capped token may reach', () => {
        setup({ tokens: [{ ...ACTIVE, playback_window_hours: 24 }] });

        expect(screen.getByText('Maks. mundur')).toBeTruthy();
        expect(screen.getByText('24 jam terakhir')).toBeTruthy();
    });

    it('says "Semua rekaman" when the token is uncapped, rather than leaving it blank', () => {
        setup({ tokens: [{ ...ACTIVE, playback_window_hours: null }] });

        expect(screen.getByText('Semua rekaman')).toBeTruthy();
    });
});
