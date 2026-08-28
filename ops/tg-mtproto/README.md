# tg-mtproto — unduh SEBAGIAN arsip Telegram lewat MTProto (bot)

## Masalah yang dipecahkan
Bot API `getFile` tidak punya Range: ia menarik SELURUH segmen (~238 MB) sebelum satu byte sampai
ke penonton, bahkan untuk lompatan 2 detik. Diukur 2026-08-28: 99,1% arsip harus ditarik dari
Telegram (retensi disk lokal ~12 jam lawan 32 hari di Telegram), jadi ini jalur panas.

MTProto `upload.getFile` PUNYA offset/limit. Service ini memakainya, memotong tepat byte yang
diminta. Lompatan 2 detik → ~1–4 MB, bukan 238 MB.

## Kenapa aman: login sebagai BOT, bukan akun
Kredensial = BOT_TOKEN yang SUDAH ada di `/opt/tg-archive/.env`. Bukan nomor telepon, bukan akun
pribadi, tidak ada sesi user. Kalau token bocor, arsipnya sudah terpapar lewat token yang sama hari
ini — tidak ada permukaan risiko baru. Terbukti bekerja pada segmen tertua (32 hari) & terbaru.

Hanya mendengar di `127.0.0.1:8093`; TIDAK PERNAH dibind ke antarmuka publik. Otorisasi admin tetap
di backend Node — service ini murni pengangkut byte.

## Pasang (sekali, di server prod)
```
python3 -m venv /opt/tg-mtproto-venv
/opt/tg-mtproto-venv/bin/pip install pyrogram TgCrypto aiohttp
cp mtproto_server.py /opt/tg-archive/mtproto_server.py   # chmod 700
cp tg-mtproto.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now tg-mtproto
curl -s http://127.0.0.1:8093/health   # {"ok": true}
```

## Nyalakan di backend
`backend/.env`: `TG_ARCHIVE_MTPROTO_URL=http://127.0.0.1:8093`

MATI secara bawaan: tanpa env itu, backend memakai jalur Bot API lama. Kalau service mati/menolak,
backend JATUH ke Bot API — menyalakannya tak pernah bisa membuat arsip yang tadinya bisa diputar
jadi tidak bisa.

## Env service (opsional, ada bawaannya)
`TG_API_ID`, `TG_API_HASH` (bawaan dari perintah Bot API server), `TG_SIDECAR_ENV`
(`/opt/tg-archive/.env`), `TG_ARCHIVE_DB`, `TG_MTPROTO_PORT` (8093).
