/**
 * Purpose: Read/write the routing rules consumed by the standalone tg-archive sidecar, which
 *          uploads finished recording segments to Telegram groups per camera / per area.
 * Caller: controllers/telegramArchiveController.js.
 * Deps: node:fs, node:path, better-sqlite3 (read-only), database/connectionPool (camera/area names).
 * MainFuncs: overview, createRoute, updateRoute, deleteRoute, activity, verifyChat.
 * SideEffects: reads/writes routes.json under TG_ARCHIVE_DIR; reads the sidecar's state.db and .env.
 *
 * The sidecar re-reads routes.json whenever its mtime changes, so a write here takes effect within
 * one poll without restarting anything. Writes are atomic (tmp + rename) because the uploader may
 * be reading the same file concurrently — the exact pattern rondaConfigService uses.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { query } from '../database/connectionPool.js';

const BASE_DIR = process.env.TG_ARCHIVE_DIR || '/opt/tg-archive';
const ROUTES_FILE = process.env.TG_ARCHIVE_ROUTES_FILE || path.join(BASE_DIR, 'routes.json');
const STATE_DB = process.env.TG_ARCHIVE_STATE_DB || path.join(BASE_DIR, 'state.db');
const ENV_FILE = process.env.TG_ARCHIVE_ENV_FILE || path.join(BASE_DIR, '.env');

const SCOPES = new Set(['camera', 'area', 'all']);
const SPECIFICITY = { camera: 0, area: 1, all: 2 };
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
// Telegram chat ids are integers; groups/supergroups are negative. Reject anything else early so a
// typo surfaces in the form instead of as a stream of failed uploads hours later.
const CHAT_ID_RE = /^-?\d{5,20}$/;

function fail(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function readRoutesFile() {
    try {
        const parsed = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));
        return {
            ...parsed,
            routes: Array.isArray(parsed.routes) ? parsed.routes : [],
        };
    } catch (error) {
        if (error.code === 'ENOENT') return { routes: [] };
        throw fail('routes.json tidak bisa dibaca (format JSON rusak?)', 500);
    }
}

function writeRoutesFile(doc) {
    const tmp = `${ROUTES_FILE}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, ROUTES_FILE);
}

/** Mirrors Router.targets() in uploader.py — most specific first, de-duplicated by chat. */
export function resolveTargets(routes, cameraId, areaId) {
    const matched = routes
        .filter((route) => route.enabled !== false)
        .filter((route) => {
            if (route.scope === 'camera') return Number(route.cameraId) === Number(cameraId);
            if (route.scope === 'area') return areaId != null && Number(route.areaId) === Number(areaId);
            return route.scope === 'all';
        })
        .sort((a, b) => SPECIFICITY[a.scope] - SPECIFICITY[b.scope]);

    const seen = new Set();
    return matched.reduce((acc, route) => {
        const chatId = String(route.chatId);
        if (seen.has(chatId)) return acc;
        seen.add(chatId);
        acc.push({
            id: route.id,
            chatId,
            label: route.label || route.id || chatId,
            scope: route.scope,
            // The first target does the real upload; the rest are copyMessage mirrors, which reuse
            // the uploaded file and cost no extra bandwidth. Worth surfacing in the UI.
            mode: acc.length === 0 ? 'upload' : 'copy',
        });
        return acc;
    }, []);
}

function loadCameras() {
    return query(
        `SELECT c.id, c.name, c.area_id AS areaId, a.name AS areaName
         FROM cameras c LEFT JOIN areas a ON a.id = c.area_id
         WHERE c.enable_recording = 1
         ORDER BY c.area_id, c.id`,
    );
}

