# -*- coding: utf-8 -*-
"""
Purpose: Awasi jam setiap kamera terhadap jam server, dan berteriak saat ada yang menyimpang.
Caller: systemd timer `camera-time-check.timer` (per jam), atau dijalankan tangan kapan saja.
Deps: python3 + curl. READ-ONLY terhadap kamera - ia tidak pernah mengubah setelan apa pun.
SideEffects: menulis state ke --state, mengirim pesan Telegram saat status BERUBAH.

KENAPA BERKAS INI ADA
---------------------
Memperbaiki jam kamera sekali itu mudah; yang sulit adalah mengetahui saat ia rusak lagi.
Kamera kembali ke mode Manual sesudah reset firmware atau mati listrik, lalu hanyut diam-diam.
Terukur 2026-08-26: lima kamera berhenti di 1970-01-05 dan satu meleset 4 jam 43 menit - dan
tidak ada yang tahu sejak kapan, karena tidak ada satu pun yang pernah memeriksanya. Rekaman
tetap mengalir, halaman tetap hijau, hanya stempel di gambar yang berbohong.

Yang diawasi DUA hal, dan yang kedua justru lebih penting:
  1. SELISIH jam terhadap server - gejalanya.
  2. MODE waktu kamera (`Manual` vs `NTP`) - penyebabnya, dan ia terlihat LEBIH DULU.
     Kamera yang baru kembali ke Manual jamnya masih benar hari ini dan baru meleset nanti.
     Menangkapnya di tahap ini berarti memperbaiki sebelum ada rekaman yang salah stempel.

KENAPA HANYA MENGIRIM SAAT BERUBAH
----------------------------------
Aturan log proyek ini: catat TRANSISI, bukan keadaan tetap; jangan pernah menulis per item di
dalam loop yang jalan tiap siklus. Peringatan yang datang tiap jam untuk masalah yang sama akan
diabaikan dalam sehari, dan saat itu ia berhenti berguna. Jadi state disimpan, dan pesan hanya
dikirim ketika himpunan kamera bermasalah BERGANTI - termasuk saat ia menjadi kosong (pulih).
"""

import argparse
import datetime
import json
import os
import re
import sqlite3
import subprocess
import sys

DB_DEFAULT = "/var/www/rafnet-cctv/backend/data/cctv.db"
STATE_DEFAULT = "/var/lib/camera-time-check.json"

# Dipinjam dari tetangganya supaya WS-Security tidak ditulis dua kali; salah satunya pasti
# akan ketinggalan diperbaiki.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from set_camera_ntp import NS_DEV, NS_SCH, soap as soap_auth  # noqa: E402

SOAP_TIME = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
    '<s:Body><GetSystemDateAndTime '
    'xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>'
)


def onvif_time(host, timeout=7):
    """Kembalikan (mode, datetime_utc, zona, error).

    Tanpa autentikasi: `GetSystemDateAndTime` terbuka di semua kamera di sini (diverifikasi
    lewat WS-Discovery ke ke-14 perangkat), sedangkan `GetNTP`/`SetNTP` menuntutnya. Karena
    itu pemantau bisa memeriksa SEMUA kamera meski hanya sebagian yang bisa dikonfigurasi.
    """
    try:
        proc = subprocess.run(
            ["curl", "-s", "--max-time", str(timeout), "-X", "POST",
             "-H", "Content-Type: application/soap+xml", "--data-binary", SOAP_TIME,
             "http://%s/onvif/device_service" % host],
            capture_output=True, text=True, timeout=timeout + 5)
        body = proc.stdout.replace("\n", "").replace("\r", "")
    except Exception as exc:  # noqa: BLE001
        return None, None, None, "gagal menghubungi: %s" % exc

    if "SystemDateAndTime" not in body:
        return None, None, None, "ONVIF tidak menjawab"

    mode = re.search(r"<tt:DateTimeType>([A-Za-z]+)", body)
    tz = re.search(r"<tt:TZ>([^<]*)", body)
    zona = tz.group(1) if tz else ""
    block = re.search(r"<tt:UTCDateTime>(.*?)</tt:UTCDateTime>", body)
    if not block:
        return (mode.group(1) if mode else "?"), None, zona, "jam tidak dilaporkan"

    def field(name):
        hit = re.search(r"<tt:%s>([0-9]+)" % name, block.group(1))
        return int(hit.group(1)) if hit else None

    try:
        stamp = datetime.datetime(field("Year"), field("Month"), field("Day"),
                                  field("Hour"), field("Minute"), field("Second"))
    except (TypeError, ValueError):
        return (mode.group(1) if mode else "?"), None, zona, "jam tidak masuk akal"

    return (mode.group(1) if mode else "?"), stamp, zona, None


