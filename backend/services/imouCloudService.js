/*
Purpose: IMOU Cloud (Easy4ip OpenAPI) client — trigger a camera's built-in SIREN / white-light (active
         deterrence, much louder than the ONVIF backchannel) on demand. Signs every request, caches the
         access token, maps our camera -> its IMOU device SN, and turns the siren on/off.
Caller: audioController (config, siren trigger, device list, ability check).
Deps: crypto (md5 sign), global fetch (Node 22), connectionPool.
MainFuncs: getConfig, setConfig, listDevices, triggerCameraSiren, setCameraSn, testConnection.
SideEffects: outbound HTTPS to the IMOU cloud; fires the physical siren on a camera when triggered.

Auth (per the imouapi convention): sign = md5("time:{t},nonce:{n},appSecret:{secret}"); the body carries
{system:{ver,sign,appId,time,nonce}, id, params}. Device calls put the cached accessToken in params.
app_secret NEVER leaves the server.
*/

import { createHash, randomBytes } from 'crypto';
import { queryOne, execute, query } from '../database/connectionPool.js';

const md5 = (s) => createHash('md5').update(s).digest('hex');
let tokenCache = { token: null, exp: 0 };

export function getConfig() {
    let row = queryOne('SELECT * FROM audio_imou_config WHERE id = 1');
    if (!row) { execute('INSERT OR IGNORE INTO audio_imou_config (id) VALUES (1)'); row = queryOne('SELECT * FROM audio_imou_config WHERE id = 1'); }
    return row;
}

/** Public view (never expose the secret): whether configured + a masked appId. */
export function configStatus() {
    const c = getConfig();
    return {
        configured: Boolean(c.app_id && c.app_secret),
        app_id: c.app_id ? `${c.app_id.slice(0, 4)}…${c.app_id.slice(-2)}` : '',
        base_url: c.base_url,
    };
}

export function setConfig({ appId, appSecret, baseUrl } = {}) {
    const c = getConfig();
    const nextId = appId !== undefined ? (String(appId).trim() || null) : c.app_id;
    const nextSecret = appSecret !== undefined ? (String(appSecret).trim() || null) : c.app_secret;
    const nextBase = baseUrl && String(baseUrl).trim() ? String(baseUrl).trim().replace(/\/$/, '') : c.base_url;
    execute("UPDATE audio_imou_config SET app_id = ?, app_secret = ?, base_url = ?, updated_at = datetime('now') WHERE id = 1",
        [nextId, nextSecret, nextBase]);
    tokenCache = { token: null, exp: 0 }; // creds changed -> drop cached token
    return configStatus();
}

async function rpc(method, params = {}) {
    const c = getConfig();
    if (!c.app_id || !c.app_secret) { const e = new Error('IMOU Cloud belum dikonfigurasi (appId/appSecret)'); e.statusCode = 400; throw e; }
    const time = Math.round(Date.now() / 1000);
    const nonce = randomBytes(8).toString('hex');
    const sign = md5(`time:${time},nonce:${nonce},appSecret:${c.app_secret}`);
    const body = { system: { ver: '1.0', sign, appId: c.app_id, time, nonce }, id: String(time), params };
    let res;
    try {
        res = await fetch(`${c.base_url}/${method}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
        });
    } catch (e) { const err = new Error(`IMOU cloud tak terjangkau: ${e.message}`); err.statusCode = 502; throw err; }
    const json = await res.json().catch(() => ({}));
    const code = json?.result?.code;
    if (code !== undefined && code !== '0') {
        const err = new Error(`IMOU: ${json?.result?.msg || 'gagal'} (code ${code})`); err.statusCode = 502; throw err;
    }
    return json?.result?.data ?? json?.result ?? json;
}

async function getToken() {
    if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
    const data = await rpc('accessToken', {});
    const token = data?.accessToken;
    if (!token) { const e = new Error('Gagal ambil accessToken IMOU'); e.statusCode = 502; throw e; }
    // expireTime is seconds; refresh a minute early.
    const ttl = (parseInt(data.expireTime, 10) || 3600) * 1000;
    tokenCache = { token, exp: Date.now() + Math.max(60000, ttl - 60000) };
    return token;
}

/** Devices bound to the IMOU account (deviceId=SN + name) — lets the operator map cameras without typing. */
export async function listDevices() {
    const token = await getToken();
    const data = await rpc('deviceBaseList', { token, bindId: -1, limit: 50, type: 'bindAndShare', needApInfo: false });
    const list = data?.deviceList || data?.list || [];
    return list.map((d) => ({ sn: d.deviceId || d.sn, name: d.name || d.deviceName || d.deviceId }));
}

export async function testConnection() {
    const token = await getToken();
    return { ok: Boolean(token) };
}

export function setCameraSn(cameraId, sn) {
    const id = parseInt(cameraId, 10);
    const cam = queryOne('SELECT id FROM cameras WHERE id = ?', [id]);
    if (!cam) { const e = new Error('Kamera tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('UPDATE cameras SET imou_sn = ? WHERE id = ?', [sn ? String(sn).trim() : null, id]);
    return { id, imou_sn: sn ? String(sn).trim() : null };
}

/** Cameras (in audio scope) with their IMOU SN mapping, for the UI. */
export function listSirenCameras() {
    return query(`SELECT id, name, imou_sn FROM cameras WHERE enabled = 1 AND stream_source = 'internal'
                  AND private_rtsp_url IS NOT NULL AND private_rtsp_url != '' ORDER BY name`);
}

async function setSiren(sn, on) {
    const token = await getToken();
    return rpc('setDeviceCameraStatus', { token, deviceId: sn, channelId: '0', enableType: 'siren', enable: Boolean(on) });
}

/** Turn a camera's built-in siren on/off by our camera id (resolves its IMOU SN). */
export async function triggerCameraSiren(cameraId, on) {
    const cam = queryOne('SELECT id, name, imou_sn FROM cameras WHERE id = ?', [parseInt(cameraId, 10)]);
    if (!cam) { const e = new Error('Kamera tidak ditemukan'); e.statusCode = 404; throw e; }
    if (!cam.imou_sn) { const e = new Error('Kamera belum dipetakan ke SN IMOU'); e.statusCode = 400; throw e; }
    await setSiren(cam.imou_sn, on);
    return { id: cam.id, name: cam.name, siren: Boolean(on) };
}

export default {
    getConfig, configStatus, setConfig, listDevices, testConnection, setCameraSn, listSirenCameras, triggerCameraSiren,
};
