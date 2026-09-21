#!/usr/bin/env bash
# Purpose: Repeatable read-only security probe of the live public surface — automates the
#          probe matrix + payload scan in .devin/skills/security-audit/SKILL.md. Fails
#          (exit 1) when any private/subscriber camera leaks or a public payload carries
#          credentials/PII. Pure HTTP: safe to run from anywhere, no prod mutation.
# Caller:  Operator/CI:
#            bash ops/security-probe.sh --base https://cctv.raf.my.id \
#                --private "3:uuid-key-a,7:uuid-key-b" --community "12:uuid-key-c"
#          or auto-discover the must-be-invisible set over SSH (read-only SELECT):
#            SSH_PASS=... bash ops/security-probe.sh --ssh root@192.168.102.100:2222
# Deps:    bash, curl, awk; --ssh mode additionally needs sshpass (or key auth) + sqlite3
#          on the remote box. No write access anywhere.
# MainFuncs: parse args → (optional) SSH discovery of private set → HTTP probe matrix →
#            public-payload credential/PII scan → PASS/FAIL table + exit code.
# SideEffects: none (GET/POST probes only; never logs secret VALUES — only paths/fields).

set -euo pipefail

BASE_URL="https://cctv.raf.my.id"
SSH_TARGET=""            # user@host:port — enables auto-discovery + infra checks
PRIVATE_SET=""           # "id:stream_key,id:stream_key,..."
COMMUNITY=""             # "id:stream_key" positive control
DB_PATH="/root/cctv/backend/data/cctv.db"  # prod default; override with --db
APP_DIR="${APP_DIR:-/var/www/rafnet-cctv}"   # deploy root for the .env perms check

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;36m'; NC=$'\033[0m'
info() { echo -e "${BLUE}i${NC} $1"; }
hr()   { echo "------------------------------------------------------------"; }
PASS_COUNT=0; FAIL_COUNT=0; WARN_COUNT=0
report() { # report <PASS|FAIL|WARN> <probe> <expected> <actual>
    local tag="$1"; shift
    case "$tag" in
        PASS) PASS_COUNT=$((PASS_COUNT+1)); echo -e "  ${GREEN}PASS${NC} $1 — $2";;
        WARN) WARN_COUNT=$((WARN_COUNT+1)); echo -e "  ${YELLOW}WARN${NC} $1 — $2";;
        FAIL) FAIL_COUNT=$((FAIL_COUNT+1)); echo -e "  ${RED}FAIL${NC} $1 — expected: $2, got: $3";;
    esac
}

usage() {
    cat <<'EOF'
Usage: ops/security-probe.sh [options]
  --base URL            Public origin (default https://cctv.raf.my.id)
  --private "id:key,…"  Must-be-invisible cameras (owner_private + subscriber)
  --community "id:key"  Published community camera (positive control)
  --ssh user@host:port  Auto-discover private/community set via read-only SQL
                        (SSH_PASS env for password auth via sshpass; else key auth)
  --db PATH             Remote DB path for --ssh discovery
  -h, --help            This help
EOF
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --base) BASE_URL="$2"; shift 2;;
        --private) PRIVATE_SET="$2"; shift 2;;
        --community) COMMUNITY="$2"; shift 2;;
        --ssh) SSH_TARGET="$2"; shift 2;;
        --db) DB_PATH="$2"; shift 2;;
        -h|--help) usage;;
        *) echo "Unknown arg: $1" >&2; usage;;
    esac
done

# ---------------------------------------------------------------------------
# HTTP helpers — status code only; bodies scanned separately, never echoed raw.
# ---------------------------------------------------------------------------
http_status() { # http_status <path> [extra curl args...]
    local path="$1"; shift
    curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" "${BASE_URL}${path}" || echo "000"
}

list_has_id() { # list_has_id <json-body-file> <id> → 0 if the id appears
    grep -Eq "\"id\":[[:space:]]*$2([^0-9]|$)" "$1"
}

