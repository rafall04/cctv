// @vitest-environment jsdom

/*
 * Purpose: Prove the audit log now shows the detail it was always recording — which device, and why
 *          an attempt failed — and that a failure is visibly different from a success.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * Fixtures use the real shapes read out of production: detail_json arrives as a STRING, and the
 * user agents are ones this deployment actually received.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackTokenAuditLog from './PlaybackTokenAuditLog';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 16; POCO F7 Build/BP2A.250605.031.A3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.79 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.54.0-gn';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1';

function log(overrides = {}) {
    return {
        id: 1,
        event_type: 'access_segments',
        created_at: '2026-08-01 19:51:00',
        token_label: 'TES',
        token_prefix: 'rafpb_EztfMG',
        camera_name: 'SIMPANG 3 POLSEK PLAOSAN',
        camera_id: 42,
        actor_username: null,
        ip_address: '157.10.90.5',
        user_agent: ANDROID_UA,
        detail_json: '{"scope_type":"all"}',
        ...overrides,
    };
}

function setup(logs, props = {}) {
    const onFilterTokenId = vi.fn();
    const onShowMore = vi.fn();
    render(
        <PlaybackTokenAuditLog
            logs={logs}
            tokens={[{ id: 7, label: 'TES' }]}
            formatTokenDate={(value) => (value ? '01 Agu 2026, 19.51' : '-')}
            onFilterTokenId={onFilterTokenId}
            onShowMore={onShowMore}
            {...props}
        />,
    );
    return { onFilterTokenId, onShowMore };
}

const cardAt = (index = 0) => screen.getAllByRole('listitem')[index];

describe('PlaybackTokenAuditLog detail', () => {
    it('names the device, which is the only thing separating two viewers of one shared token', () => {
        setup([log({ id: 1, user_agent: ANDROID_UA }), log({ id: 2, user_agent: IPHONE_UA })]);

        expect(within(cardAt(0)).getByText('Android 16 · POCO F7 · MIUI Browser 14')).toBeTruthy();
        expect(within(cardAt(1)).getByText('iOS 18.7 · Safari 26')).toBeTruthy();
    });

    it('shows WHY an attempt failed — the line the whole log exists for', () => {
        setup([log({
            event_type: 'activation_failed',
            detail_json: '{"reason":"Token playback tidak valid","mode":"activated_token"}',
        })]);

        expect(screen.getByText('Token playback tidak valid')).toBeTruthy();
    });

    it('makes a failure look different from a success rather than identical', () => {
        setup([log({ id: 1, event_type: 'activation_failed', detail_json: '{"reason":"Token kedaluwarsa"}' }),
            log({ id: 2, event_type: 'access_segments' })]);

        expect(cardAt(0).className).toContain('status-fault');
        expect(cardAt(1).className).not.toContain('status-fault');
    });

    it('translates stored event names into plain language', () => {
        setup([
            log({ id: 1, event_type: 'access_segments' }),
            log({ id: 2, event_type: 'activated_share' }),
            log({ id: 3, event_type: 'session_started' }),
        ]);

        expect(screen.getByText('Buka rekaman')).toBeTruthy();
        expect(screen.getByText('Masuk pakai tautan')).toBeTruthy();
        expect(screen.getByText('Sesi dimulai')).toBeTruthy();
    });

    it('keeps an unknown event visible under its raw name instead of dropping the entry', () => {
        setup([log({ event_type: 'something_new' })]);

        expect(screen.getByText('something_new')).toBeTruthy();
    });

    it('summarises the share detail rather than dumping raw JSON', () => {
        setup([log({ event_type: 'shared', detail_json: '{"share_key_prefix":"CCTVKU","reused":true}' })]);

        expect(screen.getByText('kunci CCTVKU (dipakai ulang)')).toBeTruthy();
        expect(screen.queryByText(/share_key_prefix/)).toBeNull();
    });

    it('omits lines that have no value, instead of printing a dash on every row', () => {
        setup([log({ actor_username: null, camera_name: null, camera_id: null, user_agent: null })]);

        const card = cardAt(0);
        expect(within(card).queryByText('Oleh')).toBeNull();
        expect(within(card).queryByText('Kamera')).toBeNull();
        expect(within(card).queryByText('Perangkat')).toBeNull();
        // The IP is still there, so the row is not empty.
        expect(within(card).getByText('157.10.90.5')).toBeTruthy();
    });

    it('says plainly when the entry outlived its token', () => {
        // token_id is ON DELETE SET NULL, so history survives a deleted token — and must say so.
        setup([log({ token_label: null, token_prefix: null })]);

        expect(screen.getByText('token sudah dihapus')).toBeTruthy();
    });

    it('survives malformed detail_json without taking the row down with it', () => {
        setup([log({ detail_json: '{not json' })]);

        expect(screen.getByText('Buka rekaman')).toBeTruthy();
    });
});

describe('PlaybackTokenAuditLog controls', () => {
    it('filters by token, which the backend always supported but the page never asked for', () => {
        const { onFilterTokenId } = setup([log()]);

        fireEvent.change(screen.getByLabelText(/Token/), { target: { value: '7' } });

        expect(onFilterTokenId).toHaveBeenCalledWith('7');
    });

    it('offers more entries only when there are more to offer', () => {
        const { onShowMore } = setup([log()], { canShowMore: true });
        fireEvent.click(screen.getByRole('button', { name: 'Tampilkan lebih banyak' }));
        expect(onShowMore).toHaveBeenCalled();
    });

    it('hides the button at the backend cap, so it cannot promise what it will not deliver', () => {
        setup([log()], { canShowMore: false });
        expect(screen.queryByRole('button', { name: 'Tampilkan lebih banyak' })).toBeNull();
    });

    it('says so when the current filter has nothing', () => {
        setup([]);
        expect(screen.getByText('Belum ada aktivitas untuk pilihan ini.')).toBeTruthy();
    });
});
