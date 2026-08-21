// @vitest-environment jsdom

/*
 * Purpose: Prove the collapse of three stacked control rows into ONE scrolling chip row lost
 *          nothing — every action a visitor could reach before is still reachable, in one render.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked cameraFeedbackService / vehicleCountService / saweriaConfig.
 * SideEffects: jsdom render only.
 *
 * THE TEST THAT MATTERS MOST
 * "rapikan namun tetap jelas semuanya" — tidy it up, but keep all of it legible. A density pass is
 * exactly the kind of change that quietly drops a control nobody notices until a visitor goes
 * looking for it, so the first test below asserts all six chips in a single render, in order. It
 * is the assertion an over-eager tidy-up trips on.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraDetailPanel from './CameraDetailPanel';
import cameraFeedbackService from '../../services/cameraFeedbackService';

// The panel hosts CameraReactionBar and CameraReportForm; their own behaviour lives in their own
// files. Left unmocked they attempt real XHRs under jsdom — both swallow the failure, but the noise
// would bury a genuine error here.
vi.mock('../../services/cameraFeedbackService', () => ({
    default: {
        getReaction: vi.fn(),
        setReaction: vi.fn(),
        getReportCategories: vi.fn(),
        submitReport: vi.fn(),
    },
}));

// Two more children of the panel that poll on mount. Neither is under test here.
vi.mock('../../services/vehicleCountService', () => ({
    vehicleCountService: { getForCamera: vi.fn().mockResolvedValue(null) },
    default: { getForCamera: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../utils/saweriaConfig', () => ({
    isSaweriaEnabled: vi.fn().mockResolvedValue(false),
    SAWERIA_URL: 'https://example.invalid/support',
    SAWERIA_SUPPRESSED_KEY: 'saweria_dont_show',
}));

const KAMERA = {
    id: 12,
    name: 'CCTV Alun Alun',
    area_name: 'DS DANDER',
    location: 'Utara alun-alun',
    description: 'Pantau area publik',
    enable_recording: 1,
    is_online: 1,
    live_viewers: 0,
    total_views: 234,
};

const CATEGORIES = [
    { key: 'buram', label: 'Gambar buram' },
    { key: 'kejadian', label: 'Ada kejadian di rekaman' },
];

/* Labels a chip shows, with its count stripped — the count is asserted separately. */
const chipLabels = (row) => [...row.children].map((chip) => chip.textContent.replace(/\d+/g, '').trim());

function renderPanel(props = {}) {
    return render(
        <CameraDetailPanel
            camera={KAMERA}
            isFavorite={false}
            onShare={vi.fn()}
            onToggleFavorite={vi.fn()}
            {...props}
        />
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    cameraFeedbackService.getReaction.mockResolvedValue({
        success: true, data: { likes: 1, dislikes: 0, myValue: 0 },
    });
    cameraFeedbackService.setReaction.mockResolvedValue({
        success: true, data: { likes: 2, dislikes: 0, myValue: 1 },
    });
    cameraFeedbackService.getReportCategories.mockResolvedValue({ success: true, data: CATEGORIES });
    cameraFeedbackService.submitReport.mockResolvedValue({ success: true, message: 'Terkirim' });
});

