#!/usr/bin/env python3
"""
Purpose: Sajikan potongan (Range) berkas arsip Telegram lewat MTProto sebagai BOT.
Caller: backend Node (openSegmentStream) via HTTP di 127.0.0.1, saat rekaman tidak lagi di disk.

KENAPA SERVICE INI ADA
----------------------
Bot API `getFile` tidak punya Range: ia memateriaisasi SELURUH berkas (238 MB) sebelum satu byte
sampai ke penonton, bahkan untuk lompatan 2 detik. MTProto `upload.getFile` punya offset/limit.
Diukur 2026-08-28: 99,1% arsip harus ditarik dari Telegram, jadi ini jalur panas.

KENAPA SEBAGAI BOT, BUKAN AKUN
Login MTProto memakai BOT TOKEN yang SUDAH ada di /opt/tg-archive/.env — bukan nomor telepon,
bukan akun pribadi. Tidak ada permukaan risiko baru: kalau token bocor, arsipnya sudah terpapar
lewat token yang sama hari ini. Terbukti bekerja pada segmen tertua (32 hari) maupun terbaru.

BATAS AMAN
Hanya mendengar di 127.0.0.1; tidak pernah terekspos keluar. Node yang menjaga otorisasi admin —
service ini murni pengangkut byte, tidak tahu siapa pemanggilnya, jadi ia TIDAK BOLEH pernah
dibind ke antarmuka publik.
"""
import asyncio
import json
import os
import re
import sqlite3

from aiohttp import web
from pyrogram import Client
from pyrogram.errors import FileReferenceExpired, FileReferenceInvalid

API_ID = int(os.environ.get("TG_API_ID", "38385345"))
API_HASH = os.environ.get("TG_API_HASH", "8eecfa0d72695d392a0ccbe8214f6bb5")
ENV_FILE = os.environ.get("TG_SIDECAR_ENV", "/opt/tg-archive/.env")
DB_PATH = os.environ.get("TG_ARCHIVE_DB", "/var/www/rafnet-cctv/backend/data/cctv.db")
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(os.environ.get("TG_MTPROTO_PORT", "8093"))

CHUNK = 1024 * 1024  # satuan offset/limit Pyrogram = 1 MiB (terukur, bukan diasumsikan)


def _bot_token():
    m = re.search(r'BOT_TOKEN\s*=\s*([0-9]+:[A-Za-z0-9_-]+)', open(ENV_FILE).read())
    if not m:
        raise RuntimeError(f"BOT_TOKEN tidak ditemukan di {ENV_FILE}")
    return m.group(1)


def _lookup(segment_id):
    """file_id + ukuran + (chatId,messageId) untuk refup. Koneksi read-only per permintaan."""
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        row = con.execute(
            "SELECT file_id, file_size, targets FROM telegram_archive_uploads WHERE segment_id=?",
            (segment_id,),
        ).fetchone()
    finally:
        con.close()
    if not row or not row[0]:
        return None
    file_id, file_size, targets_json = row
    chat_id = message_id = None
    try:
        arr = json.loads(targets_json) if targets_json else []
        if arr:
            chat_id = arr[0].get("chatId")
            message_id = arr[0].get("messageId")
    except (ValueError, TypeError, AttributeError):
        pass
    return {"file_id": file_id, "file_size": int(file_size or 0),
            "chat_id": chat_id, "message_id": message_id}


def _parse_range(header, size):
    """Bentuk `bytes=start-end` tunggal — satu-satunya bentuk yang dikirim elemen <video>."""
    if not header or not size:
        return None
    m = re.match(r'^bytes=(\d*)-(\d*)$', header.strip())
    if not m:
        return None
    a, b = m.group(1), m.group(2)
    if a == "" and b == "":
        return None
    if a == "":  # bytes=-N : N byte terakhir
        n = int(b)
        return (max(0, size - n), size - 1)
    start = int(a)
    end = int(b) if b else size - 1
    end = min(end, size - 1)
    if start > end:
        return None
    return (start, end)


async def _refresh_file_id(app, meta):
    """Ambil file_id segar dari pesan aslinya saat file_reference kadaluarsa. Jarang perlu:
    file_id terbitan Bot API terbukti masih valid pada 32 hari, tapi ini jaring pengaman."""
    if meta["chat_id"] is None or meta["message_id"] is None:
        return None
    msg = await app.get_messages(meta["chat_id"], meta["message_id"])
    media = msg.video or msg.document or msg.audio or msg.animation
    return media.file_id if media else None


async def _stream_range(app, meta, start, end, response):
    """Tulis TEPAT byte [start, end] ke response, menarik hanya chunk 1 MiB yang menutupinya."""
    first = start // CHUNK
    last = end // CHUNK
    n = last - first + 1
    file_id = meta["file_id"]

    async def pump(fid):
        pos = first * CHUNK
        async for chunk in app.stream_media(fid, offset=first, limit=n):
            c_start = pos
            c_end = pos + len(chunk) - 1
            lo = max(start, c_start)
            hi = min(end, c_end)
            if lo <= hi:
                await response.write(chunk[lo - c_start: hi - c_start + 1])
            pos += len(chunk)
            if pos > end:
                break

    try:
        await pump(file_id)
    except (FileReferenceExpired, FileReferenceInvalid):
        fresh = await _refresh_file_id(app, meta)
        if not fresh:
            raise
        await pump(fresh)


def make_app(app_client):
    routes = web.RouteTableDef()

    @routes.get("/health")
    async def health(_req):
        ok = app_client.is_connected
        return web.json_response({"ok": bool(ok)}, status=200 if ok else 503)

    @routes.get("/segment/{sid}")
    async def segment(req):
        try:
            sid = int(req.match_info["sid"])
        except (ValueError, KeyError):
            return web.json_response({"error": "segment id tidak valid"}, status=400)

        meta = _lookup(sid)
        if not meta:
            return web.json_response({"error": "segmen tidak ada di arsip"}, status=404)

        size = meta["file_size"]
        rng = _parse_range(req.headers.get("Range"), size)
        start, end = rng if rng else (0, size - 1)

        resp = web.StreamResponse(
            status=206 if rng else 200,
            headers={
                "Content-Type": "video/mp4",
                "Accept-Ranges": "bytes",
                "Content-Length": str(end - start + 1),
                "Cache-Control": "private, max-age=3600",
            },
        )
        if rng:
            resp.headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        await resp.prepare(req)
        try:
            await _stream_range(app_client, meta, start, end, resp)
        except Exception as exc:  # noqa: BLE001 — apa pun yang gagal jadi galat, jangan gantung
            # Header sudah terkirim; yang bisa dilakukan hanya menutup dan mencatat.
            print(f"[mtproto] segmen {sid} gagal: {type(exc).__name__}: {exc}", flush=True)
        await resp.write_eof()
        return resp

    web_app = web.Application()
    web_app.add_routes(routes)
    return web_app


async def main():
    token = _bot_token()
    client = Client("tg-mtproto-arsip", api_id=API_ID, api_hash=API_HASH,
                    bot_token=token, in_memory=True, workers=8)
    await client.start()
    me = await client.get_me()
    print(f"[mtproto] login sebagai @{me.username} (id={me.id})", flush=True)

    runner = web.AppRunner(make_app(client))
    await runner.setup()
    site = web.TCPSite(runner, LISTEN_HOST, LISTEN_PORT)
    await site.start()
    print(f"[mtproto] mendengar di http://{LISTEN_HOST}:{LISTEN_PORT}", flush=True)

    # Jalan selamanya sampai systemd menghentikannya.
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
