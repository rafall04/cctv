/**
 * Purpose: Provide admin diagnostics for Telegram camera notification routing and drill delivery.
 * Caller: adminController notification diagnostics handlers.
 * Deps: database camera/runtime tables, telegramService routing and send helpers.
 * MainFuncs: previewCameraEvent, runCameraEventDrill, listRecentRuns.
 * SideEffects: Drill mode sends Telegram messages and writes notification_diagnostic_runs audit rows.
 */

import { execute, query, queryOne } from '../database/database.js';
import {
    inspectCameraNotificationRouting,
    sendCameraStatusNotifications,
} from './telegramService.js';

const VALID_EVENTS = new Set(['offline', 'online']);
export const RUNTIME_STATE_DIAGNOSTICS_SELECT = `
    SELECT
        camera_id,
        is_online,
        monitoring_state,
        monitoring_reason,
        last_runtime_signal_at,
        last_runtime_signal_type,
        last_health_check_at,
        updated_at
    FROM camera_runtime_state
    WHERE camera_id = ?
`;

function assertEventType(eventType) {
    if (!VALID_EVENTS.has(eventType)) {
        const err = new Error('Invalid event type');
        err.statusCode = 400;
        throw err;
    }
}

function normalizeCameraId(cameraId) {
    const parsed = Number.parseInt(cameraId, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        const err = new Error('Invalid camera id');
        err.statusCode = 400;
        throw err;
    }
    return parsed;
}

function getCamera(cameraId) {
    const id = normalizeCameraId(cameraId);
    const camera = queryOne(`
        SELECT c.*, a.name AS area_name
        FROM cameras c
        LEFT JOIN areas a ON a.id = c.area_id
        WHERE c.id = ?
    `, [id]);

    if (!camera) {
        const err = new Error('Camera not found');
        err.statusCode = 404;
        throw err;
    }

    return camera;
}

function getRuntimeState(cameraId) {
    return queryOne(RUNTIME_STATE_DIAGNOSTICS_SELECT, [cameraId]);
}

function formatCamera(camera) {
    return {
        id: camera.id,
        name: camera.name,
        areaId: camera.area_id || null,
        areaName: camera.area_name || camera.location || 'Tanpa Area',
        location: camera.location || '',
        enabled: camera.enabled !== 0,
    };
}

export function formatRuntimeHealthForDiagnostics(runtime) {
    if (!runtime) {
        return {
            status: 'unknown',
            isOnline: false,
            reason: null,
            lastCheckedAt: null,
            lastRuntimeSignalAt: null,
            lastRuntimeSignalType: null,
            updatedAt: null,
            lastError: null,
            responseTimeMs: null,
            consecutiveFailures: 0,
        };
    }

    const reason = runtime.monitoring_reason || null;
    return {
        status: runtime.monitoring_state || (runtime.is_online === 1 ? 'online' : 'unknown'),
        isOnline: runtime.is_online === 1,
        reason,
        lastCheckedAt: runtime.last_health_check_at || null,
        lastRuntimeSignalAt: runtime.last_runtime_signal_at || null,
        lastRuntimeSignalType: runtime.last_runtime_signal_type || null,
        updatedAt: runtime.updated_at || null,
        lastError: reason,
        responseTimeMs: null,
        consecutiveFailures: 0,
    };
}

function writeRunAudit({ camera, eventType, mode, success, routing, skippedReason = null, errorMessage = null, userId = null }) {
    execute(`
        INSERT INTO notification_diagnostic_runs (
            camera_id, camera_name, event_type, mode, success, target_count, sent_count,
            skipped_reason, error_message, targets_json, routing_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        camera.id,
        camera.name,
        eventType,
        mode,
        success ? 1 : 0,
        routing.matchedTargets.length,
        success ? routing.matchedTargets.length : 0,
        skippedReason,
        errorMessage,
        JSON.stringify(routing.matchedTargets),
        JSON.stringify({
            matchedRules: routing.matchedRules,
            unmatchedRules: routing.unmatchedRules,
            ruleIssues: routing.ruleIssues,
        }),
        userId,
    ]);
}

function buildPreview(cameraId, eventType) {
    assertEventType(eventType);
    const camera = getCamera(cameraId);
    const runtime = getRuntimeState(camera.id);
    const routing = inspectCameraNotificationRouting(eventType, camera);

    return {
        camera: formatCamera(camera),
        health: formatRuntimeHealthForDiagnostics(runtime),
        eventType,
        routing,
        generatedAt: new Date().toISOString(),
        rawCamera: camera,
    };
}

function previewCameraEvent({ cameraId, eventType }) {
    const preview = buildPreview(cameraId, eventType);
    const { rawCamera, ...response } = preview;
    return response;
}

async function runCameraEventDrill({ cameraId, eventType, userId = null }) {
    const preview = buildPreview(cameraId, eventType);
    const { rawCamera, routing } = preview;

    if (!routing.canSend) {
        writeRunAudit({
            camera: rawCamera,
            eventType,
            mode: 'drill',
            success: false,
            routing,
            skippedReason: routing.skippedReason,
            userId,
        });
        const { rawCamera: omitted, ...response } = preview;
        return { ...response, success: false, skippedReason: routing.skippedReason };
    }

    try {
        const sent = await sendCameraStatusNotifications(eventType, [rawCamera], {
            bypassCooldown: true,
            diagnostic: true,
        });
        writeRunAudit({
            camera: rawCamera,
            eventType,
            mode: 'drill',
            success: sent,
            routing,
            skippedReason: sent ? null : 'TELEGRAM_SEND_FAILED',
            userId,
        });
        const { rawCamera: omitted, ...response } = preview;
        return { ...response, success: sent, skippedReason: sent ? null : 'TELEGRAM_SEND_FAILED' };
    } catch (error) {
        writeRunAudit({
            camera: rawCamera,
            eventType,
            mode: 'drill',
            success: false,
            routing,
            skippedReason: 'TELEGRAM_SEND_ERROR',
            errorMessage: error.message,
            userId,
        });
        throw error;
    }
}

function listRecentRuns({ cameraId = null, limit = 20 } = {}) {
    const normalizedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 50);
    const params = [];
    let where = '';

    if (cameraId) {
        where = 'WHERE camera_id = ?';
        params.push(normalizeCameraId(cameraId));
    }
    params.push(normalizedLimit);

    return query(`
        SELECT id, camera_id, camera_name, event_type, mode, success, target_count, sent_count,
               skipped_reason, error_message, targets_json, created_at
        FROM notification_diagnostic_runs
        ${where}
        ORDER BY created_at DESC
        LIMIT ?
    `, params).map((row) => ({
        id: row.id,
        cameraId: row.camera_id,
        cameraName: row.camera_name,
        eventType: row.event_type,
        mode: row.mode,
        success: row.success === 1,
        targetCount: row.target_count,
        sentCount: row.sent_count,
        skippedReason: row.skipped_reason,
        errorMessage: row.error_message,
        targets: JSON.parse(row.targets_json || '[]'),
        createdAt: row.created_at,
    }));
}

export default {
    previewCameraEvent,
    runCameraEventDrill,
    listRecentRuns,
};
