# Testing MediaMTX with Real Camera

## Camera Details
- **RTSP URL**: rtsp://admin:Aldivarama123@192.168.13.4:554/stream1
- **Status**: Working in OBS Studio
- **MediaMTX Path**: camera1

## Testing Steps

### 1. Start MediaMTX

Download MediaMTX from: https://github.com/bluenviron/mediamtx/releases

```powershell
cd c:\project\cctv\mediamtx
# Place mediamtx.exe here
.\mediamtx.exe mediamtx.yml
```

### 2. Check MediaMTX Logs

Look for:
- ✅ "camera1" path started
- ✅ Connected to RTSP source
- ❌ Connection errors (check credentials, network)

### 3. Test HLS Stream

Open in browser:
```
http://localhost:8888/camera1/index.m3u8
```

Should download .m3u8 file if working.

### 4. Test in Frontend

Open: http://localhost:5174

Camera 1 should show live stream.

## Common Issues

### Issue: "Connection refused"
**Solution**: Check if camera IP is reachable
```powershell
ping 192.168.13.4
```

### Issue: "Authentication failed"
**Solution**: Verify username/password in RTSP URL

### Issue: "Stream not found"
**Solution**: Check stream path (stream1 vs stream)

## MediaMTX Not Installed?

**Quick Test Without MediaMTX:**
The frontend will show camera cards but video players will show "Stream Unavailable" - this is expected.

**To get streaming working:**
1. Download MediaMTX binary
2. Place in `mediamtx/` folder
3. Run `.\mediamtx.exe mediamtx.yml`
4. Refresh frontend page
