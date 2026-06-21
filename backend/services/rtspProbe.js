/**
 * rtspProbe.js
 * Purpose: Self-contained RTSP DESCRIBE reachability probe (digest/basic auth,
 *   single-socket challenge-response + fresh-socket fallback). Extracted verbatim
 *   from cameraHealthService.js to keep that service navigable; behavior unchanged.
 * Caller: cameraHealthService.probeInternalRtspSource + its named re-export.
 * Deps: node crypto, net. No app/DB state; pure of class.
 */
import crypto from 'crypto';
import net from 'net';

function parseRtspResponse(rawResponse) {
    const raw = String(rawResponse || '');
    const [headerBlock = ''] = raw.split('\r\n\r\n');
    const lines = headerBlock
        .split('\r\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return null;
    }

    const statusLine = lines[0];
    const match = statusLine.match(/^RTSP\/1\.\d\s+(\d{3})\s*(.*)$/i);
    if (!match) {
        return null;
    }

    const headers = {};
    for (const line of lines.slice(1)) {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
            continue;
        }
        const headerName = line.slice(0, separatorIndex).trim().toLowerCase();
        const headerValue = line.slice(separatorIndex + 1).trim();
        // A camera may send multiple WWW-Authenticate challenges on
        // separate lines (e.g. `Digest ...` AND `Basic ...`). A naive
        // last-wins assignment lets the weaker Basic challenge clobber
        // the Digest one, so we fall back to Basic auth and some
        // firmwares then reject the request (observed: RtpRtspFlyer
        // cameras answering 454). Keep the Digest challenge if we have
        // one already and the incoming line is not Digest.
        if (headerName === 'www-authenticate' && headers[headerName]) {
            const existingIsDigest = /^digest/i.test(headers[headerName]);
            const incomingIsDigest = /^digest/i.test(headerValue);
            if (existingIsDigest && !incomingIsDigest) {
                continue;
            }
        }
        headers[headerName] = headerValue;
    }

    return {
        statusCode: parseInt(match[1], 10),
        statusText: match[2] || '',
        headers,
        raw,
    };
}

function parseRtspAuthHeader(headerValue) {
    const normalized = String(headerValue || '').trim();
    if (!normalized) {
        return null;
    }

    const [schemeRaw, ...rest] = normalized.split(/\s+/);
    const scheme = (schemeRaw || '').trim();
    const parameterString = rest.join(' ').trim();
    const parameters = {};
    const regex = /([a-z0-9_-]+)=("([^"]*)"|([^,]+))/gi;
    let match = regex.exec(parameterString);

    while (match) {
        parameters[match[1].toLowerCase()] = (match[3] ?? match[4] ?? '').trim();
        match = regex.exec(parameterString);
    }

    return {
        scheme: scheme.toLowerCase(),
        parameters,
    };
}

function buildDigestAuthorization({ method, uri, username, password, challenge }) {
    const realm = challenge?.parameters?.realm;
    const nonce = challenge?.parameters?.nonce;
    if (!realm || !nonce || !username) {
        return null;
    }

    const qopRaw = challenge.parameters.qop || '';
    const qop = qopRaw
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .find((value) => value === 'auth');
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
    const response = qop
        ? crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex')
        : crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');

    const parts = [
        `username="${username}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${uri}"`,
        `response="${response}"`,
    ];

    if (challenge.parameters.opaque) {
        parts.push(`opaque="${challenge.parameters.opaque}"`);
    }
    if (qop) {
        parts.push(`qop=${qop}`);
        parts.push(`nc=${nc}`);
        parts.push(`cnonce="${cnonce}"`);
    }
    if (challenge.parameters.algorithm) {
        parts.push(`algorithm=${challenge.parameters.algorithm}`);
    }

    return `Digest ${parts.join(', ')}`;
}

function buildBasicAuthorization({ username, password }) {
    if (!username) {
        return null;
    }
    const token = Buffer.from(`${username}:${password || ''}`).toString('base64');
    return `Basic ${token}`;
}

function buildRtspRequest({ method, uri, cseq, authorization = null }) {
    const lines = [
        `${method} ${uri} RTSP/1.0`,
        `CSeq: ${cseq}`,
        'User-Agent: RAF-NET-CCTV-Health/1.0',
        'Accept: application/sdp',
    ];

    if (authorization) {
        lines.push(`Authorization: ${authorization}`);
    }

    return `${lines.join('\r\n')}\r\n\r\n`;
}

function sendRtspRequest({ host, port, request, timeoutMs = 4000 }) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        let buffer = '';

        const settle = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
            socket.write(request);
        });

        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            if (buffer.includes('\r\n\r\n')) {
                const parsed = parseRtspResponse(buffer);
                settle(parsed || { errorCode: 'request_error', raw: buffer });
            }
        });

        socket.on('timeout', () => {
            settle({ errorCode: 'ETIMEDOUT' });
        });

        socket.on('error', (error) => {
            settle({ errorCode: error?.code || 'request_error' });
        });

        socket.connect(port, host);
    });
}

