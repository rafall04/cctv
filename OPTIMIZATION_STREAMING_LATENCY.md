# Streaming Latency Optimization Guide

## Current Latency Analysis

### Measured Latency Breakdown
```
Total Latency: ~5-8 seconds
├── RTSP Pull: 2-3s (camera → MediaMTX)
├── HLS Segmentation: 2-3s (MediaMTX processing)
├── Network Hops: 1-2s (client → nginx → backend → mediamtx)
└── Browser Buffering: 1-2s (HLS.js initial buffer)
```

## Target: <3 Second Latency

### Strategy 1: Direct MediaMTX Access with Pre-signed URLs ⭐ RECOMMENDED

**Concept**: Bypass backend proxy, use pre-signed URLs for direct MediaMTX access

```
BEFORE: Client → Nginx → Backend → MediaMTX (4 hops)
AFTER:  Client → Nginx → MediaMTX (2 hops)
```

**Implementation**:

#### Backend: Generate Pre-signed HLS URLs
```javascript
// backend/controllers/streamController.js
import crypto from 'crypto';

export async function generatePresignedStreamUrl(request, reply) {
    const { cameraId } = request.params;
    const camera = queryOne('SELECT id, stream_key FROM cameras WHERE id = ? AND enabled = 1', [cameraId]);
    
    if (!camera) {
        return reply.code(404).send({ success: false, message: 'Camera not found' });
    }
    
    const streamPath = camera.stream_key || `camera${camera.id}`;
    const expiresAt = Date.now() + 3600000; // 1 hour
    
    // Generate HMAC signature
    const signature = crypto
        .createHmac('sha256', config.jwt.secret)
        .update(`${streamPath}:${expiresAt}`)
        .digest('hex');
    
    // Build direct MediaMTX URL with signature
    const baseUrl = config.mediamtx.publicHlsUrl || '/hls';
    const signedUrl = `${baseUrl}/${streamPath}/index.m3u8?expires=${expiresAt}&signature=${signature}`;
    
    return reply.send({
        success: true,
        data: {
            streamUrl: signedUrl,
            expiresAt,
        },
    });
}
```

#### Nginx: Validate Signature Before Proxying
```nginx
# deployment/nginx.conf

# Lua script for signature validation
location /hls/ {
    access_by_lua_block {
        local expires = ngx.var.arg_expires
        local signature = ngx.var.arg_signature
        local path = ngx.var.uri
        
        -- Check expiration
        if not expires or tonumber(expires) < ngx.time() * 1000 then
            ngx.exit(403)
        end
        
        -- Validate signature
        local secret = os.getenv("JWT_SECRET")
        local expected = ngx.hmac_sha256(secret, path .. ":" .. expires)
        
        if signature ~= expected then
            ngx.exit(403)
        end
    }
    
    # Proxy to MediaMTX
    proxy_pass http://localhost:8888;
    proxy_buffering off;
    proxy_cache off;
}
```

**Latency Reduction**: ~1-2 seconds (eliminates backend hop)

---

### Strategy 2: MediaMTX Low-Latency Configuration

**Current Issue**: Default HLS segment duration (2s) causes buffering

**Solution**: Optimize MediaMTX for low latency

```yaml
# deployment/mediamtx.yml

hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsAllowOrigin: '*'

# Low-latency settings
hlsSegmentDuration: 1s        # Reduce segment size (was 2s)
hlsSegmentCount: 3            # Reduce segment count (was 7)
hlsPartDuration: 200ms        # Enable LL-HLS parts

# CRITICAL: Use fMP4 for LL-HLS support
hlsVariant: fmp4              # Use fMP4 instead of MPEG-TS
```

**Frontend: Enable LL-HLS in HLS.js**
```javascript
// frontend/src/utils/hlsConfig.js

export const getLowLatencyHLSConfig = (deviceTier) => {
    return {
        ...getHLSConfig(deviceTier),
        
        // Enable Low-Latency HLS
        lowLatencyMode: true,
        
        // Reduce buffer for lower latency
        maxBufferLength: 10,      // 10 seconds (was 15-30s)
        backBufferLength: 5,      // 5 seconds (was 10-30s)
        
        // Faster fragment loading
        fragLoadingTimeOut: 2000,
        manifestLoadingTimeOut: 2000,
        
        // Live sync
        liveSyncDuration: 1,      // Stay 1 second behind live edge
        liveMaxLatencyDuration: 3, // Max 3 seconds behind
    };
};
```

**Latency Reduction**: ~2-3 seconds (faster segmentation + smaller buffers)

---

### Strategy 3: WebRTC Fallback for Ultra-Low Latency

**Concept**: Use WebRTC for <1 second latency, fallback to HLS

