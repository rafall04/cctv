# -*- coding: utf-8 -*-
"""Temukan alamat layanan ONVIF sesungguhnya tiap kamera lewat WS-Discovery unicast.

Multicast 239.255.255.250 TIDAK melewati gateway, dan kamera di sini ada di subnet lain
(192.168.12-16.x) sedangkan server di 172.17.11.x. Jadi Probe dikirim UNICAST ke UDP 3702
tiap kamera - ONVIF mewajibkan perangkat menjawabnya, dan jawabannya memuat XAddrs: URL
layanan device yang SEBENARNYA, termasuk port dan jalur yang tidak standar.
"""
import re, socket, sqlite3, sys, uuid

PROBE = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"'
    ' xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"'
    ' xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"'
    ' xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
    '<e:Header>'
    '<w:MessageID>uuid:{mid}</w:MessageID>'
    '<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>'
    '<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>'
    '</e:Header>'
    '<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>'
    '</e:Envelope>'
)

def probe(ip, timeout=4.0):
    msg = PROBE.format(mid=uuid.uuid4()).encode()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(msg, (ip, 3702))
        data, _ = s.recvfrom(65535)
        return data.decode("utf-8", "replace")
    except Exception:
        return ""
    finally:
        s.close()

con = sqlite3.connect("/var/www/rafnet-cctv/backend/data/cctv.db")
rows = con.execute(
    "SELECT id, name, private_rtsp_url FROM cameras "
    "WHERE enabled=1 AND private_rtsp_url LIKE ? ORDER BY id",
    ("rtsp://%@192.168.%",)).fetchall()

print("%-6s %-30s %-15s %s" % ("ID", "NAMA", "HOST", "XAddrs (URL layanan ONVIF sesungguhnya)"))
print("-" * 118)
for cid, nama, url in rows:
    m = re.search(r"@([^:/]+)", url or "")
    if not m:
        continue
    host = m.group(1)
    r = probe(host)
    if not r:
        print("%-6s %-30s %-15s %s" % (cid, (nama or "")[:30], host, "(tidak menjawab WS-Discovery)"))
        continue
    x = re.search(r"<[^>]*XAddrs[^>]*>([^<]+)<", r)
    scopes = re.search(r"<[^>]*Scopes[^>]*>([^<]+)<", r)
    merk = ""
    if scopes:
        hw = re.search(r"hardware/([^ ]+)", scopes.group(1))
        nm = re.search(r"name/([^ ]+)", scopes.group(1))
        merk = " | ".join(filter(None, [hw.group(1) if hw else "", nm.group(1) if nm else ""]))
    print("%-6s %-30s %-15s %s" % (cid, (nama or "")[:30], host,
                                   (x.group(1).strip() if x else "(tanpa XAddrs)")))
    if merk:
        print("%-6s %-30s %-15s   perangkat: %s" % ("", "", "", merk[:70]))
