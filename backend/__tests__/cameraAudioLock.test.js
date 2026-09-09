import { describe, it, expect } from 'vitest';
import {
    acquire, preempt, release, isBusy, activeAudioCount, MAX_AUDIO_CONCURRENT,
} from '../services/cameraAudioLock.js';

describe('cameraAudioLock', () => {
    it('acquire is exclusive per camera and returns a truthy token', () => {
        const t = acquire(101, 'clip');
        expect(t).toBeTruthy();
        expect(acquire(101, 'clip')).toBeNull(); // already held
        release(101);
        expect(isBusy(101)).toBe(false);
    });

    it('token-guarded release ignores a stale (preempted) holder', () => {
        const t1 = acquire(102, 'clip');
        const { token: t2 } = preempt(102, 'clip'); // a newer holder takes over
        expect(t2).not.toBe(t1);
        release(102, t1);              // stale release must NOT remove the new holder
        expect(isBusy(102)).toBe(true);
        release(102, t2);
        expect(isBusy(102)).toBe(false);
    });

    it('preempt calls the displaced holder stop() and reports its kind', () => {
        let stopped = false;
        acquire(103, 'clip', () => { stopped = true; });
        const r = preempt(103, 'talk', null);
        expect(stopped).toBe(true);    // the old child was actually told to stop (the core bug fix)
        expect(r.displaced).toBe('clip');
        release(103, r.token);
        expect(isBusy(103)).toBe(false);
    });

    it('governor caps concurrent holders at MAX_AUDIO_CONCURRENT', () => {
        const ids = [];
        for (let i = 0; i < MAX_AUDIO_CONCURRENT; i += 1) {
            const t = acquire(200 + i, 'clip');
            expect(t).toBeTruthy();
            ids.push(200 + i);
        }
        expect(activeAudioCount()).toBe(MAX_AUDIO_CONCURRENT);
        expect(acquire(999, 'clip')).toBeNull(); // governor full -> refused
        ids.forEach((id) => release(id));
        expect(activeAudioCount()).toBe(0);
    });

    it('preempt bypasses the governor cap (emergency)', () => {
        const ids = [];
        for (let i = 0; i < MAX_AUDIO_CONCURRENT; i += 1) { acquire(300 + i, 'clip'); ids.push(300 + i); }
        const r = preempt(400, 'clip'); // emergency onto a fresh camera even though the cap is reached
        expect(r.token).toBeTruthy();
        expect(isBusy(400)).toBe(true);
        ids.forEach((id) => release(id));
        release(400, r.token);
    });
});
