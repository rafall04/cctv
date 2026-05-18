// Purpose: Single source of truth for the recording filesystem root.
// Caller: Every recording service that needs the base path (cleanup, finalizer, playback, file ops, scanner).
// Deps: node:path, node:url.
// MainFuncs: RECORDINGS_BASE_PATH constant.
// SideEffects: Reads RECORDINGS_DIR environment override at module load.

import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RECORDINGS_BASE_PATH = join(__dirname, '..', '..', 'recordings');

function resolveRecordingsBasePath() {
    const override = (process.env.RECORDINGS_DIR || '').trim();
    if (!override) {
        return DEFAULT_RECORDINGS_BASE_PATH;
    }
    return isAbsolute(override) ? override : resolve(process.cwd(), override);
}

export const RECORDINGS_BASE_PATH = resolveRecordingsBasePath();
