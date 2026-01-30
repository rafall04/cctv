# 🛡️ Safety Net Optimization - Buffer Extension

**Status:** ✅ APPLIED  
**Date:** 2025-01-31  
**Objective:** Increase HLS playlist history to prevent 404 errors during client network dropouts

---

## 📊 RAM Usage Analysis

### Current State (7 segments)
```
History: 7 segments × 2s = 14 seconds
RAM per camera: ~7 × 500KB = ~3.5 MB
10 cameras: ~35 MB total
```

**Problem:**
- Client network dropout 5-10 detik → segment sudah dihapus dari playlist
- User mendapat 404 error → harus refresh manual
- Bad UX, terutama di koneksi mobile yang tidak stabil

### Proposed State (15 segments)
```
History: 15 segments × 2s = 30 seconds
RAM per camera: ~15 × 500KB = ~7.5 MB
10 cameras: ~75 MB total
```

**Overhead:** +40 MB untuk 10 cameras = **SANGAT KECIL** ✅

**Benefit:**
- 30s history buffer → client bisa "catch up" setelah network recovery
- Smooth reconnection tanpa 404 error
- Better UX untuk mobile users

---

## ✅ VERDICT: WORTH IT!

| Aspect | Impact | Assessment |
|--------|--------|------------|
| RAM Overhead | +40 MB (10 cameras) | ✅ Minimal |
| CPU Impact | None (same transcoding) | ✅ No change |
| Network Resilience | 14s → 30s buffer | ✅ Significant improvement |
| User Experience | Fewer 404 errors | ✅ Better UX |
| Industry Standard | 30s is common | ✅ Best practice |

**Conclusion:** Minimal cost, significant benefit → **APPLY**

---

## ⚙️ Updated MediaMTX Config

**File:** `mediamtx/mediamtx.yml`

```yaml
# HLS settings - STANDARD MODE (Stability Priority)
hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsAllowOrigin: '*'
# Segment duration: 2s (sweet spot for stability + reasonable latency)
hlsSegmentDuration: 2s
# Segment count: 15 (extended buffer for network resilience)
# History: 15 segments × 2s = 30s (prevents 404 during client network dropouts)
hlsSegmentCount: 15
# RAM Disk storage for instant access
hlsDirectory: /dev/shm/mediamtx-live
# NOTE: hlsPartDuration REMOVED - No LL-HLS (reduces CPU load)
```

**Key Changes:**
- ✅ `hlsSegmentCount: 15` (was 7)
- ✅ History: 14s → 30s
- ✅ `hlsSegmentDuration: 2s` - **TIDAK BERUBAH**
- ✅ `hlsDirectory: /dev/shm/mediamtx-live` - **TETAP DI RAM**

---

## 🚀 Apply & Verify

### Step 1: Pull Latest Code
```bash
cd /var/www/rafnet-cctv
git pull origin main
```

### Step 2: Restart MediaMTX
```bash
pm2 restart rafnet-cctv-mediamtx
```

### Step 3: Verify Segment Count
```bash
# Wait 30 seconds for segments to accumulate
sleep 30

# Check number of .ts files for a camera
ls -1 /dev/shm/mediamtx-live/camera1/*.ts | wc -l
# Should show ~15 files (was ~7 before)

# Check total RAM usage
du -sh /dev/shm/mediamtx-live/
# Should be slightly higher than before (~40 MB more for 10 cameras)
```

### Step 4: Test Network Resilience
1. Open browser: `http://cctv.raf.my.id:800`
2. Play a camera
3. **Simulate network dropout:**
   - Pause WiFi for 10 seconds
   - Resume WiFi
4. **Expected behavior:**
   - Video should resume smoothly (no 404 error)
   - No need to refresh page

---

## 📈 Before vs After

| Metric | Before (7 segments) | After (15 segments) | Improvement |
|--------|---------------------|---------------------|-------------|
| History Buffer | 14 seconds | 30 seconds | +114% |
| RAM per Camera | ~3.5 MB | ~7.5 MB | +4 MB |
| Network Dropout Tolerance | 5-10s | 20-25s | +15s |
| 404 Error Rate | High on mobile | Minimal | ✅ Better |
| User Experience | Frequent refresh needed | Smooth recovery | ✅ Better |

---

## 🔍 Technical Details

### Segment Lifecycle
```
MediaMTX generates segments every 2s:
- segment_001.ts (0-2s)
- segment_002.ts (2-4s)
- segment_003.ts (4-6s)
...
- segment_015.ts (28-30s)

When segment_016.ts is created:
- segment_001.ts is deleted (oldest)
- Playlist always contains 15 segments (30s history)
```

### Client Behavior
```
Normal playback:
- Client requests segment_010.ts
- Plays smoothly

Network dropout (10s):
- Client pauses at segment_010.ts
- MediaMTX continues generating segments
- After 10s, client reconnects

With 7 segments (14s history):
- segment_010.ts already deleted → 404 error ❌

With 15 segments (30s history):
- segment_010.ts still available → smooth resume ✅
```

---

## 🎯 Impact Summary

**RAM Cost:** +40 MB (10 cameras) = **0.4% of 8GB RAM** → Negligible

**Benefit:**
- ✅ Prevents 404 errors during network dropouts
- ✅ Better mobile user experience
- ✅ Follows industry best practices
- ✅ No CPU overhead (same transcoding rate)

**Recommendation:** **KEEP THIS SETTING** in production

---

## 📝 Notes

- ✅ Recording service **TIDAK terpengaruh** (tetap ke disk)
- ✅ Nginx cache **TIDAK terpengaruh** (tetap aktif)
- ✅ Frontend HLS.js config **TIDAK perlu diubah**
- ✅ Backward compatible - tidak perlu ubah database atau API

---

**Engineer:** Senior SRE  
**Focus:** Network Resilience & User Experience  
**Status:** ✅ Production Ready
