# Recording & Playback Workflow - RAF NET CCTV

## 📋 OVERVIEW

Sistem recording RAF NET CCTV menggunakan **FFmpeg stream copy** (0% CPU overhead) dengan format MP4 yang dioptimalkan untuk web playback. Sistem ini dirancang khusus untuk menangani **CCTV tunnel yang sering putus-putus**.

---

## 🎬 WORKFLOW RECORDING

### 1. AUTO-START RECORDING (Server Startup)

```
┌─────────────────────────────────────────────────────────────┐
│ SERVER STARTUP                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Server start → Load all services                        │
│  2. MediaMTX sync cameras                                   │
│  3. Stream warmer pre-warm cameras                          │
│  4. Wait 5 seconds (MediaMTX paths ready)                   │
│  5. recordingService.autoStartRecordings()                  │
│                                                             │
│     Query: SELECT id FROM cameras                           │
│            WHERE enable_recording = 1 AND enabled = 1       │
│                                                             │
│     For each camera:                                        │
│       - Retry 3x dengan delay 2s                            │
│       - Stagger 500ms antar kamera                          │
│       - Log success/failure                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Kode:**
```javascript
// backend/server.js line 337-339
await new Promise(resolve => setTimeout(resolve, 5000));
await recordingService.autoStartRecordings();
```

---

### 2. RECORDING START PROCESS

```
┌─────────────────────────────────────────────────────────────┐
│ START RECORDING                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  VALIDASI:                                                  │
│  ✓ Camera exists?                                           │
│  ✓ RTSP URL valid? (starts with rtsp://)                   │
│  ✓ Camera enabled?                                          │
│  ✓ Recording enabled?                                       │
│  ✓ Not already recording?                                   │
│                                                             │
│  FFMPEG COMMAND:                                            │
│  ffmpeg -rtsp_transport tcp                                 │
│         -i rtsp://camera_url                                │
│         -map 0:v                    # Video only            │
│         -c:v copy                   # Stream copy (0% CPU)  │
│         -an                         # No audio              │
│         -f segment                  # Split ke segments     │
│         -segment_time 600           # 10 menit per file     │
│         -segment_format mp4                                 │
│         -movflags +frag_keyframe+empty_moov+default_base_moof │
│         -segment_atclocktime 1      # Align dengan clock    │
│         -reset_timestamps 1                                 │
│         -strftime 1                                         │
│         /recordings/camera1/%Y%m%d_%H%M%S.mp4              │
│                                                             │
│  RESULT:                                                    │
│  ✓ FFmpeg process spawned                                   │
│  ✓ Stream health monitoring started                         │
│  ✓ Database status updated: recording_status = 'recording' │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Points:**
- **Stream copy**: Tidak ada re-encoding, CPU usage 0%
- **Movflags**: `empty_moov` → moov atom di awal file (critical!)
- **Segment**: 10 menit per file, aligned dengan clock time
- **Format**: MP4 dengan fragmented keyframe untuk seeking

---

### 3. SEGMENT DETECTION & PROCESSING

```
┌─────────────────────────────────────────────────────────────┐
│ SEGMENT LIFECYCLE                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DETECTION (FFmpeg stderr output):                          │
│  "Opening 'YYYYMMDD_HHMMSS.mp4' for writing"               │
│         ↓                                                   │
│  onSegmentCreated(cameraId, filename)                       │
│                                                             │
│  PROCESSING FLOW:                                           │
│                                                             │
│  1. SAFETY CHECK (Prevent Duplicate)                        │
│     if (filesBeingProcessed.has(fileKey)) return;          │
│     if (isFileFailed(cameraId, filename)) return;          │
│     filesBeingProcessed.add(fileKey);                       │
│                                                             │
│  2. INITIAL WAIT (3 seconds)                                │
│     → FFmpeg close file                                     │
│                                                             │
│  3. FILE STABILITY CHECK                                    │
│     size1 = fileSize()                                      │
│     wait 2s                                                 │
│     size2 = fileSize()                                      │
│     if (size2 > size1) wait 3s more                         │
│                                                             │
│  4. SIZE VALIDATION                                         │
│     if (fileSize < 500KB) {                                 │
│       // Too small, likely corrupt                          │
│       cleanup(); return;                                    │
│     }                                                       │
│     if (fileSize < 5MB) {                                   │
│       // Smaller than expected (tunnel reconnect)           │
│       log warning but continue;                             │
│     }                                                       │
│                                                             │
│  5. FINAL WAIT (3 seconds)                                  │
│     → Ensure file complete                                  │
│                                                             │
│  6. FFPROBE VALIDATION (3s timeout)                         │
│     ffprobe -v error -show_entries format=duration          │
│     if (duration < 1s) {                                    │
│       incrementFailCount(); // Track failed                 │
│       cleanup(); return;                                    │
│     }                                                       │
│                                                             │
│  7. RE-MUX (Fix MP4 Index)                                  │
│     ffmpeg -i input.mp4                                     │
│            -c copy                                          │
│            -movflags +faststart  # Moov atom to start       │
│            -fflags +genpts       # Generate timestamps      │
│            -avoid_negative_ts make_zero                     │
│            output.remux.mp4                                 │
│                                                             │
│  8. REPLACE ORIGINAL                                        │
│     delete input.mp4                                        │
│     rename output.remux.mp4 → input.mp4                     │
│                                                             │
│  9. SAVE TO DATABASE                                        │
│     INSERT INTO recording_segments                          │
│     (camera_id, filename, start_time, end_time,            │
│      file_size, duration, file_path)                        │
│                                                             │
│  10. CLEANUP                                                │
│      filesBeingProcessed.delete(fileKey);                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Total Processing Time:** ~11 detik (optimized dari 28 detik)

**Critical untuk Tunnel:**
- Minimum size **500KB** (bukan 5MB) → file pendek dari reconnect tetap disimpan
- Re-mux dengan `+faststart` → moov atom pasti di awal
- Failed file tracking → prevent infinite loop

---

### 4. HEALTH MONITORING & AUTO-RESTART

```
┌─────────────────────────────────────────────────────────────┐
│ STREAM HEALTH MONITORING (Every 5 seconds)                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  For each active recording:                                 │
│                                                             │
│    timeSinceData = now - lastDataTime                       │
│                                                             │
│    timeout = camera.is_tunnel === 1 ? 10000 : 30000        │
│              └─ Tunnel: 10s | Normal: 30s                   │
│                                                             │
│    if (timeSinceData > timeout) {                           │
│      console.log("Stream frozen, restarting...");           │
│      restartRecording(cameraId, 'stream_frozen');           │
│    }                                                        │
│                                                             │
│  RESTART FLOW:                                              │
│    1. stopRecording(cameraId)                               │
│    2. wait 3 seconds                                        │
│    3. startRecording(cameraId)                              │
│    4. logRestart(cameraId, reason, success)                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Adaptive Timeout:**
- **Tunnel camera**: 10 detik (lebih sensitif)
- **Normal camera**: 30 detik (lebih toleran)

---

### 5. SEGMENT SCANNER (Fallback)

```
┌─────────────────────────────────────────────────────────────┐
│ SEGMENT SCANNER (Every 60 seconds)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PURPOSE: Fallback jika FFmpeg output detection gagal       │
│                                                             │
│  For each active recording:                                 │
│    1. Scan directory: /recordings/camera{id}/               │
│    2. Find files: YYYYMMDD_HHMMSS.mp4 (exact pattern)      │
│    3. For each file:                                        │
│       - Skip if failed 3+ times                             │
│       - Check if in database                                │
│       - If not in DB and age > 30s:                         │
│         → trigger onSegmentCreated()                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Safety:**
- Hanya proses file 30+ detik (likely complete)
- Skip files yang sudah failed 3x
- Prevent duplicate processing

---

### 6. CLEANUP SYSTEM

```
┌─────────────────────────────────────────────────────────────┐
│ SCHEDULED CLEANUP (Every 30 minutes)                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  For each camera with recording enabled:                    │
│                                                             │
│    retentionHours = camera.recording_duration_hours         │
│    retentionMs = retentionHours * 3600000                   │
│    retentionWithBuffer = retentionMs * 1.1  # +10% safety   │
│                                                             │
│    segments = SELECT * FROM recording_segments              │
│               WHERE camera_id = ?                           │
│               ORDER BY start_time ASC                       │
│                                                             │
│    For each segment:                                        │
│      segmentAge = now - segment.start_time                  │
│                                                             │
│      if (segmentAge <= retentionWithBuffer) {               │
│        KEEP IT  # Still within retention period             │
│        continue;                                            │
│      }                                                      │
│                                                             │
│      # Segment older than retention period                  │
│      if (filesBeingProcessed.has(fileKey)) {                │
│        SKIP  # File being processed (remux)                 │
│        continue;                                            │
│      }                                                      │
│                                                             │
│      if (!fileExists(segment.file_path)) {                  │
│        DELETE from database only;                           │
│        continue;                                            │
│      }                                                      │
│                                                             │
│      # Delete file and database entry                       │
│      unlinkSync(segment.file_path);                         │
│      DELETE FROM recording_segments WHERE id = ?;           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Points:**
- **Age-based deletion** (bukan count-based)
- **10% buffer** untuk safety
- **Throttle**: Max 1x per 60 detik per camera
- **Skip files being processed** (prevent deletion during remux)

---

## 📺 WORKFLOW PLAYBACK

### 1. PLAYBACK PAGE STRUCTURE

```
┌─────────────────────────────────────────────────────────────┐
│ PLAYBACK PAGE                                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  LEFT PANEL:                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Camera Selector (Dropdown)                          │   │
│  │  - List all cameras with recordings                 │   │
│  │  - GET /api/playback/cameras                        │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ Date Picker                                         │   │
│  │  - Select date to view recordings                   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ Segment List                                        │   │
│  │  - GET /api/playback/recordings/:cameraId?date=...  │   │
│  │  - Show all segments for selected date              │   │
│  │  - Format: HH:MM:SS - HH:MM:SS (duration)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  RIGHT PANEL:                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │         VIDEO PLAYER                                │   │
│  │         (Native HTML5 <video>)                      │   │
│  │                                                     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ Timeline Controls:                                  │   │
│  │  [Play/Pause] [━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]  │   │
│  │  00:05:23 / 00:10:00                                │   │
│  │  Speed: [0.5x] [1x] [1.5x] [2x]                     │   │
│  │  [Download]                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 2. PLAYBACK API FLOW

```
┌─────────────────────────────────────────────────────────────┐
│ API ENDPOINTS                                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. GET /api/playback/cameras                               │
│     → List cameras yang punya recordings                    │
│                                                             │
│     SELECT DISTINCT c.id, c.name, c.location               │
│     FROM cameras c                                          │
│     INNER JOIN recording_segments r ON c.id = r.camera_id  │
│     WHERE r.status = 'completed'                            │
│     ORDER BY c.name ASC                                     │
│                                                             │
│  2. GET /api/playback/recordings/:cameraId?date=YYYY-MM-DD  │
│     → List segments untuk camera & date tertentu            │
│                                                             │
│     SELECT id, filename, start_time, end_time,             │
│            duration_seconds, file_size_bytes                │
│     FROM recording_segments                                 │
│     WHERE camera_id = ?                                     │
│     AND start_time >= 'YYYY-MM-DD 00:00:00'                │
│     AND start_time <= 'YYYY-MM-DD 23:59:59'                │
│     ORDER BY start_time ASC                                 │
│                                                             │
│  3. GET /api/playback/stream/:recordingId                   │
│     → Stream video file dengan HTTP Range support           │
│                                                             │
│     - Get recording info from database                      │
│     - Validate file exists                                  │
│     - Handle HTTP Range requests (for seeking)              │
│     - Stream file chunks                                    │
│     - Log playback access (audit)                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 3. VIDEO STREAMING WITH RANGE REQUESTS

```
┌─────────────────────────────────────────────────────────────┐
│ HTTP RANGE REQUEST SUPPORT                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CLIENT REQUEST:                                            │
│  GET /api/playback/stream/123                               │
│  Range: bytes=0-1048575  (first 1MB)                        │
│                                                             │
│  SERVER RESPONSE:                                           │
│  HTTP/1.1 206 Partial Content                               │
│  Content-Range: bytes 0-1048575/52428800                    │
│  Content-Length: 1048576                                    │
│  Content-Type: video/mp4                                    │
│  Accept-Ranges: bytes                                       │
│                                                             │
│  [Binary data chunk]                                        │
│                                                             │
│  SEEKING FLOW:                                              │
│  1. User drags timeline slider                              │
│  2. Browser calculates byte offset                          │
│  3. Browser sends Range request                             │
│  4. Server returns specific chunk                           │
│  5. Video player continues from new position                │
│                                                             │
│  WHY IT WORKS:                                              │
│  ✓ Moov atom at start (from +faststart)                     │
│  ✓ Fragmented keyframes (from +frag_keyframe)              │
│  ✓ Proper timestamps (from +genpts)                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 4. PLAYBACK CONTROLS

```
┌─────────────────────────────────────────────────────────────┐
│ VIDEO PLAYER CONTROLS                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PLAY/PAUSE:                                                │
│    video.play() / video.pause()                             │
│                                                             │
│  SEEK (Timeline Slider):                                    │
│    video.currentTime = newTime                              │
│    → Triggers Range request to server                       │
│                                                             │
│  SPEED CONTROL:                                             │
│    video.playbackRate = speed  # 0.5x, 1x, 1.5x, 2x        │
│                                                             │
│  DOWNLOAD:                                                  │
│    window.open('/api/playback/stream/:recordingId')         │
│    → Full file download                                     │
│                                                             │
│  TIME DISPLAY:                                              │
│    formatTime(video.currentTime) / formatTime(video.duration) │
│    → 00:05:23 / 00:10:00                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 HANDLING TUNNEL CAMERA (Putus-Putus)

### Skenario: Tunnel Putus 3x dalam 30 Menit

```
Timeline:
─────────────────────────────────────────────────────────────

10:00:00  ┌─ Recording Start (Segment 1)
          │  FFmpeg: camera1/20240201_100000.mp4
          │
10:08:30  │  Tunnel PUTUS! ❌
          │  → FFmpeg stop
          │  → Segment 1 = 8.5 menit (~10MB)
          │  → onSegmentCreated() triggered
          │     - Wait 3s
          │     - Stability check (2x2s)
          │     - Size: 10MB ✓ (> 500KB)
          │     - ffprobe: duration 510s ✓
          │     - Re-mux dengan +faststart
          │     - Save to database ✓
          │
10:08:35  │  Health Monitor detects frozen (10s timeout)
          │  → Auto-restart recording
          │
10:08:38  ┌─ Recording Resume (Segment 2)
          │  FFmpeg: camera1/20240201_100838.mp4
          │
10:15:20  │  Tunnel PUTUS lagi! ❌
          │  → Segment 2 = 6.7 menit (~8MB)
          │  → Same processing flow
          │
10:15:25  ┌─ Recording Resume (Segment 3)
          │
10:22:10  │  Tunnel PUTUS lagi! ❌
          │  → Segment 3 = 6.75 menit (~8MB)
          │
10:22:15  ┌─ Recording Resume (Segment 4)
          │
10:32:15  └─ Segment 4 complete (10 menit, normal)

RESULT:
✓ 4 segments tersimpan (total ~36 menit recording)
✓ Semua file playable (moov atom di awal)
✓ Tidak ada gap dalam timeline
✓ Auto-restart seamless
```

**Key Points:**
- **Minimum 500KB**: File pendek dari reconnect tetap disimpan
- **Moov atom di awal**: File playable meskipun FFmpeg crash
- **Auto-restart 10s**: Cepat detect dan recover
- **No data loss**: Semua segment tersimpan

---

## 📊 STORAGE & CLEANUP

### Contoh: Camera dengan Retention 5 Jam

```
Current Time: 15:00:00
Retention: 5 hours (with 10% buffer = 5.5 hours)
Cutoff Time: 09:30:00

Segments:
┌────────────────────────────────────────────────────────┐
│ ID  │ Start Time │ Duration │ Age    │ Action         │
├────────────────────────────────────────────────────────┤
│ 101 │ 08:00:00   │ 10 min   │ 7h     │ DELETE ❌      │
│ 102 │ 08:10:00   │ 10 min   │ 6.8h   │ DELETE ❌      │
│ 103 │ 09:00:00   │ 10 min   │ 6h     │ DELETE ❌      │
│ 104 │ 09:30:00   │ 10 min   │ 5.5h   │ DELETE ❌      │
│ 105 │ 09:40:00   │ 10 min   │ 5.3h   │ KEEP ✓        │
│ 106 │ 10:00:00   │ 10 min   │ 5h     │ KEEP ✓        │
│ ... │ ...        │ ...      │ ...    │ KEEP ✓        │
│ 135 │ 14:50:00   │ 10 min   │ 10min  │ KEEP ✓        │
└────────────────────────────────────────────────────────┘

Cleanup Result:
- Deleted: 4 segments (~40MB freed)
- Kept: 31 segments (~310MB)
```

---

## 🎯 SUMMARY

### Recording Features:
✅ **Zero CPU overhead** (stream copy, no re-encoding)
✅ **Web-compatible MP4** (moov atom di awal, fragmented keyframes)
✅ **Tunnel-optimized** (10s timeout, 500KB minimum, auto-restart)
✅ **Robust processing** (stability check, ffprobe validation, re-mux)
✅ **Age-based cleanup** (retention period dengan 10% buffer)
✅ **Health monitoring** (auto-restart on frozen stream)
✅ **Fallback scanner** (detect unregistered segments)

### Playback Features:
✅ **HTTP Range requests** (smooth seeking)
✅ **Speed control** (0.5x - 2x)
✅ **Timeline navigation** (precise seeking)
✅ **Download support** (full segment download)
✅ **Audit logging** (track playback access)

### Tunnel Handling:
✅ **Fast detection** (10s timeout vs 30s normal)
✅ **No data loss** (500KB minimum, all segments saved)
✅ **Seamless restart** (3s delay, auto-resume)
✅ **Playable files** (moov atom di awal, even if FFmpeg crash)

---

**Document Version:** 1.0  
**Last Updated:** 2024-02-01  
**Status:** Production Ready ✅
