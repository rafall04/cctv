#!/bin/bash
# Deploy Smart Seek Limiter - Quick Fix
# Ubuntu 20.04 Production Server

set -e

echo "=========================================="
echo "Smart Seek Limiter - Deployment"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Error: This script must be run as root"
    exit 1
fi

# Navigate to project directory
cd /var/www/rafnet-cctv

echo "📥 Step 1: Pull latest changes from GitHub..."
git pull origin main
echo "✓ Code updated"
echo ""

echo "🔨 Step 2: Build frontend..."
cd frontend
npm run build
echo "✓ Frontend built"
echo ""

echo "✅ Deployment Complete!"
echo ""
echo "=========================================="
echo "What's New:"
echo "=========================================="
echo ""
echo "✨ Smart Seek Limiter (Max 3 menit per skip)"
echo "   - Mencegah buffering saat long seek"
echo "   - Warning notification yang user-friendly"
echo "   - Suggestion untuk skip bertahap"
echo ""
echo "🎯 User Experience:"
echo "   - Skip >3 menit → Otomatis dibatasi ke 3 menit"
echo "   - Notifikasi kuning muncul dengan info sisa jarak"
echo "   - Auto-hide setelah 5 detik"
echo ""
echo "📖 Dokumentasi:"
echo "   - PLAYBACK_USAGE.md (panduan untuk user)"
echo "   - VIDEO_SEEKING_FIX.md (technical details)"
echo ""
echo "🧪 Testing:"
echo "   1. Buka: https://cctv.raf.my.id/playback"
echo "   2. Pilih segment 10 menit"
echo "   3. Coba skip dari 00:00 ke 08:00"
echo "   4. Harus muncul warning kuning"
echo "   5. Video skip ke 03:00 (bukan stuck)"
echo ""
echo "=========================================="
