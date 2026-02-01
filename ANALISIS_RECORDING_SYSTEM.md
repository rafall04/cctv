# Analisis Lengkap: Recording System

## 📊 Overview Sistem Recording

Sistem recording RAF NET CCTV terdiri dari 3 komponen utama:
1. **Backend Recording Service** - FFmpeg recording dengan stream copy
2. **Backend API Controller** - REST API untuk manage dan stream recordings
3. **Frontend Playback** - UI untuk play recording dengan native HTML5 video

---

## ✅ ANALISIS: Logika Save Record

### 1. FFmpeg Recording Process

**File:** `backend/services/recordingService.js`

#### Konfigurasi FFmpeg (Line 150-170)
```javascript
const ffmpegArgs = [
    '-rtsp_transport', 'tcp',
    '-i', camera.private_rtsp_url,
    '-map', '0:v',                   // Video only
    '-c:v', 'copy',                  // Stream copy (0% CPU)
    '-an',                           // No audio
    '-f', 'segment',                 // Split ke segments
    '-segment_time', '600',          // 10 menit per file
    '-segment_format', 'mp4',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', // Web-compatible
    '-segment_atclocktime', '1',     // Align dengan clock time
    '-reset_timestamps', '1',
    '-strftime', '1',
    outputPattern                    // %Y%m%d_%H%M%S.mp4
];
```

**✅ BENAR:**
- Stream copy (0% CPU overhead)
- Web-compatible MP4 dengan `frag_keyframe+empty_moov`
- Segment 10 menit (600 detik)
- Filename pattern: `YYYYMMDD_HHMMSS.mp4`

#### Segment Detection (Line 200-230)
```javascript
ffmpeg.stderr.on('data', (data) => {
    const output = data.toString();
    
    // Detect new segment creation
    if ((output.includes('Opening') || output.includes('segment')) && output.includes('.mp4')) {
        const match = output.match(/(\d{8}_\d{6}\.mp4)/);
        if (match) {
            const filename = match[1];
            this.onSegmentCreated(cameraId, filename);
        }
    }
});
```

**✅ BENAR:**
- Deteksi segment baru dari FFmpeg output
- Pattern matching untuk filename
- Trigger `onSegmentCreated()` handler

### 2. Segment Processing & Save to Database

**File:** `backend/services/recordingService.js` (Line 335-550)

#### Flow Segment Processing:

**Step 1: Initial Wait (3 detik)**
```javascript
setTimeout(async () => {
    // Wait 3 seconds untuk FFmpeg close file
}, 3000);
```

**Step 2: File Stability Check**
```javascript
// Check file size 2x dengan gap 2 detik
let fileSize1 = statSync(filePath).size;
await new Promise(resolve => setTimeout(resolve, 2000));
let fileSize2 = statSync(filePath).size;

// If still growing, wait 3s more
if (fileSize2 > fileSize1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
}
```

**✅ BENAR:** Memastikan file tidak sedang ditulis

**Step 3: File Size Validation**
```javascript
// FIXED: Threshold 500KB (dari 5MB)
if (fileSize < 500 * 1024) {
    console.warn(`File too small (< 500KB), likely corrupt`);
    return;
}
```

**✅ BENAR:** 
- Threshold 500KB memungkinkan file dari tunnel reconnect (30 detik+) tersimpan
- File < 500KB dianggap corrupt

**Step 4: FFprobe Duration Check**
```javascript
const ffprobeOutput = execSync(
    `ffprobe -v error -show_entries format=duration ...`,
    { timeout: 3000 }
).trim();

if (!ffprobeOutput || parseFloat(ffprobeOutput) < 1) {
    incrementFailCount(cameraId, filename);
    return;
}
```

**✅ BENAR:**
- Validasi durasi video minimal 1 detik
- Track failed attempts untuk prevent infinite loop

**Step 5: Re-mux untuk Fix MP4 Index**
```javascript
// CRITICAL: Re-mux dengan faststart untuk seeking
const ffmpeg = spawn('ffmpeg', [
    '-i', filePath,
    '-c', 'copy',
    '-movflags', '+faststart',       // Move moov atom to start
    '-fflags', '+genpts',
    '-avoid_negative_ts', 'make_zero',
    '-y',
    tempPath
]);
```

**✅ BENAR:**
- Re-mux diperlukan untuk proper seeking di browser
- `+faststart` memindahkan moov atom ke awal file
- Tidak ada re-encoding (copy codec)

