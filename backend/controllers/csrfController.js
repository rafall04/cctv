/**
 * CSRF Controller
 * 
 * Handles CSRF token generation and distribution.
 * 
 * Requirements: 1.6
 */

import { 
    generateCsrfToken, 
    setCsrfCookie, 
    CSRF_CONFIG 
} from '../middleware/csrfProtection.js';

/**
 * GET /api/auth/csrf
 * 
 * Generate and return a new CSRF token.
 * Sets the token in an httpOnly cookie and returns it in the response body.
 * 
 * @param {Object} request - Fastify request object
 * @param {Object} reply - Fastify reply object
 * @returns {Object} Response with CSRF token
 */
export async function getCsrfToken(request, reply) {
    // Generate new CSRF token
    const token = generateCsrfToken();
    
    // Set token in httpOnly cookie
    setCsrfCookie(reply, token);
    
    // Return token in response body
    // Frontend will use this to set the X-CSRF-Token header
    return reply.send({
        success: true,
        data: {
            token: token,
            headerName: CSRF_CONFIG.headerName,
            expiresIn: CSRF_CONFIG.expirationMinutes * 60 // seconds
        }
    });
}

export default {
    getCsrfToken
};
