import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const THUMBNAIL_DIR = join(__dirname, '..', 'data', 'thumbnails');

export default async function thumbnailRoutes(fastify, options) {
    // Serve static thumbnail
    fastify.get('/:cameraId.jpg', async (request, reply) => {
        const { cameraId } = request.params;
        
        // Validate cameraId is numeric
        if (!/^\d+$/.test(cameraId)) {
            return reply.code(400).send({ error: 'Invalid camera ID' });
        }

        const filePath = join(THUMBNAIL_DIR, `${cameraId}.jpg`);

        if (!existsSync(filePath)) {
            return reply.code(404).send({ error: 'Thumbnail not found' });
        }

        // Cache 5 menit (sync dengan generation interval)
        reply.header('Content-Type', 'image/jpeg');
        reply.header('Cache-Control', 'public, max-age=300');
        reply.header('Access-Control-Allow-Origin', '*');

        return reply.sendFile(`${cameraId}.jpg`, THUMBNAIL_DIR);
    });
}
