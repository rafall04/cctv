# Requirements Document

## Introduction

Dokumen ini mendefinisikan requirements untuk optimasi Media Player pada sistem RAF NET CCTV Hub. Fokus utama adalah meningkatkan performa, efisiensi, dan responsivitas video player agar dapat berjalan dengan baik di semua jenis device, mulai dari low-end (HP kentang) hingga high-end devices. Masalah yang sering terjadi pada device low-end meliputi: video stuck/freeze, reload berulang, buffering berlebihan, dan lag meskipun koneksi internet stabil.

## Glossary

- **Video_Player**: Komponen React yang menampilkan stream video HLS dari kamera CCTV
- **HLS_Engine**: Library HLS.js yang menangani parsing dan playback stream HLS
- **Buffer_Manager**: Modul yang mengelola buffer video untuk optimasi memori dan playback
- **Adaptive_Quality**: Sistem yang menyesuaikan kualitas video berdasarkan kondisi device dan jaringan
- **Device_Detector**: Modul yang mendeteksi kapabilitas dan performa device pengguna
- **Stream_Controller**: Komponen yang mengontrol lifecycle stream video (load, play, pause, destroy)
- **Memory_Manager**: Sistem yang mengelola penggunaan memori untuk mencegah memory leak
- **Low_End_Device**: Device dengan RAM ≤ 2GB, CPU single/dual core, atau browser dengan limited capabilities
- **High_End_Device**: Device dengan RAM > 4GB, CPU quad core+, dan browser modern dengan full capabilities

## Requirements

### Requirement 1: Adaptive HLS Configuration

**User Story:** As a user with a low-end device, I want the video player to automatically adjust its configuration based on my device capabilities, so that I can watch streams without freezing or crashing.

#### Acceptance Criteria

1. WHEN the Video_Player initializes, THE Device_Detector SHALL detect device capabilities including RAM, CPU cores, and browser type
2. WHEN a Low_End_Device is detected, THE HLS_Engine SHALL use conservative buffer settings (maxBufferLength ≤ 15s, backBufferLength ≤ 10s)
3. WHEN a High_End_Device is detected, THE HLS_Engine SHALL use optimized buffer settings (maxBufferLength ≤ 30s, backBufferLength ≤ 30s)
4. THE HLS_Engine SHALL disable web workers on Low_End_Device to reduce CPU overhead
5. THE HLS_Engine SHALL enable web workers on High_End_Device for better performance

### Requirement 2: Intelligent Buffer Management

**User Story:** As a user, I want the video player to manage memory efficiently, so that my device doesn't slow down or crash when watching multiple streams.

#### Acceptance Criteria

1. THE Buffer_Manager SHALL limit total buffer size to prevent memory exhaustion
2. WHEN buffer exceeds threshold, THE Buffer_Manager SHALL automatically trim old segments
3. WHEN video is paused for more than 30 seconds, THE Buffer_Manager SHALL reduce buffer to minimum
4. WHEN switching between cameras, THE Stream_Controller SHALL properly destroy previous HLS instance before creating new one
5. THE Memory_Manager SHALL release all video resources when component unmounts

### Requirement 3: Graceful Error Recovery

**User Story:** As a user, I want the video player to automatically recover from errors without requiring manual intervention, so that I can have uninterrupted viewing experience.

#### Acceptance Criteria

1. WHEN a network error occurs, THE HLS_Engine SHALL attempt automatic recovery with exponential backoff (1s, 2s, 4s delays)
2. WHEN a media error occurs, THE HLS_Engine SHALL call recoverMediaError() before attempting full reload
3. IF recovery fails after 3 attempts, THEN THE Video_Player SHALL display user-friendly error message with retry button
4. WHEN connection is restored after error, THE Stream_Controller SHALL resume playback from live edge
5. THE Video_Player SHALL NOT show loading spinner during brief buffering events (< 2 seconds)

### Requirement 4: Lazy Loading and Resource Optimization

**User Story:** As a user viewing multiple cameras, I want only visible cameras to actively stream, so that my device resources are used efficiently.

#### Acceptance Criteria

1. THE Video_Player SHALL use Intersection Observer to detect visibility
2. WHEN a video becomes invisible (scrolled out of view), THE Stream_Controller SHALL pause the stream after 5 seconds
3. WHEN a video becomes visible again, THE Stream_Controller SHALL resume playback
4. THE HLS_Engine module SHALL be lazy loaded only when first video is requested
5. WHEN Multi-View mode is active, THE Stream_Controller SHALL limit concurrent streams to device capability (2 for Low_End_Device, 3 for High_End_Device)

### Requirement 5: Optimized Rendering Performance

**User Story:** As a user, I want smooth video playback without UI lag, so that I can interact with the application while watching streams.

#### Acceptance Criteria

1. THE Video_Player SHALL use CSS transform for zoom/pan operations instead of re-rendering
2. THE Video_Player SHALL debounce zoom/pan events to maximum 60fps
3. THE Video_Player overlay controls SHALL only render on hover/touch, not continuously
4. WHEN fullscreen mode is active, THE Video_Player SHALL disable unnecessary UI animations
5. THE Video_Player SHALL use requestAnimationFrame for smooth transform updates

### Requirement 6: Network-Aware Streaming

**User Story:** As a user with varying network conditions, I want the video player to adapt to my connection quality, so that I get the best possible experience without constant buffering.

#### Acceptance Criteria

1. THE Adaptive_Quality system SHALL monitor network bandwidth continuously
2. WHEN bandwidth drops below 500kbps, THE HLS_Engine SHALL switch to lower quality level
3. WHEN bandwidth is stable above 2Mbps, THE HLS_Engine SHALL allow higher quality levels
4. THE HLS_Engine SHALL use conservative ABR (Adaptive Bitrate) settings to prevent quality oscillation
5. WHEN network type changes (e.g., WiFi to cellular), THE Adaptive_Quality SHALL re-evaluate and adjust settings

### Requirement 7: Mobile-Specific Optimizations

**User Story:** As a mobile user, I want the video player to work smoothly on my phone, so that I can monitor cameras on the go.

#### Acceptance Criteria

1. THE Video_Player SHALL detect mobile devices and apply mobile-specific HLS configuration
2. WHEN on mobile, THE HLS_Engine SHALL use smaller segment sizes for faster initial load
3. THE Video_Player SHALL support native fullscreen API on mobile browsers
4. WHEN device orientation changes, THE Video_Player SHALL smoothly adapt layout without reload
5. THE Video_Player SHALL handle touch events efficiently without causing scroll jank

### Requirement 8: Multi-View Performance

**User Story:** As a user using Multi-View mode, I want to watch multiple cameras simultaneously without performance degradation, so that I can monitor multiple locations at once.

#### Acceptance Criteria

1. WHEN Multi-View is activated, THE Stream_Controller SHALL stagger stream initialization (100ms delay between each)
2. THE Multi-View layout SHALL use CSS Grid for efficient rendering
3. WHEN a stream in Multi-View encounters error, THE Video_Player SHALL NOT affect other streams
4. THE Multi-View SHALL share a single HLS.js worker instance across all streams on High_End_Device
5. WHEN exiting Multi-View, THE Stream_Controller SHALL properly cleanup all stream instances

