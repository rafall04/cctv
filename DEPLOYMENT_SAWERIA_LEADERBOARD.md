# Deployment Guide - Saweria Leaderboard Feature

## Fitur yang Ditambahkan
1. **Database**: Field `leaderboard_link` di tabel `saweria_settings`
2. **Backend**: Update controller, service, dan schema validator
3. **Frontend Admin**: Input field untuk leaderboard link di halaman Saweria Settings
4. **Frontend Public**: Komponen SaweriaLeaderboard dengan CTA button (bukan iframe karena X-Frame-Options restriction)

## Important Note: Iframe vs CTA Button

Saweria.co menggunakan `X-Frame-Options: sameorigin` yang **mencegah iframe embed dari domain lain**.

**Solusi yang diimplementasikan:**
- ✅ Attractive CTA card dengan gradient design
- ✅ External link button yang membuka leaderboard di tab baru
- ✅ Better UX dengan clear call-to-action
- ✅ Real-time update dan verified supporters badges
- ✅ Responsive design dengan decorative elements

### 1. Pull Latest Code
```bash
cd /var/www/rafnet-cctv
git pull origin main
```

### 2. Run Database Migration
```bash
cd /var/www/rafnet-cctv/backend
node database/migrations/add_saweria_settings.js
```

Expected output:
```
Creating saweria_settings table...
✓ saweria_settings table created
Adding leaderboard_link column...
✓ leaderboard_link column added
✓ Saweria settings already exist
✓ Default leaderboard_link added to existing settings

✅ Migration completed successfully
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

#### Check Backend API
```bash
# Test get settings endpoint (requires auth token)
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/saweria/settings

# Expected response should include leaderboard_link field
```

#### Check Frontend
1. Login ke admin panel: https://cctv.raf.my.id/admin/login
2. Navigate ke: Admin > Saweria Settings
3. Verify ada input field "Link Leaderboard Saweria"
4. Test save dengan mengisi leaderboard link

#### Check Public Page
1. Buka: https://cctv.raf.my.id
2. Scroll ke bawah setelah camera grid
3. Verify leaderboard muncul jika link sudah diisi di admin

## Configuration

### Default Leaderboard Link
Default link yang digunakan: `https://saweria.co/overlays/leaderboard/raflialdi`

### Customize Leaderboard
1. Login ke admin panel
2. Go to Saweria Settings
3. Update "Link Leaderboard Saweria" dengan link Anda
4. Format: `https://saweria.co/overlays/leaderboard/YOUR_USERNAME`
5. Klik "Simpan Pengaturan"

## Penempatan Leaderboard

Leaderboard ditampilkan di LandingPage dengan urutan:
1. Hero Section (dengan StatsBar)
2. Camera Grid Section
3. **Saweria Leaderboard** ← Posisi baru
4. Footer

Leaderboard hanya muncul jika:
- Saweria enabled = true
- Leaderboard link tidak kosong

## Troubleshooting

### Leaderboard tidak muncul
1. Check admin settings: pastikan leaderboard_link terisi
2. Check browser console untuk error
3. Verify button CTA muncul dengan benar

### X-Frame-Options Error (SOLVED)
Error: `Refused to display 'https://saweria.co/' in a frame because it set 'X-Frame-Options' to 'sameorigin'`

**Solution:** Gunakan CTA button dengan external link, bukan iframe embed. Sudah diimplementasikan di commit `019ab14`.

### Migration error
Jika migration gagal karena column sudah ada:
```bash
# Check current table structure
sqlite3 /var/www/rafnet-cctv/data/cctv.db ".schema saweria_settings"

# If leaderboard_link already exists, skip migration
```

### Frontend build error
```bash
# Clear cache and rebuild
cd /var/www/rafnet-cctv/frontend
rm -rf node_modules/.vite
npm run build
```

## Rollback (if needed)

Jika ada masalah, rollback dengan:
```bash
cd /var/www/rafnet-cctv
git reset --hard a081c5c  # Commit sebelum leaderboard feature
npm run build
pm2 restart rafnet-cctv-backend
```

## Testing Checklist

- [ ] Migration berhasil tanpa error
- [ ] Frontend build berhasil
- [ ] Backend restart berhasil
- [ ] Admin page menampilkan input leaderboard link
- [ ] Dapat save leaderboard link di admin
- [ ] Leaderboard CTA card muncul di public page
- [ ] Button "Buka Leaderboard" berfungsi (open new tab)
- [ ] Gradient design dan badges tampil dengan benar
- [ ] Responsive di mobile dan desktop

## Notes

- Leaderboard menggunakan **CTA button dengan external link**, bukan iframe
- Alasan: Saweria.co blocks iframe dengan `X-Frame-Options: sameorigin`
- Design: Attractive gradient card dengan trophy icon dan badges
- Opens in new tab dengan `target="_blank"` dan `rel="noopener noreferrer"`
- Responsive height dan spacing untuk semua device sizes
