#!/usr/bin/env python3
"""ONVIF PullPoint motion subscriber — prints motion events as JSON lines. Detection ONLY (no side effects).

Env: CAM_IP, CAM_USER, CAM_PASS, ONVIF_PORT(=80), RUN_SECONDS(0=forever).
Stdout: {"status":"subscribed"|"done"|"subscribe_error"|"pull_error", ...} and {"event":"signal", name, value, topic}.

Verified working against the internal IMOU cameras (subscribe + pull loop + WS-Security PasswordDigest).
The caller (audioMotionService) applies ALL the safety policy (arm window, debounce, cooldown, hourly cap);
this script only reports raw signals. It NEVER touches the audio backchannel.
"""
import os
import sys
import base64
import hashlib
import datetime
import time
import json
import re
import urllib.request

IP = os.environ["CAM_IP"]
USER = os.environ.get("CAM_USER", "")
PASS = os.environ.get("CAM_PASS", "")
PORT = os.environ.get("ONVIF_PORT", "80")
EVENT_URL_DEFAULT = f"http://{IP}:{PORT}/onvif/event_service"
RUN_SECONDS = int(os.environ.get("RUN_SECONDS", "0") or "0")


def wsse():
    created = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    nonce = os.urandom(16)
    digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + PASS.encode()).digest()).decode()
    n64 = base64.b64encode(nonce).decode()
    return (
        '<wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" '
        'xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">'
        f"<wsse:UsernameToken><wsse:Username>{USER}</wsse:Username>"
        f'<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{digest}</wsse:Password>'
        f'<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{n64}</wsse:Nonce>'
        f"<wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security>"
    )


def soap(url, body):
    env = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
        'xmlns:tev="http://www.onvif.org/ver10/events/wsdl" '
        'xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2" '
        'xmlns:wsa="http://www.w3.org/2005/08/addressing">'
        f"<s:Header>{wsse()}</s:Header><s:Body>{body}</s:Body></s:Envelope>"
    )
    req = urllib.request.Request(url, data=env.encode(), headers={"Content-Type": "application/soap+xml; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def main():
    create_body = "<tev:CreatePullPointSubscription><tev:InitialTerminationTime>PT120S</tev:InitialTerminationTime></tev:CreatePullPointSubscription>"
    try:
        resp = soap(EVENT_URL_DEFAULT, create_body)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"status": "subscribe_error", "error": str(e)[:200]}), flush=True)
        return 2
    m = re.search(r"<[^>]*Address[^>]*>\s*([^<\s]+)\s*</[^>]*Address>", resp)
    pull_url = m.group(1) if m else EVENT_URL_DEFAULT
    print(json.dumps({"status": "subscribed", "pull_url": pull_url[:120]}), flush=True)

    started = time.time()
    renew_at = started + 80
    pull_body = "<tev:PullMessages><tev:Timeout>PT15S</tev:Timeout><tev:MessageLimit>10</tev:MessageLimit></tev:PullMessages>"
    while True:
        if RUN_SECONDS and time.time() - started > RUN_SECONDS:
            print(json.dumps({"status": "done"}), flush=True)
            return 0
        try:
            resp = soap(pull_url, pull_body)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"status": "pull_error", "error": str(e)[:160]}), flush=True)
            time.sleep(2)
            continue
        for block in re.findall(r"<[^>]*NotificationMessage[^>]*>.*?</[^>]*NotificationMessage>", resp, re.S):
            topic = ""
            tm = re.search(r"<[^>]*Topic[^>]*>(.*?)</[^>]*Topic>", block, re.S)
            if tm:
                topic = re.sub(r"<[^>]+>", "", tm.group(1)).strip()
            for name, val in re.findall(r'<[^>]*SimpleItem[^>]*Name="([^"]+)"[^>]*Value="([^"]+)"', block):
                if re.search(r"motion|state|ismotion", name, re.I) or re.search(r"motion", topic, re.I):
                    print(json.dumps({"event": "signal", "name": name, "value": val, "topic": topic[:80]}), flush=True)
        if time.time() > renew_at:
            try:
                soap(pull_url, "<wsnt:Renew><wsnt:TerminationTime>PT120S</wsnt:TerminationTime></wsnt:Renew>")
                renew_at = time.time() + 80
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