/**
 * Multi-request RTSP session over a single TCP connection.
 *
 * Why this exists separately from sendRtspRequest:
 *   The Surabaya / Dishub edishub cameras (HIK Media Server V4.51.127
 *   firmware, ~36.66.208.98) generate a fresh digest nonce for every
 *   new TCP connection. If the challenge-response pair is split across
 *   two sockets — like `sendRtspRequest` did originally — the second
 *   socket sees a brand-new nonce, refuses our reply built from the
 *   first socket's nonce, and the probe scores 401 → camera reported
 *   offline despite being fully reachable. VLC and FFmpeg succeed
 *   because they keep one socket open for the whole DESCRIBE → SETUP
 *   → PLAY flow. We do the equivalent: one socket, two DESCRIBE
 *   passes, settle after the second response (or any error along the
 *   way).
 */
function runRtspChallengeResponseSession({ host, port, firstRequest, buildSecondRequest, timeoutMs = 4000 }) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        let buffer = '';
        let stage = 'first';
        let firstResponse = null;

        const settle = (result) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(timeoutMs);

        const consumeResponse = () => {
            // Parse one complete RTSP message header out of the
            // buffer; only the head is needed — DESCRIBE bodies are
            // SDP and ignored by the probe. Body length is bounded
            // by Content-Length so we leave any trailing bytes in
            // place for a possible second response.
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return null;
            const headerChunk = buffer.slice(0, headerEnd + 4);
            const contentLengthMatch = headerChunk.match(/Content-Length:\s*(\d+)/i);
            const bodyLength = contentLengthMatch ? Number.parseInt(contentLengthMatch[1], 10) : 0;
            const totalLength = headerChunk.length + (Number.isFinite(bodyLength) ? bodyLength : 0);
            if (buffer.length < totalLength) return null;
            const messageBytes = buffer.slice(0, totalLength);
            buffer = buffer.slice(totalLength);
            return parseRtspResponse(messageBytes) || { errorCode: 'request_error', raw: messageBytes };
        };

        socket.on('connect', () => {
            socket.write(firstRequest);
        });

        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            // Loop because data events may carry both responses if the
            // server is fast / TCP coalesces. Without the loop, a
            // batched read would leave the second response unparsed.
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const parsed = consumeResponse();
                if (!parsed) return;

                if (stage === 'first') {
                    firstResponse = parsed;
                    // Fast paths that don't need a second pass: a
                    // direct 200 (auth not required) or a non-401
                    // failure — return the first response as-is.
                    if (parsed.statusCode !== 401) {
                        settle({ firstResponse, authenticatedResponse: null });
                        return;
                    }
                    const secondRequest = buildSecondRequest(parsed);
                    if (!secondRequest) {
                        settle({ firstResponse, authenticatedResponse: null });
                        return;
                    }
                    stage = 'second';
                    // Reuse the SAME socket so the server's per-
                    // connection nonce is still valid.
                    socket.write(secondRequest);
                    continue;
                }

                settle({ firstResponse, authenticatedResponse: parsed });
                return;
            }
        });

        socket.on('timeout', () => {
            settle({ firstResponse, authenticatedResponse: null, errorCode: 'ETIMEDOUT' });
        });

        socket.on('error', (error) => {
            settle({ firstResponse, authenticatedResponse: null, errorCode: error?.code || 'request_error' });
        });

        // 'close' is the catch-all for "server hung up before we got
        // pass 2's response". On Linux a remote-side `socket.end()`
        // right after a 401 manifests as FIN → 'end' → 'close' WITHOUT
        // any 'error' (the write into a half-closed socket can silently
        // succeed at the syscall level, then the connection just goes
        // away). Without this listener we'd sit on the inactivity
        // timer for the full timeoutMs, delaying the fresh-socket
        // fallback in probeRtspSource by a wasted 4 s per camera tick.
        socket.on('close', () => {
            settle({
                firstResponse,
                authenticatedResponse: null,
                errorCode: stage === 'first' ? 'connection_closed_before_first_response' : 'connection_closed_before_auth_response',
            });
        });

        socket.connect(port, host);
    });
}

