#!/bin/bash
# Check EZVIZ camera recording issue on production

echo "================================================================================"
echo "DIAGNOSIS: EZVIZ Camera Recording Issue (Production)"
echo "================================================================================"

# 1. Find EZVIZ camera ID
echo -e "\n1. Finding EZVIZ camera..."
CAMERA_INFO=$(sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "SELECT id, name FROM cameras WHERE name LIKE '%EZVIZ%'")
echo "Camera: $CAMERA_INFO"

if [ -z "$CAMERA_INFO" ]; then
    echo "ERROR: EZVIZ camera not found!"
    exit 1
fi

CAMERA_ID=$(echo $CAMERA_INFO | cut -d'|' -f1)
CAMERA_NAME=$(echo $CAMERA_INFO | cut -d'|' -f2)
echo "Camera ID: $CAMERA_ID"
echo "Camera Name: $CAMERA_NAME"

# 2. Check database recordings
echo -e "\n2. Database recordings for camera $CAMERA_ID:"
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "SELECT filename, status, start_time FROM recordings WHERE camera_id = $CAMERA_ID ORDER BY start_time DESC" | head -20

DB_COUNT=$(sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "SELECT COUNT(*) FROM recordings WHERE camera_id = $CAMERA_ID")
echo "Total in database: $DB_COUNT"

# 3. Check filesystem files
echo -e "\n3. Filesystem files for camera$CAMERA_ID:"
RECORDING_DIR="/var/www/rafnet-cctv/recordings/camera$CAMERA_ID"

if [ -d "$RECORDING_DIR" ]; then
    ls -lh $RECORDING_DIR/*.mp4 2>/dev/null | tail -20
    FS_COUNT=$(ls -1 $RECORDING_DIR/*.mp4 2>/dev/null | wc -l)
    echo "Total in filesystem: $FS_COUNT"
else
    echo "ERROR: Directory not found: $RECORDING_DIR"
    exit 1
fi

# 4. Find missing files
echo -e "\n4. Checking for mismatch..."
echo "Files in database: $DB_COUNT"
echo "Files in filesystem: $FS_COUNT"

if [ $FS_COUNT -gt $DB_COUNT ]; then
    echo -e "\n⚠️ MISMATCH DETECTED: $((FS_COUNT - DB_COUNT)) files in filesystem but NOT in database"
    
    echo -e "\nFiles in filesystem:"
    ls -1 $RECORDING_DIR/*.mp4 2>/dev/null | xargs -n1 basename > /tmp/fs_files.txt
    
    echo -e "\nFiles in database:"
    sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "SELECT filename FROM recordings WHERE camera_id = $CAMERA_ID" > /tmp/db_files.txt
    
    echo -e "\n⚠️ Missing in database:"
    comm -23 <(sort /tmp/fs_files.txt) <(sort /tmp/db_files.txt)
    
    rm /tmp/fs_files.txt /tmp/db_files.txt
fi

# 5. Check playback query
echo -e "\n5. Playback query (status='completed' only):"
PLAYBACK_COUNT=$(sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "SELECT COUNT(*) FROM recordings WHERE camera_id = $CAMERA_ID AND status = 'completed'")
echo "Recordings with status='completed': $PLAYBACK_COUNT"

if [ $PLAYBACK_COUNT -lt $DB_COUNT ]; then
    echo -e "\n⚠️ Some recordings have status != 'completed':"
    sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "SELECT filename, status FROM recordings WHERE camera_id = $CAMERA_ID AND status != 'completed'"
fi

echo -e "\n================================================================================"
echo "ROOT CAUSE ANALYSIS:"
echo "================================================================================"

if [ $FS_COUNT -gt $DB_COUNT ]; then
    echo "✗ Files exist in filesystem but NOT in database"
    echo "  Reason: Recording service created files but failed to write to database"
    echo "  Solution: Run sync script to add missing files to database"
elif [ $PLAYBACK_COUNT -lt $DB_COUNT ]; then
    echo "✗ Some recordings have status != 'completed'"
    echo "  Reason: Recording segments not properly finalized"
    echo "  Solution: Update recording status or check recording service"
else
    echo "✓ No obvious mismatch found"
fi

echo "================================================================================"
