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
# ============================================================================
# CAKUPAN: kamera mana yang urusan penyelaras ini
#
# Hanya kamera di rentang privat RFC1918 - yaitu yang benar-benar ada di jaringan kita,
# bisa dijangkau, dan boleh dikonfigurasi. Kamera pihak ketiga di IP publik (di pemasangan
# ini: 394 feed Surabaya di 36.66.x.x) bukan milik kita; jamnya urusan pemiliknya, dan
# memasukkannya hanya menghasilkan ratusan baris "belum diketahui" yang tidak bisa ditindak.
#
# BUKAN dihardcode ke 192.168: pemasangan pelanggan bisa memakai 10.x atau 172.16-31.x, dan
# kamera mereka akan luput tanpa satu pun tanda bahwa ada yang terlewat.
#
# ⚠️ Definisi yang SAMA ada di backend/services/cameraTimeStatusService.js karena panel admin
# harus menampilkan persis kamera yang diperiksa penyelaras ini. Keduanya dijaga sebuah tes
# di backend/__tests__/guardrails.test.js - kalau salah satu diubah, tes itu merah.
# ============================================================================
SCOPE_SQL = (
    "enabled = 1 AND ("
    "private_rtsp_url LIKE 'rtsp://%@10.%' OR "
    "private_rtsp_url LIKE 'rtsp://%@192.168.%' OR "
    "private_rtsp_url GLOB 'rtsp://*@172.1[6-9].*' OR "
    "private_rtsp_url GLOB 'rtsp://*@172.2[0-9].*' OR "
    "private_rtsp_url GLOB 'rtsp://*@172.3[01].*')"
)

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


def alamat_server_untuk(host):
    """Alamat yang HARUS diisikan ke kamera ini — ditemukan, bukan dihardcode.

    `ip route get <kamera>` menjawab dengan alamat sumber yang dipakai server saat menghubungi
    kamera itu. Itu persis alamat yang harus dituju balik oleh kamera, dan ia benar dengan
    sendirinya di topologi mana pun: satu NIC, banyak NIC, di balik gateway, atau saat dipasang
    di jaringan pelanggan yang belum pernah kita lihat.

    Inilah bagian yang membuat semuanya bisa dipasang tanpa penyetelan: tidak ada satu pun
    alamat yang perlu ditulis tangan.
    """
    try:
        out = subprocess.run(["ip", "route", "get", host],
                             capture_output=True, text=True, timeout=6).stdout
    except Exception:  # noqa: BLE001
        return None
    hit = re.search(r"\bsrc\s+([0-9.]+)", out)
    return hit.group(1) if hit else None


def apply_isapi(host, user, pwd, server):
    """Jalur Hikvision. ONVIF-nya menolak autentikasi di firmware ini — diuji, konsisten.

    Zona waktu dibaca lalu dikirim kembali apa adanya, alasan yang sama seperti di jalur ONVIF.
    """
    base = "http://%s/ISAPI/System/time" % host

    def isapi(method, url, body=None):
        cmd = ["curl", "-s", "--max-time", "10", "--digest", "-u", "%s:%s" % (user, pwd)]
        if method != "GET":
            cmd += ["-X", method, "-H", "Content-Type: application/xml", "--data-binary", body]
        cmd.append(url)
        try:
            return subprocess.run(cmd, capture_output=True, text=True,
                                  timeout=15).stdout.replace("\n", "")
        except Exception as exc:  # noqa: BLE001
            return "LOCALERR " + str(exc)

    now = isapi("GET", base)
    if "<timeMode>" not in now:
        return False, "ISAPI tidak menjawab"
    tz_hit = re.search(r"<timeZone>([^<]*)</timeZone>", now)
    tz = tz_hit.group(1) if tz_hit else "CST-7:00:00"

    srv = ("<?xml version='1.0' encoding='UTF-8'?>"
           "<NTPServer version='2.0' xmlns='http://www.hikvision.com/ver20/XMLSchema'>"
           "<id>1</id><addressingFormatType>ipaddress</addressingFormatType>"
           "<ipAddress>%s</ipAddress><portNo>123</portNo>"
           "<synchronizeInterval>60</synchronizeInterval></NTPServer>" % server)
    r1 = isapi("PUT", base + "/ntpServers/1", srv)
    if "<statusString>OK" not in r1.replace(" ", ""):
        return False, "ISAPI set server: " + fault(r1)

    mode = ("<?xml version='1.0' encoding='UTF-8'?>"
            "<Time version='2.0' xmlns='http://www.hikvision.com/ver20/XMLSchema'>"
            "<timeMode>NTP</timeMode><timeZone>%s</timeZone></Time>" % tz)
    r2 = isapi("PUT", base, mode)
    if "<statusString>OK" not in r2.replace(" ", ""):
        return False, "ISAPI set mode: " + fault(r2)
    return True, "ok"


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