**Step 6: Save to Database**
```javascript
// Parse filename untuk timestamp
const [, year, month, day, hour, minute, second] = match;
const startTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
const endTime = new Date(startTime.getTime() + 10 * 60 * 1000);

// Save to database
execute(
    `INSERT INTO recording_segments 
    (camera_id, filename, start_time, end_time, file_size, duration, file_path) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [cameraId, filename, startTime.toISOString(), endTime.toISOString(), 
     finalSize, 600, filePath]
);
```

**✅ BENAR:**
- Timestamp dari filename (reliable)
- Duration 600 detik (10 menit)
- File path absolut disimpan

**Step 7: Cleanup Old Segments**
```javascript
// Wait 3 detik sebelum cleanup
await new Promise(resolve => setTimeout(resolve, 3000));
this.cleanupOldSegments(cameraId);
```

**✅ BENAR:** Delay untuk prevent race condition

### 3. Cleanup Logic (FIXED)

**File:** `backend/services/recordingService.js` (Line 560-650)

#### Throttling (60 detik)
```javascript
// Only cleanup once per 60 seconds
if (timeSinceLastCleanup < 60000) {
    return;
}
```

**✅ BENAR:** Prevent race condition

#### Safety Buffer (+2 segments)
```javascript
const safetyBuffer = 2;
const effectiveMaxSegments = maxSegments + safetyBuffer;
```

**✅ BENAR:** Extra 20 menit buffer

#### Age Check (minimal 15 menit)
```javascript
const segmentAge = Date.now() - new Date(segment.start_time).getTime();
if (segmentAge < 15 * 60 * 1000) {
    return; // Skip recent segments
}
```

**✅ BENAR:** File baru tidak akan dihapus

---

## ✅ ANALISIS: Logika Play Record

### 1. Backend API - Get Segments

**File:** `backend/controllers/recordingController.js` (Line 214-250)

```javascript
export async function getSegments(request, reply) {
    const { cameraId } = request.params;
    
    // Get segments from database
    const segments = query(
        `SELECT id, filename, start_time, end_time, file_size, duration, created_at
        FROM recording_segments 
        WHERE camera_id = ? 
        ORDER BY start_time DESC`,  // ✅ DESC = newest first
        [cameraId]
    );
    
    return reply.send({
        success: true,
        data: {
            camera_id: camera.id,
            camera_name: camera.name,
            segments: segments,
            total_segments: segments.length
        }
    });
}
```

**✅ BENAR:**
- Query dari database (bukan scan filesystem)
- ORDER BY DESC (newest first)
- Return semua field yang diperlukan

### 2. Backend API - Stream Segment

**File:** `backend/controllers/recordingController.js` (Line 260-350)

#### Validation
```javascript
// 1. Check database
const segment = queryOne(
    'SELECT * FROM recording_segments WHERE camera_id = ? AND filename = ?',
    [cameraId, filename]
);

if (!segment) {
    return reply.code(404).send({ message: 'Segment not found in database' });
}

// 2. Check file exists
if (!existsSync(segment.file_path)) {
    return reply.code(404).send({ message: 'Segment file not found on disk' });
}
```

**✅ BENAR:** Double validation (database + filesystem)

#### HTTP Range Support (untuk seeking)
```javascript
const range = request.headers.range;
if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
    
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${stats.size}`);
    
    const stream = createReadStream(segment.file_path, { start, end });
    return reply.send(stream);
}
```

**✅ BENAR:**
- Support HTTP Range requests (206 Partial Content)
- Essential untuk video seeking di browser

#### CORS Headers
```javascript
reply.header('Access-Control-Allow-Origin', '*');
reply.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
reply.header('Accept-Ranges', 'bytes');
```

**✅ BENAR:** CORS untuk cross-origin requests

### 3. Frontend - Playback Component

**File:** `frontend/src/pages/Playback.jsx`

#### Camera Selection & Segment Fetch
```javascript
useEffect(() => {
    if (!selectedCamera) return;
    
    // CRITICAL: Reset selected segment saat camera berubah
    setSelectedSegment(null);
    setSegments([]);
    
    const fetchSegments = async () => {
        const response = await recordingService.getSegments(selectedCamera.id);
        if (response.success) {
            const segmentsArray = response.data.segments || [];
            setSegments(segmentsArray);
            
            // Auto-select latest segment (index 0 = newest, DESC order)
            if (segmentsArray.length > 0 && isInitialLoadRef.current) {
                setSelectedSegment(segmentsArray[0]);
                isInitialLoadRef.current = false;
            }
        }
    };
    
    fetchSegments();
    const interval = setInterval(fetchSegments, 10000); // Refresh every 10s
    
    return () => clearInterval(interval);
}, [selectedCamera]);
```

**✅ BENAR:**
- Reset state saat camera berubah (prevent 404)
- Auto-select latest segment
- Refresh segments every 10 seconds

