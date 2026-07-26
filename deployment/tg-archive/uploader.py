#!/usr/bin/env python3
# Purpose: Upload finalized 10-minute CCTV recording segments to a Telegram group
#          via a self-hosted local Bot API server (2000 MB limit, not the cloud 50 MB).
# Caller:  systemd unit tg-archive.service (long-running loop).
# Deps:    stdlib + requests. Reads the app DB READ-ONLY; own state in state.db.
# SideEffects: network upload to Telegram; writes only to its own state.db.

import os
import sys
import time
import json
import sqlite3
import logging
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
        self.api_base = env('TG_API_BASE', 'http://127.0.0.1:8081').rstrip('/')
        self.token = env('TG_BOT_TOKEN', required=True)
        self.chat_id = env('TG_CHAT_ID', required=True)
        self.app_db = env('APP_DB', '/var/www/rafnet-cctv/backend/data/cctv.db')
        self.state_db = env('STATE_DB', '/opt/tg-archive/state.db')
        raw_ids = (env('CAMERA_IDS', '') or '').strip()
        self.camera_ids = set(int(x) for x in raw_ids.split(',') if x.strip()) if raw_ids else None
        self.poll_interval = int(env('POLL_INTERVAL_SEC', '60'))
        self.max_file_mb = int(env('MAX_FILE_MB', '1900'))
        self.max_mbps = float(env('MAX_AVG_MBPS', '14'))
        self.batch_size = int(env('BATCH_SIZE', '40'))
        self.max_attempts = int(env('MAX_ATTEMPTS', '4'))
        self.timeout = int(env('REQUEST_TIMEOUT_SEC', '1800'))
        self.backfill = env('BACKFILL', '0') == '1'
        self.stability_sec = int(env('STABILITY_SEC', '3'))
        self.dry_run = env('DRY_RUN', '0') == '1'

    def api(self, method):
        return '%s/bot%s/%s' % (self.api_base, self.token, method)


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
        message_id  INTEGER,
        uploaded_at TEXT    NOT NULL DEFAULT (datetime('now')))''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_uploaded_status ON uploaded(status)')
    conn.commit()
    return conn


def meta_get(state, key):
    row = state.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return row[0] if row else None


