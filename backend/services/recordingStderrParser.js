// Purpose: Classify FFmpeg recording stderr lines into segment-completion events and log categories.
// Caller: recordingService stderr callback.
// Deps: None.
// MainFuncs: parseRecordingStderrLine.
// SideEffects: None; pure parsing.

const SEGMENT_FILENAME_RE = /(\d{8}_\d{6}\.mp4(?:\.partial)?)/;

/**
 * Returns a structured classification for an FFmpeg stderr line.
 *   - kind: 'segment_completed' | 'segment_debug' | 'error' | 'other'
 *   - filename: present only when kind === 'segment_completed'
 *   - logLine: trimmed text for caller to log when kind !== 'other'
 */
export function parseRecordingStderrLine(output = '') {
    const text = String(output);
    const trimmed = text.trim();

    if (text.includes('Closing') && text.includes('.mp4')) {
        const match = text.match(SEGMENT_FILENAME_RE);
        if (match) {
            return { kind: 'segment_completed', filename: match[1], logLine: trimmed };
        }
    }

    if (
        text.includes('.mp4')
        && (text.includes('segment') || text.includes('Opening') || text.includes('Closing'))
    ) {
        return { kind: 'segment_debug', logLine: trimmed };
    }

    if (
        (text.includes('error') || text.includes('Error') || text.includes('failed'))
        && !text.includes('Closing')
    ) {
        return { kind: 'error', logLine: trimmed };
    }

    return { kind: 'other' };
}