#### Video Player Initialization
```javascript
useEffect(() => {
    if (!selectedSegment || !videoRef.current || !selectedCamera) return;
    
    // Validate filename
    if (!selectedSegment.filename || selectedSegment.filename.trim() === '') {
        return;
    }
    
    // Get stream URL
    const streamUrl = recordingService.getSegmentStreamUrl(
        selectedCamera.id, 
        selectedSegment.filename
    );
    
    // AbortController untuk cancel fetch on cleanup
    const abortController = new AbortController();
    
    // Test URL accessibility
    fetch(streamUrl, { method: 'HEAD', signal: abortController.signal })
        .then(response => {
            if (response.ok) {
                // Set video source
                video.src = streamUrl;
                video.load();
            } else {
                setVideoError(`HTTP ${response.status}`);
            }
        })
        .catch(error => {
            if (error.name !== 'AbortError') {
                setVideoError(`Network error: ${error.message}`);
            }
        });
    
    return () => {
        abortController.abort(); // Cancel fetch on cleanup
        video.pause();
        video.removeAttribute('src');
        video.load();
    };
}, [selectedSegment, selectedCamera]);
```

**✅ BENAR:**
- Validation sebelum load
- HEAD request untuk test accessibility
- AbortController untuk prevent 404 saat cleanup
- Proper cleanup

#### Smart Seek (Max 3 menit)
```javascript
const MAX_SEEK_DISTANCE = 180; // 3 minutes

const handleSeeking = () => {
    const targetTime = video.currentTime;
    const previousTime = lastSeekTimeRef.current || 0;
    const seekDistance = Math.abs(targetTime - previousTime);
    
    // Limit seek distance
    if (seekDistance > MAX_SEEK_DISTANCE) {
        const direction = targetTime > previousTime ? 1 : -1;
        const limitedTarget = previousTime + (MAX_SEEK_DISTANCE * direction);
        
        setSeekWarning({ type: 'limit' });
        video.currentTime = limitedTarget;
        lastSeekTimeRef.current = limitedTarget;
    } else {
        lastSeekTimeRef.current = targetTime;
    }
};
```

**✅ BENAR:**
- Limit seek untuk prevent buffering issues
- User-friendly warning

#### Auto-Play Next Segment
```javascript
const handleEnded = () => {
    if (!autoPlayEnabled) return;
    
    // Find current segment index (DESC order)
    const currentIndex = segments.findIndex(s => s.id === selectedSegment.id);
    
    // Next segment chronologically is at currentIndex - 1
    const nextSegment = segments[currentIndex - 1];
    
    if (nextSegment) {
        // Check for gap
        const currentEnd = new Date(selectedSegment.end_time);
        const nextStart = new Date(nextSegment.start_time);
        const gapSeconds = (nextStart - currentEnd) / 1000;
        
        if (gapSeconds > 30) {
            setAutoPlayNotification({
                type: 'gap',
                message: `Melewati ${Math.round(gapSeconds / 60)} menit rekaman yang hilang`
            });
        }
        
        setSelectedSegment(nextSegment);
    }
};
```

**✅ BENAR:**
- Auto-play dengan toggle
- Gap detection
- User notification

#### Playback Speed Control
```javascript
// Separate useEffect untuk speed (tidak reload video)
useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    video.playbackRate = playbackSpeed;
}, [playbackSpeed]);
```

**✅ BENAR:** Speed change tanpa reload video

---

## 🎯 Kesimpulan Analisis

### ✅ Yang Sudah BENAR:

1. **Save Record:**
   - ✅ FFmpeg stream copy (0% CPU)
   - ✅ Web-compatible MP4 dengan proper flags
   - ✅ File stability check sebelum process
   - ✅ File size threshold 500KB (support tunnel reconnect)
   - ✅ FFprobe validation
   - ✅ Re-mux untuk fix MP4 index (seeking)
   - ✅ Cleanup dengan safety buffer & throttling
   - ✅ Age check untuk prevent delete file baru

2. **Play Record:**
   - ✅ Database-driven (bukan filesystem scan)
   - ✅ HTTP Range support untuk seeking
   - ✅ CORS headers proper
   - ✅ Frontend validation & error handling
   - ✅ AbortController untuk prevent 404
   - ✅ Smart seek dengan limit 3 menit
   - ✅ Auto-play next segment dengan gap detection
   - ✅ Playback speed control tanpa reload

### 🔧 Perbaikan yang Sudah Diterapkan:

1. **File Size Threshold:** 5MB → 500KB (support tunnel reconnect)
2. **Cleanup Throttling:** 60 detik (prevent race condition)
3. **Safety Buffer:** +2 segments (20 menit extra)
4. **Age Check:** Minimal 15 menit (protect new files)
5. **Orphaned Entry Cleanup:** Minimal 5 menit (prevent premature delete)

### 📝 Rekomendasi Deployment:

```bash
# Di production server
cd /var/www/rafnet-cctv
git pull origin main
pm2 restart rafnet-cctv-backend

# Verifikasi
pm2 logs rafnet-cctv-backend --lines 50
```

### ✅ Sistem Recording SUDAH SESUAI dan AMAN!

Tidak ada bug kritis yang ditemukan. Semua logika save dan play record sudah benar dan optimal.
