import recordingPlaybackService from '../services/recordingPlaybackService.js';
import { createReadStream } from 'fs';

// Start recording untuk camera
export async function startRecording(request, reply) {
    try {
        const { cameraId } = request.params;
        const { date } = request.query || {};
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
        const { date } = request.query || {};

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
        const { date } = request.query || {};
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

// Get segments untuk camera (untuk playback)
export async function getSegments(request, reply) {
    try {
        const { cameraId } = request.params;
        const { date } = request.query || {};
        const segmentsData = recordingPlaybackService.getSegments(cameraId, date);

        return reply.send({ success: true, data: segmentsData });
    } catch (error) {
        console.error('Get segments error:', error);
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

        const { segment, stats } = await recordingPlaybackService.getStreamSegment(cameraId, filename);

        // Set CORS headers explicitly
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Range');
        reply.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

        // Set headers for video streaming
        reply.header('Content-Type', 'video/mp4');
        reply.header('Content-Length', stats.size);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Cache-Control', 'public, max-age=3600');

        // Handle range requests (for seeking)
        const range = request.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
            const chunksize = (end - start) + 1;

            console.log(`[Stream Info] Range request: ${start}-${end}/${stats.size}`);

            reply.code(206);
            reply.header('Content-Range', `bytes ${start}-${end}/${stats.size}`);
            reply.header('Content-Length', chunksize);

            const stream = createReadStream(segment.file_path, { start, end });
            return reply.send(stream);
        }

        // Stream entire file
        console.log(`[Stream Info] Streaming entire file: ${stats.size} bytes`);
        const stream = createReadStream(segment.file_path);
        return reply.send(stream);

    } catch (error) {
        console.error('[Stream Error] Exception:', error);
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
        const { limit, offset } = request.query;
        
        const options = {};
        if (limit) options.limit = parseInt(limit, 10);
        if (offset) options.offset = parseInt(offset, 10);

        const playlist = recordingPlaybackService.generatePlaylist(cameraId, options);

        reply.header('Content-Type', 'application/vnd.apple.mpegurl');
        return reply.send(playlist);
    } catch (error) {
        console.error('Generate playlist error:', error);
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
        const { date } = request.query || {};
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
        const { date } = request.query || {};

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
