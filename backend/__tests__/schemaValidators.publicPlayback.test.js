/**
 * Purpose: Guard the "route schema eats fields" trap for the per-camera public-playback controls —
 *          if these properties are absent from the camera schemas, Fastify's removeAdditional strips
 *          them from the body and the admin's setting is silently never saved (200 OK, no write).
 * Caller: Vitest backend suite.
 */
import { describe, it, expect } from 'vitest';
import { createCameraSchema, updateCameraSchema } from '../middleware/schemaValidators.js';

describe('camera schemas declare public-playback fields (regression: silently-dropped admin setting)', () => {
    for (const [name, schema] of [['create', createCameraSchema], ['update', updateCameraSchema]]) {
        it(`${name}CameraSchema declares public_playback_mode + public_playback_preview_minutes`, () => {
            const props = schema.body.properties;
            expect(props.public_playback_mode).toBeTruthy();
            expect(props.public_playback_mode.enum).toEqual(
                expect.arrayContaining(['inherit', 'disabled', 'preview_only', 'admin_only'])
            );
            expect(props.public_playback_preview_minutes).toBeTruthy();
            // additionalProperties:false is what makes the declaration load-bearing.
            expect(schema.body.additionalProperties).toBe(false);
        });
    }
});