function normalize(payload, existing = {}) {
    const merged = { ...existing, ...payload };
    const scope = String(merged.scope || '').trim();

    if (!SCOPES.has(scope)) throw fail("Cakupan harus 'camera', 'area', atau 'all'", 400);

    const chatId = String(merged.chatId ?? '').trim();
    if (!CHAT_ID_RE.test(chatId)) {
        throw fail('ID grup Telegram tidak valid — harus berupa angka, biasanya diawali tanda minus', 400);
    }

    const route = {
        id: existing.id,
        enabled: merged.enabled === undefined ? true : Boolean(merged.enabled),
        scope,
        chatId,
        label: String(merged.label || '').trim().slice(0, 80) || null,
    };

    if (scope === 'camera') {
        const cameraId = Number(merged.cameraId);
        if (!Number.isInteger(cameraId)) throw fail('Pilih kamera terlebih dahulu', 400);
        const known = loadCameras().some((cam) => cam.id === cameraId);
        if (!known) throw fail('Kamera tidak ditemukan atau perekamannya tidak aktif', 400);
        route.cameraId = cameraId;
    } else if (scope === 'area') {
        const areaId = Number(merged.areaId);
        if (!Number.isInteger(areaId)) throw fail('Pilih area terlebih dahulu', 400);
        const known = query('SELECT id FROM areas WHERE id = ?', [areaId]).length > 0;
        if (!known) throw fail('Area tidak ditemukan', 400);
        route.areaId = areaId;
    }

    return route;
}

