#!/usr/bin/env python3
# Purpose: Upload finalized 10-minute CCTV recording segments to Telegram groups
#          via a self-hosted local Bot API server (2000 MB limit, not the cloud 50 MB),
#          routed per-camera / per-area so one group never mixes sources.
# Caller:  systemd unit tg-archive.service (long-running loop).
# Deps:    stdlib + requests. Reads recording segments from the app DB; own state in state.db.
# SideEffects: network upload to Telegram; writes state.db, and MIRRORS each outcome into the app
#          DB table telegram_archive_uploads so the admin archive page reads its own data instead
#          of opening this sidecar's state.db across processes. The mirror is best-effort: it can
#          never fail an upload (see mirror_to_app_db).

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


def parse_cutoff(raw):
    """
    ARCHIVE_MIN_RECORDED_AT -> aware datetime, or None when unset.

    Exits rather than silently ignoring a malformed value: a cutoff that quietly
    does nothing would let exactly the flood it was set to stop back through.
    """
    raw = (raw or '').strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        sys.exit('FATAL: ARCHIVE_MIN_RECORDED_AT=%r is not ISO-8601 (e.g. 2026-07-27T22:00:00Z)' % raw)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


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
        # Periodic re-attempt of transiently-failed uploads (bot kicked from a group, long 5xx,
        # etc.). Without it the watermark advances past a failure forever and the footage is lost
        # once local retention deletes it. 0 disables. (Audit v1.2.0, A-01.)
        self.retry_interval = int(env('RETRY_INTERVAL_SEC', '900'))
        self.retry_batch = int(env('RETRY_BATCH', '20'))
        self.timeout = int(env('REQUEST_TIMEOUT_SEC', '1800'))
        self.backfill = env('BACKFILL', '0') == '1'
        self.stability_sec = int(env('STABILITY_SEC', '3'))
        # Stale-salvage filter. A recording incident leaves thousands of corrupt
        # partials behind; the recovery pipeline rescues a few seconds out of each,
        # registers them as segments, and they land here HOURS later — burying the
        # archive group under 6-60 second clips that arrive after newer footage.
        #
        # Duration alone is NOT a safe test: measured over 390 real uploads, 24 of
        # them were legitimately short (a flaky camera reconnecting) and those are
        # exactly the clips an operator wants. What separates them is AGE, not length
        # — every legitimate short segment reached here within 0.07-0.60h of being
        # recorded, while salvage fragments are many hours old.
        #
        # So both conditions must hold before we skip. Set MIN_DURATION_SEC=0 to
        # disable the filter entirely.
        self.min_duration_sec = int(env('MIN_DURATION_SEC', '120'))
        self.stale_hours = float(env('STALE_HOURS', '2'))
        # Ceiling on how late a segment may arrive and still be archived, whatever
        # its length. The archive's value is chronological order; a clip landing
        # hours after it was recorded breaks that permanently. Doubles as the
        # tolerance for an uploader outage — set it above the longest downtime you
        # would still want backfilled. 0 disables.
        self.max_late_hours = float(env('MAX_LATE_HOURS', '12'))
        # Hard cutoff: never archive anything recorded before this instant.
        # Surgical tool for excluding a known-bad window (e.g. a recording incident)
        # without loosening the tolerance rules. Empty = no cutoff.
        self.min_recorded_at = parse_cutoff(env('ARCHIVE_MIN_RECORDED_AT', ''))
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


# Telegram's CLOUD API reports throttling as a structured `parameters.retry_after`. The
# self-hosted Bot API server does not: it answers HTTP 400 with the hint buried in the
# description text ("too Many Requests: retry after 8"). In --local mode — the only mode
# this sidecar runs in — the structured field is therefore always absent, the purpose-built
# back-off below never fired once, and every throttle fell through to the caller's generic
# 30/60/90s ladder. Measured on prod 2026-07-31: 15 throttles in 30 minutes, each paying
# 30s for a documented 8s request, burning ~25% of wall-clock during a backfill.
RETRY_AFTER_RE = re.compile(r'retry after (\d+)', re.IGNORECASE)

# Prefix on the returned error telling the caller the mandated wait has ALREADY been served
# inside call(), so it must not stack its own back-off on top.
RATE_LIMITED = 'RATE_LIMITED'


