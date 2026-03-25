import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, join } from 'path';
import { config } from '../config/config.js';
import { resolveMigrationDatabasePath } from '../database/migrations/backfill_camera_delivery_types.js';

describe('backfillCameraDeliveryTypes migration', () => {
    it('uses the same configured database path as the application runtime', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const expectedPath = isAbsolute(config.database.path)
            ? config.database.path
            : join(__dirname, '..', config.database.path);

        expect(resolveMigrationDatabasePath()).toBe(expectedPath);
    });
});
