# Requirements Document

## Introduction

Dokumen ini mendefinisikan requirements untuk memperbaiki masalah loading stream CCTV yang stuck/tidak responsif, khususnya pada device low-end (laptop/PC dengan spesifikasi rendah). Masalah utama yang dilaporkan adalah stream CCTV stuck loading di halaman LandingPage pada Chrome di laptop low-end, padahal di halaman admin sudah terlihat ada traffic ke CCTV tersebut.

Fokus utama adalah:
1. Mempercepat initial load time stream
2. Mendeteksi dan menangani stuck loading dengan timeout
3. Memberikan feedback yang jelas kepada user saat loading
4. Memastikan kompatibilitas dengan semua jenis hardware (desktop hingga mobile low-spec)

## Glossary

- **Stream_Loader**: Modul yang menangani proses loading stream HLS dari awal hingga playback
- **Loading_Timeout_Handler**: Sistem yang mendeteksi dan menangani kondisi stuck loading
- **Preload_Manager**: Modul yang melakukan preloading HLS.js dan manifest untuk mempercepat initial load
- **Connection_Tester**: Modul yang menguji konektivitas ke MediaMTX sebelum memulai stream
- **Fallback_Handler**: Sistem yang menyediakan mekanisme fallback saat stream gagal load
- **Low_End_Device**: Device dengan RAM ≤ 4GB, CPU dual core, atau browser dengan limited capabilities
- **Stuck_Loading**: Kondisi dimana stream tidak berhasil load dalam waktu yang wajar (> 15 detik)
- **HLS_Manifest**: File index.m3u8 yang berisi informasi segment video

## Requirements

### Requirement 1: Loading Timeout Detection

**User Story:** As a user with a low-end device, I want the system to detect when stream loading is stuck, so that I can be informed and take action instead of waiting indefinitely.

#### Acceptance Criteria

1. WHEN stream loading starts, THE Stream_Loader SHALL set a loading timeout of 15 seconds for low-end devices and 10 seconds for high-end devices
2. IF loading timeout is reached without successful playback, THEN THE Loading_Timeout_Handler SHALL display a timeout error message with retry option
3. WHEN timeout occurs, THE Loading_Timeout_Handler SHALL destroy the current HLS instance and release resources
4. THE Loading_Timeout_Handler SHALL track consecutive timeout failures and suggest troubleshooting after 3 failures
5. WHEN user clicks retry after timeout, THE Stream_Loader SHALL attempt fresh connection with cleared cache

### Requirement 2: HLS.js Preloading

**User Story:** As a user, I want the video player to load faster, so that I don't have to wait long before seeing the stream.

#### Acceptance Criteria

1. WHEN LandingPage mounts, THE Preload_Manager SHALL immediately start preloading HLS.js module in background
2. THE Preload_Manager SHALL cache the loaded HLS.js module for reuse across all video players
3. WHEN a video player initializes, THE Stream_Loader SHALL use the preloaded HLS.js if available
4. IF HLS.js is not preloaded yet, THEN THE Stream_Loader SHALL wait for preload to complete before initializing
5. THE Preload_Manager SHALL complete HLS.js preload within 3 seconds on average network conditions

### Requirement 3: Connection Pre-check

**User Story:** As a user, I want to know immediately if the stream server is unreachable, so that I don't waste time waiting for a stream that will never load.

#### Acceptance Criteria

1. WHEN stream loading starts, THE Connection_Tester SHALL first verify MediaMTX server is reachable
2. IF MediaMTX server is unreachable, THEN THE Connection_Tester SHALL immediately display server offline message
3. THE Connection_Tester SHALL use a lightweight HEAD request to check server availability
4. THE Connection_Tester SHALL timeout server check after 5 seconds
5. WHEN server check fails, THE Fallback_Handler SHALL provide option to retry or check network connection

### Requirement 4: Progressive Loading Feedback

**User Story:** As a user, I want to see clear progress during stream loading, so that I know the system is working and not frozen.

#### Acceptance Criteria

1. WHEN stream loading starts, THE Stream_Loader SHALL display "Connecting to server..." message
2. WHEN HLS manifest is being fetched, THE Stream_Loader SHALL display "Loading stream data..." message
3. WHEN video segments are being buffered, THE Stream_Loader SHALL display "Buffering video..." message
4. WHEN playback is about to start, THE Stream_Loader SHALL display "Starting playback..." message
5. THE Stream_Loader SHALL update loading progress at least every 2 seconds to show activity

### Requirement 5: Low-End Device Optimizations

**User Story:** As a user with a low-end laptop, I want the stream to load reliably even on my limited hardware, so that I can monitor CCTV without issues.

#### Acceptance Criteria

1. WHEN low-end device is detected, THE Stream_Loader SHALL use minimal HLS configuration (no worker, small buffer)
2. THE Stream_Loader SHALL disable all animations during loading on low-end devices
3. WHEN on low-end device, THE Stream_Loader SHALL use longer timeouts (15s vs 10s) to accommodate slower processing
4. THE Stream_Loader SHALL limit concurrent stream initializations to 1 on low-end devices
5. WHEN on low-end device, THE Preload_Manager SHALL preload HLS.js with higher priority

### Requirement 6: Automatic Recovery

**User Story:** As a user, I want the stream to automatically recover from temporary issues, so that I don't have to manually refresh the page.

#### Acceptance Criteria

1. WHEN stream fails to load due to network error, THE Fallback_Handler SHALL automatically retry after 3 seconds
2. THE Fallback_Handler SHALL limit automatic retries to 3 attempts before requiring manual intervention
3. WHEN automatic retry succeeds, THE Stream_Loader SHALL resume normal playback without user action
4. IF all automatic retries fail, THEN THE Fallback_Handler SHALL display clear error message with manual retry button
5. WHEN network connection is restored after failure, THE Stream_Loader SHALL automatically attempt reconnection

### Requirement 7: Resource Cleanup on Stuck

**User Story:** As a user, I want the system to properly clean up resources when loading fails, so that my device doesn't slow down from memory leaks.

#### Acceptance Criteria

1. WHEN loading timeout occurs, THE Loading_Timeout_Handler SHALL destroy HLS instance completely
2. WHEN loading timeout occurs, THE Loading_Timeout_Handler SHALL clear video element source
3. WHEN loading timeout occurs, THE Loading_Timeout_Handler SHALL cancel all pending network requests
4. THE Loading_Timeout_Handler SHALL release all event listeners on timeout
5. WHEN user navigates away during loading, THE Stream_Loader SHALL immediately cleanup all resources

### Requirement 8: Diagnostic Information

**User Story:** As a user experiencing loading issues, I want to see diagnostic information, so that I can understand what's wrong and report issues effectively.

#### Acceptance Criteria

1. WHEN loading fails, THE Fallback_Handler SHALL display the specific error type (timeout, network, server)
2. THE Fallback_Handler SHALL show device tier information in error details (for debugging)
3. WHEN timeout occurs, THE Loading_Timeout_Handler SHALL log the loading stage where timeout happened
4. THE Stream_Loader SHALL provide option to copy diagnostic info for support
5. THE Fallback_Handler SHALL display estimated time to retry based on error type