def retry_after_seconds(params, description):
    """Seconds Telegram asked us to wait, from the structured field or the description."""
    value = params.get('retry_after')
    if value is None:
        match = RETRY_AFTER_RE.search(description or '')
        value = match.group(1) if match else None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


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

    wait_for = retry_after_seconds(params, desc)
    if wait_for is not None:
        wait = wait_for + 1
        log.warning('rate limited by Telegram, sleeping %ss', wait)
        time.sleep(wait)
        return False, None, '%s %s %s' % (RATE_LIMITED, resp.status_code, desc)

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


def record(state, seg, status, detail=None, targets=None, cfg=None, log=None):
    payload = json.dumps(targets) if targets else None
    state.execute(
        'INSERT OR REPLACE INTO uploaded'
        '(segment_id,camera_id,filename,file_size,status,detail,targets,uploaded_at) '
        "VALUES(?,?,?,?,?,?,?,datetime('now'))",
        (seg['id'], seg['camera_id'], seg['filename'], seg['file_size'],
         status, detail, payload))
    state.commit()
    if cfg is not None:
        mirror_to_app_db(cfg, seg, status, detail, targets, payload, log)


def mirror_to_app_db(cfg, seg, status, detail, targets, payload, log=None):
    """Mirror the outcome into the APPLICATION database.

    The uploader stays a separate process on purpose (see sidecar/.module_map.md), but its data
    should not be foreign: the admin archive page reads telegram_archive_uploads with an ordinary
    query and can join it against cameras/areas, instead of the backend opening this sidecar's
    state.db read-only across processes while it is mid-WAL-write.

    Deliberately a MIRROR, not a move: state.db stays the uploader's own source of truth, so a
    write failure here can never cost an upload or cause one to be retried. Rows are tiny and rare
    (~15/hour), so the extra connection costs nothing.
    """
    # NOTE: `seg` is a sqlite3.Row — it indexes like a dict but has NO .get(). Its SELECT always
    # includes start_time, so ['start_time'] is safe. `targets` entries ARE plain dicts.
    file_id = None
    if targets:
        file_id = (targets[0] or {}).get('fileId')
    conn = None
    try:
        conn = sqlite3.connect(cfg.app_db, timeout=30)
        conn.execute('PRAGMA busy_timeout=5000')
        conn.execute(
            'INSERT OR REPLACE INTO telegram_archive_uploads'
            '(segment_id,camera_id,filename,file_size,status,detail,targets,file_id,'
            ' recorded_at,recorded_until,duration_seconds,uploaded_at) '
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))",
            (seg['id'], seg['camera_id'], seg['filename'], seg['file_size'],
             status, detail, payload, file_id,
             seg['start_time'], seg['end_time'], seg['duration']))
        conn.commit()
    except Exception as exc:  # noqa: BLE001 - never let bookkeeping break an upload
        if log:
            log.warning('mirror to app db failed for seg %s: %s', seg['id'], exc)
    finally:
        if conn is not None:
            conn.close()


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

def parse_recorded_at(seg):
    """recording_segments.start_time is ISO-8601 UTC. None when unparseable."""
    try:
        return datetime.fromisoformat(str(seg['start_time']).replace('Z', '+00:00'))
    except (ValueError, AttributeError, TypeError):
        return None


