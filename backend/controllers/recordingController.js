/**
 * Purpose: HTTP handlers for recording control, playback segment access, and recording assurance.
 * Caller: recordingRoutes mounted under /api.
 * Deps: recordingPlaybackService, recordingAssuranceService, recordingPathSafetyPolicy, and fs streaming utilities.
 * MainFuncs: startRecording(), stopRecording(), getRecordingsOverview(), getRecordingAssurance(), getSegments(), streamSegment().
 * SideEffects: Starts/stops recordings, updates settings, streams MP4 files, and returns read-only assurance data.
 */

import { createReadStream } from 'fs';
import recordingPlaybackService from '../services/recordingPlaybackService.js';
import recordingAssuranceService from '../services/recordingAssuranceService.js';
import { normalizeRecordingRange } from '../services/recordingPathSafetyPolicy.js';

// Start recording untuk camera
export async function startRecording(request, reply) {
    try {
        const { cameraId } = request.params;
        const { duration_hours } = request.body;

        const result = await recordingPlaybackService.startRecording(cameraId, duration_hours, request);
        return reply.send(result);
    } catch (error) {
        console.error('Start recording error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Stop recording untuk camera
export async function stopRecording(request, reply) {
    try {
        const { cameraId } = request.params;

        const result = await recordingPlaybackService.stopRecording(cameraId, request);
        return reply.send(result);
    } catch (error) {
        console.error('Stop recording error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get recording status untuk camera
export async function getRecordingStatus(request, reply) {
    try {
        const { cameraId } = request.params;
        const status = recordingPlaybackService.getRecordingStatus(cameraId);

        return reply.send({ success: true, data: status });
    } catch (error) {
        console.error('Get recording status error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get all recordings overview (dashboard)
export async function getRecordingsOverview(request, reply) {
    try {
        const overviewData = recordingPlaybackService.getRecordingsOverview();
        return reply.send({ success: true, data: overviewData });
    } catch (error) {
        console.error('Get recordings overview error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get recording assurance snapshot for operational monitoring
export async function getRecordingAssurance(request, reply) {
    try {
        const snapshot = recordingAssuranceService.getSnapshot();
        return reply.send({ success: true, data: snapshot });
    } catch (error) {
        console.error('Get recording assurance error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get segments untuk camera (untuk playback)
export async function getSegments(request, reply) {
    try {
        const { cameraId } = request.params;
        const segmentsData = recordingPlaybackService.getSegments(cameraId, request);

        return reply.send({ success: true, data: segmentsData });
    } catch (error) {
        console.error('Get segments error:', error);
        if (error.statusCode === 401) {
            return reply.code(401).send({ success: false, message: error.message });
        }
        if (error.statusCode === 403) {
            return reply.code(403).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Stream segment file (untuk playback)
export async function streamSegment(request, reply) {
    try {
        const { cameraId, filename } = request.params;
        console.log(`[Stream Request] Camera: ${cameraId}, File: ${filename}`);

        const { segment, stats } = recordingPlaybackService.getStreamSegment(cameraId, filename, request);

        // Set headers for video streaming
        reply.header('Content-Type', 'video/mp4');
        reply.header('Content-Length', stats.size);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Cache-Control', 'public, max-age=3600');

        const range = normalizeRecordingRange({
            rangeHeader: request.headers?.range,
            fileSize: stats.size,
        });
        if (!range.valid) {
            return reply
                .code(range.statusCode)
                .header('Content-Range', `bytes */${stats.size}`)
                .send({ success: false, message: range.reason });
        }

        if (range.partial) {
            console.log(`[Stream Info] Range request: ${range.start}-${range.end}/${stats.size}`);
            reply.code(206);
            reply.header('Content-Range', range.contentRange);
            reply.header('Content-Length', range.chunkSize);

            const stream = createReadStream(segment.file_path, { start: range.start, end: range.end });
            return reply.send(stream);
        }

        // Stream entire file
        console.log(`[Stream Info] Streaming entire file: ${stats.size} bytes`);
        const stream = createReadStream(segment.file_path);
        return reply.send(stream);

    } catch (error) {
        console.error('[Stream Error] Exception:', error);
        if (error.statusCode === 401) {
            return reply.code(401).send({ success: false, message: error.message });
        }
        if (error.statusCode === 403) {
            return reply.code(403).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
}

// Generate HLS playlist untuk seamless playback
export async function generatePlaylist(request, reply) {
    try {
        const { cameraId } = request.params;
        const playlist = recordingPlaybackService.generatePlaylist(cameraId, request);

        reply.header('Content-Type', 'application/vnd.apple.mpegurl');
        return reply.send(playlist);
    } catch (error) {
        console.error('Generate playlist error:', error);
        if (error.statusCode === 401) {
            return reply.code(401).send({ success: false, message: error.message });
        }
        if (error.statusCode === 403) {
            return reply.code(403).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get restart logs untuk monitoring
export async function getRestartLogs(request, reply) {
    try {
        const { cameraId } = request.params;
        const { limit = 50 } = request.query;

        const logs = recordingPlaybackService.getRestartLogs(cameraId, limit);
        return reply.send({ success: true, data: logs });
    } catch (error) {
        console.error('Get restart logs error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Update recording settings untuk camera
export async function updateRecordingSettings(request, reply) {
    try {
        const { cameraId } = request.params;

        await recordingPlaybackService.updateRecordingSettings(cameraId, request.body, request);

        return reply.send({ success: true, message: 'Recording settings updated' });
    } catch (error) {
        console.error('Update recording settings error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
