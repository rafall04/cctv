// Purpose: Provide pure path, filename, and HTTP byte-range safety decisions for recording files.
// Caller: recording playback, cleanup, recovery, and file operation services.
// Deps: node:path, recordingRetentionPolicy.
// MainFuncs: isSafeRecordingFilePath, isPathInside, normalizeRecordingRange.
// SideEffects: None.

import { basename, isAbsolute, join, relative, resolve } from 'path';
import { isSafeRecordingFilename } from './recordingRetentionPolicy.js';

export function isPathInside(parentPath, candidatePath) {
    const parent = resolve(parentPath);
    const candidate = resolve(candidatePath);
    const pathDiff = relative(parent, candidate);
    return Boolean(pathDiff) && !pathDiff.startsWith('..') && !isAbsolute(pathDiff);
}

export function isSafeRecordingFilePath({ recordingsBasePath, cameraId, filePath, filename = null }) {
    if (!recordingsBasePath || !cameraId || !filePath) {
        return false;
    }

    const cameraDir = join(recordingsBasePath, `camera${cameraId}`);
    const resolvedPath = resolve(filePath);
    const resolvedFilename = basename(resolvedPath);

    if (!isPathInside(cameraDir, resolvedPath)) {
        return false;
    }

    if (filename && resolvedFilename !== filename) {
        return false;
    }

    return isSafeRecordingFilename(filename || resolvedFilename);
}

export function normalizeRecordingRange({ rangeHeader, fileSize }) {
    const size = Number(fileSize);
    if (!rangeHeader) {
        return {
            valid: true,
            partial: false,
            start: 0,
            end: Math.max(0, size - 1),
            chunkSize: size,
            contentRange: null,
        };
    }

    if (!Number.isFinite(size) || size <= 0) {
        return { valid: false, statusCode: 416, reason: 'range_not_satisfiable' };
    }

    const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
        return { valid: false, statusCode: 416, reason: 'invalid_range_header' };
    }

    const [, rawStart, rawEnd] = match;
    if (!rawStart && !rawEnd) {
        return { valid: false, statusCode: 416, reason: 'invalid_range_header' };
    }

    let start = rawStart ? Number.parseInt(rawStart, 10) : size - Number.parseInt(rawEnd, 10);
    let end = rawEnd && rawStart ? Number.parseInt(rawEnd, 10) : size - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return { valid: false, statusCode: 416, reason: 'invalid_range_header' };
    }

    start = Math.max(0, start);
    end = Math.min(size - 1, end);

    if (start > end || start >= size) {
        return { valid: false, statusCode: 416, reason: 'range_not_satisfiable' };
    }

    return {
        valid: true,
        partial: true,
        start,
        end,
        chunkSize: end - start + 1,
        contentRange: `bytes ${start}-${end}/${size}`,
    };
}
