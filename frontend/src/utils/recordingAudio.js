/**
 * Purpose: Shared mute preference + audio-track detection for the three recording players.
 * Caller: PlaybackVideo, ArchiveVideo (Telegram archive), MyRecordings (customer portal).
 * Deps: localStorage and HTML media element properties only.
 * MainFuncs: readRecordingMutePreference, writeRecordingMutePreference, detectHasAudioTrack.
 * SideEffects: Writes one localStorage key.
 *
 * Recordings carried no audio track at all until the recorder started mapping `0:a?`, so
 * every player here was written against a medium that could not make sound. Two habits
 * survive from that era and both are wrong now:
 *
 *   - PlaybackVideo hardcoded `muted`, which would silence the audio we now record.
 *   - ArchiveVideo and MyRecordings autoplay WITHOUT `muted`, which browsers permit only
 *     while there is nothing to hear. Give those elements a real audio track and the
 *     autoplay policy blocks them.
 *
 * So the default stays muted — that is what keeps autoplay working — and the viewer's own
 * choice is remembered instead of being reset on every segment change.
 */

const MUTE_PREFERENCE_KEY = 'recording-audio-muted';

/** Muted unless the viewer has explicitly asked otherwise. Storage failures stay muted. */
export function readRecordingMutePreference() {
    try {
        return localStorage.getItem(MUTE_PREFERENCE_KEY) !== '0';
    } catch {
        // Private mode / storage disabled. The session still plays, it just forgets.
        return true;
    }
}

export function writeRecordingMutePreference(isMuted) {
    try {
        localStorage.setItem(MUTE_PREFERENCE_KEY, isMuted ? '1' : '0');
    } catch {
        // Nothing to do — losing the preference is not worth breaking playback over.
    }
}

/** HTMLMediaElement.HAVE_METADATA — below this, the element has not parsed its tracks yet. */
const HAVE_METADATA = 1;

/**
 * Does the loaded media actually have an audio track?
 *
 * Returns `true` / `false` / `null`, and the third value is the point: no browser exposes
 * this reliably, so "I do not know" has to be sayable. Callers must not turn `null` into
 * "no audio" — three of the twelve recording cameras genuinely have no microphone, but a
 * player that hides its unmute control on a guess would silence the other nine.
 *
 * The asymmetry below is deliberate. Evidence FOR a track is self-proving and needs no
 * readiness check. Evidence AGAINST is only trustworthy once metadata has been parsed:
 * `audioTracks` is an empty list on every element that has not loaded yet, so reading it
 * early reports "no audio" for a camera that has plenty. Same trap in reverse for
 * `webkitAudioDecodedByteCount`, which is 0 until decoding starts — and a MUTED element
 * may never start, which is exactly the state this is called in. So a zero counter is
 * never evidence of anything.
 */
export function detectHasAudioTrack(video) {
    if (!video) return null;

    if (typeof video.webkitAudioDecodedByteCount === 'number' && video.webkitAudioDecodedByteCount > 0) {
        return true;
    }
    if (video.audioTracks && video.audioTracks.length > 0) {
        return true;
    }
    if (video.mozHasAudio === true) {
        return true;
    }

    if (typeof video.readyState === 'number' && video.readyState < HAVE_METADATA) {
        return null;
    }

    if (typeof video.mozHasAudio === 'boolean') {
        return video.mozHasAudio;
    }
    if (video.audioTracks && typeof video.audioTracks.length === 'number') {
        return false;
    }
    return null;
}
