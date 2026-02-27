# Recording Maintenance & Observability

This document details the recording architecture and troubleshooting steps for the RAF NET Secure CCTV Hub.

## 🏗️ Architecture Overview

The recording system is located in `backend/services/recordingCore/` and consists of several key components:

- **StreamEngine**: Manages FFmpeg processes for each camera. It uses `-c copy` to minimize CPU usage.
- **SegmentProcessor**: Monitors segments and ensures they are properly finalized and indexed in the database.
- **FileWatcher**: Uses OS-level events to detect new `.mp4` files created by FFmpeg and waits for them to stabilize (file size stops growing) before processing.
- **HouseKeeper**: Periodically cleans up old recordings based on retention settings and manages disk space emergencies.
- **LockManager**: Prevents race conditions by ensuring files currently being written or processed are not deleted.

## 🔍 Observability & Logs

We use structured logging prefixes to make system state glanceable via `pm2 logs`.

### FileWatcher Logs
- `[FileWatcher] Stabilizing... camera1/20260227_120000.mp4`: A new file was detected and is being checked for stability (usually takes ~3-15 seconds).
- `[FileWatcher] Finalized: camera1/20260227_120000.mp4`: The file is stable and ready for database indexing.

### HouseKeeper Logs
- `[HouseKeeper] Cleanup for Cam 1: Deleted: 10, Skipped: 0 (Locked), Kept: 2 (Grace)`:
    - **Deleted**: Successfully removed from disk and database.
    - **Skipped (Locked)**: File is currently being accessed (e.g., by a viewer or the watcher).
    - **Kept (Grace)**: File is older than the retention limit but within the 90-second safety grace period.
- `[HouseKeeper] 🚨 EMERGENCY DISK LOW!`: Triggered when free space is < 10GB. Cleanup accelerates to prioritize disk health.

## 🛠️ Troubleshooting

### 1. "EXT-X-DISCONTINUITY" in HLS
This tag in the `.m3u8` manifest indicates a break in the video timeline.
- **Cause**: Camera reboot, network glitch, or FFmpeg restart.
- **Troubleshooting**: Check `pm2 logs cctv-mediamtx` for source connection issues. The `StreamEngine` will automatically attempt to recover.

### 2. Recordings are missing
- **Check FileWatcher**: If `[FileWatcher] Stabilizing...` appears but `Finalized` doesn't, the file might be locked by another process or FFmpeg is hanging.
- **Check Storage Permissions**: Ensure the `RECORDINGS_PATH` is writable by the user running the Node.js process.
- **Check Database**: Verify segments are being inserted: `sqlite3 backend/data/cctv.db "SELECT count(*) FROM recording_segments;"`

### 3. Disk filling up too fast
- **Cause**: Retention duration set too high for available storage.
- **Action**: Lower `recording_duration_hours` in the Camera Management settings.
- **Manual Trigger**: You can restart the backend to trigger an immediate `HouseKeeper` sweep.

## 🔄 Rollback & Recovery
If the recording core becomes unstable after an update:
1. Stop the services: `pm2 stop ecosystem.config.cjs`
2. Revert to the last stable commit: `git checkout <commit-hash>`
3. Re-install dependencies: `npm install` (in backend)
4. Restart: `pm2 start ecosystem.config.cjs`