describe('CameraDetailPanel — nothing was lost', () => {
    /*
     * Six chips, one row, one render. Before this change they were spread over three rows written
     * by three components; if a future tidy-up drops one, this is what says so.
     */
    it('keeps every action reachable in one row: Bagus, Bermasalah, Bagikan, Favorit, Area, Lapor', async () => {
        renderPanel();

        const row = await screen.findByTestId('camera-action-row');
        await screen.findByTestId('camera-reaction-like');

        // Order is frequency, not seniority: the two one-tap judgements first, the form last.
        expect(chipLabels(row)).toEqual(['Bagus', 'Bermasalah', 'Bagikan', 'Favorit', 'Area', 'Lapor']);

        // Same six again by accessible name, because the visible word is not always the whole story.
        expect(within(row).getByRole('button', { name: 'Kamera ini bagus' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Kamera ini bermasalah' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Bagikan kamera ini' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Tambah kamera ini ke favorit' })).toBeTruthy();
        expect(within(row).getByRole('link', { name: 'Buka area' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Laporkan masalah pada kamera ini' })).toBeTruthy();
    });

    it('still fires the camera share and the favourite toggle', async () => {
        const onShare = vi.fn();
        const onToggleFavorite = vi.fn();
        renderPanel({ onShare, onToggleFavorite });

        fireEvent.click(await screen.findByRole('button', { name: 'Bagikan kamera ini' }));
        fireEvent.click(screen.getByRole('button', { name: 'Tambah kamera ini ke favorit' }));

        expect(onShare).toHaveBeenCalledTimes(1);
        expect(onToggleFavorite).toHaveBeenCalledWith(12);
    });

    /* A popup with no favourite handler simply has no favourite chip; the other five are untouched. */
    it('drops only the favourite chip when the caller has no handler for it', async () => {
        renderPanel({ onToggleFavorite: undefined });

        const row = await screen.findByTestId('camera-action-row');
        await screen.findByTestId('camera-reaction-like');
        expect(chipLabels(row)).toEqual(['Bagus', 'Bermasalah', 'Bagikan', 'Area', 'Lapor']);
    });

    /*
     * Failure is silence: a feedback endpoint that is down must not put an error next to the video,
     * and it must not take the other four chips down with it.
     */
    it('keeps the rest of the row when the feedback endpoint is down', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({ success: false });
        renderPanel();

        const row = await screen.findByTestId('camera-action-row');
        await waitFor(() => expect(cameraFeedbackService.getReaction).toHaveBeenCalled());
        expect(chipLabels(row)).toEqual(['Bagikan', 'Favorit', 'Area', 'Lapor']);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('CameraDetailPanel — the area chip is a link', () => {
    /*
     * It has to stay a real <a href>: middle-click, long-press → "buka di tab baru" and "salin
     * alamat tautan" all disappear the moment it becomes a <button onClick={navigate}>.
     */
    it('renders area navigation as an anchor with a real href, not a button', async () => {
        renderPanel();

        const area = await screen.findByRole('link', { name: 'Buka area' });
        expect(area.tagName).toBe('A');
        expect(area.getAttribute('href')).toBe('/area/ds-dander');
        expect(screen.queryByRole('button', { name: 'Buka area' })).toBeNull();
    });

    it('prefers the canonical area slug when the camera carries one', async () => {
        renderPanel({
            camera: { ...KAMERA, id: 13, area_name: 'KAB SURABAYA', area_slug: 'kab-surabaya' },
        });

        expect((await screen.findByRole('link', { name: 'Buka area' })).getAttribute('href'))
            .toBe('/area/kab-surabaya');
    });
});

describe('CameraDetailPanel — one scrolling row, never a second line', () => {
    /*
     * A wrapping row is the same disease with an extra step: at Android's 1.3x font scaling six
     * chips wrap to two lines and on a narrow phone to three, pushing the video down again and
     * making the panel's height depend on the reader's font setting. A scroller has one height at
     * every scale.
     */
    it('scrolls horizontally instead of wrapping', async () => {
        renderPanel();

        const cls = (await screen.findByTestId('camera-action-row')).getAttribute('class');
        expect(cls).toMatch(/\boverflow-x-auto\b/);
        expect(cls, 'wrapping is what the scroller exists to replace').not.toMatch(/\bflex-wrap\b/);
        expect(cls, 'a flex row that cannot shrink widens the page').toMatch(/\bmin-w-0\b/);
    });

    /*
     * The page itself must never gain a horizontal scrollbar — repo guardrail, and the 2026-07
     * mobile incident behind it: in-app WebViews fit their initial zoom to the widest content, so
     * one over-wide strip shrinks the whole page into a narrow column.
     */
    it('never lets the strip reach the page: no w-screen, no fixed, no 100vw on any ancestor', async () => {
        renderPanel();
        const row = await screen.findByTestId('camera-action-row');

        for (let el = row; el && el !== document.body; el = el.parentElement) {
            const cls = el.getAttribute('class') || '';
            expect(cls, `${cls}: w-screen is banned outright`).not.toMatch(/\bw-screen\b/);
            expect(cls, `${cls}: a fixed ancestor escapes the root overflow-x: clip guard`).not.toMatch(/\bfixed\b/);
            expect(cls, `${cls}: 100vw grows with the very overflow it causes`).not.toMatch(/100vw/);
        }

        // Its overflow must be contained, or it reaches the document's scrollable rect through
        // every clipping ancestor and the WebView zooms the page out to fit it.
        expect(row.getAttribute('class')).toMatch(/\[contain:paint\]/);
        // Bleeding to the panel edge is done with a negative margin, never a viewport unit.
        expect(row.getAttribute('class')).toMatch(/-mx-3/);
    });

    /* "Bermasalah" is a REPORT control, not a fault state. Nothing in this row is broken. */
    it('carries no fault colour, idle or pressed', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 4, dislikes: 3, myValue: -1 },
        });
        renderPanel({ isFavorite: true });

        const row = await screen.findByTestId('camera-action-row');
        await screen.findByTestId('camera-reaction-dislike');
        expect(screen.getByTestId('camera-reaction-dislike').getAttribute('aria-pressed')).toBe('true');
        expect(row.innerHTML, 'status-fault is reserved for genuine faults').not.toMatch(/status-fault/);
    });
});

describe('CameraDetailPanel — the vote still behaves, and still says so', () => {
    it('shows both counts on the chips', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 4, dislikes: 2, myValue: 0 },
        });
        renderPanel();

        expect((await screen.findByTestId('camera-reaction-like')).textContent).toBe('Bagus4');
        expect(screen.getByTestId('camera-reaction-dislike').textContent).toBe('Bermasalah2');
    });

    it('records the vote and shows the pressed state the server confirmed', async () => {
        renderPanel();

        fireEvent.click(await screen.findByTestId('camera-reaction-like'));

        await waitFor(() => expect(cameraFeedbackService.setReaction).toHaveBeenCalledWith(12, 1));
        await waitFor(() => {
            expect(screen.getByTestId('camera-reaction-like').getAttribute('aria-pressed')).toBe('true');
        });
        expect(screen.getByTestId('camera-reaction-like').textContent).toBe('Bagus2');
    });

    /*
     * The hint is the only thing that tells a visitor the tap registered AND that it is reversible.
     * It moved OUT of the row on purpose: inside a horizontal scroller it would sit ~220px past the
     * right edge of a 360px phone, which is the same as deleting it.
     */
    it('prints "Tersimpan · ketuk lagi untuk batal" after a vote, outside the scroller', async () => {
        renderPanel();
        const row = await screen.findByTestId('camera-action-row');
        expect(screen.queryByText(/Tersimpan/)).toBeNull();

        fireEvent.click(await screen.findByTestId('camera-reaction-like'));

        const hint = await screen.findByText('Tersimpan · ketuk lagi untuk batal');
        expect(hint.getAttribute('role')).toBe('status');
        expect(row.contains(hint), 'inside the scroller it would be off-screen on a phone').toBe(false);
    });

    it('takes the hint away again when the visitor withdraws the vote', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 5, dislikes: 0, myValue: 1 },
        });
        cameraFeedbackService.setReaction.mockResolvedValue({
            success: true, data: { likes: 4, dislikes: 0, myValue: 0 },
        });
        renderPanel();

        expect(await screen.findByText('Tersimpan · ketuk lagi untuk batal')).toBeTruthy();
        fireEvent.click(screen.getByTestId('camera-reaction-like'));

        await waitFor(() => expect(cameraFeedbackService.setReaction).toHaveBeenCalledWith(12, 0));
        await waitFor(() => expect(screen.queryByText(/Tersimpan/)).toBeNull());
    });
});

