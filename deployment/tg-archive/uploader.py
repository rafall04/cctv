#!/usr/bin/env python3
# Purpose: Upload finalized 10-minute CCTV recording segments to Telegram groups
#          via a self-hosted local Bot API server (2000 MB limit, not the cloud 50 MB),
#          routed per-camera / per-area so one group never mixes sources.
# Caller:  systemd unit tg-archive.service (long-running loop).
# Deps:    stdlib + requests. Reads the app DB READ-ONLY; own state in state.db.
# SideEffects: network upload to Telegram; writes only to its own state.db.

import os
import re
import sys
import json
import time
import sqlite3
import logging
import threading
from datetime import datetime, timezone, timedelta

import requests

WIB = timezone(timedelta(hours=7))


def env(name, default=None, required=False):
    val = os.environ.get(name, default)
    if required and not val:
        sys.exit('FATAL: env %s is required (set it in tg-archive.env)' % name)
    return val


class Config:
    def __init__(self):
        self.api_base = env('TG_API_BASE', 'http://127.0.0.1:8092').rstrip('/')
        # Not required up front: --status and --routes are pure local reads, and demanding the token
        # made them exit silently when run without sourcing .env first.
        self.token = env('TG_BOT_TOKEN')
        self.default_chat_id = env('TG_CHAT_ID', '') or None
        self.app_db = env('APP_DB', '/var/www/rafnet-cctv/backend/data/cctv.db')
        self.state_db = env('STATE_DB', '/opt/tg-archive/state.db')
        self.routes_file = env('ROUTES_FILE', '/opt/tg-archive/routes.json')
        self.poll_interval = int(env('POLL_INTERVAL_SEC', '60'))
        self.max_file_mb = int(env('MAX_FILE_MB', '1900'))
        # 45 sits just above the measured per-file rate (median 43.7 Mbps over 103 real uploads),
        # so it never fires in normal operation and only bounds a backfill storm. See pace().
        self.max_mbps = float(env('MAX_AVG_MBPS', '45'))
        self.batch_size = int(env('BATCH_SIZE', '40'))
        self.max_attempts = int(env('MAX_ATTEMPTS', '4'))
        self.timeout = int(env('REQUEST_TIMEOUT_SEC', '1800'))
        self.backfill = env('BACKFILL', '0') == '1'
        self.stability_sec = int(env('STABILITY_SEC', '3'))
        self.dry_run = env('DRY_RUN', '0') == '1'
        # Set to 0 only if some OTHER process ever needs to consume this bot's updates —
        # Telegram allows a single getUpdates consumer per token (a second one gets 409).
        self.discover_chats = env('DISCOVER_CHATS', '1') == '1'

    def api(self, method):
        return '%s/bot%s/%s' % (self.api_base, self.token, method)


# ------------------------------------------------------------------------ routing

class Router:
    """Routes a segment to one or more groups.

    routes.json:
      {"routes": [
         {"id":"ahass",  "enabled":true, "scope":"camera", "cameraId":1441,
          "chatId":"-5510674082", "label":"Arsip Selatan AHASS"},
         {"id":"dander", "enabled":true, "scope":"area",   "areaId":2,
          "chatId":"-100...",     "label":"Arsip DS Dander"},
         {"id":"all",    "enabled":false,"scope":"all",    "chatId":"-100..."}
      ]}

    Specificity: camera (0) beats area (1) beats all (2). The most specific match
    does the real upload; any additional matching group gets a copyMessage, which
    reuses the already-uploaded file and costs no extra bandwidth.
    """

    SPECIFICITY = {'camera': 0, 'area': 1, 'all': 2}

    def __init__(self, path, default_chat_id, log):
        self.path = path
        self.default_chat_id = default_chat_id
        self.log = log
        self._mtime = None
        self.routes = []
        self.reload()

    def reload(self):
        try:
            mtime = os.path.getmtime(self.path)
        except OSError:
            if self.routes or self._mtime is None:
                self.log.warning('routes file %s not found — falling back to TG_CHAT_ID',
                                 self.path)
            self._mtime, self.routes = None, []
            return
        if mtime == self._mtime:
            return
        try:
            with open(self.path) as fh:
                data = json.load(fh)
        except (ValueError, OSError) as exc:
            self.log.error('routes file unreadable, keeping previous routes: %s', exc)
            return

        routes = []
        for raw in data.get('routes', []):
            if not raw.get('enabled', True):
                continue
            scope = raw.get('scope', 'all')
            if scope not in self.SPECIFICITY:
                self.log.error('route %s: unknown scope %r, ignored', raw.get('id'), scope)
                continue
            if not raw.get('chatId'):
                self.log.error('route %s: missing chatId, ignored', raw.get('id'))
                continue
            routes.append(raw)
        self.routes = routes
        self._mtime = mtime
        self.log.info('routes loaded: %d active', len(routes))

    def targets(self, camera_id, area_id):
        """Ordered, de-duplicated list of {chatId,label} — most specific first."""
        matched = []
        for r in self.routes:
            scope = r['scope']
            if scope == 'camera' and int(r.get('cameraId', -1)) == camera_id:
                matched.append((0, r))
            elif scope == 'area' and area_id is not None and int(r.get('areaId', -1)) == area_id:
                matched.append((1, r))
            elif scope == 'all':
                matched.append((2, r))
        matched.sort(key=lambda pair: pair[0])

        out, seen = [], set()
        for _, r in matched:
            chat = str(r['chatId'])
            if chat in seen:
                continue
            seen.add(chat)
            out.append({'chatId': chat, 'label': r.get('label') or r.get('id') or chat})

        if not out and self.default_chat_id:
            out.append({'chatId': str(self.default_chat_id), 'label': 'default'})
        return out


