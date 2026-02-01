/**
 * Snapshot Helper Utility
 * Reusable snapshot function with watermark support
 * Client-side Canvas API for zero server load
 */

/**
 * Take snapshot from video element with watermark
 * @param {HTMLVideoElement} videoElement - Video element to capture
 * @param {Object} options - Snapshot options
 * @param {Object} options.branding - Branding settings (company_name, logo_text, etc)
 * @param {string} options.cameraName - Camera name for filename
 * @param {boolean} options.watermarkEnabled - Enable/disable watermark
 * @param {string} options.watermarkText - Custom watermark text (optional)
 * @param {string} options.watermarkPosition - Position: bottom-right, bottom-left, top-right, top-left
 * @param {number} options.watermarkOpacity - Opacity 0.1-1.0
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function takeSnapshot(videoElement, options = {}) {
    const {
        branding = {},
        cameraName = 'camera',
        watermarkEnabled = true,
        watermarkText = '',
        watermarkPosition = 'bottom-right',
        watermarkOpacity = 0.9
    } = options;

    // Validate video element
    if (!videoElement || videoElement.paused || videoElement.readyState < 2) {
        return {
            success: false,
            message: 'Video belum siap untuk snapshot'
        };
    }

    try {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d');

        // Draw video frame
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        // Add watermark if enabled
        if (watermarkEnabled) {
            addWatermark(ctx, canvas, {
                branding,
                watermarkText,
                watermarkPosition,
                watermarkOpacity
            });
        }

        // Convert to blob and share/download
        return new Promise((resolve) => {
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    resolve({
                        success: false,
                        message: 'Gagal membuat snapshot'
                    });
                    return;
                }

                const filename = `${cameraName}-${Date.now()}.png`;

                // Try Web Share API first (mobile-friendly)
                if (navigator.share && navigator.canShare) {
                    try {
                        const file = new File([blob], filename, { type: 'image/png' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file],
                                title: `Snapshot - ${cameraName}`,
                                text: `Snapshot dari ${branding.company_name || 'RAF NET'} CCTV`
                            });
                            resolve({
                                success: true,
                                message: 'Snapshot berhasil dibagikan!'
                            });
                            return;
                        }
                    } catch (err) {
                        if (err.name === 'AbortError') {
                            resolve({
                                success: false,
                                message: 'Share dibatalkan'
                            });
                            return;
                        }
                        // Continue to download fallback
                    }
                }

                // Fallback: Download
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.click();
                URL.revokeObjectURL(url);

                resolve({
                    success: true,
                    message: 'Snapshot berhasil diunduh!'
                });
            }, 'image/png', 0.95);
        });

    } catch (error) {
        console.error('Snapshot error:', error);
        return {
            success: false,
            message: 'Gagal mengambil snapshot'
        };
    }
}

/**
 * Add watermark to canvas
 * @private
 */
function addWatermark(ctx, canvas, options) {
    const {
        branding,
        watermarkText,
        watermarkPosition,
        watermarkOpacity
    } = options;

    const watermarkHeight = Math.max(40, canvas.height * 0.08);
    const padding = watermarkHeight * 0.3;
    const fontSize = watermarkHeight * 0.4;

    // Calculate position
    const positions = {
        'bottom-right': {
            x: canvas.width - (watermarkHeight * 4) - padding,
            y: canvas.height - watermarkHeight - padding
        },
        'bottom-left': {
            x: padding,
            y: canvas.height - watermarkHeight - padding
        },
        'top-right': {
            x: canvas.width - (watermarkHeight * 4) - padding,
            y: padding
        },
        'top-left': {
            x: padding,
            y: padding
        }
    };

    const pos = positions[watermarkPosition] || positions['bottom-right'];

    // Semi-transparent background
    ctx.fillStyle = `rgba(0, 0, 0, ${watermarkOpacity * 0.7})`;
    ctx.fillRect(pos.x, pos.y, watermarkHeight * 4, watermarkHeight);

    // Logo circle
    const logoSize = watermarkHeight * 0.6;
    const logoX = pos.x + (watermarkHeight * 0.5);
    const logoY = pos.y + (watermarkHeight / 2);

    ctx.fillStyle = branding.primary_color || '#0ea5e9';
    ctx.beginPath();
    ctx.arc(logoX, logoY, logoSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Logo text
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${logoSize * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(branding.logo_text || 'R', logoX, logoY);

    // Company name or custom text
    const displayText = watermarkText || branding.company_name || 'RAF NET';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255, 255, 255, ${watermarkOpacity})`;
    ctx.fillText(
        displayText,
        logoX + logoSize / 2 + padding / 2,
        logoY - fontSize / 3
    );

    // Timestamp
    ctx.font = `${fontSize * 0.7}px Arial`;
    ctx.fillStyle = `rgba(148, 163, 184, ${watermarkOpacity})`;
    const timestamp = new Date().toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    ctx.fillText(
        timestamp,
        logoX + logoSize / 2 + padding / 2,
        logoY + fontSize / 2
    );
}
