# -*- coding: utf-8 -*-
"""
Purpose: Alihkan kamera dari mode waktu Manual ke NTP dan arahkan ke server NTP LAN.
Caller: dijalankan tangan oleh operator (python3 set_camera_ntp.py --apply).
Deps: python3 + curl. Membaca daftar & kredensial kamera dari backend/data/cctv.db.
SideEffects: MENGUBAH SETELAN KAMERA FISIK saat --apply. Tanpa flag itu ia hanya membaca.

KENAPA BERKAS INI ADA
---------------------
Diukur 2026-08-26: dari 14 kamera milik sendiri, hanya 3 yang mode waktunya `NTP` - dan
ketiganya akurat dalam 1 detik. Sebelas sisanya `Manual`, dan semuanya meleset: lima berhenti
di 1970 (jam tak pernah di-set), satu meleset 4 jam 43 menit, sisanya belasan sampai puluhan
detik.

Kolom server NTP-nya SUDAH terisi di banyak kamera. Jadi masalahnya bukan "belum diisi",
melainkan mode-nya tidak pernah dipindah ke NTP sehingga kolom itu tidak pernah dibaca.
Bukti paling bersih: id 7 dan id 8 satu subnet, sama-sama menunjuk pool NTP, tapi hanya id 7
yang mode-nya NTP - dan hanya id 7 yang jamnya benar.

Dua cacat tambahan yang ikut diperbaiki: sebagian kamera menunjuk `10.1.1.1` (tidak ada di
jaringan mana pun di sini), sisanya `pool.ntp.org` yang menuntut DNS + internet dari VLAN
kamera. Server NTP LAN tidak menuntut keduanya.

ZONA WAKTU SENGAJA TIDAK DISENTUH
---------------------------------
Kamera di sini memakai label zona berbeda-beda untuk offset yang sama: `KRAT-07:00`,
`CST-7:00:00`, `AltaiStandardTime-7`, `GMT+07:00`. Semuanya UTC+7, jadi angkanya sudah benar.
Menyeragamkannya berarti menebak konvensi tanda POSIX tiap firmware, dan salah tebak menggeser
jam berjam-jam - lebih buruk daripada keadaan sekarang. Skrip ini MEMBACA zona yang ada lalu
mengirimkannya kembali apa adanya.
"""

import argparse
import base64
import datetime
import hashlib
import os
import re
import sqlite3
import subprocess

DB_DEFAULT = "/var/www/rafnet-cctv/backend/data/cctv.db"
NS_DEV = "http://www.onvif.org/ver10/device/wsdl"
NS_SCH = "http://www.onvif.org/ver10/schema"


def wsse(user, pwd):
    """WS-Security UsernameToken - ONVIF di sini menolak HTTP digest biasa (diuji, gagal)."""
    nonce = os.urandom(16)
    created = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    digest = base64.b64encode(
        hashlib.sha1(nonce + created.encode() + pwd.encode()).digest()).decode()
    return (
        '<s:Header><Security s:mustUnderstand="1" '
        'xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">'
        '<UsernameToken><Username>{u}</Username>'
        '<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{d}</Password>'
        '<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{n}</Nonce>'
        '<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">{c}</Created>'
        '</UsernameToken></Security></s:Header>'
    ).format(u=user, d=digest, n=base64.b64encode(nonce).decode(), c=created)


def soap(host, user, pwd, body, timeout=10):
    env = ('<?xml version="1.0" encoding="UTF-8"?>'
           '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
           + wsse(user, pwd) + "<s:Body>" + body + "</s:Body></s:Envelope>")
    try:
        proc = subprocess.run(
            ["curl", "-s", "--max-time", str(timeout), "-X", "POST",
             "-H", "Content-Type: application/soap+xml", "--data-binary", env,
             "http://%s/onvif/device_service" % host],
            capture_output=True, text=True, timeout=timeout + 5)
        return proc.stdout.replace("\n", "").replace("\r", "")
    except Exception as exc:  # noqa: BLE001
        return "LOCALERR " + str(exc)


def fault(xml):
    hit = re.search(r"<[^>]*Text[^>]*>([^<]{0,90})", xml or "")
    if hit:
        return hit.group(1).strip()
    if not (xml or "").strip():
        return "tidak ada respons"
    return (xml or "")[:80]


def read_state(host, user, pwd):
    """Kembalikan (mode, tz, daftar_server_ntp, error)."""
    got = soap(host, user, pwd, '<GetSystemDateAndTime xmlns="%s"/>' % NS_DEV)
    if "SystemDateAndTime" not in got:
        return None, None, None, fault(got)
    mode = re.search(r"<tt:DateTimeType>([A-Za-z]+)", got)
    tz = re.search(r"<tt:TZ>([^<]*)", got)
    ntp = soap(host, user, pwd, '<GetNTP xmlns="%s"/>' % NS_DEV)
    servers = re.findall(r"IPv4Address>([0-9.]+)<", ntp) + re.findall(r"DNSname>([^<]+)<", ntp)
    return (mode.group(1) if mode else "?"), (tz.group(1) if tz else ""), servers, None


