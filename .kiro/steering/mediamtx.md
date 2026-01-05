# MediaMTX Configuration Rules

## CRITICAL: Do NOT Use These Settings

The following settings can break HLS streaming and cause 404 errors:

```yaml
# ❌ NEVER USE - causes 404 on HLS requests
hlsVariant: lowLatency
hlsPartDuration: 200ms

# ❌ AVOID - may cause issues with some camera codecs
hlsSegmentDuration: 1s  # Too short, use default or 2s minimum
hlsSegmentCount: 3      # Too few, use default 7
```

## Safe MediaMTX Configuration

Always use this basic, tested configuration:

```yaml
# Logging
logLevel: info          # Use 'info' for debugging, 'error' for production
logDestinations: [stdout]

# API
api: yes
apiAddress: :9997

# HLS - KEEP IT SIMPLE
hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsAllowOrigin: '*'
# DO NOT add hlsVariant, hlsPartDuration, or other advanced settings

# WebRTC
webrtc: yes
webrtcAddress: :8889
webrtcAllowOrigin: '*'

# RTMP
rtmp: yes
rtmpAddress: :1935

# RTSP
rtsp: yes
rtspAddress: :8554

# Paths managed by backend
paths:
  all_others: {}
```

## Why Low-Latency HLS Fails

1. **Codec incompatibility** - LL-HLS requires specific codec configurations (fMP4 with CMAF)
2. **Camera limitations** - Most IP cameras output H.264/MPEG-TS which doesn't support LL-HLS parts
3. **Version mismatch** - Older MediaMTX versions have bugs with hlsVariant

## Optimizing Stream Startup Time

Instead of modifying MediaMTX config, use these approaches:

### 1. Stream Pre-warming (Backend)
Keep streams active server-side so they're ready when users request them.
See `backend/services/streamWarmer.js`

### 2. Frontend HLS.js Optimization
```javascript
const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,  // Keep false for compatibility
    backBufferLength: 30,
    maxBufferLength: 30,
});
```

### 3. sourceOnDemand Settings
In path config via API:
```json
{
    "sourceOnDemand": true,
    "sourceOnDemandStartTimeout": "10s",
    "sourceOnDemandCloseAfter": "30s"
}
```

## Troubleshooting

### HLS Returns 404
1. Check MediaMTX is running: `curl http://localhost:9997/v3/config/global/get`
2. Check path exists: `curl http://localhost:9997/v3/paths/list`
3. Check path config: `curl http://localhost:9997/v3/config/paths/get/camera1`
4. Verify RTSP source is reachable from server

### Stream Not Starting
1. Trigger stream manually: `curl http://localhost:8888/camera1/index.m3u8`
2. Wait 5-10 seconds for RTSP connection
3. Check MediaMTX logs: `pm2 logs mediamtx`

### After Config Changes
Always restart MediaMTX:
```bash
pm2 restart mediamtx
# or
systemctl restart cctv-mediamtx
```

## Port Reference

| Port | Service | Purpose |
|------|---------|---------|
| 8554 | RTSP | RTSP streaming |
| 8888 | HLS | HTTP Live Streaming |
| 8889 | WebRTC | WebRTC streaming |
| 9997 | API | MediaMTX management API |
| 1935 | RTMP | RTMP streaming |