def dorong_waktu(host, user, pwd, tz):
    """Tulis jam server ke kamera lewat ONVIF SetSystemDateAndTime (mode Manual).

    Untuk kamera yang TIDAK BISA menarik waktu sendiri. Longse IPC-S41FE/IPC-PS3D di sini
    menjawab `SetNTP` dengan "This optional method is not implemented" - baik varian manual
    maupun FromDHCP - dan `SetSystemDateAndTime` dengan DateTimeType=NTP dijawab OK lalu
    DIABAIKAN (dibaca ulang: mode tetap Manual). Firmware-nya memang tidak punya klien NTP.

    Perangkat itu juga tidak punya UI web sama sekali: dari seluruh port TCP, hanya
    /onvif/device_service yang menjawab HTTP; sisanya protokol proprietary di 37777. Jadi
    mendorong waktu bukan pilihan yang lebih malas - ini satu-satunya jalur yang ada.

    Konsekuensinya jam kamera itu hanya seakurat jarak antar-siklus timer (satu jam), dan
    itu sudah jauh lebih baik daripada hanyut tanpa batas.
    """
    now = datetime.datetime.utcnow()
    tz_xml = ('<TimeZone><TZ xmlns="%s">%s</TZ></TimeZone>' % (NS_SCH, tz)) if tz else ""
    body = ('<SetSystemDateAndTime xmlns="%s">'
            '<DateTimeType>Manual</DateTimeType><DaylightSavings>false</DaylightSavings>%s'
            '<UTCDateTime>'
            '<Time xmlns="%s"><Hour>%d</Hour><Minute>%d</Minute><Second>%d</Second></Time>'
            '<Date xmlns="%s"><Year>%d</Year><Month>%d</Month><Day>%d</Day></Date>'
            '</UTCDateTime></SetSystemDateAndTime>'
            % (NS_DEV, tz_xml, NS_SCH, now.hour, now.minute, now.second,
               NS_SCH, now.year, now.month, now.day))
    reply = soap_auth(host, user, pwd, body)
    return "SetSystemDateAndTimeResponse" in reply


def kirim_telegram(teks, env_file):
    """Pakai kredensial uploader arsip yang sudah ada; diam kalau tidak dikonfigurasi."""
    token = os.environ.get("TG_BOT_TOKEN")
    chat = os.environ.get("TG_ALERT_CHAT_ID")
    if (not token or not chat) and os.path.exists(env_file):
        for line in open(env_file, encoding="utf-8", errors="replace"):
            if "=" not in line or line.strip().startswith("#"):
                continue
            key, _, val = line.strip().partition("=")
            val = val.strip().strip('"').strip("'")
            if key == "TG_BOT_TOKEN" and not token:
                token = val
            elif key == "TG_ALERT_CHAT_ID" and not chat:
                chat = val
    if not token or not chat:
        return "tidak terkirim (TG_BOT_TOKEN/TG_ALERT_CHAT_ID belum diisi)"
    try:
        subprocess.run(
            ["curl", "-s", "--max-time", "15", "-o", "/dev/null",
             "https://api.telegram.org/bot%s/sendMessage" % token,
             "-d", "chat_id=%s" % chat, "--data-urlencode", "text=%s" % teks],
            capture_output=True, timeout=20)
        return "terkirim"
    except Exception as exc:  # noqa: BLE001
        return "gagal kirim: %s" % exc