def meta_set(state, key, value):
    state.execute('INSERT INTO meta(key,value) VALUES(?,?) '
                  'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))
    state.commit()


# ------------------------------------------------------------- app DB (READ-ONLY)

def open_app_db(path):
    # mode=ro is a hard guarantee we can never mutate the production database.
    conn = sqlite3.connect('file:%s?mode=ro' % path, uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def load_camera_names(app_db):
    names = {}
    for row in app_db.execute('SELECT id, name FROM cameras'):
        names[row['id']] = row['name']
    return names


def fetch_segments(app_db, after_id, limit):
    return app_db.execute(
        'SELECT id, camera_id, filename, file_path, file_size, start_time, end_time, duration '
        'FROM recording_segments WHERE id > ? ORDER BY id ASC LIMIT ?',
        (after_id, limit)).fetchall()


def max_segment_id(app_db):
    row = app_db.execute('SELECT COALESCE(MAX(id), 0) FROM recording_segments').fetchone()
    return row[0]


# ------------------------------------------------------------------------ upload

def fmt_wib(iso_utc):
    """recording_segments stores ISO-8601 UTC (…Z). Render as WIB for the caption."""
    try:
        cleaned = iso_utc.replace('Z', '+00:00')
        return datetime.fromisoformat(cleaned).astimezone(WIB).strftime('%d %b %Y %H:%M')
    except (ValueError, AttributeError):
        return iso_utc or '-'


def build_caption(seg, camera_name):
    size_mb = seg['file_size'] / 1048576.0
    return (
        '\U0001F4F9 %s\n'
        '\U0001F551 %s - %s WIB\n'
        '⏱ %s detik  •  \U0001F4E6 %.1f MB\n'
        '\U0001F5C2 cam%s / %s'
    ) % (camera_name, fmt_wib(seg['start_time']), fmt_wib(seg['end_time'])[-5:],
         seg['duration'], size_mb, seg['camera_id'], seg['filename'])


def is_stable(path, wait_sec):
    """Belt-and-braces: the app promotes segments with an atomic rename, but a
    cross-device fallback (copy) exists — never upload a file still growing."""
    try:
        first = os.path.getsize(path)
        time.sleep(wait_sec)
        return os.path.getsize(path) == first, first
    except OSError:
        return False, 0


def send_document(cfg, seg, caption, log):
    """In --local mode the Bot API server reads the file straight off disk, so we
    pass the absolute path as a plain form value — no multipart copy of ~200 MB."""
    payload = {
        'chat_id': cfg.chat_id,
        'document': seg['file_path'],
        'caption': caption,
        'disable_notification': True,
        'disable_content_type_detection': True,
    }
    resp = requests.post(cfg.api('sendDocument'), data=payload, timeout=cfg.timeout)
    try:
        body = resp.json()
    except ValueError:
        body = {'ok': False, 'description': 'non-JSON response: %s' % resp.text[:200]}

    if body.get('ok'):
        return True, body['result'].get('message_id'), None

    desc = body.get('description', 'unknown error')
    retry_after = (body.get('parameters') or {}).get('retry_after')
    if retry_after:
        log.warning('rate limited, sleeping %ss', retry_after)
        time.sleep(int(retry_after) + 1)
    return False, None, '%s %s' % (resp.status_code, desc)


def record(state, seg, status, detail=None, message_id=None):
    state.execute(
        'INSERT OR REPLACE INTO uploaded'
        '(segment_id,camera_id,filename,file_size,status,detail,message_id,uploaded_at) '
        "VALUES(?,?,?,?,?,?,?,datetime('now'))",
        (seg['id'], seg['camera_id'], seg['filename'], seg['file_size'],
         status, detail, message_id))
    state.commit()


# -------------------------------------------------------------------------- main

def process_one(cfg, state, seg, camera_names, log):
    """Returns True when the watermark may advance past this segment."""
    if cfg.camera_ids is not None and seg['camera_id'] not in cfg.camera_ids:
        record(state, seg, 'skipped', 'camera not in CAMERA_IDS')
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

    name = camera_names.get(seg['camera_id'], 'camera%s' % seg['camera_id'])
    caption = build_caption(seg, name)

    if cfg.dry_run:
        log.info('[dry-run] would upload seg %s cam%s %s (%.1f MB)',
                 seg['id'], seg['camera_id'], seg['filename'], size / 1048576.0)
        record(state, seg, 'dry_run', None)
        return True

    for attempt in range(1, cfg.max_attempts + 1):
        started = time.time()
        ok, message_id, err = send_document(cfg, seg, caption, log)
        elapsed = max(time.time() - started, 0.001)
        if ok:
            mbps = size * 8 / elapsed / 1e6
            log.info('seg %s cam%s %s uploaded (%.1f MB in %.0fs, %.1f Mbps)',
                     seg['id'], seg['camera_id'], seg['filename'],
                     size / 1048576.0, elapsed, mbps)
            record(state, seg, 'ok', None, message_id)
            pace(cfg, size, elapsed, log)
            return True
        log.warning('seg %s upload attempt %s/%s failed: %s',
                    seg['id'], attempt, cfg.max_attempts, err)
        if attempt < cfg.max_attempts:
            time.sleep(min(30 * attempt, 180))

    # Give up on this one rather than wedging the queue behind it forever.
    record(state, seg, 'failed', err)
    log.error('seg %s cam%s permanently failed, advancing past it', seg['id'], seg['camera_id'])
    return True


def pace(cfg, size_bytes, elapsed, log):
    """Cap the *average* egress so archiving never starves live streaming.
    Uplink measured at ~25 Mbps; default target 14 Mbps average."""
    if cfg.max_mbps <= 0:
        return
    needed = size_bytes * 8 / (cfg.max_mbps * 1e6)
    sleep_for = needed - elapsed
    if sleep_for > 0:
        log.debug('pacing: sleeping %.0fs to hold %.0f Mbps average', sleep_for, cfg.max_mbps)
        time.sleep(sleep_for)


def run(cfg, log):
    state = open_state(cfg.state_db)
    app_db = open_app_db(cfg.app_db)

    watermark = meta_get(state, 'last_segment_id')
    if watermark is None:
        start = 0 if cfg.backfill else max_segment_id(app_db)
        meta_set(state, 'last_segment_id', start)
        watermark = start
        log.info('first run: watermark set to %s (%s)', start,
                 'full backfill' if cfg.backfill else 'new segments only')
    watermark = int(watermark)

    camera_names = load_camera_names(app_db)
    names_refreshed = time.time()
    log.info('started: chat=%s cameras=%s watermark=%s cap=%.0f Mbps',
             cfg.chat_id, sorted(cfg.camera_ids) if cfg.camera_ids else 'ALL',
             watermark, cfg.max_mbps)

    while True:
        try:
            if time.time() - names_refreshed > 900:
                camera_names = load_camera_names(app_db)
                names_refreshed = time.time()

            rows = fetch_segments(app_db, watermark, cfg.batch_size)
            if not rows:
                time.sleep(cfg.poll_interval)
                continue

            for seg in rows:
                if not process_one(cfg, state, seg, camera_names, log):
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


def discover_chat(cfg, log):
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
            seen[chat['id']] = '%s (%s)' % (chat.get('title') or chat.get('username') or '-',
                                            chat.get('type'))
    if not seen:
        print('No chats seen yet. Add the bot to the group, then send: /start@<botusername>')
    for cid, label in seen.items():
        print('TG_CHAT_ID=%s   %s' % (cid, label))


def main():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(message)s',
        stream=sys.stdout)
    log = logging.getLogger('tg-archive')
    cfg = Config()

    if '--discover-chat' in sys.argv:
        discover_chat(cfg, log)
        return
    if '--status' in sys.argv:
        state = open_state(cfg.state_db)
        rows = state.execute(
            'SELECT status, COUNT(*), ROUND(SUM(file_size)/1073741824.0,2) '
            'FROM uploaded GROUP BY status').fetchall()
        print('watermark:', meta_get(state, 'last_segment_id'))
        for status, count, gb in rows:
            print('  %-9s %6d files  %s GB' % (status, count, gb))
        return

    run(cfg, log)


if __name__ == '__main__':
    main()
