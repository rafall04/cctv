// @vitest-environment jsdom
/*
Purpose: Lock the audio surface onto the shared primitives after the 2026-09 elegance audit.
Caller: Vitest frontend jsdom suite.
Deps: components/ui primitives, @testing-library/react, fs/path for structural scans.
MainFuncs: SegmentedControl/StatusDot ARIA contract tests + audio-folder structural guards.
SideEffects: None.

What the audit measured (and these tests now guard):
- The pick-one-of-N button row was hand-rolled identically in FOUR files — no radiogroup role,
  no aria-checked, no arrow-key traversal. SegmentedControl owns that pattern now.
- 13 status dots carried `aria-hidden` with no sr-only label — meaning lived on colour alone.
- window.prompt() drove two inputs — blocking, unstyled, dead inside in-app webviews.
*/

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { StatusDot } from '../../ui/Badge';
import CameraMultiSelect from './CameraMultiSelect';

vi.mock('../../../services/audioService', () => ({
    playNow: vi.fn(), playDevices: vi.fn(), stopPlay: vi.fn(),
    getActivePlays: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getPlayHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getDevices: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));
vi.mock('../../../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification: vi.fn() }),
}));
vi.mock('../../../contexts/ConfirmContext', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

const AUDIO_DIR = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_FILES = fs.readdirSync(AUDIO_DIR)
    .filter((f) => /\.jsx$/.test(f) && !/\.(test|spec)\.jsx$/.test(f))
    .map((f) => path.join(AUDIO_DIR, f));

const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('SegmentedControl', () => {
    const OPTS = [
        { value: 'clip', label: 'Audio' },
        { value: 'playlist', label: 'Playlist' },
        { value: 'tts', label: 'Teks suara' },
    ];

    it('is a labelled radiogroup with aria-checked on exactly the value', () => {
        render(<SegmentedControl label="Sumber" options={OPTS} value="playlist" onChange={() => {}} />);
        const group = screen.getByRole('radiogroup', { name: 'Sumber' });
        expect(group).toBeTruthy();
        const radios = screen.getAllByRole('radio');
        expect(radios).toHaveLength(3);
        expect(radios[1].getAttribute('aria-checked')).toBe('true');
        expect(radios[0].getAttribute('aria-checked')).toBe('false');
    });

    it('keeps a visible focus affordance (the hand-rolled rows had none)', () => {
        render(<SegmentedControl label="Sumber" options={OPTS} value="clip" onChange={() => {}} />);
        expect(screen.getByRole('radio', { name: 'Audio' }).className).toContain('focus-visible:outline-primary');
    });

    it('roving tabindex — only the checked option sits in the tab order', () => {
        render(<SegmentedControl label="Sumber" options={OPTS} value="playlist" onChange={() => {}} />);
        const radios = screen.getAllByRole('radio');
        expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    });

    it('an uninitialised value still leaves the first option reachable', () => {
        render(<SegmentedControl label="Sumber" options={OPTS} value="" onChange={() => {}} />);
        expect(screen.getAllByRole('radio')[0].tabIndex).toBe(0);
    });

    it('moves selection on arrow keys and wraps', () => {
        const onChange = vi.fn();
        // value stays 'clip' (uncontrolled fixture) — every key computes from index 0.
        render(<SegmentedControl label="Sumber" options={OPTS} value="clip" onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith('playlist');
        fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowLeft' });
        expect(onChange).toHaveBeenCalledWith('tts'); // wraps from the first option
        fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'End' });
        expect(onChange).toHaveBeenCalledWith('tts');
        fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'Home' });
        expect(onChange).toHaveBeenCalledWith('clip');
    });

    it('skips disabled options during arrow traversal', () => {
        const opts = [OPTS[0], { ...OPTS[1], disabled: true }, OPTS[2]];
        const onChange = vi.fn();
        render(<SegmentedControl label="Sumber" options={opts} value="clip" onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith('tts');
    });
});