function slugify(route, taken) {
    const base = (route.label || `${route.scope}-${route.cameraId ?? route.areaId ?? 'all'}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'rute';
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) {
        candidate = `${base}-${n}`;
        n += 1;
    }
    return candidate;
}

function assertNoDuplicate(routes, route) {
    const clash = routes.some((existing) => existing.id !== route.id
        && existing.scope === route.scope
        && String(existing.chatId) === String(route.chatId)
        && Number(existing.cameraId ?? -1) === Number(route.cameraId ?? -1)
        && Number(existing.areaId ?? -1) === Number(route.areaId ?? -1));
    if (clash) throw fail('Rute yang sama persis sudah ada', 409);
}

class TelegramArchiveService {
    isAvailable() {
        // The sidecar lives outside the app; say so plainly rather than showing an empty list that
        // reads like a bug on a host where tg-archive was never installed.
        return fs.existsSync(BASE_DIR);
    }

    overview() {
        const doc = readRoutesFile();
        const cameras = loadCameras().map((camera) => ({
            ...camera,
            targets: resolveTargets(doc.routes, camera.id, camera.areaId),
        }));
        const areas = query('SELECT id, name FROM areas ORDER BY name');
        return {
            available: this.isAvailable(),
            routesFile: ROUTES_FILE,
            routes: doc.routes,
            cameras,
            areas,
            groups: this.groups(),
        };
    }

    /**
     * Groups the bot has been added to, learned by the sidecar from Telegram's `my_chat_member`
     * updates. This is what lets the admin form offer a picker instead of asking someone to copy
     * a chat id by hand.
     */
    groups() {
        return this.#readState((db) => db.prepare(
            `SELECT chat_id AS chatId, title, type, status, can_send AS canSend, updated_at AS updatedAt
             FROM chats WHERE status IS NULL OR status IN ('member','administrator','creator')
             ORDER BY title COLLATE NOCASE`,
        ).all().map((row) => ({ ...row, canSend: row.canSend === null ? null : row.canSend === 1 })), []);
    }

    createRoute(payload) {
        const doc = readRoutesFile();
        const route = normalize(payload);
        route.id = slugify(route, new Set(doc.routes.map((r) => r.id)));
        assertNoDuplicate(doc.routes, route);
        doc.routes.push(route);
        writeRoutesFile(doc);
        return route;
    }

    updateRoute(id, patch) {
        if (!ID_RE.test(id || '')) throw fail('ID rute tidak valid', 400);
        const doc = readRoutesFile();
        const index = doc.routes.findIndex((route) => route.id === id);
        if (index === -1) throw fail('Rute tidak ditemukan', 404);

        const route = normalize(patch, doc.routes[index]);
        route.id = id;
        assertNoDuplicate(doc.routes, route);
        doc.routes[index] = route;
        writeRoutesFile(doc);
        return route;
    }

    deleteRoute(id) {
        if (!ID_RE.test(id || '')) throw fail('ID rute tidak valid', 400);
        const doc = readRoutesFile();
        const remaining = doc.routes.filter((route) => route.id !== id);
        if (remaining.length === doc.routes.length) throw fail('Rute tidak ditemukan', 404);
        doc.routes = remaining;
        writeRoutesFile(doc);
        return { id };
    }

    /** Run a read-only query against the sidecar's own state DB, or return `fallback`. */
    #readState(fn, fallback) {
        if (!fs.existsSync(STATE_DB)) return fallback;
        let db;
        try {
            db = new Database(STATE_DB, { readonly: true, fileMustExist: true });
            return fn(db);
        } catch (error) {
            console.error('Read tg-archive state error:', error);
            return fallback;
        } finally {
            db?.close();
        }
    }

    /** Upload activity straight from the sidecar's own state DB. Opened read-only on purpose. */
    activity(limit = 15) {
        if (!fs.existsSync(STATE_DB)) {
            return { available: false, totals: [], recent: [] };
        }
        let db;
        try {
            db = new Database(STATE_DB, { readonly: true, fileMustExist: true });
            const totals = db.prepare(
                `SELECT status, COUNT(*) AS files, COALESCE(SUM(file_size), 0) AS bytes
                 FROM uploaded GROUP BY status ORDER BY files DESC`,
            ).all();
            const recent = db.prepare(
                `SELECT segment_id AS segmentId, camera_id AS cameraId, filename, file_size AS fileSize,
                        status, targets, uploaded_at AS uploadedAt
                 FROM uploaded ORDER BY segment_id DESC LIMIT ?`,
            ).all(limit).map((row) => ({
                ...row,
                targets: row.targets ? JSON.parse(row.targets) : [],
            }));
            return { available: true, totals, recent };
        } catch (error) {
            console.error('Read tg-archive state error:', error);
            return { available: false, totals: [], recent: [] };
        } finally {
            db?.close();
        }
    }

    /**
     * Ask Telegram whether this chat really exists and whether the bot can post there.
     * The token stays server-side — the browser only ever sees the resolved title/permissions.
     */
    async verifyChat(chatId) {
        if (!CHAT_ID_RE.test(String(chatId ?? '').trim())) {
            throw fail('ID grup Telegram tidak valid', 400);
        }
        const env = this.#readEnv();
        if (!env.TG_BOT_TOKEN) throw fail('Bot arsip belum dikonfigurasi di server', 503);

        const base = (env.TG_API_BASE || 'http://127.0.0.1:8092').replace(/\/+$/, '');
        const call = async (method, params) => {
            const response = await fetch(`${base}/bot${env.TG_BOT_TOKEN}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(params).toString(),
                signal: AbortSignal.timeout(15000),
            });
            return response.json();
        };

        let chat;
        try {
            chat = await call('getChat', { chat_id: chatId });
        } catch {
            throw fail('Server Bot API lokal tidak merespons', 503);
        }
        if (!chat.ok) {
            throw fail(`Telegram menolak: ${chat.description || 'grup tidak ditemukan'}`, 400);
        }

        const permissions = chat.result.permissions || {};
        return {
            chatId: String(chat.result.id),
            title: chat.result.title || chat.result.username || String(chat.result.id),
            type: chat.result.type,
            // A bot that is merely "in" the group but cannot post documents would fail silently at
            // upload time; surface it now, while the operator is still looking at the form.
            canSendDocuments: permissions.can_send_documents !== false,
        };
    }

    #readEnv() {
        try {
            return fs.readFileSync(ENV_FILE, 'utf8')
                .split('\n')
                .reduce((acc, line) => {
                    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
                    if (match) acc[match[1]] = match[2];
                    return acc;
                }, {});
        } catch {
            return {};
        }
    }
}

export default new TelegramArchiveService();
