// @vitest-environment jsdom

/*
 * Purpose: Verify playback token share panel action state and handler payloads.
 * Caller: Frontend Vitest suite for admin playback token components.
 * Deps: React Testing Library, vitest, PlaybackTokenSharePanel.
 * MainFuncs: PlaybackTokenSharePanel interaction tests.
 * SideEffects: None; callbacks are mocked.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackTokenSharePanel from './PlaybackTokenSharePanel.jsx';

describe('PlaybackTokenSharePanel', () => {
    it('disables share actions when share text is empty', () => {
        render(
            <PlaybackTokenSharePanel
                createdShare={{ shareText: '' }}
                whatsappHref="#"
                onCopy={vi.fn()}
                onNativeShare={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: /copy teks/i }).disabled).toBe(true);
        expect(screen.getByRole('button', { name: /^share$/i }).disabled).toBe(true);
        expect(screen.getByRole('link', { name: /whatsapp/i }).getAttribute('aria-disabled')).toBe('true');
    });

    it('passes current share text to copy and native share handlers', () => {
        const onCopy = vi.fn();
        const onNativeShare = vi.fn();

        render(
            <PlaybackTokenSharePanel
                createdShare={{ shareText: 'Kode Akses: SANDI1234' }}
                whatsappHref="https://wa.me/?text=Kode%20Akses%3A%20SANDI1234"
                onCopy={onCopy}
                onNativeShare={onNativeShare}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /copy teks/i }));
        fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

        expect(onCopy).toHaveBeenCalledWith('Kode Akses: SANDI1234');
        expect(onNativeShare).toHaveBeenCalledWith('Kode Akses: SANDI1234');
    });
});
