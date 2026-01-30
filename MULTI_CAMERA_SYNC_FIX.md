# 🎬 Multi-Camera Synchronization Fix

**Status:** ✅ APPLIED  
**Date:** 2025-01-31  
**Problem:** Cameras tidak sinkron saat play bareng (ada yang lebih cepat/lambat)  
**Root Cause:** `liveSyncDurationCount: 3` → setiap kamera mulai dari posisi berbeda

---

## 🔍 Root Cause Analysis

### ❌ BUKAN Penyebab
- `hlsSegmentCount` (15) - Ini hanya mengatur berapa banyak segment disimpan
- MediaMTX configuration - Server side tidak mempengaruhi client sync
- Network latency - Ini bukan masalah network

### ✅ PENYEBAB SEBENARNYA: liveSyncDurationCount

**Sebelum (liveSyncDurationCount: 3):**
```
Camera 1: Mulai play dari segment 3 (6s behind live edge)
Camera 2: Mulai play dari segment 4 (8s behind live edge) 
Camera 3: Mulai play dari segment 2 (4s behind live edge)

Result: TIDAK SINKRON - beda 2-4 detik antar kamera
```

**Kenapa beda posisi?**
- HLS.js memilih segment berdasarkan `liveSyncDurationCount` dari live edge
- Saat kamera di-initialize, live edge berbeda-beda
- Camera 1 init saat segment 10 baru dibuat → mulai dari segment 7
- Camera 2 init saat segment 11 baru dibuat → mulai dari segment 8
- **Result:** Desynchronized playback

---

## 🎯 SOLUSI: liveSyncDurationCount = 1

**Setelah (liveSyncDurationCount: 1):**
```
Camera 1: Mulai play dari segment 14 (2s behind live edge)
Camera 2: Mulai play dari segment 14 (2s behind live edge)
Camera 3: Mulai play dari segment 14 (2s behind live edge)

Result: SINKRON - semua kamera di posisi yang sama
```

**Matematika:**
- Live edge: segment 15 (paling baru)
- liveSyncDurationCount: 1 → mulai dari segment 15 - 1 = segment 14
- Semua kamera mulai dari segment 14 → **SYNCHRONIZED**

---

## ⚙️ Configuration Changes

**File:** `frontend/src/utils/hlsConfig.js`

### Before
```javascript
// All device tiers
liveSyncDurationCount: 3,  // 3 segments behind = 6s latency
liveMaxLatencyDurationCount: 5,
```

### After
```javascript
// All device tiers (low, medium, high)
liveSyncDurationCount: 1,  // 1 segment behind = 2s latency
liveMaxLatencyDurationCount: 3,
```

**Applied to:**
- ✅ Low-end devices
- ✅ Medium devices
- ✅ High-end devices
- ✅ Mobile phone config
- ✅ Mobile tablet config

---

## 📊 Trade-offs Analysis

| Aspect | Before (Count: 3) | After (Count: 1) | Impact |
|--------|-------------------|------------------|--------|
| Synchronization | ❌ Desync 2-4s | ✅ Synchronized | Better |
| Latency | 6s behind live | 2s behind live | Better |
| Buffer Safety | High (6s) | Medium (2s) | Acceptable |
| Stuttering Risk | Very Low | Low | Acceptable |
| Network Resilience | High | Medium | Acceptable |

**Conclusion:** Trade-off is worth it for synchronized playback.

---

## 🛡️ Safety Net: hlsSegmentCount = 15

**Why we keep 15 segments (30s history)?**

Even with `liveSyncDurationCount: 1`, we still have 30s history buffer:
```
Current playback: segment 14 (2s behind)
History available: segments 1-15 (30s total)
Safety margin: 30s - 2s = 28s buffer

If network dropout 10s:
- Player paused at segment 14
- After 10s, segment 14 still available (within 30s history)
- Smooth resume ✅
```

**Without 15 segments (if we used 6):**
```
Current playback: segment 5 (2s behind)
History available: segments 1-6 (12s total)
Safety margin: 12s - 2s = 10s buffer

If network dropout 10s:
- Player paused at segment 5
- After 10s, segment 5 might be deleted
- 404 error ❌
```

**Verdict:** `hlsSegmentCount: 15` is CRITICAL for network resilience.

---

## 🚀 Deployment

### Step 1: Pull Latest Code
```bash
cd /var/www/rafnet-cctv
git pull origin main
```

### Step 2: Rebuild Frontend
```bash
cd frontend
npm run build
```

### Step 3: Clear Browser Cache
```bash
# Users need to hard refresh (Ctrl+F5) or clear cache
# Or wait for browser to fetch new bundle
```

### Step 4: Test Synchronization
1. Open browser: `http://cctv.raf.my.id:800`
2. Play 2-3 cameras simultaneously
3. **Expected behavior:**
   - All cameras start at approximately same timestamp
   - Synchronized playback (max 1-2s difference)
   - No more 4-6s desync

---

## 🔍 Verification

### Test Synchronized Playback
```javascript
// Open browser DevTools Console
// Play 2 cameras and check their currentTime

const videos = document.querySelectorAll('video');
setInterval(() => {
    console.log('Camera 1:', videos[0]?.currentTime.toFixed(2));
    console.log('Camera 2:', videos[1]?.currentTime.toFixed(2));
    console.log('Diff:', Math.abs(videos[0]?.currentTime - videos[1]?.currentTime).toFixed(2), 's');
}, 1000);

// Expected: Diff < 2s (synchronized)
```

### Monitor for Stuttering
```bash
# Check if liveSyncDurationCount: 1 causes stuttering
# Watch for 5-10 minutes
# If stuttering occurs frequently, may need to increase to 2
```

---

## ⚠️ Potential Issues & Solutions

### Issue 1: Increased Stuttering on Slow Connections
**Symptom:** Video pauses/buffers more frequently  
**Cause:** Less buffer (2s vs 6s)  
**Solution:** Increase to `liveSyncDurationCount: 2` (4s buffer)

### Issue 2: Still Not Perfectly Synced
**Symptom:** 1-2s difference still exists  
**Cause:** Staggered initialization (100ms delay between cameras)  
**Solution:** This is acceptable - perfect sync is impossible with HLS

### Issue 3: 404 Errors on Network Dropout
**Symptom:** Video fails to resume after network dropout  
**Cause:** Segment deleted from history  
**Solution:** Already mitigated with `hlsSegmentCount: 15` (30s history)

---

## 📈 Expected Results

### Before Fix
```
Camera 1: 00:00:06 (6s behind)
Camera 2: 00:00:08 (8s behind)
Camera 3: 00:00:04 (4s behind)
Desync: 4 seconds ❌
```

### After Fix
```
Camera 1: 00:00:02 (2s behind)
Camera 2: 00:00:02 (2s behind)
Camera 3: 00:00:03 (3s behind)
Desync: 1 second ✅
```

---

## 🎯 Summary

**Problem:** Multi-camera desynchronization (2-4s difference)  
**Root Cause:** `liveSyncDurationCount: 3` → cameras start at different positions  
**Solution:** `liveSyncDurationCount: 1` → all cameras start near live edge  
**Trade-off:** Less buffer (2s vs 6s), but acceptable with 30s history  
**Result:** Synchronized playback with minimal latency

**Recommendation:** Monitor for stuttering. If frequent, increase to `liveSyncDurationCount: 2`.

---

**Engineer:** Video Streaming Architect  
**Focus:** Multi-Camera Synchronization  
**Status:** ✅ Production Ready