def apply_ntp(host, user, pwd, server, tz):
    """Set server NTP, lalu pindahkan mode ke NTP. Zona dikirim balik apa adanya."""
    body = ('<SetNTP xmlns="%s"><FromDHCP>false</FromDHCP>'
            '<NTPManual><Type xmlns="%s">IPv4</Type>'
            '<IPv4Address xmlns="%s">%s</IPv4Address></NTPManual></SetNTP>'
            % (NS_DEV, NS_SCH, NS_SCH, server))
    first = soap(host, user, pwd, body)
    if "SetNTPResponse" not in first:
        return False, "SetNTP: " + fault(first)

    tz_xml = ('<TimeZone><TZ xmlns="%s">%s</TZ></TimeZone>' % (NS_SCH, tz)) if tz else ""
    body2 = ('<SetSystemDateAndTime xmlns="%s"><DateTimeType>NTP</DateTimeType>'
             '<DaylightSavings>false</DaylightSavings>%s</SetSystemDateAndTime>'
             % (NS_DEV, tz_xml))
    second = soap(host, user, pwd, body2)
    if "SetSystemDateAndTimeResponse" not in second:
        return False, "SetSystemDateAndTime: " + fault(second)
    return True, "ok"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_DEFAULT)
    parser.add_argument("--server", default="172.17.11.12", help="alamat server NTP LAN")
    parser.add_argument("--apply", action="store_true",
                        help="benar-benar mengubah kamera (tanpa ini: hanya membaca)")
    parser.add_argument("--only", help="batasi ke id kamera tertentu, dipisah koma")
    parser.add_argument("--backup", default="/root/camera-ntp-backup.txt")
    args = parser.parse_args()

    con = sqlite3.connect(args.db)
    query = ("SELECT id, name, private_rtsp_url FROM cameras "
             "WHERE enabled=1 AND private_rtsp_url LIKE ? ORDER BY id")
    rows = con.execute(query, ("rtsp://%@192.168.%",)).fetchall()
    if args.only:
        want = {int(x) for x in args.only.split(",")}
        rows = [r for r in rows if r[0] in want]

    print("MODE: %s   server NTP tujuan: %s\n"
          % ("MENGUBAH KAMERA" if args.apply else "hanya membaca (dry-run)", args.server))
    print("%-6s %-32s %-15s %-8s %-24s %s"
          % ("ID", "NAMA", "HOST", "MODE", "SERVER NTP SEKARANG", "HASIL"))
    print("-" * 120)

    backup = open(args.backup, "a") if args.apply else None
    ok = skip = failed = 0

    for cid, nama, url in rows:
        parts = re.match(r"rtsp://([^:]+):([^@]+)@([^:/]+)", url or "")
        if not parts:
            continue
        user, pwd, host = parts.group(1), parts.group(2), parts.group(3)
        mode, tz, servers, err = read_state(host, user, pwd)
        now = ", ".join(servers) if servers else "-"

        if err:
            print("%-6s %-32s %-15s %-8s %-24s %s"
                  % (cid, nama[:32], host, "-", "-", "LEWAT: " + err))
            skip += 1
            continue

        if not args.apply:
            sudah = mode == "NTP" and args.server in (servers or [])
            print("%-6s %-32s %-15s %-8s %-24s %s"
                  % (cid, nama[:32], host, mode, now[:24],
                     "sudah benar" if sudah else "PERLU DIUBAH"))
            continue

        backup.write("%s|%s|%s|mode=%s|tz=%s|ntp=%s\n"
                     % (datetime.datetime.now().isoformat(timespec="seconds"),
                        cid, host, mode, tz, now))
        backup.flush()

        good, msg = apply_ntp(host, user, pwd, args.server, tz)
        if good:
            mode2, _tz2, servers2, _err2 = read_state(host, user, pwd)
            terbukti = mode2 == "NTP" and args.server in (servers2 or [])
            hasil = ("OK -> mode=%s server=%s" % (mode2, ", ".join(servers2 or []))
                     if terbukti else
                     "TERKIRIM tapi verifikasi meleset: mode=%s server=%s"
                     % (mode2, ", ".join(servers2 or [])))
            print("%-6s %-32s %-15s %-8s %-24s %s"
                  % (cid, nama[:32], host, mode, now[:24], hasil))
            ok += 1
        else:
            print("%-6s %-32s %-15s %-8s %-24s %s"
                  % (cid, nama[:32], host, mode, now[:24], "GAGAL: " + msg))
            failed += 1

    if backup:
        backup.close()
        print("\nsetelan lama dicatat di %s" % args.backup)
    print("\nringkasan: %d berhasil, %d gagal, %d dilewat (API menolak)" % (ok, failed, skip))


if __name__ == "__main__":
    main()