def skip_reason(seg, cfg, now=None):
    """
    Why this segment should NOT be archived, or None to archive it.

    THE ARCHIVE IS A LIVE MIRROR, NOT A BACKFILL TOOL. Its value comes from the
    group reading in recording order. A clip that lands hours after it was recorded
    breaks that ordering permanently, and no amount of correct content makes up for
    an archive you can no longer scroll chronologically.

    That matters because of how recovery works: after a recording incident the
    pipeline rescues fragments out of corrupt partials and registers them as NEW
    segments — new ids, old recording times — so they upload after newer footage.
    Measured after the 2026-07-27 incident: 161 short fragments plus 25 mid-length
    ones, with 1749 partials still queued to produce more.

    Three rules, cheapest first. All are opt-out.
    """
    now = now or datetime.now(timezone.utc)
    recorded = parse_recorded_at(seg)

    # 1. Hard cutoff. Excludes a known-bad window outright, without touching the
    #    tolerance rules below. This is the surgical tool for "we had an incident on
    #    date X, never archive anything from before it".
    if cfg.min_recorded_at and recorded and recorded < cfg.min_recorded_at:
        return ('before_cutoff',
                'recorded %s, before ARCHIVE_MIN_RECORDED_AT=%s'
                % (seg['start_time'], cfg.min_recorded_at.isoformat()))

    if recorded is None:
        # Cannot prove anything about an unparseable timestamp — archive it.
        return None

    age_hours = (now - recorded).total_seconds() / 3600.0

    # 2. Too late to be worth ordering. Catches salvage of ANY length, which rule 3
    #    misses — the incident produced 25 clips of 2-9 minutes that passed a
    #    length-based test and still arrived out of order.
    #    Set generously: it doubles as the tolerance for an uploader outage, since
    #    anything recorded while the uploader was down ages exactly the same way.
    if cfg.max_late_hours > 0 and age_hours > cfg.max_late_hours:
        return ('too_late',
                'recorded %s (%.1fh ago) — older than MAX_LATE_HOURS=%s'
                % (seg['start_time'], age_hours, cfg.max_late_hours))

    # 3. Short AND stale. Catches salvage early, before rule 2's generous window is
    #    reached. Both conditions are required: measured across 390 real uploads, 24
    #    were legitimately short (a flaky camera reconnecting) and every one reached
    #    the uploader within 0.07-0.60h, so age separates them cleanly while length
    #    alone would have discarded real footage.
    duration = seg['duration']
    if (cfg.min_duration_sec > 0 and duration is not None
            and duration < cfg.min_duration_sec and age_hours > cfg.stale_hours):
        return ('stale_salvage',
                '%ss clip recorded %s (%.1fh ago) — below MIN_DURATION_SEC=%s and older than STALE_HOURS=%s'
                % (duration, seg['start_time'], age_hours, cfg.min_duration_sec, cfg.stale_hours))

    return None


def process_one(cfg, state, router, seg, cam_meta, log):
    """Returns True when the watermark may advance past this segment."""
    cam = cam_meta.get(seg['camera_id']) or {
        'name': 'camera%s' % seg['camera_id'], 'area_id': None, 'area_name': '-'}

    targets = router.targets(seg['camera_id'], cam['area_id'])
    if not targets:
        record(state, seg, 'no_route', 'no group configured for this camera/area', cfg=cfg, log=log)
        return True

    # Checked before touching the disk: this is the cheap way out of a salvage flood.
    skip = skip_reason(seg, cfg)
    if skip:
        status, detail = skip
        record(state, seg, status, detail, cfg=cfg, log=log)
        log.info('seg %s cam%s %s: %s (%ss), not archiving',
                 seg['id'], seg['camera_id'], seg['filename'], status, seg['duration'])
        return True

    path = seg['file_path']
    if not os.path.isfile(path):
        record(state, seg, 'missing', 'file gone (retention cleanup?)', cfg=cfg, log=log)
        log.info('seg %s cam%s: file gone, skipping', seg['id'], seg['camera_id'])
        return True

    stable, size = is_stable(path, cfg.stability_sec)
    if not stable:
        log.info('seg %s: still growing, retry next poll', seg['id'])
        return False

    if size > cfg.max_file_mb * 1048576:
        record(state, seg, 'too_big', '%d bytes > MAX_FILE_MB' % size, cfg=cfg, log=log)
        log.warning('seg %s cam%s: %.1f MB exceeds limit, skipping',
                    seg['id'], seg['camera_id'], size / 1048576.0)
        return True

    caption = build_caption(seg, cam)
    primary = targets[0]

    if cfg.dry_run:
        log.info('[dry-run] seg %s %s (%s, %.1f MB) -> %s',
                 seg['id'], seg['filename'], cam['name'], size / 1048576.0,
                 ', '.join('%s(%s)' % (t['label'], t['chatId']) for t in targets))
        record(state, seg, 'dry_run', None, targets, cfg=cfg, log=log)
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
            # file_id is what the web archive needs: Bot API cannot fetch a file from a
            # message_id — getFile takes a file_id, and it arrives right here in the same
            # sendDocument response. Copies into extra groups reuse this same stored file,
            # so ONE file_id per segment is enough however many groups it landed in.
            document = result.get('document') or {}
            sent = [{'chatId': primary['chatId'], 'label': primary['label'],
                     'messageId': result.get('message_id'),
                     'fileId': document.get('file_id'),
                     'fileUniqueId': document.get('file_unique_id')}]

            # extra groups: copy, never re-upload
            for extra in targets[1:]:
                ok2, res2, err2 = copy_to(cfg, state, extra['chatId'],
                                          primary['chatId'], result['message_id'], log)
                if ok2:
                    sent.append({'chatId': extra['chatId'], 'label': extra['label'],
                                 'messageId': res2.get('message_id')})
                else:
                    log.warning('seg %s copy to %s failed: %s', seg['id'], extra['label'], err2)

            record(state, seg, 'ok', None, sent, cfg=cfg, log=log)
            pace(cfg, size, elapsed, log)
            return True

        log.warning('seg %s upload attempt %s/%s failed: %s',
                    seg['id'], attempt, cfg.max_attempts, err)
        if attempt < cfg.max_attempts:
            # A throttle has already been waited out inside call(), for exactly as long as
            # Telegram asked. Stacking the generic ladder on top would triple an 8s wait.
            if not (err or '').startswith(RATE_LIMITED):
                time.sleep(min(30 * attempt, 180))

    # Give up on this one rather than wedging the queue behind it forever.
    record(state, seg, 'failed', err, targets, cfg=cfg, log=log)
    log.error('seg %s cam%s permanently failed, advancing past it', seg['id'], seg['camera_id'])
    return True


