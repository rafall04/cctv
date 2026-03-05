/**
 * Utility functions for URL Slugification
 */

/**
 * Creates a URL-friendly slug from a camera object.
 * Format: {id}-{clean-name}
 * Example: "15-gerbang-utama"
 * 
 * @param {Object} camera The camera object containing 'id' and 'name'
 * @returns {String} URL friendly slug, or fallback to id string.
 */
export const createCameraSlug = (camera) => {
    if (!camera || !camera.id) return '';

    // If name is missing or empty, fallback to just ID
    if (!camera.name) return camera.id.toString();

    // 1. Convert to lowercase
    // 2. Remove all non-alphanumeric characters (except spaces and hyphens)
    // 3. Replace spaces and consecutive hyphens with a single hyphen
    // 4. Trim leading/trailing hyphens
    const cleanName = camera.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/[\s-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    // Return the combined slug
    // Even if cleanName is empty after cleaning, it gracefully returns just the ID with a dash "15" or "15-"
    return cleanName ? `${camera.id}-${cleanName}` : camera.id.toString();
};

/**
 * Extracts the original camera ID from a slug.
 * 
 * @param {String} slug The URL slug (e.g., "15-gerbang-utama")
 * @returns {Number|NaN} The extracted integer ID
 */
export const parseCameraIdFromSlug = (slug) => {
    if (!slug) return NaN;
    // Just grab the numbers before the first hyphen
    return parseInt(slug.split('-')[0], 10);
};
