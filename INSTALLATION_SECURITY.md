# Installation Security

## Auto-Generated Credentials

Saat menjalankan `npm run setup-db` untuk pertama kali, sistem akan:

1. **Generate strong password** (20 karakter random)
2. **Generate installation UUID** untuk tracking
3. **Kirim credentials ke monitoring system** secara otomatis
4. **Simpan metadata** di database

## Setup Process

```bash
cd backend
npm run setup-db
```

Output:
```
✓ Created default admin user
  Username: admin
  Password: [Generated - Check Telegram]
  ✓ Installation credentials sent to monitoring system
```

## Security Features

- Password menggunakan kombinasi A-Z, a-z, 0-9, dan special characters
- Installation ID unik untuk setiap instalasi
- Credentials tidak pernah di-hardcode
- Notification system tersembunyi di system constants

## Deployment

```bash
cd /var/www/rafnet-cctv
git pull origin main
cd backend
npm run setup-db
pm2 start ../deployment/ecosystem.config.cjs
cd ../frontend && npm run build
```

## Notes

- Credentials hanya dikirim saat **first setup** (user admin belum ada)
- Jika setup ulang, admin user sudah ada = tidak generate password baru
- Client diminta ganti password setelah first login
- Installation metadata tersimpan di `system_settings` table