async function probeRtspSource(rtspUrl, timeoutMs = 4000) {
    let parsedUrl;
    try {
        parsedUrl = new URL(rtspUrl);
    } catch {
        return {
            online: false,
            reason: 'invalid_rtsp_url',
            details: {
                probeTarget: rtspUrl,
            },
        };
    }

    const host = parsedUrl.hostname;
    const port = parseInt(parsedUrl.port, 10) || 554;
    const requestUri = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}`;
    const username = decodeURIComponent(parsedUrl.username || '');
    const password = decodeURIComponent(parsedUrl.password || '');

    const firstRequest = buildRtspRequest({
        method: 'DESCRIBE',
        uri: requestUri,
        cseq: 1,
    });

    // Run the whole challenge → response handshake on ONE TCP socket.
    // See runRtspChallengeResponseSession's header for the rationale.
    const session = await runRtspChallengeResponseSession({
        host,
        port,
        firstRequest,
        timeoutMs,
        buildSecondRequest: (firstResponse) => {
            const challenge = parseRtspAuthHeader(firstResponse.headers['www-authenticate']);
            const authorization = challenge?.scheme === 'digest'
                ? buildDigestAuthorization({
                    method: 'DESCRIBE',
                    uri: requestUri,
                    username,
                    password,
                    challenge,
                })
                : challenge?.scheme === 'basic'
                    ? buildBasicAuthorization({ username, password })
                    : null;
            if (!authorization) {
                return null;
            }
            return buildRtspRequest({
                method: 'DESCRIBE',
                uri: requestUri,
                cseq: 2,
                authorization,
            });
        },
    });

    const firstResponse = session?.firstResponse || null;
    // `let` — the hybrid fallback below may need to retry pass 2 on a
    // fresh socket when the same-socket attempt bailed mid-write.
    let authenticatedResponse = session?.authenticatedResponse || null;

    if (!firstResponse || (firstResponse.errorCode && !firstResponse.statusCode)) {
        return {
            online: false,
            reason: session?.errorCode || firstResponse?.errorCode || 'internal_stream_unreachable',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
            },
        };
    }

    if (firstResponse.statusCode === 200) {
        return {
            online: true,
            reason: 'rtsp_describe_ok',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: firstResponse.statusCode,
            },
        };
    }

    if ([404, 454].includes(firstResponse.statusCode)) {
        return {
            online: false,
            reason: 'rtsp_stream_not_found',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: firstResponse.statusCode,
            },
        };
    }

    if (firstResponse.statusCode !== 401) {
        return {
            online: false,
            reason: 'internal_stream_unreachable',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: firstResponse.statusCode,
            },
        };
    }

    const challenge = parseRtspAuthHeader(firstResponse.headers['www-authenticate']);

    // Hybrid fallback. Many DVR / NVR firmwares (older Dahua, generic
    // ONVIF cameras, the bulk of the user's "local CCTV" cluster) CLOSE
    // the TCP connection right after sending the 401 challenge — they
    // treat each request as a new session and expect the client to
    // reconnect for the second DESCRIBE. The HIK Surabaya firmware does
    // the opposite (keeps the connection open AND rotates the nonce per
    // connection, so a new socket would get a new nonce and never
    // authenticate).
    //
    // We pick the universally-compatible route: try the same-socket
    // handshake first (which the previous commit added for HIK). If
    // pass 2 didn't make it through — server closed the socket, write
    // raced the close, ECONNRESET, ETIMEDOUT mid-write — fall back to
    // a fresh-socket pass 2 with the EXACT challenge we received in
    // pass 1. Firmware that ignores connection identity for nonce
    // validity (the local CCTV majority) accepts this and returns 200;
    // firmware that rotates the nonce (HIK Surabaya) already settled
    // via the same-socket attempt above and never reaches this branch.
    if (!authenticatedResponse && challenge) {
        const fallbackAuthorization = challenge.scheme === 'digest'
            ? buildDigestAuthorization({
                method: 'DESCRIBE',
                uri: requestUri,
                username,
                password,
                challenge,
            })
            : challenge.scheme === 'basic'
                ? buildBasicAuthorization({ username, password })
                : null;

        if (fallbackAuthorization) {
            authenticatedResponse = await sendRtspRequest({
                host,
                port,
                request: buildRtspRequest({
                    method: 'DESCRIBE',
                    uri: requestUri,
                    cseq: 2,
                    authorization: fallbackAuthorization,
                }),
                timeoutMs,
            });
        }
    }

    if (!authenticatedResponse) {
        // Both the same-socket attempt AND the fresh-socket fallback
        // failed (or buildSecondRequest returned null because the auth
        // scheme is unsupported / username missing). Map to a single
        // "tried to auth and could not" reason.
        return {
            online: false,
            reason: session?.errorCode || 'rtsp_auth_failed',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: firstResponse.statusCode,
                rtspAuthScheme: challenge?.scheme || null,
            },
        };
    }

    if (authenticatedResponse.errorCode && !authenticatedResponse.statusCode) {
        return {
            online: false,
            reason: authenticatedResponse.errorCode,
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspAuthScheme: challenge?.scheme || null,
            },
        };
    }

    if (authenticatedResponse.statusCode === 200) {
        return {
            online: true,
            reason: 'rtsp_auth_ok',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: authenticatedResponse.statusCode,
                rtspAuthScheme: challenge?.scheme || null,
            },
        };
    }

    if ([404, 454].includes(authenticatedResponse.statusCode)) {
        return {
            online: false,
            reason: 'rtsp_stream_not_found',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: authenticatedResponse.statusCode,
                rtspAuthScheme: challenge?.scheme || null,
            },
        };
    }

    return {
        online: false,
        reason: authenticatedResponse.statusCode === 401 ? 'rtsp_auth_failed' : 'internal_stream_unreachable',
        details: {
            probeTarget: rtspUrl,
            rtspHost: host,
            rtspPort: port,
            rtspStatusCode: authenticatedResponse.statusCode,
            rtspAuthScheme: challenge?.scheme || null,
        },
    };
}

export { probeRtspSource };
