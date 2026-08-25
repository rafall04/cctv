// @vitest-environment jsdom

/*
 * Purpose: Prove the collapse of three stacked control rows into ONE WRAPPING chip row lost
 *          nothing — every action a visitor could reach before is still reachable, in one render,
 *          without swiping.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked cameraFeedbackService / vehicleCountService / saweriaConfig.
 * SideEffects: jsdom render only.
 *
 * THE TEST THAT MATTERS MOST
 * "rapikan namun tetap jelas semuanya" — tidy it up, but keep all of it legible. A density pass is
 * exactly the kind of change that quietly drops a control nobody notices until a visitor goes
 * looking for it, so the first test below asserts all six chips in a single render, in order, BY
 * ACCESSIBLE NAME. It is the assertion an over-eager tidy-up trips on.
 *
 * WHY "BY ACCESSIBLE NAME" IS NOT A STYLE PREFERENCE HERE
 * Five of the six chips are icon-only below `sm`. Their visible text is not what identifies them to
 * a screen reader, to speech control, or to the long-press tooltip a sighted visitor uses to check
 * a glyph before committing — the accessible name is, and it is the ONLY thing left. So the name is
 * what the tests query on. Drop an `aria-label` while tidying and this file goes red, which is the
 * whole point of writing it this way.
 *
 * AND WHY THE SCROLLER TESTS ARE GONE — 2026-08-21, ON EVIDENCE
 * The previous round pinned `overflow-x-auto` + `[contain:paint]` on this row, on the theory that a
 * scroller has ONE height at every font scale while a wrapping row grows a second line. A
 * photograph from the owner's real Android phone settled it the other way: only three and a half
 * button-sized chips fit, so "Area" and "Lapor" were not cramped, they were INVISIBLE until you
 * swiped — and on a desktop pointer, where no scrollbar is drawn, there was no evidence they
 * existed at all. Scrolling hides; wrapping does not. Those assertions were therefore INVERTED, not
 * deleted: the row is now asserted to carry no overflow-x utility at all, loudly, because that is
 * the regression this round exists to prevent.
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

        /*
         * The same six again BY ACCESSIBLE NAME, and this is the assertion that carries the round.
         * Five of them are icon-only below `sm`, so their visible word is no longer what identifies
         * them — the name is the only thing a screen reader, speech control or a long-press tooltip
         * has left. Every one is the FULL sentence rather than the icon's name, and the vote's count
         * rides along in it so "Bagus, 1" is announced as one thing.
         */
        expect(within(row).getByRole('button', { name: 'Kamera ini bagus, 1' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Tandai kamera ini bermasalah' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Bagikan kamera ini' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Tambah kamera ini ke favorit' })).toBeTruthy();
        expect(within(row).getByRole('link', { name: 'Buka area' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Laporkan masalah pada kamera ini' })).toBeTruthy();

        // Six controls, six names — nothing is behind a menu, a disclosure or a swipe.
        expect(within(row).getAllByRole('button').length + within(row).getAllByRole('link').length).toBe(6);
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

describe('CameraDetailPanel — the row WRAPS, and never scrolls', () => {
    /*
     * THE regression this round exists to fix, so it is asserted loudly and from both sides.
     * A scroller was tried, and on a real 375px Android phone it hid "Area" and "Lapor" behind a
     * swipe — on desktop, with no scrollbar drawn, it hid the fact that there was anything to swipe
     * to at all. A control nobody can see is worse than a control on a second line.
     */
    it('carries NO horizontal scroll utility of any kind, and wraps instead', async () => {
        renderPanel();

        const cls = (await screen.findByTestId('camera-action-row')).getAttribute('class');
        // Not just overflow-x-auto: any overflow-x that scrolls hides an action behind a swipe.
        expect(cls, 'horizontal scrolling for primary actions IS the bug').not.toMatch(/\boverflow-x-auto\b/);
        expect(cls, 'overflow-x-scroll hides the same actions the same way').not.toMatch(/\boverflow-x-scroll\b/);
        expect(cls).not.toMatch(/\boverflow-auto\b/);
        expect(cls).not.toMatch(/\boverflow-scroll\b/);
        // Wrapping is the fallback for the widths the sizing cannot cover (320px, 1.3x font scale):
        // a second line keeps every action visible and reachable.
        expect(cls, 'the row must wrap, not scroll').toMatch(/\bflex-wrap\b/);
        expect(cls, 'a flex row that cannot shrink widens the page').toMatch(/\bmin-w-0\b/);
    });

    /* Moving the scroller one level up would hide the same two actions the same way — the row
       having no overflow-x of its own is not enough on its own. */
    it('is not sitting inside a horizontal scroller either', async () => {
        renderPanel();
        const row = await screen.findByTestId('camera-action-row');

        for (let el = row; el && el !== document.body; el = el.parentElement) {
            const cls = el.getAttribute('class') || '';
            expect(cls, `${cls}: an ancestor scroller hides the row's tail just as well`)
                .not.toMatch(/\boverflow-x-(auto|scroll)\b/);
        }
    });

    /*
     * The scroller's own machinery went with it. `[contain:paint]` and the `-mx-3` bleed existed
     * ONLY to keep a horizontal strip's overflow out of the document's scrollable rect — the thing
     * that makes in-app WebViews zoom the whole page out (2026-07 mobile incident). A wrapping row
     * produces no horizontal overflow to contain, so leaving them behind would only leave the next
     * reader guessing what they were guarding against.
     */
    it('sheds the scroll machinery it no longer needs', async () => {
        renderPanel();

        const cls = (await screen.findByTestId('camera-action-row')).getAttribute('class');
        expect(cls, 'nothing left to contain once the row wraps').not.toMatch(/\[contain:paint\]/);
        expect(cls, 'the negative-margin bleed belonged to the scroller').not.toMatch(/-mx-3/);
        expect(cls, 'a wrapping row still has to stay inside the panel').toMatch(/\bmax-w-full\b/);
    });

    /*
     * The page itself must never gain a horizontal scrollbar — repo guardrail, and the 2026-07
     * mobile incident behind it: in-app WebViews fit their initial zoom to the widest content, so
     * one over-wide strip shrinks the whole page into a narrow column.
     */
    it('never lets the row reach the page: no w-screen, no fixed, no 100vw on any ancestor', async () => {
        renderPanel();
        const row = await screen.findByTestId('camera-action-row');

        for (let el = row; el && el !== document.body; el = el.parentElement) {
            const cls = el.getAttribute('class') || '';
            expect(cls, `${cls}: w-screen is banned outright`).not.toMatch(/\bw-screen\b/);
            expect(cls, `${cls}: a fixed ancestor escapes the root overflow-x: clip guard`).not.toMatch(/\bfixed\b/);
            expect(cls, `${cls}: 100vw grows with the very overflow it causes`).not.toMatch(/100vw/);
        }
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

/*
 * The row fits one line on a phone because five of the six chips drop their LABEL, not their hit
 * area. That trade is only honest while the accessible name and the 44px square both hold, so both
 * are asserted here rather than left to ActionChip's own unit tests: this is the file that knows
 * WHICH chips are compact and which one is not.
 */
describe('CameraDetailPanel — icon-only below sm, and paid for properly', () => {
    /* "Bagus" is the exception, and the contract names it: the most-tapped control in the row keeps
       its word and its number at every size. A bare digit next to a thumb counts nothing in
       particular. */
    it('keeps the literal text "Bagus" on screen unconditionally', async () => {
        renderPanel();

        const bagus = await screen.findByTestId('camera-reaction-like');
        const label = [...bagus.querySelectorAll('span')].find((s) => s.textContent === 'Bagus');
        expect(label, 'the word "Bagus" left the chip entirely').toBeTruthy();
        expect(label.getAttribute('class'), '"Bagus" must not be hidden at any width').toBeNull();
        expect(bagus.textContent).toBe('Bagus1');
    });

    /*
     * An icon is a SMALLER visual target than a labelled pill, so the tappable box goes UP when the
     * word goes away — never down to match the ink. 44px is the platform floor on iOS and Android
     * alike; docs/frontend-guide.md records that this app's 26–30px icon buttons were measurably
     * unreliable for a thumb.
     */
    it.each([
        ['camera-reaction-dislike', 'Bermasalah'],
        ['camera-action-share', 'Bagikan'],
        ['camera-action-favorite', 'Favorit'],
        ['camera-action-area', 'Area'],
        ['camera-action-report', 'Lapor'],
    ])('gives %s a 44x44 target and hides only its label pixels', async (testId, word) => {
        renderPanel();
        await screen.findByTestId('camera-reaction-like');

        const chip = screen.getByTestId(testId);
        const cls = chip.getAttribute('class');
        expect(cls, `${word}: an icon-only control needs the whole 44px`).toMatch(/\bmin-h-\[44px\]/);
        expect(cls, `${word}: 44px wide too, or the square collapses to the glyph`).toMatch(/\bmin-w-\[44px\]/);

        // The word is still in the DOM and still in the name — only its pixels go away below `sm`.
        const label = [...chip.querySelectorAll('span')].find((s) => s.textContent === word);
        expect(label.getAttribute('class')).toBe('hidden sm:inline');
    });

    /*
     * Each name is the FULL sentence, never the icon's name, and it is repeated in `title` so a
     * long-press or hover tooltip says the same thing. Below `sm` these two attributes are the
     * entire statement of what the control does.
     */
    it.each([
        ['camera-reaction-dislike', 'Tandai kamera ini bermasalah'],
        ['camera-action-share', 'Bagikan kamera ini'],
        ['camera-action-favorite', 'Tambah kamera ini ke favorit'],
        ['camera-action-area', 'Buka area'],
        ['camera-action-report', 'Laporkan masalah pada kamera ini'],
    ])('names %s "%s" in BOTH aria-label and title', async (testId, name) => {
        renderPanel();
        await screen.findByTestId('camera-reaction-like');

        const chip = screen.getByTestId(testId);
        // The dislike chip's count rides into aria-label; here it is 0, so the two match exactly.
        expect(chip.getAttribute('aria-label')).toBe(name);
        expect(chip.getAttribute('title')).toBe(name);
    });

    /* A keyboard user has no hover to fall back on, and an icon gives them nothing else to go on. */
    it('draws a visible focus ring on every control in the row', async () => {
        renderPanel();
        const row = await screen.findByTestId('camera-action-row');
        await screen.findByTestId('camera-reaction-like');

        const controls = [...within(row).getAllByRole('button'), ...within(row).getAllByRole('link')];
        expect(controls).toHaveLength(6);
        for (const control of controls) {
            expect(
                control.getAttribute('class'),
                `${control.getAttribute('aria-label')}: no focus ring`
            ).toMatch(/focus-visible:ring-2/);
        }
    });

    /* Toggles say so; one-shot actions do not pretend to be toggles. */
    it('keeps aria-pressed on the toggles and off the one-shot actions', async () => {
        renderPanel();
        await screen.findByTestId('camera-reaction-like');

        expect(screen.getByTestId('camera-reaction-like').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('camera-reaction-dislike').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('camera-action-favorite').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('camera-action-report').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('camera-action-share').hasAttribute('aria-pressed')).toBe(false);
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
     * It moved OUT of the row on purpose: a sentence among six chips is the item that forces the
     * wrap, and it would then land wherever the wrap happened to put it rather than directly under
     * the chip it is talking about.
     */
    it('prints "Tersimpan · ketuk lagi untuk batal" after a vote, under the row', async () => {
        renderPanel();
        const row = await screen.findByTestId('camera-action-row');
        expect(screen.queryByText(/Tersimpan/)).toBeNull();

        fireEvent.click(await screen.findByTestId('camera-reaction-like'));

        const hint = await screen.findByText('Tersimpan · ketuk lagi untuk batal');
        expect(hint.getAttribute('role')).toBe('status');
        expect(row.contains(hint), 'a sentence inside the row is what forces it onto a second line').toBe(false);
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
       jump cut — and beneath the row, never as a seventh item inside it. */
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
        expect(screen.getByText('120 tontonan')).toBeTruthy();
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
        expect(screen.getByText('234 tontonan')).toBeTruthy();
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
