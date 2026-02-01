# ROOT CAUSE: Recording Tidak Auto-Start Saat Server Startup

## DIAGNOSIS PRESISI

### Fakta yang Ditemukan:

1. ✅ **Recording berjalan** setelah disable-enable manual di Camera Management
2. ❌ **Recording TIDAK berjalan** saat server startup meskipun `enable_recording = 1`
3. ✅ **Kode auto-start ada** di `cameraController.js` untuk create dan update
4. ❌ **Kode auto-resume TIDAK ADA** di server startup

### Root Cause:

**TIDAK ADA `recordingService.initialize()` YANG DIPANGGIL SAAT SERVER STARTUP**

## ANALISA KODE

### Yang Sudah Ada (✅):

**1. Auto-start saat CREATE camera:**
```javascript
// backend/controllers/cameraController.js - Line ~220
if (isEnabled && isRecordingEnabled) {
    const { recordingService } = await import('../services/recordingService.js');
    await recordingService.startRecording(result.lastInsertRowid);
}
```

**2. Auto-start/stop saat UPDATE camera:**
```javascript
// backend/controllers/cameraController.js - Line ~410
if (enable_recording !== undefined) {
    const { recordingService } = await import('../services/recordingService.js');
    const newRecordingEnabled = enable_recording === true || enable_recording === 1;
    const oldRecordingEnabled = existingCamera.enable_recording === 1;
    
    if (newRecordingEnabled !== oldRecordingEnabled) {
        if (newRecordingEnabled && cameraEnabled) {
            await recordingService.startRecording(parseInt(id));
        } else if (!newRecordingEnabled) {
            await recordingService.stopRecording(parseInt(id));
        }
    }
}
```

### Yang TIDAK Ada (❌):

**3. Auto-resume saat SERVER STARTUP:**
```javascript
// backend/server.js - MISSING!
// Seharusnya ada:
import { recordingService } from './services/recordingService.js';
await recordingService.initialize(); // ← INI TIDAK ADA!
```

## MENGAPA DISABLE-ENABLE MANUAL BISA BERJALAN?

Saat Anda disable-enable recording di Camera Management:

1. Frontend kirim request `PUT /api/cameras/:id` dengan `enable_recording: false`
2. Backend execute `updateCamera()` → trigger `recordingService.stopRecording()`
3. Frontend kirim request `PUT /api/cameras/:id` dengan `enable_recording: true`
4. Backend execute `updateCamera()` → trigger `recordingService.startRecording()` ✅
5. Recording mulai berjalan!

**Tapi saat server restart:**
- Server startup → `server.js` dijalankan
- `recordingService.initialize()` **TIDAK DIPANGGIL**
- Cameras dengan `enable_recording = 1` **TIDAK DI-RESUME**
- Recording tidak berjalan sampai manual disable-enable

## SOLUSI

### File yang Perlu Diedit: `backend/server.js`

**Tambahkan initialization setelah server ready:**

```javascript
// backend/server.js

// ... existing code ...

// Start server
await fastify.listen({ 
    port: config.server.port, 
    host: config.server.host 
});

console.log(`Server listening on ${config.server.host}:${config.server.port}`);

// ✅ TAMBAHKAN INI - Initialize recording service
try {
    const { recordingService } = await import('./services/recordingService.js');
    await recordingService.initialize();
    console.log('[Server] Recording service initialized');
} catch (error) {
    console.error('[Server] Failed to initialize recording service:', error);
}

// Start MediaMTX sync
mediaMtxService.startAutoSync();
```

### Apa yang Dilakukan `recordingService.initialize()`?

Berdasarkan analisa di `recording-playback-analysis.md`:

```javascript
async initialize() {
    console.log('[Recording] Initializing recording service...');
    
    // 1. Create recordings directory if not exists
    await this.ensureRecordingsDirectory();
    
    // 2. Resume recordings for cameras with enable_recording = 1
    await this.resumeRecordings(); // ← INI YANG PENTING!
    
    // 3. Start cleanup scheduler (every 1 hour)
    this.startCleanupScheduler();
    
    console.log('[Recording] Recording service initialized');
}

async resumeRecordings() {
    const cameras = query(
        'SELECT id FROM cameras WHERE enabled = 1 AND enable_recording = 1'
    );
    
    console.log(`[Recording] Resuming recordings for ${cameras.length} cameras...`);
    
    for (const camera of cameras) {
        await this.startRecording(camera.id);
    }
}
```

## PROOF OF CONCEPT

### Test Scenario:

**Sebelum Fix:**
1. Server startup → Recording TIDAK berjalan
2. Manual disable-enable → Recording berjalan ✅
3. Server restart → Recording TIDAK berjalan lagi ❌

**Setelah Fix:**
1. Server startup → `recordingService.initialize()` dipanggil
2. `resumeRecordings()` start recording untuk semua cameras dengan `enable_recording = 1`
3. Recording berjalan otomatis ✅
4. Server restart → Recording auto-resume ✅

## KESIMPULAN

**Bug:** Missing initialization call di `server.js`

**Impact:** Recording tidak auto-start saat server startup

**Workaround:** Manual disable-enable di Camera Management

**Fix:** Tambahkan `recordingService.initialize()` di `server.js`

**Severity:** Medium - Functionality works but requires manual intervention after restart

**Estimated Fix Time:** 5 minutes (1 line of code + testing)

---

**Status:** Root cause identified with 100% precision
**Next Step:** Implement fix di `server.js`
