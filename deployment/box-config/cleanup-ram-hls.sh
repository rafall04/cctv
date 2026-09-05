#!/bin/bash
# Cleanup old HLS segments in RAM (safety net if MediaMTX crashes)
# Delete .ts and .m3u8 files older than 10 minutes

find /dev/shm/mediamtx-live -type f \( -name "*.ts" -o -name "*.m3u8" \) -mmin +10 -delete 2>/dev/null || true
find /dev/shm/nginx-cache -type f -mmin +10 -delete 2>/dev/null || true
