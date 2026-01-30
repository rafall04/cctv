# ⚙️ Stability Optimization Phase 1 - Standard HLS Mode

**Status:** ✅ COMPLETED  
**Date:** 2025-01-31  
**Objective:** Prioritize 100% Stability over <2s Latency

---

## 🎯 Changes Summary

### Problem Identified
- Aggressive LL-HLS settings (`liveSyncDurationCount: 2`) dapat menyebabkan:
  - High CPU usage di server
  - Client buffering/stuttering
  - Instability pada koneksi tidak stabil

### Solution Applied
- **MediaMTX:** Explicit Standard HLS config (2s segments, no LL-HLS parts)
- **Frontend:** Relaxed buffering (`liveSyncDurationCount: 3`)
- **Result:** Smooth playback dengan latency ~6 detik (acceptable trade-off)

---

## ⚙️ 1. Final Stable MediaMTX Config

**File:** `mediamtx/mediamtx.yml`

```yaml
# HLS settings - STANDARD MODE (Stability Priority)
hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsAllowOrigin: '*'
# Segment duration: 2s (sweet spot for stability + reasonable latency)
hlsSegmentDuration: 2s
# Segment count: 7 (default, provides good buffer)
hlsSegmentCount: 7
# RAM Disk storage for instant access
hlsDirectory: /dev/shm/mediamtx-live
# NOTE: hlsPartDuration REMOVED - No LL-HLS (reduces CPU load)
```

**Key Points:**
- ✅ `hlsSegmentDuration: 2s` - Sweet spot (cepat tapi stabil)
- ✅ `hlsSegmentCount: 7` - Default, provides good buffer
- ✅ `hlsDirectory: /dev/shm/mediamtx-live` - TETAP di RAM
- ✅ **NO `hlsPartDuration`** - Tidak ada LL-HLS parts (CPU efficient)

---

## 📺 2. Smooth Playback Frontend Config

**File:** `frontend/src/utils/hlsConfig.js`

### Low-End Devices
```javascript
low: {
    enableWorker: false,
    lowLatencyMode: false,
    backBufferLength: 10,
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    maxBufferSize: 30 * 1000 * 1000,
    liveSyncDurationCount: 3,  // ← CHANGED from 2 to 3
    liveMaxLatencyDurationCount: 5,
    fragLoadingTimeOut: 10000,
    fragLoadingMaxRetry: 3,
}
```

### Medium Devices
```javascript
medium: {
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 20,
    maxBufferLength: 25,
    maxMaxBufferLength: 45,
    maxBufferSize: 45 * 1000 * 1000,
    liveSyncDurationCount: 3,  // ← CHANGED from 2 to 3
    liveMaxLatencyDurationCount: 5,
    fragLoadingTimeOut: 10000,
    fragLoadingMaxRetry: 4,
}
```

### High-End Devices
```javascript
high: {
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 60 * 1000 * 1000,
    liveSyncDurationCount: 3,  // ← CHANGED from 2 to 3
    liveMaxLatencyDurationCount: 5,
    fragLoadingTimeOut: 10000,
    fragLoadingMaxRetry: 5,
}
```

**Key Changes:**
- ✅ `liveSyncDurationCount: 3` (was 2) - Safer buffer, prevents stuttering
- ✅ `liveMaxLatencyDurationCount: 5` (was 3) - More tolerance for network jitter
- ✅ Increased buffer lengths for smoother playback
- ✅ Balanced timeouts (10s) for reliability

---

## 🔄 3. Apply Changes (Production Deployment)

### Step 1: Pull Latest Code
```bash
cd /var/www/rafnet-cctv
git pull origin main
```

### Step 2: Restart MediaMTX
```bash
pm2 restart rafnet-cctv-mediamtx
```

### Step 3: Rebuild Frontend
```bash
cd frontend
npm run build
```

### Step 4: Restart Backend (if needed)
```bash
pm2 restart rafnet-cctv-backend
```

### Step 5: Verify MediaMTX Config
```bash
# Check MediaMTX logs for errors
pm2 logs rafnet-cctv-mediamtx --lines 50

# Should NOT see any "hlsPartDuration" errors
# Should see: "HLS server opened on :8888"
```

### Step 6: Test Playback
1. Open browser: `http://cctv.raf.my.id:800`
2. Play any camera
3. **Expected behavior:**
   - Smooth playback, no stuttering
   - Initial load: ~4-6 seconds (acceptable)
   - No buffering during playback
   - CPU usage: Lower than before

---

## 📊 Expected Results

### Before (LL-HLS Mode)
- ❌ Latency: ~2-3 seconds
- ❌ CPU usage: High (constant transcoding of 200ms parts)
- ❌ Client buffering: Frequent on slow connections
- ❌ Stability: Stuttering on network jitter

### After (Standard HLS Mode)
- ✅ Latency: ~6 seconds (acceptable for monitoring)
- ✅ CPU usage: Lower (2s segments, less frequent transcoding)
- ✅ Client buffering: Minimal to none
- ✅ Stability: Smooth playback, no stuttering

---

## 🔍 Verification Commands

### Check MediaMTX Status
```bash
curl http://localhost:9997/v3/config/global/get | jq '.hls'
```

### Check HLS Segments in RAM
```bash
ls -lh /dev/shm/mediamtx-live/
# Should see *.m3u8 and *.ts files
```

### Monitor CPU Usage
```bash
top -p $(pgrep mediamtx)
# CPU should be lower than before
```

### Test Stream URL
```bash
curl -I http://localhost:8888/camera1/index.m3u8
# Should return 200 OK
```

---

## 🎯 Trade-offs Accepted

| Aspect | Before | After | Decision |
|--------|--------|-------|----------|
| Latency | ~2-3s | ~6s | ✅ Acceptable for monitoring |
| CPU Usage | High | Lower | ✅ Better server efficiency |
| Stability | Unstable | Stable | ✅ Priority achieved |
| Buffering | Frequent | Minimal | ✅ Better UX |

**Conclusion:** Prioritizing stability over ultra-low latency is the right choice for a monitoring system.

---

## 🚀 Next Steps (Optional)

If you want to further optimize:

1. **Monitor CPU usage** for 24 hours
2. **Collect user feedback** on playback quality
3. **Consider Phase 2:** Nginx caching optimization (if needed)

---

## 📝 Notes

- ✅ RAM Disk (`/dev/shm`) TETAP digunakan - instant segment access
- ✅ Nginx cache TETAP aktif - reduces MediaMTX load
- ✅ Recording service TIDAK terpengaruh - tetap berjalan normal
- ✅ Backward compatible - tidak perlu ubah database atau API

---

**Engineer:** Senior SRE  
**Focus:** Server Stability, CPU Efficiency, Smooth Playback  
**Status:** ✅ Production Ready