describe('StatusDot (audio audit extensions)', () => {
    it('pairs every dot with sr-only text — the dot alone can never carry meaning', () => {
        const { container } = render(<StatusDot tone="live" label="sedang diputar" />);
        expect(container.querySelector('.sr-only')?.textContent).toBe('sedang diputar');
        expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    });

    it('small drops to the chip-dot size, pulse animates for actively-changing state', () => {
        const { container } = render(<StatusDot tone="fault" label="gagal" small pulse />);
        const dot = container.querySelector('[aria-hidden="true"]');
        expect(dot.className).toContain('h-1.5');
        expect(dot.className).toContain('animate-pulse');
    });
});

describe('loading-state contract (initial Promise.all paint bug)', () => {
    // Regression: the default "Putar Sekarang" tab rendered empty pickers while the parent's
    // Promise.all was still in flight — "— pilih —" / "Tidak ada kamera" showed, then options
    // popped in later with no "memuat" cue. loading=true must say so instead of faking empty.
    it('CameraMultiSelect shows a loading note, not the empty-state text, while loading', () => {
        render(<CameraMultiSelect cameras={[]} value={[]} onChange={() => {}} loading />);
        expect(screen.getByText(/Memuat daftar kamera/)).toBeTruthy();
        expect(screen.queryByText(/Tidak ada kamera/)).toBeNull();
    });

    it('CameraMultiSelect falls back to the real empty state once loading is done', () => {
        render(<CameraMultiSelect cameras={[]} value={[]} onChange={() => {}} loading={false} />);
        expect(screen.getByText(/Tidak ada kamera/)).toBeTruthy();
    });

    it('PlayNowTab says "Memuat…" in the source picker instead of a bare "— pilih —"', async () => {
        const { default: PlayNowTab } = await import('./PlayNowTab');
        render(<PlayNowTab clips={[]} playlists={[]} cameras={[]} groups={[]} loading />);
        const select = screen.getByRole('combobox', { name: /Pilih audio/ });
        expect(select.disabled).toBe(true);
        expect(select.querySelector('option').textContent).toBe('Memuat…');
        expect(screen.getByText(/Memuat daftar kamera/)).toBeTruthy();
    });

    it('PlayNowTab shows real options after loading resolves', async () => {
        const { default: PlayNowTab } = await import('./PlayNowTab');
        render(<PlayNowTab
            clips={[{ id: 7, name: 'Azan', duration_sec: 120 }]}
            playlists={[]} cameras={[]} groups={[]} loading={false}
        />);
        const select = screen.getByRole('combobox', { name: /Pilih audio/ });
        expect(select.disabled).toBe(false);
        expect(screen.getByRole('option', { name: /Azan/ })).toBeTruthy();
    });
});

describe('guardrail: the audio surface stays on the primitives', () => {
    const read = (f) => stripComments(fs.readFileSync(f, 'utf8'));

    it('no window.prompt / window.confirm / alert — dialogs go through Modal/ConfirmContext', () => {
        const offenders = AUDIO_FILES
            .filter((f) => /window\.(prompt|confirm|alert)\s*\(/.test(read(f)))
            .map((f) => path.basename(f));
        expect(offenders, `Use Modal/TextPrompt/ConfirmContext: ${offenders.join(', ')}`).toEqual([]);
    });

    it('no bare aria-hidden status dots — meaning needs StatusDot sr-only text', () => {
        // A rounded-full span that hides itself is a colour-only status marker.
        // CameraMultiSelect is exempt: its two dots sit INSIDE spans that already carry the
        // same word as visible text ("offline", capability label) — decorative, not a carrier.
        const DECORATIVE = ['CameraMultiSelect.jsx'];
        const offenders = AUDIO_FILES
            .filter((f) => !DECORATIVE.includes(path.basename(f)))
            .filter((f) => /<span[^>]*rounded-full[^>]*aria-hidden/.test(read(f)) || /<span[^>]*aria-hidden[^>]*rounded-full/.test(read(f)))
            .map((f) => path.basename(f));
        expect(offenders, `Use <StatusDot tone label> instead: ${offenders.join(', ')}`).toEqual([]);
    });

    it('no hand-rolled segment toggles — pick-one-of-N goes through SegmentedControl', () => {
        const offenders = AUDIO_FILES
            .filter((f) => /flex-1 rounded-control border px-3 py-2 text-sm font-medium/.test(read(f)))
            .map((f) => path.basename(f));
        expect(offenders, `Use <SegmentedControl> instead: ${offenders.join(', ')}`).toEqual([]);
    });
});
