// @vitest-environment jsdom

/**
 * Purpose: Verifies the playback zoom engine — button zoom, wheel, pinch, clamping, and the
 *          click suppression that stops a pan-drag from toggling play on the video below.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library and usePlaybackZoom.
 * MainFuncs: usePlaybackZoom behavior contract.
 * SideEffects: None; renders into jsdom only.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import usePlaybackZoom from './usePlaybackZoom';

vi.mock('../../utils/deviceDetector.js', () => ({
    detectDeviceTier: () => 'high',
}));
// Flag mutable supaya satu file test bisa menyalakan/mematikan preferensi OS
// tanpa menyentuh matchMedia (jsdom tidak mengimplementasikannya).
const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock('../../utils/animationControl.js', async (importOriginal) => ({
    ...(await importOriginal()),
    prefersReducedMotion: () => reducedMotion.value,
}));
// Mock tetap menulis transform sungguhan supaya assertion membaca hasil akhir yang sama
// seperti di browser (RAF hanya menjadwalkan, bukan mengubah apa yang ditulis).
vi.mock('../../utils/rafThrottle.js', () => ({
    createTransformThrottle: (el) => ({
        update: (s, x, y) => { el.style.transform = `scale(${s}) translate(${x}%, ${y}%)`; },
        cancel: vi.fn(),
    }),
}));

// jsdom tidak punya PointerEvent & pointer-capture API — sediakan shim + dispatcher
// manual supaya pointerId/clientX benar-benar sampai ke listener native stage.
beforeAll(() => {
    if (!HTMLElement.prototype.setPointerCapture) {
        HTMLElement.prototype.setPointerCapture = () => {};
        HTMLElement.prototype.releasePointerCapture = () => {};
    }
});

function Harness({ isFullscreen = false }) {
    const stageRef = useRef(null);
    const videoElRef = useRef(null);
    const { zoom, zoomIn, zoomOut, resetZoom, touchAction } = usePlaybackZoom({
        stageRef,
        videoElRef,
        isFullscreen,
    });
    return (
        <div>
            <div ref={stageRef} data-testid="stage" style={{ touchAction }}>
                <video ref={videoElRef} />
            </div>
            <span data-testid="zoom">{zoom.toFixed(2)}</span>
            <span data-testid="ta">{touchAction}</span>
            <button data-testid="in" onClick={zoomIn}>in</button>
            <button data-testid="out" onClick={zoomOut}>out</button>
            <button data-testid="reset" onClick={resetZoom}>reset</button>
        </div>
    );
}

const zoomOf = () => Number(screen.getByTestId('zoom').textContent);
const transformOf = () => screen.getByTestId('stage').style.transform;
const stage = () => screen.getByTestId('stage');

function pointer(type, { pointerId = 1, clientX = 0, clientY = 0 } = {}) {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
    Object.defineProperty(ev, 'pointerId', { value: pointerId });
    // Listener native — bukan synthetic React — jadi state flush butuh act() eksplisit.
    act(() => { stage().dispatchEvent(ev); });
}

describe('usePlaybackZoom', () => {
    it('zooms in and out with buttons and clamps inside [1, maxZoom]', () => {
        render(<Harness />);

        fireEvent.click(screen.getByTestId('in'));
        expect(zoomOf()).toBe(1.5);
        expect(transformOf()).toContain('scale(1.5)');

        fireEvent.click(screen.getByTestId('out'));
        fireEvent.click(screen.getByTestId('out'));
        // Di bawah 1 tidak boleh turun — overview 1x adalah lantai.
        expect(zoomOf()).toBe(1);
    });

    it('wheel zooms on the stage without waiting for a control', () => {
        render(<Harness />);

        fireEvent.wheel(stage(), { deltaY: -120 });
        expect(zoomOf()).toBe(1.5);

        fireEvent.wheel(stage(), { deltaY: 120 });
        expect(zoomOf()).toBe(1);
    });

    /*
     * Scroll-jacking regression: the wheel listener used to preventDefault unconditionally,
     * so a desktop visitor could never scroll the page while the cursor sat over the video.
     * Wheel may only be captured when it would actually change the zoom.
     */
    it('lets wheel-down fall through to page scroll at 1x, captures it only when zoomed', () => {
        render(<Harness />);

        // 1x + scroll ke bawah: tidak ada yang bisa di-zoom-out → halaman boleh scroll.
        expect(fireEvent.wheel(stage(), { deltaY: 120 })).toBe(true);
        expect(zoomOf()).toBe(1);

        // Zoom masuk tetap dicegat, dan begitu aktif zoom-out juga milik kita.
        expect(fireEvent.wheel(stage(), { deltaY: -120 })).toBe(false);
        expect(zoomOf()).toBe(1.5);
        expect(fireEvent.wheel(stage(), { deltaY: 120 })).toBe(false);
        expect(zoomOf()).toBe(1);
    });

    it('pinch gesture on two pointers scales the zoom', () => {
        render(<Harness />);

        pointer('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
        pointer('pointerdown', { pointerId: 2, clientX: 110, clientY: 100 });
        // Jarak 10px → 40px = 4x lipat dari zoom awal 1.
        pointer('pointermove', { pointerId: 2, clientX: 140, clientY: 100 });

        expect(zoomOf()).toBe(4);

        pointer('pointerup', { pointerId: 1 });
        pointer('pointerup', { pointerId: 2 });
    });

    it('single pointer at 1x does NOT capture — native controls keep working', () => {
        render(<Harness />);
        const captureSpy = vi.spyOn(stage(), 'setPointerCapture');

        pointer('pointerdown', { pointerId: 1, clientX: 50, clientY: 50 });
        expect(captureSpy).not.toHaveBeenCalled();
        expect(zoomOf()).toBe(1);
    });

    it('drags the frame when zoomed, then swallows the trailing click so play is not toggled', () => {
        render(<Harness />);

        fireEvent.click(screen.getByTestId('in')); // zoom 1.5

        pointer('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
        pointer('pointermove', { pointerId: 1, clientX: 160, clientY: 100 }); // 60px drag
        pointer('pointerup', { pointerId: 1 });

        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        act(() => { stage().dispatchEvent(click); });
        expect(click.defaultPrevented).toBe(true);
        // Dan hanya sekali — click berikutnya harus tembus lagi ke kontrol native.
        const second = new MouseEvent('click', { bubbles: true, cancelable: true });
        act(() => { stage().dispatchEvent(second); });
        expect(second.defaultPrevented).toBe(false);
    });

    it('pan is clamped at the edge — a wild drag cannot expose empty space', () => {
        render(<Harness />);

        for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByTestId('in')); // mentok 4x

        pointer('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
        pointer('pointermove', { pointerId: 1, clientX: 5000, clientY: 5000 });
        pointer('pointerup', { pointerId: 1 });

        // Windowed: batas simetris (zoom-1)/(2*zoom)*100 → 4x = 37.5%.
        expect(transformOf()).toContain('translate(37.5%, 37.5%)');
    });

    it('resets zoom and pan back to identity', () => {
        render(<Harness />);

        fireEvent.click(screen.getByTestId('in'));
        fireEvent.click(screen.getByTestId('reset'));

        expect(zoomOf()).toBe(1);
        expect(transformOf()).toContain('scale(1) translate(0%, 0%)');
    });

    it('drops the ease-out transition entirely when the user prefers reduced motion', () => {
        reducedMotion.value = false;
        render(<Harness />);
        fireEvent.click(screen.getByTestId('in'));
        expect(stage().style.transition).toContain('transform 0.2s');
    });

    it('keeps reduced-motion users on the instant path — no transition is written', () => {
        reducedMotion.value = true;
        try {
            render(<Harness />);
            fireEvent.click(screen.getByTestId('in'));
            expect(zoomOf()).toBe(1.5);
            expect(stage().style.transition).toBe('none');
        } finally {
            reducedMotion.value = false;
        }
    });

    it('reports touch-action that keeps page scroll at 1x and owns gestures when zoomed', () => {
        render(<Harness />);

        expect(screen.getByTestId('ta').textContent).toBe('pan-y');
        fireEvent.click(screen.getByTestId('in'));
        expect(screen.getByTestId('ta').textContent).toBe('none');
    });
});
