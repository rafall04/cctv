// @vitest-environment jsdom

/**
 * Purpose: Locks the three-valued contract of audio-track detection and the mute preference.
 * Caller: Frontend Vitest suite.
 * Deps: recordingAudio util only.
 * MainFuncs: detectHasAudioTrack, readRecordingMutePreference, writeRecordingMutePreference.
 * SideEffects: Writes localStorage inside jsdom.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    detectHasAudioTrack,
    readRecordingMutePreference,
    writeRecordingMutePreference,
} from './recordingAudio';

describe('detectHasAudioTrack', () => {
    /*
     * The whole reason this returns three values instead of a boolean. Chrome exposes neither
     * mozHasAudio nor audioTracks, and its decoded-byte counter reads 0 both for "no audio"
     * and for "audio not decoded yet" — which is the normal state of a MUTED player. Collapse
     * that into `false` and the unmute control disappears on the nine production cameras that
     * really do have a microphone.
     */
    it('answers null when the browser gives it nothing to go on', () => {
        expect(detectHasAudioTrack({})).toBe(null);
    });

    it('answers null for a zero decoded-byte counter rather than guessing "no audio"', () => {
        expect(detectHasAudioTrack({ webkitAudioDecodedByteCount: 0 })).toBe(null);
    });

    it('answers null for a missing element', () => {
        expect(detectHasAudioTrack(null)).toBe(null);
    });

    it('trusts mozHasAudio in both directions once metadata is in', () => {
        expect(detectHasAudioTrack({ mozHasAudio: true })).toBe(true);
        expect(detectHasAudioTrack({ mozHasAudio: false, readyState: 1 })).toBe(false);
    });

    it('reads an empty audioTracks list as a definite no once metadata is in', () => {
        expect(detectHasAudioTrack({ audioTracks: { length: 0 }, readyState: 1 })).toBe(false);
        expect(detectHasAudioTrack({ audioTracks: { length: 1 } })).toBe(true);
    });

    it('treats decoded audio bytes as proof of a track', () => {
        expect(detectHasAudioTrack({ webkitAudioDecodedByteCount: 4096 })).toBe(true);
    });

    /*
     * The trap this exists for: `audioTracks` is an EMPTY list on every element that has not
     * loaded yet. Read before metadata, a camera with a microphone reports "no audio" — and
     * since the probe runs the moment the player mounts, that is the common case, not an
     * edge one.
     */
    it('refuses to call it "no audio" before metadata has been parsed', () => {
        expect(detectHasAudioTrack({ audioTracks: { length: 0 }, readyState: 0 })).toBe(null);
        expect(detectHasAudioTrack({ mozHasAudio: false, readyState: 0 })).toBe(null);
    });

    it('still accepts positive evidence before metadata — proof needs no waiting', () => {
        expect(detectHasAudioTrack({ audioTracks: { length: 1 }, readyState: 0 })).toBe(true);
        expect(detectHasAudioTrack({ webkitAudioDecodedByteCount: 4096, readyState: 0 })).toBe(true);
        expect(detectHasAudioTrack({ mozHasAudio: true, readyState: 0 })).toBe(true);
    });
});

describe('recording mute preference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    /*
     * Muted is the safe default, not a neutral one: these players autoplay, and the browser
     * autoplay policy blocks an unmuted element. A first visit that defaulted to sound would
     * be a clip that never starts.
     */
    it('defaults to muted when nothing has been remembered', () => {
        expect(readRecordingMutePreference()).toBe(true);
    });

    it('round-trips an explicit choice in both directions', () => {
        writeRecordingMutePreference(false);
        expect(readRecordingMutePreference()).toBe(false);

        writeRecordingMutePreference(true);
        expect(readRecordingMutePreference()).toBe(true);
    });
});
