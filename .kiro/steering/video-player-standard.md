# Standarisasi Model Play CCTV

## Prinsip Standarisasi

Semua komponen video player (MapView, LandingPage Grid View, Playback) harus mengikuti standar yang sama untuk konsistensi UX.

## Struktur Video Modal/Popup

### 1. Mode Normal (Non-Fullscreen)

```
┌─────────────────────────────────────┐
│ Header (optional)                   │
│ - Camera name + CodecBadge          │
│ - Status badge (LIVE/LOADING)       │
│ - Controls (snapshot, fullscreen)   │
├─────────────────────────────────────┤
│                                     │
│         Video Player Area           │
│                                     │
├─────────────────────────────────────┤
│ Info Panel / Footer                 │
│ - Location + Area                   │
│ - Zoom controls                     │
│ - Codec Info Section:               │
│   • Codec name (H264/H265)          │
│   • CodecBadge                      │
│   • Warning/compatibility info      │
└─────────────────────────────────────┘
```

### 2. Mode Fullscreen

```
┌─────────────────────────────────────┐
│ Top Bar (floating, gradient fade)   │
│ - Camera name + CodecBadge          │
│ - Status badge                      │
│ - Codec detail (NEW!)               │
│   • "Codec: H265"                   │
│   • "⚠ Terbaik di Safari" (H265)    │
│ - Controls (snapshot, exit)         │
│                                     │
│                                     │
│         Video Player Area           │
│         (full screen)               │
│                                     │
│                                     │
│ Bottom Right (floating)             │
│ - Zoom controls                     │
└─────────────────────────────────────┘
```

## Codec Info Display Rules

### Rule 1: Selalu Tampilkan Codec Info
- **Mode Normal**: Di Info Panel/Footer (bawah video)
- **Mode Fullscreen**: Di Top Bar (atas video)

### Rule 2: Codec Info Components
1. **Codec Name**: `Codec: H264` atau `Codec: H265`
2. **CodecBadge**: Visual badge dengan warna (hijau/kuning)
3. **Warning/Compatibility** (jika H265):
   - Normal mode: Box dengan border dan icon
   - Fullscreen mode: Text singkat "⚠ Terbaik di Safari"

### Rule 3: Implementasi Kode

#### MapView VideoModal
```jsx
{/* Fullscreen top bar */}
{isFullscreen && (
    <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
                <h2>{camera.name}</h2>
                {camera.video_codec && (
                    <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                )}
                <span>LIVE/LOADING</span>
            </div>
            <div>{/* Controls */}</div>
        </div>
        {/* Codec detail - WAJIB */}
        {camera.video_codec && (
            <div className="mt-2 flex items-center gap-2 text-xs">
                <span>Codec: <strong>{camera.video_codec.toUpperCase()}</strong></span>
                {camera.video_codec === 'h265' && (
                    <span className="text-yellow-400 text-[10px]">⚠ Terbaik di Safari</span>
                )}
            </div>
        )}
    </div>
)}

{/* Normal mode info panel */}
<div className={`p-3 ${isFullscreen ? 'hidden' : ''}`}>
    {/* Camera info */}
    {/* Codec Info Section - WAJIB */}
    {camera.video_codec && (
        <div className="pt-2 border-t">
            <div className="flex items-center gap-2">
                <span>Codec: <strong>{camera.video_codec.toUpperCase()}</strong></span>
                <CodecBadge codec={camera.video_codec} size="sm" showWarning={false} />
            </div>
            {/* Full warning box untuk H265 */}
            {camera.video_codec === 'h265' ? (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded text-[10px]">
                    ⚠ Terbaik di Safari. Chrome/Edge tergantung hardware.
                </div>
            ) : (
                <div className="text-[10px]">✓ Kompatibel dengan semua browser</div>
            )}
        </div>
    )}
</div>
```

#### LandingPage VideoPopup
Sama seperti MapView, dengan struktur:
- Header (non-fullscreen)
- Video area
- Footer (non-fullscreen) dengan codec info
- Floating top bar (fullscreen) dengan codec detail

## Checklist Implementasi

Saat membuat atau memodifikasi video player component:

- [ ] Codec info ditampilkan di mode normal (Info Panel/Footer)
- [ ] Codec info ditampilkan di mode fullscreen (Top Bar)
- [ ] CodecBadge component digunakan
- [ ] Warning H265 ditampilkan dengan jelas
- [ ] Responsive untuk mobile dan desktop
- [ ] Konsisten dengan komponen lain (MapView, LandingPage, Playback)

## Alasan Standarisasi

1. **Konsistensi UX**: User mendapat pengalaman yang sama di semua view
2. **Informasi Penting**: Codec info membantu user memahami kompatibilitas browser
3. **Troubleshooting**: User bisa langsung tahu jika masalah karena codec H265
4. **Accessibility**: Info selalu terlihat, tidak hilang saat fullscreen

## Testing

Saat testing video player:
1. Buka kamera di mode normal → Cek codec info di bawah
2. Klik fullscreen → Cek codec info di top bar
3. Test dengan kamera H264 dan H265
4. Test di mobile (portrait & landscape)
5. Pastikan warning H265 muncul dengan jelas

## Maintenance

Jika ada perubahan pada codec info display:
1. Update SEMUA komponen video player (MapView, LandingPage, Playback)
2. Update dokumentasi ini
3. Test di semua view mode (normal, fullscreen, mobile)
