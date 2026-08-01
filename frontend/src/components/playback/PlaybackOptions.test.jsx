// @vitest-environment jsdom

/*
 * Purpose: Prove a token holder is told how far back their access reaches.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * With a token active there used to be NO panel at all: the visitor could not tell whether they
 * held full access or how far back it went — the very thing a shared or paid token is sold on.
 * The limit was already carried in playback_policy and simply never shown.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackOptions from './PlaybackOptions';

const base = { autoPlayEnabled: false, onAutoPlayToggle: vi.fn() };

describe('PlaybackOptions token reach', () => {
    it('states the hour limit when the token is capped', () => {
        render(<PlaybackOptions {...base} playbackPolicy={{ accessMode: 'token_full', playbackWindowHours: 24 }} />);

        expect(screen.getByText('Akses token aktif')).toBeTruthy();
        expect(screen.getByText('Rekaman 24 jam terakhir')).toBeTruthy();
        expect(screen.getByText(/tidak ditampilkan/)).toBeTruthy();
    });

    it('says plainly when the token has no limit, rather than leaving it ambiguous', () => {
        render(<PlaybackOptions {...base} playbackPolicy={{ accessMode: 'token_full', playbackWindowHours: null }} />);

        expect(screen.getByText('Seluruh rekaman tersedia')).toBeTruthy();
    });

    it('shows nothing of the sort to an anonymous public visitor', () => {
        render(<PlaybackOptions {...base} playbackPolicy={{ accessMode: 'public_preview', previewMinutes: 10 }} />);

        expect(screen.queryByText('Akses token aktif')).toBeNull();
    });
});