# ---------------------------------------------------------------- state (own DB)

def open_state(path):
    conn = sqlite3.connect(path, timeout=30)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('''CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY, value TEXT NOT NULL)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS uploaded (
        segment_id  INTEGER PRIMARY KEY,
        camera_id   INTEGER NOT NULL,
        filename    TEXT    NOT NULL,
        file_size   INTEGER NOT NULL,
        status      TEXT    NOT NULL,
        detail      TEXT,
        targets     TEXT,
        uploaded_at TEXT    NOT NULL DEFAULT (datetime('now')))''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_uploaded_status ON uploaded(status)')
    # Groups the bot has been added to, learned from Telegram itself — the admin UI reads this so
    # nobody has to copy a chat id by hand.
    conn.execute('''CREATE TABLE IF NOT EXISTS chats (
        chat_id       TEXT PRIMARY KEY,
        title         TEXT,
        type          TEXT,
        status        TEXT,
        can_send      INTEGER,
        discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')))''')
    conn.commit()
    return conn


def meta_get(state, key):
    row = state.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return row[0] if row else None


def meta_set(state, key, value):
    state.execute('INSERT INTO meta(key,value) VALUES(?,?) '
                  'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))
    state.commit()


def resolve_chat(state, chat_id):
    """Groups upgraded to supergroups get a new id; honour any recorded migration."""
    return meta_get(state, 'chat_migrate:%s' % chat_id) or chat_id


# ------------------------------------------------------ group discovery (my_chat_member)

def record_chat(state, chat, status=None, can_send=None):
    """Upsert one known chat. Fields absent from this update keep their stored value."""
    state.execute(
        '''INSERT INTO chats (chat_id, title, type, status, can_send)
           VALUES (?,?,?,?,?)
           ON CONFLICT(chat_id) DO UPDATE SET
             title      = COALESCE(excluded.title, chats.title),
             type       = COALESCE(excluded.type, chats.type),
             status     = COALESCE(excluded.status, chats.status),
             can_send   = COALESCE(excluded.can_send, chats.can_send),
             updated_at = datetime('now')''',
        (str(chat.get('id')), chat.get('title') or chat.get('username'),
         chat.get('type'), status, can_send))
    state.commit()


def refresh_chat(cfg, state, chat_id, log):
    """Ask Telegram for the current title and whether the bot may post files there."""
    try:
        resp = requests.post(cfg.api('getChat'), data={'chat_id': chat_id}, timeout=20)
        body = resp.json()
    except (requests.RequestException, ValueError) as exc:
        log.debug('refresh_chat %s failed: %s', chat_id, exc)
        return
    if not body.get('ok'):
        # left/kicked/deleted — keep the row so the UI can explain why it stopped working
        record_chat(state, {'id': chat_id}, status='unreachable')
        return
    result = body['result']
    permissions = result.get('permissions') or {}
    record_chat(state, result, status='member',
                can_send=0 if permissions.get('can_send_documents') is False else 1)


def seed_chats_from_routes(cfg, state, log):
    """Groups added before this poller existed never emitted my_chat_member, so resolve the ones
    already referenced by routes.json on start-up."""
    try:
        with open(cfg.routes_file) as fh:
            routes = json.load(fh).get('routes', [])
    except (OSError, ValueError):
        return
    for chat_id in {str(r.get('chatId')) for r in routes if r.get('chatId')}:
        refresh_chat(cfg, state, chat_id, log)


def handle_update(cfg, state, update, log):
    membership = update.get('my_chat_member')
    if membership:
        chat = membership.get('chat') or {}
        status = (membership.get('new_chat_member') or {}).get('status')
        record_chat(state, chat, status=status)
        log.info('grup %s (%s) -> %s', chat.get('title'), chat.get('id'), status)
        if status in ('member', 'administrator'):
            refresh_chat(cfg, state, chat.get('id'), log)
        return

    message = update.get('message') or update.get('channel_post')
    if message:
        chat = message.get('chat') or {}
        if chat.get('type') in ('group', 'supergroup', 'channel'):
            record_chat(state, chat)


def discovery_loop(cfg, log):
    """Long-polls getUpdates so a group becomes selectable in the admin UI the moment the bot is
    invited. Runs in its own thread with its own SQLite connection; a failure here must never take
    the uploader down. Only ONE consumer per bot token is allowed — nothing else polls this one."""
    state = open_state(cfg.state_db)
    seed_chats_from_routes(cfg, state, log)
    log.info('penemuan grup aktif (getUpdates long-poll)')

    while True:
        try:
            offset = int(meta_get(state, 'updates_offset') or 0)
            params = {
                'timeout': 25,
                'allowed_updates': json.dumps(['my_chat_member', 'message']),
            }
            if offset:
                params['offset'] = offset
            body = requests.get(cfg.api('getUpdates'), params=params, timeout=45).json()

            if not body.get('ok'):
                log.warning('getUpdates ditolak: %s', body.get('description'))
                time.sleep(30)
                continue

            for update in body.get('result', []):
                handle_update(cfg, state, update, log)
                meta_set(state, 'updates_offset', update['update_id'] + 1)
        except (requests.RequestException, ValueError) as exc:
            log.warning('penemuan grup: %s', exc)
            time.sleep(20)
        except sqlite3.Error as exc:
            log.error('penemuan grup (sqlite): %s', exc)
            time.sleep(30)


# ------------------------------------------------------------- app DB (READ-ONLY)

def open_app_db(path):
    # mode=ro is a hard guarantee we can never mutate the production database.
    conn = sqlite3.connect('file:%s?mode=ro' % path, uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def load_camera_meta(app_db):
    meta = {}
    rows = app_db.execute(
        'SELECT c.id, c.name, c.area_id, a.name AS area_name '
        'FROM cameras c LEFT JOIN areas a ON a.id = c.area_id')
    for row in rows:
        meta[row['id']] = {
            'name': row['name'],
            'area_id': row['area_id'],
            'area_name': row['area_name'] or '-',
        }
    return meta


def fetch_segments(app_db, after_id, limit):
    return app_db.execute(
        'SELECT id, camera_id, filename, file_path, file_size, start_time, end_time, duration '
        'FROM recording_segments WHERE id > ? ORDER BY id ASC LIMIT ?',
        (after_id, limit)).fetchall()


def max_segment_id(app_db):
    return app_db.execute('SELECT COALESCE(MAX(id), 0) FROM recording_segments').fetchone()[0]


# ------------------------------------------------------------------------ upload

def fmt_wib(iso_utc, time_only=False):
    """recording_segments stores ISO-8601 UTC (…Z). Render as WIB for the caption."""
    try:
        stamp = datetime.fromisoformat(iso_utc.replace('Z', '+00:00')).astimezone(WIB)
        return stamp.strftime('%H:%M' if time_only else '%d %b %Y %H:%M')
    except (ValueError, AttributeError):
        return iso_utc or '-'


def build_caption(seg, cam):
    return (
        '\U0001F4F9 %s\n'
        '\U0001F4CD %s\n'
        '\U0001F551 %s - %s WIB  (%s dtk)\n'
        '\U0001F4E6 %.1f MB  •  cam%s/%s'
    ) % (cam['name'], cam['area_name'],
         fmt_wib(seg['start_time']), fmt_wib(seg['end_time'], time_only=True), seg['duration'],
         seg['file_size'] / 1048576.0, seg['camera_id'], seg['filename'])


def is_stable(path, wait_sec):
    """Belt-and-braces: the app promotes segments with an atomic rename, but a
    cross-device fallback (copy) exists — never upload a file still growing."""
    try:
        first = os.path.getsize(path)
        time.sleep(wait_sec)
        return os.path.getsize(path) == first, first
    except OSError:
        return False, 0


def call(cfg, state, method, payload, log):
    """POST to the local Bot API. Handles 429 back-off and supergroup migration."""
    resp = requests.post(cfg.api(method), data=payload, timeout=cfg.timeout)
    try:
        body = resp.json()
    except ValueError:
        return False, None, 'non-JSON response: %s' % resp.text[:200]

    if body.get('ok'):
        return True, body['result'], None

    params = body.get('parameters') or {}
    desc = body.get('description', 'unknown error')

    if params.get('migrate_to_chat_id'):
        old, new = str(payload['chat_id']), str(params['migrate_to_chat_id'])
        meta_set(state, 'chat_migrate:%s' % old, new)
        log.warning('chat %s upgraded to supergroup %s — retrying', old, new)
        retry = dict(payload)
        retry['chat_id'] = new
        return call(cfg, state, method, retry, log)

    if params.get('retry_after'):
        wait = int(params['retry_after']) + 1
        log.warning('rate limited by Telegram, sleeping %ss', wait)
        time.sleep(wait)

    return False, None, '%s %s' % (resp.status_code, desc)


def send_document(cfg, state, chat_id, seg, caption, log):
    """In --local mode the Bot API server reads the file straight off disk, so we
    pass a reference instead of a multipart copy of ~200 MB.

    It must be a file:// URI — a bare absolute path is parsed as an HTTP URL and
    rejected with "invalid file HTTP URL specified: URL host is empty".
    """
    return call(cfg, state, 'sendDocument', {
        'chat_id': resolve_chat(state, chat_id),
        'document': 'file://' + seg['file_path'],
        'caption': caption,
        'disable_notification': True,
        'disable_content_type_detection': True,
    }, log)


def copy_to(cfg, state, chat_id, from_chat_id, message_id, log):
    """Mirror an already-uploaded segment into another group. Telegram reuses the
    stored file, so a second group costs zero extra upload bandwidth."""
    return call(cfg, state, 'copyMessage', {
        'chat_id': resolve_chat(state, chat_id),
        'from_chat_id': resolve_chat(state, from_chat_id),
        'message_id': message_id,
        'disable_notification': True,
    }, log)


def record(state, seg, status, detail=None, targets=None):
    state.execute(
        'INSERT OR REPLACE INTO uploaded'
        '(segment_id,camera_id,filename,file_size,status,detail,targets,uploaded_at) '
        "VALUES(?,?,?,?,?,?,?,datetime('now'))",
        (seg['id'], seg['camera_id'], seg['filename'], seg['file_size'],
         status, detail, json.dumps(targets) if targets else None))
    state.commit()


def pace(cfg, size_bytes, elapsed, log):
    """Bound the LONG-RUN average egress by sleeping between files.

    Be clear about what this does not do: the sleep happens *after* a transfer, so the transfer
    itself always runs at full line rate. It therefore does nothing to soften a burst against live
    streaming — its only real job is stopping a backfill (or a long catch-up) from running flat out
    for hours. Set it above the observed per-file rate or it fires on every single file: at 14 Mbps
    against a measured 41.5 Mbps transfer rate it slept 4775 s out of 7210 s, delaying archives 66%
    for no benefit.
    """
    if cfg.max_mbps <= 0:
        return
    sleep_for = size_bytes * 8 / (cfg.max_mbps * 1e6) - elapsed
    if sleep_for > 0:
        log.debug('pacing: sleeping %.0fs to hold %.0f Mbps average', sleep_for, cfg.max_mbps)
        time.sleep(sleep_for)


# -------------------------------------------------------------------------- main

def process_one(cfg, state, router, seg, cam_meta, log):
    """Returns True when the watermark may advance past this segment."""
    cam = cam_meta.get(seg['camera_id']) or {
        'name': 'camera%s' % seg['camera_id'], 'area_id': None, 'area_name': '-'}

    targets = router.targets(seg['camera_id'], cam['area_id'])
    if not targets:
        record(state, seg, 'no_route', 'no group configured for this camera/area')
        return True

    path = seg['file_path']
    if not os.path.isfile(path):
        record(state, seg, 'missing', 'file gone (retention cleanup?)')
        log.info('seg %s cam%s: file gone, skipping', seg['id'], seg['camera_id'])
        return True

    stable, size = is_stable(path, cfg.stability_sec)
    if not stable:
        log.info('seg %s: still growing, retry next poll', seg['id'])
        return False

    if size > cfg.max_file_mb * 1048576:
        record(state, seg, 'too_big', '%d bytes > MAX_FILE_MB' % size)
        log.warning('seg %s cam%s: %.1f MB exceeds limit, skipping',
                    seg['id'], seg['camera_id'], size / 1048576.0)
        return True

    caption = build_caption(seg, cam)
    primary = targets[0]

    if cfg.dry_run:
        log.info('[dry-run] seg %s %s (%s, %.1f MB) -> %s',
                 seg['id'], seg['filename'], cam['name'], size / 1048576.0,
                 ', '.join('%s(%s)' % (t['label'], t['chatId']) for t in targets))
        record(state, seg, 'dry_run', None, targets)
        return True

    err = None
    for attempt in range(1, cfg.max_attempts + 1):
        started = time.time()
        ok, result, err = send_document(cfg, state, primary['chatId'], seg, caption, log)
        elapsed = max(time.time() - started, 0.001)
        if ok:
            log.info('seg %s cam%s %s -> %s (%.1f MB in %.0fs, %.1f Mbps)',
                     seg['id'], seg['camera_id'], seg['filename'], primary['label'],
                     size / 1048576.0, elapsed, size * 8 / elapsed / 1e6)
            sent = [{'chatId': primary['chatId'], 'label': primary['label'],
                     'messageId': result.get('message_id')}]

            # extra groups: copy, never re-upload
            for extra in targets[1:]:
                ok2, res2, err2 = copy_to(cfg, state, extra['chatId'],
                                          primary['chatId'], result['message_id'], log)
                if ok2:
                    sent.append({'chatId': extra['chatId'], 'label': extra['label'],
                                 'messageId': res2.get('message_id')})
                else:
                    log.warning('seg %s copy to %s failed: %s', seg['id'], extra['label'], err2)

            record(state, seg, 'ok', None, sent)
            pace(cfg, size, elapsed, log)
            return True

        log.warning('seg %s upload attempt %s/%s failed: %s',
                    seg['id'], attempt, cfg.max_attempts, err)
        if attempt < cfg.max_attempts:
            time.sleep(min(30 * attempt, 180))

    # Give up on this one rather than wedging the queue behind it forever.
    record(state, seg, 'failed', err, targets)
    log.error('seg %s cam%s permanently failed, advancing past it', seg['id'], seg['camera_id'])
    return True


def run(cfg, log):
    state = open_state(cfg.state_db)
    app_db = open_app_db(cfg.app_db)
    router = Router(cfg.routes_file, cfg.default_chat_id, log)

    watermark = meta_get(state, 'last_segment_id')
    if watermark is None:
        start = 0 if cfg.backfill else max_segment_id(app_db)
        meta_set(state, 'last_segment_id', start)
        watermark = start
        log.info('first run: watermark set to %s (%s)', start,
                 'full backfill' if cfg.backfill else 'new segments only')
    watermark = int(watermark)

    cam_meta = load_camera_meta(app_db)
    refreshed = time.time()
    log.info('started: watermark=%s routes=%d cap=%.0f Mbps',
             watermark, len(router.routes), cfg.max_mbps)

    if cfg.discover_chats:
        threading.Thread(target=discovery_loop, args=(cfg, log),
                         name='chat-discovery', daemon=True).start()

    while True:
        try:
            if time.time() - refreshed > 900:
                cam_meta = load_camera_meta(app_db)
                refreshed = time.time()
            router.reload()   # picks up routes.json edits without a restart

            rows = fetch_segments(app_db, watermark, cfg.batch_size)
            if not rows:
                time.sleep(cfg.poll_interval)
                continue

            for seg in rows:
                if not process_one(cfg, state, router, seg, cam_meta, log):
                    break   # not ready yet — stop, keep order, retry next poll
                watermark = seg['id']
                meta_set(state, 'last_segment_id', watermark)
        except sqlite3.Error as exc:
            log.error('sqlite error: %s', exc)
            time.sleep(30)
        except requests.RequestException as exc:
            log.error('network error: %s', exc)
            time.sleep(30)
        except KeyboardInterrupt:
            log.info('shutting down')
            return


# ---------------------------------------------------------------------- cli extras

def cmd_discover_chat(cfg, log):
    resp = requests.get(cfg.api('getUpdates'), timeout=30)
    body = resp.json()
    if not body.get('ok'):
        log.error('getUpdates failed: %s', body.get('description'))
        return
    seen = {}
    for upd in body.get('result', []):
        msg = upd.get('message') or upd.get('channel_post') or {}
        chat = msg.get('chat') or {}
        if chat.get('id'):
            seen[chat['id']] = '%s (%s)' % (
                chat.get('title') or chat.get('username') or '-', chat.get('type'))
    if not seen:
        print('No chats seen yet. Add the bot to the group, then send /start@<botusername>')
    for cid, label in seen.items():
        print('chatId=%s   %s' % (cid, label))


def cmd_routes(cfg, log):
    app_db = open_app_db(cfg.app_db)
    router = Router(cfg.routes_file, cfg.default_chat_id, log)
    cam_meta = load_camera_meta(app_db)
    rows = app_db.execute(
        'SELECT id FROM cameras WHERE enable_recording=1 ORDER BY area_id, id')
    print('%-6s %-38s %-16s %s' % ('CAM', 'NAME', 'AREA', 'GROUPS'))
    for row in rows:
        cam = cam_meta[row['id']]
        targets = router.targets(row['id'], cam['area_id'])
        label = ', '.join('%s(%s)' % (t['label'], t['chatId']) for t in targets) or '-- none --'
        print('%-6s %-38s %-16s %s' % (row['id'], cam['name'][:38], cam['area_name'][:16], label))


def cmd_chats(cfg):
    state = open_state(cfg.state_db)
    rows = state.execute(
        'SELECT chat_id, title, type, status, can_send, updated_at '
        'FROM chats ORDER BY title').fetchall()
    if not rows:
        print('Belum ada grup terdeteksi. Tambahkan bot ke grup — datanya masuk otomatis.')
        return
    print('%-16s %-34s %-8s %-12s %s' % ('CHAT_ID', 'JUDUL', 'TIPE', 'STATUS', 'BISA KIRIM'))
    for chat_id, title, ctype, status, can_send, _ in rows:
        can = '-' if can_send is None else ('ya' if can_send else 'TIDAK')
        print('%-16s %-34s %-8s %-12s %s' % (chat_id, (title or '-')[:34], ctype or '-',
                                             status or '-', can))


def cmd_status(cfg):
    state = open_state(cfg.state_db)
    print('watermark:', meta_get(state, 'last_segment_id'))
    rows = state.execute(
        'SELECT status, COUNT(*), ROUND(COALESCE(SUM(file_size),0)/1073741824.0,2) '
        'FROM uploaded GROUP BY status ORDER BY 2 DESC').fetchall()
    if not rows:
        print('  (nothing processed yet)')
    for status, count, gb in rows:
        print('  %-9s %6d files  %s GB' % (status, count, gb))
    recent = state.execute(
        'SELECT segment_id,camera_id,filename,status,uploaded_at FROM uploaded '
        'ORDER BY segment_id DESC LIMIT 8').fetchall()
    if recent:
        print('\n  recent:')
        for r in recent:
            print('    seg %-8s cam%-6s %-24s %-8s %s' % r)


def main():
    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s %(levelname)s %(message)s',
                        stream=sys.stdout)
    log = logging.getLogger('tg-archive')
    cfg = Config()

    if '--routes' in sys.argv:
        return cmd_routes(cfg, log)
    if '--status' in sys.argv:
        return cmd_status(cfg)
    if '--chats' in sys.argv:
        return cmd_chats(cfg)

    if not cfg.token:
        sys.exit('FATAL: TG_BOT_TOKEN is required (set it in /opt/tg-archive/.env)')
    if '--discover-chat' in sys.argv:
        return cmd_discover_chat(cfg, log)
    run(cfg, log)


if __name__ == '__main__':
    main()
