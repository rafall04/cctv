/*
Purpose: Define JSON schemas for API endpoint request validation.
Caller: Fastify route registration and schema validation middleware.
Deps: security audit logger.
MainFuncs: createCameraSchema, updateCameraSchema, area/user/auth/settings schema exports.
SideEffects: Logs validation-related security events through validationErrorHandler().
*/

import { logSecurityEvent, SECURITY_EVENTS } from '../services/securityAuditLogger.js';

// ============================================
// Authentication Schemas
// ============================================

export const loginSchema = {
    body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
            username: {
                type: 'string',
                minLength: 1,
                maxLength: 50
            },
            password: {
                type: 'string',
                minLength: 1,
                maxLength: 128
            }
        },
        additionalProperties: false
    }
};

export const refreshTokenSchema = {
    body: {
        type: 'object',
        properties: {
            refreshToken: {
                type: 'string',
                minLength: 1
            }
        },
        additionalProperties: false
    }
};

// ============================================
// Camera Schemas
// ============================================

export const createCameraSchema = {
    body: {
        type: 'object',
        required: ['name'],
        properties: {
            name: {
                type: 'string',
                minLength: 1,
                maxLength: 100
            },
            private_rtsp_url: {
                anyOf: [
                    { type: 'string', minLength: 1, maxLength: 500, pattern: '^rtsp://.+$' },
                    { type: 'null' }
                ]
            },
            stream_source: {
                type: 'string',
                enum: ['internal', 'external']
            },
            delivery_type: {
                type: 'string',
                enum: ['internal_hls', 'external_hls', 'external_flv', 'external_mjpeg', 'external_embed', 'external_jsmpeg', 'external_custom_ws']
            },
            external_hls_url: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }]
            },
            external_stream_url: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }]
            },
            external_embed_url: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }]
            },
            external_snapshot_url: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }]
            },
            external_origin_mode: {
                type: 'string',
                enum: ['direct', 'embed']
            },
            external_use_proxy: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            external_tls_mode: {
                type: 'string',
                enum: ['strict', 'insecure']
            },
            external_health_mode: {
                type: 'string',
                enum: ['default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled']
            },
            video_codec: {
                type: 'string',
                enum: ['h264', 'h265'],
                default: 'h264'
            },
            description: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            location: {
                anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }]
            },
            group_name: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            area_id: {
                anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }]
            },
            enabled: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            is_tunnel: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            latitude: {
                anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }]
            },
            longitude: {
                anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }]
            },
            status: {
                type: 'string',
                enum: ['active', 'maintenance', 'offline']
            },
            sponsor_name: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            sponsor_logo: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            sponsor_url: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            sponsor_package: {
                anyOf: [
                    { type: 'string', enum: ['bronze', 'silver', 'gold'] },
                    { type: 'null' }
                ]
            },
            enable_recording: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            recording_duration_hours: {
                anyOf: [{ type: 'integer', minimum: 1, maximum: 2160 }, { type: 'null' }]
            },
            internal_ingest_policy_override: {
                type: 'string',
                enum: ['default', 'always_on', 'on_demand']
            },
            internal_on_demand_close_after_seconds_override: {
                anyOf: [{ type: 'integer', minimum: 5, maximum: 300 }, { type: 'null' }]
            },
            internal_rtsp_transport_override: {
                type: 'string',
                enum: ['default', 'tcp', 'udp', 'auto']
            },
            thumbnail_strategy: {
                type: 'string',
                enum: ['default', 'direct_rtsp', 'hls_fallback', 'hls_only']
            },
            source_profile: {
                anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }]
            }
        },
        additionalProperties: false
    }
};

