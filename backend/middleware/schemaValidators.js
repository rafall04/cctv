/**
 * JSON Schema Validators for API Endpoints
 * 
 * Defines validation schemas for all API endpoints to ensure
 * proper input validation and return 400 for invalid input.
 * 
 * Requirements: 7.1, 7.4
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
        required: ['name', 'private_rtsp_url'],
        properties: {
            name: {
                type: 'string',
                minLength: 1,
                maxLength: 100
            },
            private_rtsp_url: {
                type: 'string',
                minLength: 1,
                maxLength: 500,
                pattern: '^rtsp://.+$'
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
                type: 'string',
                minLength: 1,
                maxLength: 500,
                pattern: '^rtsp://.+$'
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