def retry_failed(cfg, state, app_db, router, cam_meta, log):
    """Re-attempt segments that hit a TRANSIENT terminal failure ('failed') and may still be on disk.
    The main loop advances the watermark past a failure so the queue never wedges, but that means a
    segment that failed while the bot was (say) removed from its group is otherwise NEVER retried —
    and footage sold as deep archive is lost once local retention deletes it. 'too_big'/'too_late'/
    'missing'/'no_route' are deliberately NOT retried: re-attempting cannot change their outcome.
    Reads app_db (mode=ro) only; all writes go to the state DB. (Audit v1.2.0, A-01.)"""
    rows = state.execute(
        "SELECT segment_id FROM uploaded WHERE status = 'failed' ORDER BY segment_id ASC LIMIT ?",
        (cfg.retry_batch,)).fetchall()
    if not rows:
        return 0
    ids = [r[0] for r in rows]
    placeholders = ','.join('?' * len(ids))
    segs = app_db.execute(
        'SELECT id, camera_id, filename, file_path, file_size, start_time, end_time, duration '
        'FROM recording_segments WHERE id IN (%s)' % placeholders, ids).fetchall()
    by_id = {seg['id']: seg for seg in segs}

    # A failed row whose recording_segments row is gone can never be retried — retire it so it stops
    # crowding the oldest-first retry window. It is marked 'expired' (NEVER 'ok'), so nothing mistakes
    # it for archived footage.
    gone = [i for i in ids if i not in by_id]
    if gone:
        state.executemany(
            "UPDATE uploaded SET status='expired', "
            "detail='segment row gone (retention); cannot retry' WHERE segment_id = ?",
            [(i,) for i in gone])
        state.commit()
        log.warning('retry: %d failed segment(s) expired (no longer on the box)', len(gone))

    retried = ok = 0
    for i in ids:
        seg = by_id.get(i)
        if seg is None:
            continue
        retried += 1
        process_one(cfg, state, router, seg, cam_meta, log)
        after = state.execute(
            'SELECT status FROM uploaded WHERE segment_id = ?', (i,)).fetchone()
        if after and after[0] == 'ok':
            ok += 1
    if retried:
        log.info('retry sweep: re-attempted %d failed segment(s), %d now ok', retried, ok)
    return retried

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
    retried_at = 0.0  # first idle tick runs a retry sweep
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

            # Periodically re-attempt transiently-failed uploads so a failure never silently drops
            # footage forever. Bounded by RETRY_BATCH so it cannot starve new-segment progress.
            if cfg.retry_interval > 0 and time.time() - retried_at > cfg.retry_interval:
                try:
                    retry_failed(cfg, state, app_db, router, cam_meta, log)
                except Exception as exc:
                    log.error('retry sweep error: %s', exc)
                retried_at = time.time()

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
