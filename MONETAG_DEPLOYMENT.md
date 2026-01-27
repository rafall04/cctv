# Monetag Admin Panel - Deployment Guide

## ✅ Completed Features

### Backend
- Database migration: `monetag_settings` table created
- API endpoints: GET/PUT `/api/monetag/settings` (admin), GET `/api/monetag/config` (public)
- Service layer: Dynamic config management
- Schema validation: All fields validated

### Frontend
- Admin page: `/admin/monetag` - Complete UI with toggles and Zone ID inputs
- Dynamic config: All components load config from API (no hardcoded values)
- Components updated: `MonetagAds.jsx`, `MonetagVideoAd.jsx`

## 🚀 Deployment Steps (Ubuntu 20.04)

### 1. Pull Latest Changes
```bash
cd /var/www/rafnet-cctv
git pull origin main
```

### 2. Run Database Migration
```bash
cd /var/www/rafnet-cctv
node backend/database/migrations/add_monetag_settings.js
```

Expected output:
```
Creating monetag_settings table...
✓ monetag_settings table created
Inserting default Monetag settings...
✓ Default Monetag settings inserted
✅ Migration completed successfully!
```

### 3. Build Frontend
```bash
cd /var/www/rafnet-cctv/frontend
npm run build
```

### 4. Restart Backend
```bash
pm2 restart rafnet-cctv-backend
```

### 5. Verify Deployment
```bash
# Test public config endpoint
curl http://localhost:3000/api/monetag/config

# Test admin endpoint (requires JWT token)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:3000/api/monetag/settings
```

## 📝 Configuration via Admin Panel

1. Login to admin panel: `https://cctv.raf.my.id/login`
2. Navigate to "Monetag" menu
3. Configure each ad format:
   - **Popunder**: Background revenue, 1x per 24h
   - **Native Banner**: Shows when video plays
   - **Push Notifications**: Requires service worker (optional)
   - **Social Bar**: Sticky bottom bar (optional)
   - **Direct Link**: Standard banner ads (optional)

4. For each format:
   - Toggle enable/disable
   - Enter Zone ID from Monetag dashboard
   - Click "Simpan Pengaturan"

## 🔍 Testing

### Test Popunder (Public)
1. Visit landing page: `https://cctv.raf.my.id`
2. Popunder should load once per 24h (check browser console)

### Test Native Banner (Video Ad)
1. Visit landing page
2. Click any camera to play video
3. Native banner should appear below video player
4. Banner hidden when video paused/closed

### Test Admin Panel
1. Login as admin
2. Go to Monetag settings
3. Toggle any format on/off
4. Save and verify changes reflected on public site

## 📊 Default Settings

After migration, default settings:
- Popunder: **Enabled** (Zone ID: placeholder)
- Native Banner: **Enabled** (Zone ID: placeholder)
- Push Notifications: **Disabled**
- Social Bar: **Disabled**
- Direct Link: **Disabled**

**IMPORTANT**: Update Zone IDs in admin panel with real values from Monetag!

## ✅ Deployment Checklist

- [ ] Git pull completed
- [ ] Database migration executed successfully
- [ ] Frontend built without errors
- [ ] Backend restarted
- [ ] Public config endpoint returns data
- [ ] Admin panel accessible
- [ ] Zone IDs configured in admin panel
- [ ] Popunder loads on landing page
- [ ] Native banner shows when video plays

## 🎯 Next Steps

1. Get real Zone IDs from Monetag dashboard
2. Configure Zone IDs via admin panel
3. Test each ad format
4. Monitor revenue in Monetag dashboard

Deployment completed! All Monetag configuration now manageable from admin panel.
