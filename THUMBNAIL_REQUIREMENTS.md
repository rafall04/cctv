# Thumbnail Generation Requirements

## System Requirements

### FFmpeg Installation

Thumbnail generation requires **FFmpeg** to capture frames from HLS streams.

#### Ubuntu/Debian (Production)
```bash
sudo apt update
sudo apt install ffmpeg -y
ffmpeg -version
```

#### Windows (Development)
```powershell
# Option 1: Chocolatey
choco install ffmpeg

# Option 2: Manual
# Download from https://ffmpeg.org/download.html
# Add to PATH
```

#### macOS (Development)
```bash
brew install ffmpeg
```

### MediaMTX Running

Thumbnails are captured from HLS streams served by MediaMTX:
- MediaMTX must be running on `http://localhost:8888`
- Camera streams must be active (enabled cameras)

## How It Works

1. **Service Start**: Backend checks FFmpeg availability
   - ✅ FFmpeg found → Service enabled
   - ❌ FFmpeg not found → Service disabled (graceful degradation)

2. **Generation Schedule**:
   - Initial: 10 seconds after backend start
   - Periodic: Every 5 minutes

3. **Thumbnail Specs**:
   - Resolution: 320x180 (16:9 ratio)
   - Quality: JPEG ~60%
   - Size: ~10-15KB per thumbnail
   - Path: `/api/thumbnails/{cameraId}.jpg`

4. **Database Update**:
   ```sql
   UPDATE cameras 
   SET thumbnail_path = '/api/thumbnails/1.jpg',
       thumbnail_updated_at = CURRENT_TIMESTAMP
   WHERE id = 1;
   ```

## Troubleshooting

### No Thumbnails Generated

**Check FFmpeg:**
```bash
ffmpeg -version
```

**Check MediaMTX:**
```bash
curl http://localhost:9997/v3/config/paths/list
curl http://localhost:8888/{stream_key}/index.m3u8
```

**Check Backend Logs:**
```bash
pm2 logs rafnet-cctv-backend | grep Thumbnail
```

**Expected Logs:**
```
[Thumbnail] FFmpeg detected ✓
[Thumbnail] Service started - generating every 5 minutes
[Thumbnail] Generating for 3 cameras...
[Thumbnail] Generated for camera 1
[Thumbnail] Complete: 3 success, 0 failed (2.1s)
```

### Development Without FFmpeg

If FFmpeg is not installed in development:
- Thumbnails will not generate (expected behavior)
- Service will gracefully disable itself
- Frontend will show fallback camera icon
- No errors or crashes

### Production Deployment

Ensure FFmpeg is installed **before** starting backend:
```bash
# Install FFmpeg
sudo apt install ffmpeg -y

# Verify
ffmpeg -version

# Start backend
pm2 restart rafnet-cctv-backend

# Check logs
pm2 logs rafnet-cctv-backend --lines 50 | grep Thumbnail
```

## Frontend Fallback

`CameraThumbnail.jsx` handles missing thumbnails gracefully:
- Shows camera icon if `thumbnail_path` is null
- Shows camera icon if image fails to load
- Different icons for maintenance/offline status
