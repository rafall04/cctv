# Standarisasi Model Play CCTV

## Prinsip Standarisasi

Semua komponen video player (MapView, LandingPage Grid View, Playback) harus mengikuti standar yang sama untuk konsistensi UX.

## Struktur Video Modal/Popup

### 1. MapView - Info di Atas Video

```
┌─────────────────────────────────────┐
│ Header Info (non-fullscreen)        │
│ - Camera name + CodecBadge          │
│ - Status badge (Stabil/Tunnel)      │
│ - Location + Area                   │
├─────────────────────────────────────┤
│                                     │
│         Video Player Area           │
│                                     │
├─────────────────────────────────────┤
│ Controls Panel (non-fullscreen)     │
│ - Hint text                         │
│ - Zoom controls                     │
│ - Screenshot + Fullscreen buttons   │
└─────────────────────────────────────┘
```

### 2. GridView (LandingPage) - Info di Bawah Video

```
┌─────────────────────────────────────┐
│                                     │
│         Video Player Area           │
│                                     │
├─────────────────────────────────────┤
│ Footer Info (non-fullscreen)        │
│ - Camera name + CodecBadge          │
│ - Location + Area                   │
│ - Status badge                      │
│ - Controls (zoom, screenshot, etc)  │
└─────────────────────────────────────┘
```

### 3. Mode Fullscreen (Semua View)

```
┌─────────────────────────────────────┐
│ Top Bar (floating, gradient fade)   │
│ - Camera name + CodecBadge          │
│ - Status badge (LIVE/LOADING)       │
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

### Rule 1: Codec Badge Only - Simpel dan Elegan
- **Tampilkan**: CodecBadge component saja
- **Jangan tampilkan**: Teks panjang "Codec: H264" atau warning box
- **Alasan**: Lebih clean, user bisa hover/tap badge untuk info detail

### Rule 2: Codec Badge Placement
- **Mode Normal**: Di samping nama kamera (header untuk MapView, footer untuk GridView)
- **Mode Fullscreen**: Di top bar, di samping nama kamera

### Rule 3: Implementasi Kode

#### MapView VideoModal
```jsx
{/* Header Info - di atas video (hide in fullscreen) */}
{!isFullscreen && (
    <div className="p-3 border-b border-gray-800">
        <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
                <h3 className="text-white font-bold text-sm sm:text-base truncate">{camera.name}</h3>
                {camera.video_codec && (
                    <CodecBadge codec={camera.video_codec} size="sm" showWarning={false} />
                )}
            </div>
            {/* Status badges */}
            <div className="flex items-center gap-1 shrink-0">
                {/* Status badges here */}
            </div>
        </div>
        {/* Location + Area */}
        {(camera.location || camera.area_name) && (
            <div className="flex items-center gap-2 mt-1.5">
                {/* Location and area info */}
            </div>
        )}
    </div>
)}

{/* Fullscreen top bar */}
{isFullscreen && (
    <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
                <h2>{camera.name}</h2>
                {camera.video_codec && (
                    <CodecBadge codec={camera.video_codec} size="sm" showWarning={false} />
                )}
                <span>LIVE/LOADING</span>
            </div>
            <div>{/* Controls */}</div>
        </div>
    </div>
)}
```

#### LandingPage VideoPopup (GridView)
```jsx
{/* Footer Info - di bawah video (hide in fullscreen) */}
{!isFullscreen && (
    <div className="p-3 border-t border-gray-800">
        <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
                <h3>{camera.name}</h3>
                {camera.video_codec && (
                    <CodecBadge codec={camera.video_codec} size="sm" showWarning={false} />
                )}
            </div>
            {/* Controls */}
        </div>
        {/* Location + Area */}
    </div>
)}

{/* Fullscreen top bar - sama seperti MapView */}
```

## Checklist Implementasi

Saat membuat atau memodifikasi video player component:

- [ ] MapView: Info di atas video (header)
- [ ] GridView: Info di bawah video (footer)
- [ ] Codec badge ditampilkan di samping nama kamera
- [ ] Tidak ada teks panjang codec atau warning box
- [ ] Fullscreen mode: codec badge di top bar
- [ ] Responsive untuk mobile dan desktop
- [ ] Konsisten dengan komponen lain

## Alasan Standarisasi

1. **Konsistensi UX**: User mendapat pengalaman yang sama di semua view
2. **Clean Design**: Codec badge lebih elegan daripada teks panjang
3. **Flexibility**: MapView (info atas) vs GridView (info bawah) sesuai konteks penggunaan
4. **Accessibility**: Info selalu terlihat, tidak hilang saat fullscreen

## Testing

Saat testing video player:
1. Buka kamera di MapView → Cek info di atas video
2. Buka kamera di GridView → Cek info di bawah video
3. Klik fullscreen → Cek codec badge di top bar
4. Test dengan kamera H264 dan H265
5. Test di mobile (portrait & landscape)
6. Pastikan codec badge muncul dengan jelas

## Maintenance

Jika ada perubahan pada codec info display:
1. Update SEMUA komponen video player (MapView, LandingPage, Playback)
2. Update dokumentasi ini
3. Test di semua view mode (normal, fullscreen, mobile)