export const updateCameraSchema = {
    body: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                minLength: 1,
                maxLength: 100
            },
            private_rtsp_url: {
                anyOf: [
                    { type: 'string', minLength: 1, maxLength: 500, pattern: '^rtsp://.+$' },
                    { type: 'null' }
                ]
            },
            stream_source: {
                type: 'string',
                enum: ['internal', 'external']
            },
            delivery_type: {
                type: 'string',
                enum: ['internal_hls', 'external_hls', 'external_flv', 'external_mjpeg', 'external_embed', 'external_jsmpeg', 'external_custom_ws']
            },
            external_hls_url: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }]
            },
            external_stream_url: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }]
            },
            external_embed_url: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }]
            },
            external_snapshot_url: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }]
            },
            external_origin_mode: {
                type: 'string',
                enum: ['direct', 'embed']
            },
            external_use_proxy: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            external_tls_mode: {
                type: 'string',
                enum: ['strict', 'insecure']
            },
            external_health_mode: {
                type: 'string',
                enum: ['default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled']
            },
            video_codec: {
                type: 'string',
                enum: ['h264', 'h265']
            },
            description: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            location: {
                anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }]
            },
            group_name: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            area_id: {
                anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }]
            },
            enabled: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            is_tunnel: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            latitude: {
                anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }]
            },
            longitude: {
                anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }]
            },
            status: {
                type: 'string',
                enum: ['active', 'maintenance', 'offline']
            },
            sponsor_name: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            sponsor_logo: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            sponsor_url: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            sponsor_package: {
                anyOf: [
                    { type: 'string', enum: ['bronze', 'silver', 'gold'] },
                    { type: 'null' }
                ]
            },
            enable_recording: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            recording_duration_hours: {
                anyOf: [{ type: 'integer', minimum: 1, maximum: 2160 }, { type: 'null' }]
            },
            internal_ingest_policy_override: {
                type: 'string',
                enum: ['default', 'always_on', 'on_demand']
            },
            internal_on_demand_close_after_seconds_override: {
                anyOf: [{ type: 'integer', minimum: 5, maximum: 300 }, { type: 'null' }]
            },
            internal_rtsp_transport_override: {
                type: 'string',
                enum: ['default', 'tcp', 'udp', 'auto']
            },
            thumbnail_strategy: {
                type: 'string',
                enum: ['default', 'direct_rtsp', 'hls_fallback', 'hls_only']
            },
            source_profile: {
                anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }]
            }
        },
        additionalProperties: false
    },
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

export const cameraIdParamSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

// ============================================
// User Management Schemas
// ============================================

export const createUserSchema = {
    body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
            username: {
                type: 'string',
                minLength: 3,
                maxLength: 50,
                pattern: '^[a-zA-Z0-9_-]+$'
            },
            password: {
                type: 'string',
                minLength: 12,
                maxLength: 128
            },
            role: {
                type: 'string',
                enum: ['admin', 'viewer']
            }
        },
        additionalProperties: false
    }
};

export const updateUserSchema = {
    body: {
        type: 'object',
        properties: {
            username: {
                type: 'string',
                minLength: 3,
                maxLength: 50,
                pattern: '^[a-zA-Z0-9_-]+$'
            },
            role: {
                type: 'string',
                enum: ['admin', 'viewer']
            }
        },
        additionalProperties: false
    },
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

export const changePasswordSchema = {
    body: {
        type: 'object',
        required: ['password'],
        properties: {
            password: {
                type: 'string',
                minLength: 12,
                maxLength: 128
            },
            current_password: {
                type: 'string',
                minLength: 1,
                maxLength: 128
            }
        },
        additionalProperties: false
    },
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

export const changeOwnPasswordSchema = {
    body: {
        type: 'object',
        required: ['current_password', 'new_password'],
        properties: {
            current_password: {
                type: 'string',
                minLength: 1,
                maxLength: 128
            },
            new_password: {
                type: 'string',
                minLength: 12,
                maxLength: 128
            }
        },
        additionalProperties: false
    }
};

export const updateProfileSchema = {
    body: {
        type: 'object',
        properties: {
            username: {
                type: 'string',
                minLength: 3,
                maxLength: 50,
                pattern: '^[a-zA-Z0-9_-]+$'
            }
        },
        additionalProperties: false
    }
};

export const userIdParamSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

// ============================================
// Area Management Schemas
// ============================================

export const createAreaSchema = {
    body: {
        type: 'object',
        required: ['name'],
        properties: {
            name: {
                type: 'string',
                minLength: 1,
                maxLength: 100
            },
            description: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            rt: {
                anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }]
            },
            rw: {
                anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }]
            },
            kelurahan: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            kecamatan: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            latitude: {
                anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }]
            },
            longitude: {
                anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }]
            },
            external_health_mode_override: {
                type: 'string',
                enum: ['default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled']
            },
            coverage_scope: {
                type: 'string',
                enum: ['default', 'site_point', 'rt_rw', 'kelurahan_desa', 'kecamatan', 'kabupaten_kota', 'regional', 'custom']
            },
            viewport_zoom_override: {
                anyOf: [{ type: 'integer', minimum: 1, maximum: 20 }, { type: 'string' }, { type: 'null' }]
            },
            show_on_grid_default: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            grid_default_camera_limit: {
                anyOf: [{ type: 'integer', minimum: 1, maximum: 100 }, { type: 'string' }, { type: 'null' }]
            },
            internal_ingest_policy_default: {
                type: 'string',
                enum: ['default', 'always_on', 'on_demand']
            },
            internal_on_demand_close_after_seconds: {
                anyOf: [{ type: 'integer', minimum: 5, maximum: 300 }, { type: 'string' }, { type: 'null' }]
            },
            internal_rtsp_transport_default: {
                type: 'string',
                enum: ['default', 'tcp', 'udp', 'auto']
            }
        },
        additionalProperties: false
    }
};