```javascript
// frontend/src/utils/streamProtocolSelector.js

export const selectOptimalProtocol = (camera, deviceCapabilities) => {
    // WebRTC for ultra-low latency (if supported)
    if (deviceCapabilities.supportsWebRTC && camera.streams.webrtc) {
        return {
            protocol: 'webrtc',
            url: camera.streams.webrtc,
            latency: '<1s',
        };
    }
    
    // HLS for compatibility
    return {
        protocol: 'hls',
        url: camera.streams.hls,
        latency: '2-3s',
    };
};
```

**MediaMTX WebRTC Configuration**:
```yaml
webrtc: yes
webrtcAddress: :8889
webrtcAllowOrigin: '*'

# ICE servers for NAT traversal
webrtcICEServers:
  - urls: [stun:stun.l.google.com:19302]
```

**Latency**: <1 second (WebRTC native)

---

### Strategy 4: Edge Caching with CDN

**Concept**: Cache HLS segments at edge locations

```nginx
# Nginx HLS caching
proxy_cache_path /var/cache/nginx/hls levels=1:2 keys_zone=hls_cache:10m max_size=1g inactive=10m;

location /hls/ {
    proxy_cache hls_cache;
    proxy_cache_valid 200 5s;  # Cache segments for 5 seconds
    proxy_cache_key "$uri$is_args$args";
    
    # Add cache status header
    add_header X-Cache-Status $upstream_cache_status;
    
    proxy_pass http://localhost:8888;
}
```

**Latency Reduction**: ~500ms-1s (for subsequent viewers)

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
- [ ] Optimize MediaMTX segment duration (1s)
- [ ] Reduce HLS.js buffer sizes
- [ ] Enable Nginx HLS caching

**Expected Latency**: 3-4 seconds

### Phase 2: Direct Access (3-5 days)
- [ ] Implement pre-signed URLs
- [ ] Add Nginx signature validation
- [ ] Update frontend to use direct URLs

**Expected Latency**: 2-3 seconds

### Phase 3: WebRTC Fallback (1 week)
- [ ] Implement WebRTC player
- [ ] Add protocol selection logic
- [ ] Fallback mechanism

**Expected Latency**: <1 second (WebRTC), 2-3s (HLS fallback)

### Phase 4: CDN Integration (2 weeks)
- [ ] Setup CloudFlare/AWS CloudFront
- [ ] Configure edge caching
- [ ] Geo-routing

**Expected Latency**: <2 seconds globally

---

## Testing & Validation

### Latency Measurement Script
```javascript
// frontend/src/utils/latencyMeasurement.js

export const measureStreamLatency = async (streamUrl) => {
    const startTime = performance.now();
    
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        
        const hls = new Hls();
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play();
        });
        
        video.addEventListener('playing', () => {
            const latency = performance.now() - startTime;
            hls.destroy();
            resolve({
                latency: Math.round(latency),
                timestamp: new Date().toISOString(),
            });
        });
        
        // Timeout after 15 seconds
        setTimeout(() => {
            hls.destroy();
            resolve({ latency: -1, error: 'timeout' });
        }, 15000);
    });
};
```

### Benchmark Results Target
```
Protocol    | Latency | Use Case
------------|---------|------------------
WebRTC      | <1s     | Live monitoring
LL-HLS      | 2-3s    | General viewing
Standard HLS| 3-5s    | Fallback/legacy
```

---

## Cost-Benefit Analysis

| Strategy | Implementation Cost | Latency Gain | Complexity |
|----------|-------------------|--------------|------------|
| MediaMTX Optimization | Low (config change) | 1-2s | Low |
| Direct Access | Medium (code changes) | 1-2s | Medium |
| WebRTC | High (new protocol) | 4-5s | High |
| CDN | High (infrastructure) | 1-2s | High |

**Recommended**: Start with MediaMTX optimization + Direct Access for best ROI.

---

## Monitoring & Alerts

### Key Metrics to Track
- Stream start time (target: <3s)
- Buffering frequency (target: <5% of playback time)
- Error rate (target: <1%)
- Concurrent viewers per camera

### Alert Thresholds
```javascript
// backend/services/streamMonitoring.js

const ALERT_THRESHOLDS = {
    streamStartTime: 5000,      // Alert if >5s
    bufferingRate: 0.1,         // Alert if >10%
    errorRate: 0.05,            // Alert if >5%
    concurrentViewers: 100,     // Alert if >100 per camera
};
```

---

## Security Considerations

### Pre-signed URL Security
- Use HMAC-SHA256 for signatures
- Short expiration (1 hour max)
- Rotate signing keys monthly
- Rate limit signature generation

### WebRTC Security
- Use TURN server with authentication
- Implement ICE candidate filtering
- Monitor for STUN amplification attacks

---

## Conclusion

By implementing these optimizations in phases, you can achieve:
- **Phase 1**: 3-4 second latency (quick wins)
- **Phase 2**: 2-3 second latency (direct access)
- **Phase 3**: <1 second latency (WebRTC for critical cameras)

**Total Implementation Time**: 2-4 weeks
**Expected Latency Reduction**: 50-80%