describe('CameraDetailPanel — the Lapor chip owns the form', () => {
    it('opens the report form and closes it again', async () => {
        renderPanel();

        const lapor = await screen.findByTestId('camera-action-report');
        expect(lapor.getAttribute('aria-pressed')).toBe('false');
        expect(screen.queryByRole('button', { name: 'Gambar buram' })).toBeNull();

        fireEvent.click(lapor);
        expect(await screen.findByRole('button', { name: 'Gambar buram' })).toBeTruthy();
        expect(screen.getByTestId('camera-action-report').getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(screen.getByTestId('camera-action-report'));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Gambar buram' })).toBeNull());
        expect(screen.getByTestId('camera-action-report').getAttribute('aria-pressed')).toBe('false');
    });

    /* The form renders directly beneath its own chip — a disclosure that opens somewhere else is a
       jump cut — and beneath the row, not inside the scroller. */
    it('renders the form under the row, not inside it', async () => {
        renderPanel();
        const row = await screen.findByTestId('camera-action-row');

        fireEvent.click(screen.getByTestId('camera-action-report'));
        const category = await screen.findByRole('button', { name: 'Gambar buram' });

        expect(row.contains(category)).toBe(false);
    });

    it('shuts a half-open form when the popup jumps to another camera', async () => {
        const { rerender } = renderPanel();

        fireEvent.click(await screen.findByTestId('camera-action-report'));
        await screen.findByRole('button', { name: 'Gambar buram' });

        rerender(
            <CameraDetailPanel
                camera={{ ...KAMERA, id: 99 }}
                isFavorite={false}
                onShare={vi.fn()}
                onToggleFavorite={vi.fn()}
            />
        );

        await waitFor(() => expect(screen.queryByRole('button', { name: 'Gambar buram' })).toBeNull());
    });
});

describe('CameraDetailPanel — the camera states itself first', () => {
    /* Five filled pills became one line of text separated by dots, and it is now the FIRST thing
       under the video. That is the whole point of collapsing the three button rows. */
    it('leads with area, quality and the counts', async () => {
        renderPanel({ camera: { ...KAMERA, live_viewers: 8, total_views: 120 } });
        // Let the reaction fetch settle before asserting, or its state update lands outside act().
        await screen.findByTestId('camera-reaction-like');

        expect(screen.getByTestId('camera-detail-panel')).toBeTruthy();
        expect(screen.getByText('DS DANDER')).toBeTruthy();
        expect(screen.getByText('Ramai')).toBeTruthy();
        expect(screen.getByText('8 live')).toBeTruthy();
        expect(screen.getByText('120 views')).toBeTruthy();
        expect(screen.getByText('Playback tersedia')).toBeTruthy();
        // The popup header states the name and the description; the panel does not repeat them.
        expect(screen.queryByText('Pantau area publik')).toBeNull();
    });

    it('says nothing about playback for a camera that has none', async () => {
        renderPanel({ camera: { ...KAMERA, enable_recording: 0 } });
        await screen.findByTestId('camera-reaction-like');

        expect(screen.queryByText('Playback tersedia')).toBeNull();
    });

    it('names the quality it found — "Sering Dilihat" for a much-watched camera', async () => {
        renderPanel();
        await screen.findByTestId('camera-reaction-like');

        expect(screen.getByText('Sering Dilihat')).toBeTruthy();
        expect(screen.getByText('0 live')).toBeTruthy();
        expect(screen.getByText('234 views')).toBeTruthy();
    });
});

describe('CameraDetailPanel — the two "Bagikan" are told apart', () => {
    /*
     * This one shares the CAMERA; the shop card below has its own, for the ITEM. Two controls with
     * the same word, a screen apart, is ambiguous — so the labels carry the difference for a screen
     * reader and for a long-press tooltip, while the context does it visually.
     */
    it('labels the camera share for a screen reader and for a long press', async () => {
        renderPanel();

        const share = await screen.findByTestId('camera-action-share');
        expect(share.textContent).toBe('Bagikan');
        expect(share.getAttribute('aria-label')).toBe('Bagikan kamera ini');
        expect(share.getAttribute('title')).toBe('Bagikan kamera ini');
    });

    /*
     * The visible word stays "Favorit" in both states so the chip does not change width — and jog
     * the whole row — every time it is tapped. State rides on the filled star, the pressed styling
     * and the label.
     */
    it('keeps the favourite chip one word wide and moves the state into the star', async () => {
        const { rerender } = renderPanel({ isFavorite: false });

        const off = await screen.findByTestId('camera-action-favorite');
        expect(off.textContent).toBe('Favorit');
        expect(off.getAttribute('aria-label')).toBe('Tambah kamera ini ke favorit');
        expect(off.getAttribute('aria-pressed')).toBe('false');
        expect(off.querySelector('svg').getAttribute('fill')).toBe('none');

        rerender(
            <CameraDetailPanel camera={KAMERA} isFavorite onShare={vi.fn()} onToggleFavorite={vi.fn()} />
        );

        const on = screen.getByTestId('camera-action-favorite');
        expect(on.textContent).toBe('Favorit');
        expect(on.getAttribute('aria-label')).toBe('Hapus kamera ini dari favorit');
        expect(on.getAttribute('aria-pressed')).toBe('true');
        expect(on.querySelector('svg').getAttribute('fill')).toBe('currentColor');
    });
});