export const updateAreaSchema = {
    body: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                minLength: 1,
                maxLength: 100
            },
            description: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            rt: {
                anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }]
            },
            rw: {
                anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }]
            },
            kelurahan: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            kecamatan: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            latitude: {
                anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }]
            },
            longitude: {
                anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }]
            },
            external_health_mode_override: {
                type: 'string',
                enum: ['default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled']
            },
            coverage_scope: {
                type: 'string',
                enum: ['default', 'site_point', 'rt_rw', 'kelurahan_desa', 'kecamatan', 'kabupaten_kota', 'regional', 'custom']
            },
            viewport_zoom_override: {
                anyOf: [{ type: 'integer', minimum: 1, maximum: 20 }, { type: 'string' }, { type: 'null' }]
            },
            show_on_grid_default: {
                anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }]
            },
            grid_default_camera_limit: {
                anyOf: [{ type: 'integer', minimum: 1, maximum: 100 }, { type: 'string' }, { type: 'null' }]
            },
            internal_ingest_policy_default: {
                type: 'string',
                enum: ['default', 'always_on', 'on_demand']
            },
            internal_on_demand_close_after_seconds: {
                anyOf: [{ type: 'integer', minimum: 5, maximum: 300 }, { type: 'string' }, { type: 'null' }]
            },
            internal_rtsp_transport_default: {
                type: 'string',
                enum: ['default', 'tcp', 'udp', 'auto']
            }
        },
        additionalProperties: false
    },
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

export const areaIdParamSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

// ============================================
// API Key Management Schemas
// ============================================

export const createApiKeySchema = {
    body: {
        type: 'object',
        required: ['name'],
        properties: {
            name: {
                type: 'string',
                minLength: 1,
                maxLength: 100
            },
            description: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            expires_at: {
                anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }]
            }
        },
        additionalProperties: false
    }
};

export const apiKeyIdParamSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

// ============================================
// Stream Schemas
// ============================================

export const streamCameraIdParamSchema = {
    params: {
        type: 'object',
        required: ['cameraId'],
        properties: {
            cameraId: {
                type: 'string',
                pattern: '^[0-9]+$'
            }
        }
    }
};

// ============================================
// Schema Validation Error Handler
// ============================================

/**
 * Custom schema error handler for Fastify
 * Logs validation failures and returns 400 with clear error messages
 */
export function schemaErrorHandler(error, request, reply) {
    if (error.validation) {
        // Log validation failure
        logSecurityEvent(SECURITY_EVENTS.VALIDATION_FAILURE, {
            reason: 'Schema validation failed',
            endpoint: request.url,
            method: request.method,
            errors: error.validation.map(v => ({
                field: v.instancePath || v.params?.missingProperty || 'unknown',
                message: v.message,
                keyword: v.keyword
            }))
        }, request);

        return reply.code(400).send({
            success: false,
            message: 'Invalid request data',
            errors: error.validation.map(v => ({
                field: v.instancePath?.replace('/', '') || v.params?.missingProperty || 'body',
                message: v.message
            }))
        });
    }

    // Re-throw non-validation errors
    throw error;
}

// ============================================
// Export all schemas as a collection
// ============================================

export const schemas = {
    // Auth
    login: loginSchema,
    refreshToken: refreshTokenSchema,

    // Camera
    createCamera: createCameraSchema,
    updateCamera: updateCameraSchema,
    cameraIdParam: cameraIdParamSchema,

    // User
    createUser: createUserSchema,
    updateUser: updateUserSchema,
    changePassword: changePasswordSchema,
    changeOwnPassword: changeOwnPasswordSchema,
    updateProfile: updateProfileSchema,
    userIdParam: userIdParamSchema,

    // Area
    createArea: createAreaSchema,
    updateArea: updateAreaSchema,
    areaIdParam: areaIdParamSchema,

    // API Key
    createApiKey: createApiKeySchema,
    apiKeyIdParam: apiKeyIdParamSchema,

    // Stream
    streamCameraIdParam: streamCameraIdParamSchema
};