# ---------------------------------------------------------------------------
# Step 1 (optional): discover the must-be-invisible set over SSH, read-only.
# ---------------------------------------------------------------------------
if [ -n "$SSH_TARGET" ]; then
    SSH_HOST="${SSH_TARGET%%:*}"; SSH_PORT="${SSH_TARGET##*:}"
    [ "$SSH_PORT" = "$SSH_TARGET" ] && SSH_PORT=22
    SSH_CMD=(ssh -p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
    [ -n "${SSH_KEY:-}" ] && SSH_CMD+=(-i "$SSH_KEY")
    if [ -n "${SSH_PASS:-}" ]; then
        command -v sshpass >/dev/null || { echo "sshpass needed for SSH_PASS auth" >&2; exit 2; }
        SSH_CMD=(sshpass -e ssh -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
    fi
    info "Discovering must-be-invisible set via SSH ($SSH_HOST) — read-only SELECT"
    PRIVATE_SET=$("${SSH_CMD[@]}" "$SSH_HOST" \
        "sqlite3 -separator : \"$DB_PATH\" \"SELECT id, stream_key FROM cameras WHERE camera_class IN ('owner_private','subscriber');\"" \
        | paste -sd, -) || true
    COMMUNITY=$("${SSH_CMD[@]}" "$SSH_HOST" \
        "sqlite3 -separator : \"$DB_PATH\" \"SELECT id, stream_key FROM cameras WHERE camera_class='community' AND enabled=1 LIMIT 1;\"" \
        ) || true
    info "Private set: $(echo "$PRIVATE_SET" | tr ',' ' ' | wc -w) camera(s); control: ${COMMUNITY%%:*}"
fi

[ -n "$PRIVATE_SET" ] || { echo "No private cameras to probe — pass --private or --ssh." >&2; exit 2; }
[ -n "$COMMUNITY" ] || { echo "No community control camera — pass --community or --ssh." >&2; exit 2; }

COMMUNITY_ID="${COMMUNITY%%:*}"; COMMUNITY_KEY="${COMMUNITY#*:}"
TMPDIR_PROBE="$(mktemp -d)"; trap 'rm -rf "$TMPDIR_PROBE"' EXIT

# ---------------------------------------------------------------------------
# Step 2: probe matrix — every private id against every surface.
# ---------------------------------------------------------------------------
echo; hr; echo "Probe matrix — must-be-invisible cameras"; hr
BODY_ACTIVE="$TMPDIR_PROBE/active.json"
curl -s --max-time 15 "${BASE_URL}/api/cameras/active" -o "$BODY_ACTIVE" || true

IFS=',' read -ra PAIRS <<< "$PRIVATE_SET"
for pair in $PRIVATE_SET; do :; done 2>/dev/null || true
for pair in "${PAIRS[@]}"; do
    PID="${pair%%:*}"; PKEY="${pair#*:}"
    [ -n "$PID" ] || continue
    echo "Camera #$PID"
    list_has_id "$BODY_ACTIVE" "$PID" \
        && report FAIL "/api/cameras/active" "id absent" "id PRESENT" \
        || report PASS "/api/cameras/active" "id absent"
    st=$(http_status "/api/stream/${PID}")
    [ "$st" = "404" ] && report PASS "/api/stream/:id" "404" || report FAIL "/api/stream/:id" "404" "$st"
    st=$(http_status "/api/stream/${PID}/token")
    [ "$st" = "404" ] && report PASS "/api/stream/:id/token" "404" || report FAIL "/api/stream/:id/token" "404" "$st"
    st=$(http_status "/api/stream/${PID}/live-token")
    { [ "$st" = "401" ] || [ "$st" = "404" ]; } && report PASS "/api/stream/:id/live-token" "401/404" || report FAIL "/api/stream/:id/live-token" "401/404" "$st"
    if [ "$PKEY" != "$PID" ] && [ -n "$PKEY" ]; then
        st=$(http_status "/hls/${PKEY}/index.m3u8" -H "Referer: ${BASE_URL}/")
        [ "$st" = "403" ] && report PASS "/hls/<key> (spoofed Referer)" "403" || report FAIL "/hls/<key> (spoofed Referer)" "403" "$st"
    fi
    st=$(http_status "/api/thumbnails/${PID}.jpg")
    { [ "$st" = "403" ] || [ "$st" = "404" ]; } && report PASS "/api/thumbnails/:id.jpg" "403/404" || report FAIL "/api/thumbnails/:id.jpg" "403/404" "$st"
    st=$(http_status "/api/recordings/${PID}/segments")
    { [ "$st" = "403" ] || [ "$st" = "404" ]; } && report PASS "/api/recordings/:id/segments" "403/404" || report FAIL "/api/recordings/:id/segments" "403/404" "$st"
    st=$(http_status "/api/recordings/${PID}/playlist.m3u8")
    { [ "$st" = "403" ] || [ "$st" = "404" ]; } && report PASS "/api/recordings/:id/playlist" "403/404" || report FAIL "/api/recordings/:id/playlist" "403/404" "$st"
    out=$(curl -s --max-time 15 -X POST -H 'Content-Type: application/json' \
        -d "{\"cameraId\":${PID},\"signal\":\"playing\"}" "${BASE_URL}/api/viewer/runtime-signal" || true)
    echo "$out" | grep -q '"ignored"[[:space:]]*:[[:space:]]*true' \
        && report PASS "runtime-signal (no session)" "ignored:true" \
        || report WARN "runtime-signal (no session)" "ignored:true, got: $(echo "$out" | cut -c1-60)"
    for list in "/api/public/discovery" "/api/public/trending-cameras" "/api/areas/public"; do
        f="$TMPDIR_PROBE/$(echo "$list" | tr '/:' '__').json"
        curl -s --max-time 15 "${BASE_URL}${list}" -o "$f" || true
        list_has_id "$f" "$PID" && report FAIL "$list" "id absent" "id PRESENT" || report PASS "$list" "id absent"
    done
    st=$(http_status "/api/public/cameras/${PID}/reaction")
    [ "$st" = "404" ] && report PASS "/api/public/cameras/:id/reaction" "404" || report WARN "/api/public/cameras/:id/reaction" "404" "$st"
done

# Positive control — community camera should be reachable.
echo "Community control #$COMMUNITY_ID"
st=$(http_status "/api/stream/${COMMUNITY_ID}")
[ "$st" = "200" ] && report PASS "/api/stream/:id (control)" "200" || report WARN "/api/stream/:id (control)" "200" "$st"
st=$(http_status "/api/admin/debug/camera-health")
{ [ "$st" = "401" ] || [ "$st" = "403" ]; } && report PASS "/api/admin/* anonymous" "401/403" || report FAIL "/api/admin/* anonymous" "401/403" "$st"

# ---------------------------------------------------------------------------
# Step 3: credential/PII scan on public JSON bodies (never echo matched values).
# ---------------------------------------------------------------------------
echo; hr; echo "Payload hygiene — public JSON bodies"; hr
scan_body() { # scan_body <file> <label>
    local f="$1" label="$2"
    grep -Eqi 'rtsp://|rtmp://|onvif' "$f" && report FAIL "$label" "no rtsp/rtmp/onvif" "pattern found" \
        || report PASS "$label" "no rtsp/rtmp/onvif"
    grep -Eq '[a-zA-Z]+://[^/?#[:space:]"'"'"']+@' "$f" && report FAIL "$label" "no userinfo creds" "URL credential found" \
        || report PASS "$label" "no userinfo creds"
    grep -Eqi '"[^"]*(password|passwd|secret|api_?key)[^"]*"[[:space:]]*:' "$f" && report FAIL "$label" "no secret fields" "field found" \
        || report PASS "$label" "no secret fields"
    grep -Eqi '"[^"]*(email|phone|whatsapp|owner_?name|username)[^"]*"[[:space:]]*:' "$f" && report WARN "$label" "no PII fields" "PII-shaped field found" \
        || report PASS "$label" "no PII fields"
}
scan_body "$BODY_ACTIVE" "/api/cameras/active"
for list in "/api/public/discovery" "/api/public/trending-cameras" "/api/areas/public"; do
    f="$TMPDIR_PROBE/$(echo "$list" | tr '/:' '__').json"
    [ -s "$f" ] && scan_body "$f" "$list"
done
# token= is by-design ONLY inside external_*_url of community cameras (ZoneMinder JWT).
grep -o '"[^"]*"[[:space:]]*:[[:space:]]*"[^"]*token=' "$BODY_ACTIVE" | grep -v 'external_' | head -1 | grep -q . \
    && report FAIL "/api/cameras/active" "token= only in external_*_url" "token= outside external_*_url" \
    || report PASS "/api/cameras/active" "token= only in external_*_url"

# ---------------------------------------------------------------------------
# Step 4: security headers — CSP on the document, hardened set, no duplicates.
# A proxied response used to emit each header twice (nginx add_header inherits
# into proxy locations AND Fastify set its own) — count occurrences, not just
# presence.
# ---------------------------------------------------------------------------
echo; hr; echo "Security headers"; hr
HDR_HTML="$TMPDIR_PROBE/headers-html.txt"; HDR_API="$TMPDIR_PROBE/headers-api.txt"
curl -sI --max-time 15 "$BASE_URL/" -o "$HDR_HTML" || true
curl -sI --max-time 15 "$BASE_URL/api/cameras/active" -o "$HDR_API" || true

header_count() { grep -ciE "^$2:" "$1" || true; }

grep -qi '^content-security-policy:.*default-src' "$HDR_HTML" \
    && report PASS "/ CSP" "present" \
    || report FAIL "/ CSP" "present" "absent"
grep -qi 'frame-ancestors' "$HDR_HTML" \
    && report PASS "/ CSP frame-ancestors" "present" \
    || report FAIL "/ CSP frame-ancestors" "present" "absent"
grep -qi '^strict-transport-security:' "$HDR_HTML" \
    && report PASS "/ HSTS" "present" \
    || report WARN "/ HSTS" "present" "absent"
grep -qi '^x-xss-protection: 0' "$HDR_HTML" \
    && report PASS "/ X-XSS-Protection" "0 (auditor off)" \
    || report FAIL "/ X-XSS-Protection" "0" "$(grep -i '^x-xss-protection' "$HDR_HTML" | tr -d '\r')"
for h in x-frame-options x-content-type-options x-xss-protection content-security-policy; do
    n=$(header_count "$HDR_API" "$h")
    [ "$n" -le 1 ] && report PASS "/api/ $h count" "<=1" || report FAIL "/api/ $h count" "<=1" "$n (duplicate headers)"
done
grep -qi '^server: cloudflare' "$HDR_HTML" || true  # informational only

# ---------------------------------------------------------------------------
# Step 5 (optional, --ssh only): infra exposure — bind addresses + env perms.
# ---------------------------------------------------------------------------
if [ -n "$SSH_TARGET" ]; then
    echo; hr; echo "Infra exposure (SSH, read-only)"; hr
    LISTEN=$("${SSH_CMD[@]}" "$SSH_HOST" "ss -tln 2>/dev/null" || true)
    for port in 8554 8888 8889 9997 1935; do
        echo "$LISTEN" | awk '{print $4}' | grep -Eq "(^|:)0\.0\.0\.0:${port}$|\*:${port}$|\[::\]:${port}$" \
            && report FAIL "MediaMTX :${port}" "localhost only" "wildcard bind" \
            || report PASS "MediaMTX :${port}" "localhost only"
    done
    PERMS=$("${SSH_CMD[@]}" "$SSH_HOST" "stat -c '%a' \"$APP_DIR/backend/.env\" 2>/dev/null || stat -c '%a' /root/cctv/backend/.env 2>/dev/null" || true)
    [ "$PERMS" = "600" ] && report PASS "backend/.env perms" "600" || report WARN "backend/.env perms" "600" "${PERMS:-unknown}"
fi

# ---------------------------------------------------------------------------
echo; hr
echo -e "Result: ${GREEN}${PASS_COUNT} PASS${NC}, ${YELLOW}${WARN_COUNT} WARN${NC}, ${RED}${FAIL_COUNT} FAIL${NC}"
[ "$FAIL_COUNT" -eq 0 ] || { echo "CRITICAL: private-camera leak or credential exposure — see FAIL rows." >&2; exit 1; }
