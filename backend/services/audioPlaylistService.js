/*
Purpose: Manage audio playlists (ordered groups of clips) for the Audio Broadcast feature.
Caller: audioController.
Deps: connectionPool, audio_playlists + audio_playlist_items tables.
MainFuncs: listPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist.
SideEffects: writes playlist rows/items.
*/

import { query, queryOne, execute, transaction } from '../database/connectionPool.js';

export function listPlaylists() {
    return query(`
        SELECT p.id, p.name, p.created_at,
            (SELECT COUNT(*) FROM audio_playlist_items i WHERE i.playlist_id = p.id) AS clip_count,
            (SELECT COALESCE(SUM(c.duration_sec), 0) FROM audio_playlist_items i
                JOIN audio_clips c ON c.id = i.clip_id WHERE i.playlist_id = p.id) AS duration_sec
        FROM audio_playlists p ORDER BY p.name ASC
    `);
}

export function getPlaylist(id) {
    const pl = queryOne('SELECT * FROM audio_playlists WHERE id = ?', [parseInt(id, 10)]);
    if (!pl) return null;
    pl.items = query(`
        SELECT i.id AS item_id, i.sort_order, c.id AS clip_id, c.name, c.duration_sec
        FROM audio_playlist_items i JOIN audio_clips c ON c.id = i.clip_id
        WHERE i.playlist_id = ? ORDER BY i.sort_order ASC, i.id ASC
    `, [pl.id]);
    return pl;
}

function cleanName(name) {
    const n = String(name || '').trim().slice(0, 120);
    if (!n) { const err = new Error('Nama playlist wajib diisi'); err.statusCode = 400; throw err; }
    return n;
}

function replaceItems(playlistId, clipIds) {
    execute('DELETE FROM audio_playlist_items WHERE playlist_id = ?', [playlistId]);
    const ids = (clipIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
    ids.forEach((clipId, idx) => {
        // Only insert clips that exist — a stale id in the request must not create a dangling item.
        if (queryOne('SELECT 1 FROM audio_clips WHERE id = ?', [clipId])) {
            execute('INSERT INTO audio_playlist_items (playlist_id, clip_id, sort_order) VALUES (?, ?, ?)',
                [playlistId, clipId, idx]);
        }
    });
}

export function createPlaylist(name, clipIds = []) {
    const n = cleanName(name);
    let id;
    transaction(() => {
        // Use the INSERT's own lastInsertRowid (robust in OR out of a transaction) rather than
        // `last_insert_rowid()` via queryOne, whose value is connection-specific.
        id = execute('INSERT INTO audio_playlists (name) VALUES (?)', [n]).lastInsertRowid;
        replaceItems(id, clipIds);
    });
    return getPlaylist(id);
}

export function updatePlaylist(id, { name, clipIds } = {}) {
    const pl = queryOne('SELECT id FROM audio_playlists WHERE id = ?', [parseInt(id, 10)]);
    if (!pl) { const err = new Error('Playlist tidak ditemukan'); err.statusCode = 404; throw err; }
    transaction(() => {
        if (name !== undefined) execute('UPDATE audio_playlists SET name = ? WHERE id = ?', [cleanName(name), pl.id]);
        if (Array.isArray(clipIds)) replaceItems(pl.id, clipIds);
    });
    return getPlaylist(pl.id);
}

export function deletePlaylist(id) {
    const pl = queryOne('SELECT id FROM audio_playlists WHERE id = ?', [parseInt(id, 10)]);
    if (!pl) { const err = new Error('Playlist tidak ditemukan'); err.statusCode = 404; throw err; }
    execute('DELETE FROM audio_playlists WHERE id = ?', [pl.id]); // items cascade
    return { deleted: pl.id };
}

export default { listPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist };
