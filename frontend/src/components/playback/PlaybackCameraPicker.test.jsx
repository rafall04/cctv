/*
 * Purpose: Lock the picker's behaviour — trigger shows the current camera, dialog narrows by area
 *          and by search, and choosing a row reports the camera and closes.
 * Caller: `npm test -- src/components/playback/PlaybackCameraPicker.test.jsx`.
 * Deps: vitest, @testing-library/react, ./PlaybackCameraPicker.jsx.
 * MainFuncs: Tests for PlaybackCameraPicker.
 * SideEffects: None.
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom, so
 * toHaveTextContent / toBeDisabled would fail as unknown Chai properties.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PlaybackCameraPicker from './PlaybackCameraPicker.jsx';

/* jsdom implements no scrollIntoView, so installing a spy is both the stub and the observation.
 * Removed after every test rather than inline, so a failing assertion cannot leak it. */
function spyOnScrollIntoView() {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    return spy;
}
afterEach(() => {
    delete Element.prototype.scrollIntoView;
});

const MAGETAN = 'KAB MAGETAN';
const BOJONEGORO = 'KEC BOJONEGORO DAN SEKITARNYA';

const CAMERAS = [
    { id: 1, name: 'S4_Ngariboyo', area_name: MAGETAN, thumbnail_path: '/api/thumbnails/1.jpg' },
    { id: 2, name: 'WISATA STRAWBERRY', area_name: MAGETAN },
    { id: 3, name: 'SIMPANG 4 BUNDARAN JETAK', area_name: BOJONEGORO },
    { id: 4, name: 'PEREMPATAN JEMBATAN SOSRODILOGO', location: 'SIMPANG 4 RAJEKWESI - SOSRODILOGO', area_name: BOJONEGORO },
];

function setup(props = {}) {
    const onCameraChange = vi.fn();
    render(
        <PlaybackCameraPicker
            cameras={CAMERAS}
            selectedCamera={CAMERAS[0]}
            onCameraChange={onCameraChange}
            {...props}
        />,
    );
    const trigger = screen.getByRole('button');
    return { onCameraChange, trigger };
}

/** Render, open the dialog, and hand back everything a test needs. */
function openDialog(props = {}) {
    const base = setup(props);
    fireEvent.click(base.trigger);
    const dialog = screen.getByRole('dialog');
    return {
        ...base,
        dialog,
        search: within(dialog).getByLabelText('Cari kamera'),
        chip: (name) => within(dialog).getByRole('button', { name }),
        /* Camera rows are the dialog buttons carrying a camera name — chips and the close
         * button are not cameras. */
        rows: () => within(dialog).getAllByRole('button')
            .filter((b) => CAMERAS.some((c) => b.textContent.includes(c.name))),
    };
}

const namesOf = (rows) => rows.map((r) => r.textContent);

