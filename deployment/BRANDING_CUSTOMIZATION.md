# Branding Customization Guide

Panduan lengkap untuk customize branding sistem CCTV untuk client baru.

## Overview

Sistem branding memungkinkan customization penuh tanpa edit kode:
- Nama perusahaan & tagline
- Nama kota & provinsi
- Hero section text
- Meta tags untuk SEO
- Logo & warna primary
- Footer & copyright text

## Quick Start

### 1. Login ke Admin Panel

```
URL: http://cctv.client.com:800/admin
Username: admin
Password: admin123 (WAJIB diganti!)
```

### 2. Buka Branding Settings

Navigation: **Settings → Branding**

### 3. Update Fields

**Wajib diubah:**
- Company Name
- Company Tagline
- City Name
- Province Name
- Hero Title
- Hero Subtitle
- Meta Title
- Meta Description
- Meta Keywords

**Optional:**
- Logo Text (default: "R")
- Primary Color (default: #0ea5e9)
- Show Powered By (default: true)

### 4. Save & Verify

Klik "Save Changes" → Refresh landing page → Verify changes

## Branding Fields Reference

### Company Information

| Field | Description | Example | Max Length |
|-------|-------------|---------|------------|
| company_name | Nama perusahaan/organisasi | "CLIENT NET" | 100 |
| company_tagline | Tagline singkat | "CCTV Kota ABC Online" | 200 |
| company_description | Deskripsi lengkap perusahaan | "CLIENT NET melayani pemasangan WiFi dan CCTV di wilayah Kota ABC..." | 500 |
| copyright_text | Teks copyright di footer | "Penyedia Internet & CCTV Kota ABC" | 200 |
| whatsapp_number | Nomor WhatsApp untuk kontak | "628123456789" | 20 |

### Location Information

| Field | Description | Example |
|-------|-------------|---------|
| city_name | Nama kota/kabupaten | "Kota ABC" |
| province_name | Nama provinsi | "Jawa Tengah" |

### Hero Section

| Field | Description | Example | Max Length |
|-------|-------------|---------|------------|
| hero_title | Judul utama hero section | "Pantau CCTV Kota ABC Secara Real-Time" | 200 |
| hero_subtitle | Subtitle/deskripsi hero | "Pantau keamanan wilayah Kota ABC secara real-time dengan sistem CCTV CLIENT NET. Akses gratis 24 jam untuk memantau berbagai lokasi di Kota ABC, Jawa Tengah." | 500 |
| footer_text | Teks di bawah hero | "Layanan pemantauan CCTV publik oleh CLIENT NET untuk keamanan dan kenyamanan warga Kota ABC" | 300 |

### SEO Meta Tags

| Field | Description | Example | Max Length |
|-------|-------------|---------|------------|
| meta_title | Page title (SEO) | "CCTV Kota ABC Online - CLIENT NET \| Pantau Keamanan Kota ABC Live" | 100 |
| meta_description | Meta description (SEO) | "Pantau CCTV Kota ABC secara online dan live streaming 24 jam. CLIENT NET menyediakan akses publik untuk memantau keamanan kota Kota ABC, Jawa Tengah. Gratis tanpa login." | 300 |
| meta_keywords | Meta keywords (SEO) | "cctv kota abc, cctv kota abc online, cctv client net, pantau cctv kota abc, live streaming cctv kota abc, keamanan kota abc, cctv jawa tengah, client net kota abc, cctv kota kota abc, monitoring kota abc" | 500 |

### Visual Branding

| Field | Description | Example | Format |
|-------|-------------|---------|--------|
| logo_text | Logo text (1 huruf) | "C" | 1 char |
| primary_color | Warna primary theme | "#0ea5e9" | Hex color |
| show_powered_by | Show "Powered by" badge | "true" / "false" | Boolean string |

## UI Components yang Ter-customize

### Navbar
- Logo (logo_text)
- Company name
- Company tagline
- City name (live indicator)

### Hero Section
- Powered by badge (jika show_powered_by = true)
- Hero title
- Hero subtitle
- Footer text

### Footer
- Company name & logo
- Copyright text
- Company description
- WhatsApp contact button
- Meta keywords (SEO footer)

### Meta Tags (Dynamic)
- Page title
- Meta description
- Meta keywords
- Open Graph tags
- Twitter Card tags
- Structured data (JSON-LD)

## Advanced: API Usage

### Get Branding Settings (Public)

```bash
curl http://localhost:3000/api/branding
```

Response:
```json
{
  "success": true,
  "data": {
    "company_name": "RAF NET",
    "company_tagline": "CCTV Bojonegoro Online",
    "city_name": "Bojonegoro",
    ...
  }
}
```

### Update Single Setting (Admin)

```bash
# Get token
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | jq -r '.data.token')

# Update setting
curl -X PUT http://localhost:3000/api/branding/company_name \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"CLIENT NET"}'
```

### Bulk Update (Admin)

```bash
curl -X PUT http://localhost:3000/api/branding/bulk \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "company_name": "CLIENT NET",
      "city_name": "Kota ABC",
      "province_name": "Jawa Tengah"
    }
  }'
```

### Reset to Defaults (Admin)

```bash
curl -X POST http://localhost:3000/api/branding/reset \
  -H "Authorization: Bearer $TOKEN"
```

## Database Direct Access

### View Current Settings

```bash
sqlite3 /var/www/cctv/backend/data/cctv.db

SELECT key, value FROM branding_settings ORDER BY key;

.quit
```

### Update via SQL

```bash
sqlite3 /var/www/cctv/backend/data/cctv.db

UPDATE branding_settings SET value = 'CLIENT NET' WHERE key = 'company_name';
UPDATE branding_settings SET value = 'Kota ABC' WHERE key = 'city_name';
UPDATE branding_settings SET value = 'Jawa Tengah' WHERE key = 'province_name';

.quit
```

**IMPORTANT:** Restart backend setelah update manual:
```bash
pm2 restart cctv-backend
```

## SEO Best Practices

### Meta Title
- Max 60 characters
- Include: Kota, Perusahaan, Keyword utama
- Format: "CCTV [Kota] Online - [Perusahaan] | [Tagline]"

### Meta Description
- Max 160 characters
- Include: Layanan, Lokasi, Benefit, Call-to-action
- Natural language, bukan keyword stuffing

### Meta Keywords
- 10-15 keywords
- Pisahkan dengan koma
- Include: Variasi nama kota, nama perusahaan, layanan
- Format: "keyword1, keyword2, keyword3"

### Example (Good)

```
Meta Title: "CCTV Semarang Online - SEMARANG NET | Pantau Keamanan Kota Live"

Meta Description: "Pantau CCTV Semarang secara online dan live streaming 24 jam. SEMARANG NET menyediakan akses publik untuk memantau keamanan kota Semarang, Jawa Tengah. Gratis tanpa login."

Meta Keywords: "cctv semarang, cctv semarang online, cctv semarang net, pantau cctv semarang, live streaming cctv semarang, keamanan semarang, cctv jawa tengah, semarang net, cctv kota semarang, monitoring semarang"
```

## Troubleshooting

### Branding tidak muncul di UI

**Cek API response:**
```bash
curl http://localhost:3000/api/branding
```

**Cek browser console:**
- Open DevTools (F12)
- Check for errors
- Verify branding object in console

**Clear cache:**
- Hard refresh: Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac)
- Clear browser cache
- Try incognito mode

