import path from 'path';

/**
 * Portable base path for camera recordings.
 * Priority: 
 * 1. process.env.RECORDINGS_PATH
 * 2. CWD/recordings
 */
export const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH 
  ? path.resolve(process.env.RECORDINGS_PATH) 
  : path.resolve(process.cwd(), 'recordings');

export default {
  RECORDINGS_BASE_PATH
};