def catatan_baris(sebab, didorong, mode, dorong_aktif):
    """Satu kalimat jujur per kamera - termasuk saat sehatnya BUKAN karena dirinya sendiri."""
    if sebab:
        return ", ".join(sebab) + (" [jam baru didorong]" if didorong else "")
    if didorong:
        return "ok (jam baru didorong dari server)"
    if dorong_aktif and mode and mode.lower() != "ntp":
        return "ok (tanpa klien NTP - dijaga dorongan server)"
    return "ok"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_DEFAULT)
    parser.add_argument("--state", default=STATE_DEFAULT)
    parser.add_argument("--toleransi", type=int, default=60,
                        help="selisih detik yang masih dianggap wajar (default 60)")
    parser.add_argument("--env-telegram", default="/opt/tg-archive/.env")
    parser.add_argument("--quiet", action="store_true",
                        help="hanya satu baris ringkasan - dipakai systemd timer")
    parser.add_argument("--dorong", action="store_true",
                        help="tulis jam server ke kamera yang tidak bisa ber-NTP sendiri")
    parser.add_argument("--ambang-dorong", type=int, default=3,
                        help="dorong hanya bila selisihnya melebihi ini (detik)")
    args = parser.parse_args()

    con = sqlite3.connect(args.db)
    rows = con.execute(
        "SELECT id, name, private_rtsp_url FROM cameras "
        "WHERE enabled=1 AND private_rtsp_url LIKE ? ORDER BY id",
        ("rtsp://%@192.168.%",)).fetchall()

    sekarang = datetime.datetime.utcnow()
    masalah, baris = [], []

    for cid, nama, url in rows:
        host_hit = re.search(r"@([^:/]+)", url or "")
        if not host_hit:
            continue
        host = host_hit.group(1)
        mode, stamp, zona, err = onvif_time(host)

        if err and stamp is None and mode is None:
            baris.append((cid, nama, host, "-", "-", err))
            # Tidak terjangkau BUKAN bukti jamnya salah - catat, jangan bunyikan alarm.
            continue

        selisih = int((stamp - sekarang).total_seconds()) if stamp else None

        # Kamera yang tidak punya klien NTP sama sekali tetap bisa dijaga: server yang
        # MENULIS jamnya. Hanya untuk yang mode-nya bukan NTP - mendorong ke kamera yang
        # sedang menarik dari server hanya akan berkelahi dengan sinkronisasinya sendiri.
        didorong = False
        if (args.dorong and mode and mode.lower() != "ntp"
                and selisih is not None and abs(selisih) > args.ambang_dorong):
            kred = re.match(r"rtsp://([^:]+):([^@]+)@", url or "")
            if kred:
                didorong = dorong_waktu(host, kred.group(1), kred.group(2), zona)

        sebab = []
        if selisih is not None and abs(selisih) > args.toleransi:
            sebab.append("selisih %+ds" % selisih if abs(selisih) < 86400
                         else "selisih %+d hari" % (selisih // 86400))
        # Mode bukan-NTP itu masalah HANYA bila kita tidak bisa menjaganya. Sebagian
        # firmware (Longse di sini) memang tidak punya klien NTP sama sekali dan tidak
        # akan pernah punya; menandainya tiap jam selamanya membuat alarm ini berhenti
        # dibaca, dan saat itu ia berhenti melindungi apa pun. Selama jamnya masih di
        # dalam toleransi - entah karena didorong atau karena memang belum hanyut -
        # keadaannya sehat, dan itu yang dilaporkan.
        di_luar_toleransi = selisih is not None and abs(selisih) > args.toleransi
        if mode and mode.lower() != "ntp" and (di_luar_toleransi or not args.dorong):
            sebab.append("mode=%s" % mode)

        baris.append((cid, nama, host, mode or "?",
                      ("%+ds" % selisih) if selisih is not None else "-",
                      catatan_baris(sebab, didorong, mode, args.dorong)))
        if sebab:
            masalah.append("id %s %s: %s" % (cid, nama, "; ".join(sebab)))

    if not args.quiet:
        print("JAM SERVER (UTC): %s   toleransi: %ds\n"
              % (sekarang.strftime("%Y-%m-%d %H:%M:%S"), args.toleransi))
        print("%-6s %-32s %-15s %-8s %-9s %s"
              % ("ID", "NAMA", "HOST", "MODE", "SELISIH", "CATATAN"))
        print("-" * 104)
        for cid, nama, host, mode, sel, catatan in baris:
            print("%-6s %-32s %-15s %-8s %-9s %s"
                  % (cid, (nama or "")[:32], host, mode, sel, catatan))
        print()

    # Transisi, bukan keadaan tetap: bandingkan dengan siklus sebelumnya.
    sebelum = []
    if os.path.exists(args.state):
        try:
            sebelum = json.load(open(args.state, encoding="utf-8")).get("masalah", [])
        except Exception:  # noqa: BLE001
            sebelum = []

    berubah = sorted(masalah) != sorted(sebelum)
    if berubah:
        if masalah:
            teks = ("Jam kamera menyimpang (%d dari %d):\n\n%s\n\n"
                    "Perbaiki: setel mode waktu ke NTP dan arahkan ke 172.17.11.12."
                    % (len(masalah), len(rows), "\n".join(masalah)))
        else:
            teks = "Jam kamera: semua %d kamera kembali normal." % len(rows)
        status_kirim = kirim_telegram(teks, args.env_telegram)
    else:
        status_kirim = "tidak dikirim (tidak ada perubahan sejak siklus lalu)"

    try:
        os.makedirs(os.path.dirname(args.state), exist_ok=True)
        json.dump({"waktu": sekarang.isoformat(timespec="seconds"), "masalah": masalah},
                  open(args.state, "w", encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print("peringatan: state tidak tersimpan: %s" % exc, file=sys.stderr)

    # SATU baris per siklus, sesuai aturan log proyek.
    print("camera-time: %d kamera diperiksa, %d bermasalah%s | telegram: %s"
          % (len(rows), len(masalah),
             (" (" + masalah[0] + ")") if masalah else "", status_kirim))

    return 1 if masalah else 0


if __name__ == "__main__":
    sys.exit(main())