### Meta tags tidak update

Meta tags di-update dinamis saat page load via JavaScript.

**Verify:**
1. View page source (Ctrl+U)
2. Check initial meta tags (dari index.html)
3. Inspect element → Check updated meta tags
4. Meta tags akan berbeda antara source vs inspect

**Fix:**
```bash
# Rebuild frontend
cd /var/www/cctv/frontend
npm run build

# Restart backend
pm2 restart cctv-backend

# Reload Nginx
systemctl reload nginx
```

### Changes tidak tersimpan

**Cek permissions:**
```bash
ls -la /var/www/cctv/backend/data/cctv.db
# Should be writable by PM2 user
```

**Cek logs:**
```bash
pm2 logs cctv-backend --lines 50
```

**Verify database:**
```bash
sqlite3 /var/www/cctv/backend/data/cctv.db \
  "SELECT key, value, updated_at FROM branding_settings WHERE key = 'company_name';"
```

## Deployment Checklist

Saat setup client baru:

- [ ] Login ke admin panel
- [ ] Buka Settings → Branding
- [ ] Update company_name
- [ ] Update company_tagline
- [ ] Update city_name
- [ ] Update province_name
- [ ] Update whatsapp_number (format: 628xxx)
- [ ] Update hero_title
- [ ] Update hero_subtitle
- [ ] Update footer_text
- [ ] Update copyright_text
- [ ] Update meta_title
- [ ] Update meta_description
- [ ] Update meta_keywords
- [ ] Update logo_text (1 huruf)
- [ ] Update primary_color (optional)
- [ ] Set show_powered_by (true/false)
- [ ] Save changes
- [ ] Verify di landing page
- [ ] Test WhatsApp button
- [ ] Test SEO dengan Google Search Console
- [ ] Test Open Graph dengan Facebook Debugger

## Support

Untuk bantuan lebih lanjut:
- WhatsApp: +62 896-8564-5956
- Email: admin@raf.my.id
- GitHub: https://github.com/rafall04/cctv