// ============================================
// Saweria Settings Schema
// ============================================

export const saweriaSettingsSchema = {
    body: {
        type: 'object',
        properties: {
            saweria_link: {
                type: 'string',
                minLength: 1,
                maxLength: 500,
                pattern: '^https?://.+$'
            },
            leaderboard_link: {
                type: 'string',
                maxLength: 500
            },
            enabled: {
                type: 'boolean'
            }
        },
        required: ['saweria_link', 'enabled'],
        additionalProperties: false
    }
};

// Validator middleware for Saweria settings
export async function validateSaweriaSettings(request, reply) {
    try {
        await request.compileValidationSchema(saweriaSettingsSchema.body)(request.body);
    } catch (error) {
        if (error.validation) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid Saweria settings data',
                errors: error.validation.map(v => ({
                    field: v.instancePath?.replace('/', '') || v.params?.missingProperty || 'body',
                    message: v.message
                }))
            });
        }
        throw error;
    }
}

// ============================================
// Sponsor Schemas
// ============================================
// Sponsors are local entities (logos rendered by us) — distinct from the
// ads-network feature (AdSense / Adsterra etc.) that lives under
// components/ads/. Keep the two domains separated in schema and code.

// Package keys are now admin-defined via the sponsor_packages table, so we
// validate format (lowercase, alphanumeric + _-) instead of pinning to a
// fixed enum. The CHECK constraint on the sponsors table is dropped in the
// matching migration (zz_20260523_add_sponsor_packages_and_camera_limit.js).
const SPONSOR_PACKAGE_KEY_PATTERN = '^[a-z0-9_-]{1,40}$';

const sponsorBodyProperties = {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    logo: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
    url: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
    package: { type: 'string', pattern: SPONSOR_PACKAGE_KEY_PATTERN },
    price: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
    // camera_limit: per-sponsor cap on how many cameras can be linked.
    // null = unlimited (the Gold-tier default). 0 effectively disables the
    // sponsor from showing on any camera.
    camera_limit: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    active: { anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }] },
    start_date: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] },
    end_date: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] },
    contact_name: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
    contact_email: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    contact_phone: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }] },
    notes: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
};

export const createSponsorSchema = {
    body: {
        type: 'object',
        required: ['name', 'package'],
        properties: sponsorBodyProperties,
        additionalProperties: false,
    },
};

export const updateSponsorSchema = {
    body: {
        type: 'object',
        properties: sponsorBodyProperties,
        additionalProperties: false,
    },
};

export const assignSponsorToCameraSchema = {
    body: {
        type: 'object',
        required: ['sponsor_name'],
        properties: {
            sponsor_name: { type: 'string', minLength: 1, maxLength: 100 },
            sponsor_logo: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
            sponsor_url: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
            sponsor_package: { anyOf: [{ type: 'string', pattern: SPONSOR_PACKAGE_KEY_PATTERN }, { type: 'null' }] },
        },
        additionalProperties: false,
    },
};

// ============================================
// Sponsor Package Schemas (catalog)
// ============================================

const sponsorPackageProperties = {
    key: { type: 'string', pattern: SPONSOR_PACKAGE_KEY_PATTERN },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    color: { type: 'string', minLength: 1, maxLength: 32 },
    default_price: { type: 'number', minimum: 0 },
    default_camera_limit: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    features: {
        type: 'array',
        maxItems: 20,
        items: { type: 'string', maxLength: 200 },
    },
    sort_order: { type: 'integer', minimum: 0, maximum: 9999 },
};

export const createSponsorPackageSchema = {
    body: {
        type: 'object',
        required: ['key', 'name'],
        properties: sponsorPackageProperties,
        additionalProperties: false,
    },
};

export const updateSponsorPackageSchema = {
    body: {
        type: 'object',
        // `key` intentionally NOT allowed on update — see service comment.
        properties: {
            name: sponsorPackageProperties.name,
            color: sponsorPackageProperties.color,
            default_price: sponsorPackageProperties.default_price,
            default_camera_limit: sponsorPackageProperties.default_camera_limit,
            features: sponsorPackageProperties.features,
            sort_order: sponsorPackageProperties.sort_order,
        },
        additionalProperties: false,
    },
};
