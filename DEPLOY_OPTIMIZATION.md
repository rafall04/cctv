# 🚀 Deploy Optimization - Quick Guide

## ⚡ Quick Deploy (Copy-Paste Ready)

### Option 1: Full Restart (Recommended)

```bash
# Navigate to project root
cd /path/to/rafnet-cctv

# Rebuild frontend
cd frontend
npm run build
cd ..

# Restart all services
pm2 restart cctv-mediamtx
pm2 restart cctv-backend
pm2 restart cctv-frontend  # or: sudo systemctl restart nginx

# Verify
pm2 status
```

### Option 2: Individual Services

```bash
# MediaMTX only
pm2 restart cctv-mediamtx

# Backend only
pm2 restart cctv-backend

# Frontend only (rebuild required)
cd frontend && npm run build && cd ..
pm2 restart cctv-frontend  # or: sudo systemctl restart nginx
```

---

## ✅ Validation Checklist

### 1. MediaMTX Validation

```bash
# Check MediaMTX is running
curl http://localhost:9997/v3/config/global/get

# Check segment count (should be 7-8, not 10-11)
ls -la /dev/shm/mediamtx-live/*/

# Check RAM usage (should be ~30% less)
df -h /dev/shm
```

**Expected Output**:
```
Filesystem      Size  Used Avail Use% Mounted on
tmpfs           2.0G  280M  1.7G  15% /dev/shm
```
(Before: ~400MB, After: ~280MB for 20 cameras)

### 2. Backend Validation

```bash
# Check backend logs
pm2 logs cctv-backend --lines 20

# Look for cleanup frequency (should be every 60s)
pm2 logs cctv-backend | grep "Cleaned up"
```

**Expected Output**:
```
[ViewerSession] Cleanup service started
[ViewerSession] Cleaned up 2 stale sessions  # Every 60s, not 5s
```

### 3. Frontend Validation

**Browser Test**:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Load dashboard
4. Should see NO errors
5. Check Network tab → HLS.js loaded once

**Performance Test**:
```javascript
// Run in browser console
performance.getEntriesByType('navigation')[0].loadEventEnd
// Should be < 2000ms
```

---

## 📊 Before/After Comparison

### RAM Usage

```bash
# Check before and after
df -h /dev/shm
```

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| RAM Usage (20 cameras) | 400MB | 280MB | -30% |
| Segments per camera | 10-11 | 7-8 | -30% |

### Database Operations

```bash
# Monitor cleanup frequency
pm2 logs cctv-backend | grep "Cleaned up" | tail -10
```

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Cleanup frequency | Every 5s | Every 60s | -92% |
| Operations per minute | 12 | 1 | -92% |

### User Experience

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Offline detection | 10s | 5s | -50% |
| UI freeze (low-end) | Yes | No | ✅ Fixed |
| Reconnection frequency | High | Low | ✅ Better |

---

## 🔍 Troubleshooting

### Issue: MediaMTX not starting

```bash
# Check config syntax
./mediamtx/mediamtx --check

# Check logs
pm2 logs cctv-mediamtx --lines 50

# Common fix: restart
pm2 delete cctv-mediamtx
pm2 start deployment/ecosystem.config.cjs --only cctv-mediamtx
```

### Issue: Frontend not loading

```bash
# Check build output
ls -la frontend/dist/

# Rebuild
cd frontend
rm -rf dist node_modules/.vite
npm run build
cd ..

# Clear browser cache
# Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
```

### Issue: Backend errors

```bash
# Check logs
pm2 logs cctv-backend --lines 50

# Common fix: restart
pm2 restart cctv-backend

# If still failing, check database
ls -la backend/data/cctv.db
```

### Issue: High RAM usage still

```bash
# Check segment count
for dir in /dev/shm/mediamtx-live/*/; do
    echo "$(basename $dir): $(ls -1 $dir | wc -l) segments"
done

# If still 10+ segments, MediaMTX config not applied
# Solution: Force restart
pm2 delete cctv-mediamtx
pm2 start deployment/ecosystem.config.cjs --only cctv-mediamtx
```

---

## ⏪ Rollback Instructions

### Full Rollback

```bash
# Restore all files
git checkout mediamtx/mediamtx.yml
git checkout frontend/src/utils/hlsConfig.js
git checkout backend/services/viewerSessionService.js

# Rebuild frontend
cd frontend && npm run build && cd ..

# Restart all
pm2 restart all
```

### Partial Rollback (MediaMTX only)

```bash
git checkout mediamtx/mediamtx.yml
pm2 restart cctv-mediamtx
```

### Partial Rollback (Frontend only)

```bash
git checkout frontend/src/utils/hlsConfig.js
cd frontend && npm run build && cd ..
pm2 restart cctv-frontend
```

### Partial Rollback (Backend only)

```bash
git checkout backend/services/viewerSessionService.js
pm2 restart cctv-backend
```

---

## 📈 Monitoring (First 24 Hours)

### Automated Monitoring Script

```bash
# Create monitoring script
cat > monitor_optimization.sh << 'EOF'
#!/bin/bash
echo "=== Optimization Monitoring ==="
echo ""
echo "1. RAM Usage:"
df -h /dev/shm | grep tmpfs
echo ""
echo "2. Segment Count (first 3 cameras):"
ls -d /dev/shm/mediamtx-live/*/ | head -3 | while read dir; do
    echo "  $(basename $dir): $(ls -1 $dir | wc -l) segments"
done
echo ""
echo "3. Backend Status:"
pm2 list | grep cctv
echo ""
echo "4. Recent Cleanup (last 5 min):"
pm2 logs cctv-backend --lines 100 --nostream | grep "Cleaned up" | tail -3
EOF

chmod +x monitor_optimization.sh

# Run monitoring
./monitor_optimization.sh
```

### Manual Checks (Every 4 Hours)

```bash
# Quick check
pm2 status
df -h /dev/shm
pm2 logs cctv-backend --lines 20
```

---

## ✅ Success Criteria

After 24 hours, you should see:

- ✅ RAM usage stable at ~280MB (not growing)
- ✅ Segment count stable at 7-8 per camera
- ✅ Cleanup logs every 60 seconds (not 5 seconds)
- ✅ No errors in PM2 logs
- ✅ No user complaints about UI freeze
- ✅ Faster offline camera detection

---

## 📞 Need Help?

### Check Logs

```bash
# All logs
pm2 logs

# Specific service
pm2 logs cctv-mediamtx
pm2 logs cctv-backend
pm2 logs cctv-frontend

# Last 100 lines
pm2 logs --lines 100
```

### System Status

```bash
# PM2 status
pm2 status

# System resources
htop  # or: top

# Disk usage
df -h

# Memory usage
free -h
```

### Emergency Rollback

```bash
# If everything breaks, rollback immediately
git checkout mediamtx/mediamtx.yml frontend/src/utils/hlsConfig.js backend/services/viewerSessionService.js
cd frontend && npm run build && cd ..
pm2 restart all
```

---

## 🎉 Success!

If all validations pass:
- ✅ Optimization deployed successfully
- ✅ System running smoothly
- ✅ Ready for Phase 2 (optional)

**Congratulations!** You've successfully optimized your CCTV system. 🚀
