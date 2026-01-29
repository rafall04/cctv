# Standarisasi Model Play CCTV

## Prinsip Standarisasi

Semua komponen video player (MapView, LandingPage Grid View, Playback) harus mengikuti standar yang sama untuk konsistensi UX.

**PENTING:** Playback adalah fitur untuk memutar rekaman video (bukan live stream). Playback memiliki kontrol tambahan seperti timeline, speed control, dan segment selection yang tidak ada di live stream player.

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

### 3. Playback - Recording Player dengan Timeline

```
┌─────────────────────────────────────┐
│ Header Info                         │
│ - Camera selector dropdown          │
│ - Date picker                       │
│ - Segment list                      │
├─────────────────────────────────────┤
│                                     │
│         Video Player Area           │
│         (dengan timeline controls)  │
│                                     │
├─────────────────────────────────────┤
│ Timeline Controls                   │
│ - Play/Pause                        │
│ - Timeline slider                   │
│ - Speed control (0.5x - 2x)         │
│ - Current time / Duration           │
│ - Download button                   │
└─────────────────────────────────────┘
```

**Perbedaan Playback vs Live Stream:**
- Playback: Ada timeline, speed control, seek, download
- Live Stream: Hanya play/pause, snapshot, fullscreen

### 4. Mode Fullscreen (Semua View)

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

**Note untuk Playback Fullscreen:**
- Timeline controls tetap visible di bottom
- Speed control accessible
- Exit fullscreen button di top right

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

#### Playback Page
```jsx
{/* Header - Camera & Date Selection */}
<div className="bg-white dark:bg-gray-900 rounded-lg p-4 shadow-lg">
    <h1 className="text-2xl font-bold mb-4">Playback Recording</h1>
    
    {/* Camera Selector */}
    <select value={selectedCamera} onChange={handleCameraChange}>
        {cameras.map(camera => (
            <option key={camera.id} value={camera.id}>
                {camera.name}
            </option>
        ))}
    </select>
    
    {/* Date Picker */}
    <input type="date" value={selectedDate} onChange={handleDateChange} />
    
    {/* Segment List */}
    <div className="segment-list">
        {segments.map(segment => (
            <button 
                key={segment.id} 
                onClick={() => setSelectedSegment(segment)}
                className={selectedSegment?.id === segment.id ? 'active' : ''}
            >
                {segment.start_time} - {segment.end_time}
            </button>
        ))}
    </div>
</div>

{/* Video Player dengan Timeline Controls */}
<div className="video-container">
    <video ref={videoRef} controls />
    
    {/* Custom Timeline Controls */}
    <div className="timeline-controls">
        <button onClick={togglePlayPause}>
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        
        <input 
            type="range" 
            min="0" 
            max={duration} 
            value={currentTime}
            onChange={handleSeek}
        />
        
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
        
        {/* Speed Control */}
        <select value={playbackSpeed} onChange={handleSpeedChange}>
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
        </select>
        
        <button onClick={handleDownload}>
            <DownloadIcon />
        </button>
    </div>
</div>
```

**Catatan Penting untuk Playback:**
- Gunakan `<video>` native controls atau custom controls
- JANGAN gunakan HLS.js untuk playback recording (gunakan direct video URL)
- Implementasikan seek dengan validasi (max 180 detik dari posisi saat ini)
- Speed control menggunakan `video.playbackRate`
- Download button untuk download segment recording

## Checklist Implementasi

Saat membuat atau memodifikasi video player component:

**Live Stream (MapView & GridView):**
- [ ] MapView: Info di atas video (header)
- [ ] GridView: Info di bawah video (footer)
- [ ] Codec badge ditampilkan di samping nama kamera
- [ ] Tidak ada teks panjang codec atau warning box
- [ ] Fullscreen mode: codec badge di top bar
- [ ] Responsive untuk mobile dan desktop
- [ ] Konsisten dengan komponen lain

**Playback Recording:**
- [ ] Camera selector dropdown dengan list semua kamera
- [ ] Date picker untuk pilih tanggal recording
- [ ] Segment list untuk pilih segment waktu
- [ ] Timeline controls (play/pause, seek, time display)
- [ ] Speed control (0.5x, 1x, 1.5x, 2x)
- [ ] Download button untuk download segment
- [ ] Seek validation (max 180 detik dari posisi saat ini)
- [ ] Error handling untuk segment tidak tersedia
- [ ] Loading state saat load segment baru

## Alasan Standarisasi

1. **Konsistensi UX**: User mendapat pengalaman yang sama di semua view
2. **Clean Design**: Codec badge lebih elegan daripada teks panjang
3. **Flexibility**: MapView (info atas) vs GridView (info bawah) sesuai konteks penggunaan
4. **Accessibility**: Info selalu terlihat, tidak hilang saat fullscreen

## Testing

Saat testing video player:

**Live Stream:**
1. Buka kamera di MapView → Cek info di atas video
2. Buka kamera di GridView → Cek info di bawah video
3. Klik fullscreen → Cek codec badge di top bar
4. Test dengan kamera H264 dan H265
5. Test di mobile (portrait & landscape)
6. Pastikan codec badge muncul dengan jelas

**Playback Recording:**
1. Pilih kamera dari dropdown → Cek segment list muncul
2. Pilih tanggal → Cek segment list update
3. Klik segment → Cek video load dan play
4. Test timeline seek → Cek validasi max 180 detik
5. Test speed control → Cek playback speed berubah (0.5x - 2x)
6. Test download button → Cek file download
7. Test error handling → Cek pesan error jika segment tidak ada
8. Test di mobile → Cek responsive controls

## Maintenance

Jika ada perubahan pada codec info display:
1. Update SEMUA komponen video player (MapView, LandingPage, Playback)
2. Update dokumentasi ini
3. Test di semua view mode (normal, fullscreen, mobile)