describe('PlaybackCameraPicker trigger', () => {
    it('shows the selected camera, its area, and how many are available', () => {
        const { trigger } = setup();
        expect(trigger.textContent).toContain('S4_Ngariboyo');
        expect(trigger.textContent).toContain(MAGETAN);
        expect(trigger.textContent).toContain('4 tersedia');
    });

    it('is disabled with an honest label when there are no cameras', () => {
        const { trigger } = setup({ cameras: [], selectedCamera: null });
        expect(trigger.disabled).toBe(true);
        expect(trigger.textContent).toContain('Belum ada kamera');
    });

    it('does not render the dialog until it is opened', () => {
        setup();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('PlaybackCameraPicker dialog', () => {
    it('lists every camera grouped by area, with an all-chip first', () => {
        const { dialog, rows, chip } = openDialog();
        expect(rows()).toHaveLength(CAMERAS.length);
        expect(chip(/Semua 4/)).toBeTruthy();
        expect(within(dialog).getByRole('heading', { name: MAGETAN })).toBeTruthy();
        expect(within(dialog).getByRole('heading', { name: BOJONEGORO })).toBeTruthy();
    });

    it('narrows to one area when its chip is pressed, and drops the now-redundant heading', () => {
        const { dialog, rows, chip } = openDialog();
        fireEvent.click(chip(/KAB MAGETAN 2/));

        const text = namesOf(rows()).join(' ');
        expect(rows()).toHaveLength(2);
        expect(text).toContain('WISATA STRAWBERRY');
        expect(text).not.toContain('BUNDARAN JETAK');
        expect(within(dialog).queryByRole('heading', { name: MAGETAN })).toBeNull();
    });

    it('searches across the inconsistent naming — the long spelling finds the contracted name', () => {
        const { rows, search } = openDialog();
        fireEvent.change(search, { target: { value: 'simpang 4 ngariboyo' } });

        expect(rows()).toHaveLength(1);
        expect(rows()[0].textContent).toContain('S4_Ngariboyo');
    });

    it('searches on location even when the name says nothing about it', () => {
        const { rows, search } = openDialog();
        fireEvent.change(search, { target: { value: 'rajekwesi' } });
        expect(rows()[0].textContent).toContain('PEREMPATAN JEMBATAN SOSRODILOGO');
    });

    it('says so plainly when nothing matches', () => {
        const { dialog, rows, search } = openDialog();
        fireEvent.change(search, { target: { value: 'tidak ada begini' } });
        expect(rows()).toHaveLength(0);
        expect(within(dialog).getByText(/Tidak ada kamera yang cocok/)).toBeTruthy();
    });

    it('shows a location line only when it adds something the name does not', () => {
        const { dialog, rows } = openDialog();
        expect(within(dialog).getByText('SIMPANG 4 RAJEKWESI - SOSRODILOGO')).toBeTruthy();

        const strawberry = rows().find((r) => r.textContent.includes('WISATA STRAWBERRY'));
        expect(strawberry.textContent.trim()).toBe('WISATA STRAWBERRY');
    });

    it('marks the current camera so you can see where you are', () => {
        const { rows } = openDialog();
        const current = rows().filter((r) => r.getAttribute('aria-current') === 'true');
        expect(current).toHaveLength(1);
        expect(current[0].textContent).toContain('S4_Ngariboyo');
    });

    it('keeps every area chip readable instead of pushing one off the edge', () => {
        const { dialog } = openDialog();
        const long = within(dialog).getByRole('button', { name: /KEC BOJONEGORO DAN SEKITARNYA 2/ });

        // The label is clamped, the count is not, and the untruncated name stays reachable.
        expect(long.getAttribute('title')).toBe(BOJONEGORO);
        expect(long.querySelector('.truncate').textContent).toBe(BOJONEGORO);
        expect(long.querySelector('.tabular-nums').className).toContain('shrink-0');
    });

    it('sends the list back to the top once results are narrowed', () => {
        const { dialog, search } = openDialog();
        const body = dialog.querySelector('.overflow-y-auto');
        body.scrollTop = 500;

        fireEvent.change(search, { target: { value: 'simpang' } });
        expect(body.scrollTop).toBe(0);
    });

    /* These two belong together: without the positive case, the negative one would pass even if
     * the reveal had been deleted outright. jsdom implements no scrollIntoView, so the spy IS the
     * implementation here. */
    it('reveals the current camera when the dialog opens', () => {
        const reveal = spyOnScrollIntoView();
        openDialog();
        expect(reveal).toHaveBeenCalled();
    });

    it('stops yanking the list back to the current camera once the visitor is searching', () => {
        const { rows, search } = openDialog();
        const reveal = spyOnScrollIntoView();

        fireEvent.change(search, { target: { value: 'ngariboyo' } });

        expect(rows()).toHaveLength(1);
        expect(reveal).not.toHaveBeenCalled();
    });

    it('reports the chosen camera and closes', () => {
        const { rows, onCameraChange } = openDialog();
        fireEvent.click(rows().find((r) => r.textContent.includes('BUNDARAN JETAK')));

        expect(onCameraChange).toHaveBeenCalledWith(CAMERAS[2]);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes without re-reporting when the current camera is re-picked', () => {
        const { rows, onCameraChange } = openDialog();
        fireEvent.click(rows().find((r) => r.getAttribute('aria-current') === 'true'));

        expect(onCameraChange).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

/*
 * The archive page reuses this picker rather than keeping its own native <select> — the same
 * unreadable-on-Android list this component was built to replace. These two options are what let
 * one component serve both pages without either bending to the other's needs.
 */
describe('PlaybackCameraPicker reuse options', () => {
    it('keeps showing locations by default, so playback is untouched', () => {
        const { rows } = openDialog();

        expect(namesOf(rows()).join(' ')).toContain('SIMPANG 4 RAJEKWESI');
    });

    it('substitutes a caller-supplied sub-line, so the archive can answer "has footage?"', () => {
        const { rows } = openDialog({ metaFor: (camera) => `${camera.id * 10} segmen` });
        const text = namesOf(rows()).join(' ');

        expect(text).toContain('10 segmen');
        expect(text).toContain('40 segmen');
        // The location it replaced must be gone, not merely joined by the count.
        expect(text).not.toContain('SIMPANG 4 RAJEKWESI');
    });

    it('has no "all cameras" row unless the caller asks — playback watches exactly one', () => {
        const { dialog } = openDialog();

        expect(within(dialog).queryByText('Semua kamera')).toBeNull();
    });

    it('offers an "all cameras" row that reports null, not a camera', () => {
        const { dialog, onCameraChange } = openDialog({
            allOption: { label: 'Semua kamera', meta: '5717 segmen' },
        });

        expect(within(dialog).getByText('5717 segmen')).toBeTruthy();
        fireEvent.click(within(dialog).getByRole('button', { name: /Semua kamera/ }));

        expect(onCameraChange).toHaveBeenCalledWith(null);
    });

    it('hides the "all" row once the list is narrowed, where it would contradict the filter', () => {
        const { dialog, search } = openDialog({ allOption: { label: 'Semua kamera' } });
        expect(within(dialog).getByRole('button', { name: /Semua kamera/ })).toBeTruthy();

        fireEvent.change(search, { target: { value: 'strawberry' } });

        expect(within(dialog).queryByRole('button', { name: /Semua kamera/ })).toBeNull();
    });

    it('treats "nothing selected" as the all-state on the trigger, not as an empty fleet', () => {
        render(
            <PlaybackCameraPicker
                cameras={CAMERAS}
                selectedCamera={null}
                onCameraChange={vi.fn()}
                allOption={{ label: 'Semua kamera', meta: '5717 segmen' }}
            />,
        );

        const trigger = screen.getAllByRole('button')[0];
        expect(trigger.textContent).toContain('Semua kamera');
        expect(trigger.textContent).not.toContain('Belum ada kamera');
    });

    it('reports a real pick made from the all-state', () => {
        const onCameraChange = vi.fn();
        render(
            <PlaybackCameraPicker
                cameras={CAMERAS}
                selectedCamera={null}
                onCameraChange={onCameraChange}
                allOption={{ label: 'Semua kamera' }}
            />,
        );
        fireEvent.click(screen.getAllByRole('button')[0]);
        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /WISATA STRAWBERRY/ }));

        expect(onCameraChange).toHaveBeenCalledWith(CAMERAS[1]);
    });
});
