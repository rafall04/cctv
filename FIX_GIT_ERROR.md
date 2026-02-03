# Fix Git Error di Server Ubuntu

## Error yang Terjadi

```
error: Your local changes to the following files would be overwritten by merge:
        deployment/install.sh
Please commit your changes or stash them before you merge.
```

## Penyebab

Ada perubahan lokal di `deployment/install.sh` di server yang belum di-commit.

## ✅ Solusi (Pilih Salah Satu)

### Solusi 1: Stash Changes (Simpan Sementara)

```bash
cd /var/www/cctv

# Simpan perubahan lokal
git stash

# Pull dari GitHub
git pull origin main

# Restore perubahan lokal (jika perlu)
git stash pop
```

### Solusi 2: Discard Changes (Buang Perubahan Lokal)

```bash
cd /var/www/cctv

# Buang semua perubahan lokal
git reset --hard HEAD

# Pull dari GitHub
git pull origin main
```

### Solusi 3: Commit Changes (Simpan Perubahan)

```bash
cd /var/www/cctv

# Commit perubahan lokal
git add deployment/install.sh
git commit -m "Local changes"

# Pull dengan merge
git pull origin main

# Jika ada conflict, resolve manually
```

## 🎯 Recommended: Solusi 2 (Discard)

Karena perubahan di GitHub sudah benar, gunakan Solusi 2:

```bash
cd /var/www/cctv
git reset --hard HEAD
git pull origin main
```

## Verifikasi

```bash
# Cek status
git status
# Output: nothing to commit, working tree clean

# Cek versi terbaru
git log --oneline -3
# Output harus ada: 1709c31 Fix: install.sh config generation path

# Test syntax
bash -n deployment/install.sh
# Tidak ada output = SUCCESS
```

## Setelah Fix

```bash
# Restart services
pm2 restart all

# Test aplikasi
curl http://localhost:3000/health
```

---

**Status:** Ready to fix on Ubuntu server