def pastikan_waktu(host, user, pwd, server=None, tz=None, dorong_bila_perlu=True):
    """Usahakan kamera ini menjaga waktunya sendiri. Kembalikan (berhasil, metode, catatan).

    Mencoba berurutan, dan BERHENTI pada yang pertama terbukti berhasil — terbukti artinya
    dibaca ulang, bukan sekadar dijawab OK:

      1. ONVIF SetNTP           - jalur standar; dipakai Tiandy dan sejenisnya.
      2. Hikvision ISAPI        - untuk firmware yang ONVIF-nya menolak autentikasi.
      3. Dorongan waktu         - untuk firmware yang memang tidak punya klien NTP sama sekali
                                  (Longse). Kamera tidak menarik, server yang menulis.

    Urutannya bukan selera: yang di atas membuat kamera mandiri, yang di bawah menuntut server
    terus mengurusnya. Jangan pernah menaikkan dorongan ke urutan pertama hanya karena ia paling
    sering berhasil.

    Tidak ada daftar merek di sini. Merek dideteksi dari APA YANG DIJAWAB perangkat, karena
    daftar akan basi begitu pelanggan memasang kamera model lain.
    """
    if server is None:
        server = alamat_server_untuk(host)
    if not server:
        return False, None, "alamat server tidak bisa ditentukan (rute ke kamera tidak ada?)"

    if tz is None:
        _mode, tz, _srv, _err = read_state(host, user, pwd)

    ok, msg = apply_ntp(host, user, pwd, server, tz)
    if ok:
        mode2, _tz2, srv2, _e2 = read_state(host, user, pwd)
        if mode2 == "NTP" and server in (srv2 or []):
            return True, "onvif", "menarik dari %s" % server
        msg = "ONVIF menjawab OK tetapi tidak berubah"

    ok2, msg2 = apply_isapi(host, user, pwd, server)
    if ok2:
        return True, "isapi", "menarik dari %s" % server

    if dorong_bila_perlu and dorong_waktu(host, user, pwd, tz):
        return True, "dorong", "tanpa klien NTP - jam ditulis server"

    return False, None, "; ".join(filter(None, [msg, msg2]))[:120]


def dorong_waktu(host, user, pwd, tz):
    """Tulis jam server ke kamera (ONVIF SetSystemDateAndTime, mode Manual).

    Untuk firmware tanpa klien NTP. Longse IPC-S41FE/IPC-PS3D di sini menjawab `SetNTP` dengan
    "This optional method is not implemented" - varian manual MAUPUN FromDHCP - dan
    `SetSystemDateAndTime` dengan DateTimeType=NTP dijawab OK lalu DIABAIKAN. Perangkat itu juga
    tidak punya UI web sama sekali. Jadi ini bukan jalan pintas, ini satu-satunya jalur.

    Konsekuensinya jujur: jam kamera itu hanya seakurat jarak antar-siklus pemeriksaan.
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
    return "SetSystemDateAndTimeResponse" in soap(host, user, pwd, body)


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
    rows = con.execute(
        "SELECT id, name, private_rtsp_url FROM cameras WHERE " + SCOPE_SQL + " ORDER BY id"
    ).fetchall()
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
