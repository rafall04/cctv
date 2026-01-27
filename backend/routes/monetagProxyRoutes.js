import axios from 'axios';

export default async function monetagProxyRoutes(fastify, options) {
    // Proxy Monetag invoke.js scripts
    fastify.get('/proxy/monetag/:zoneId/invoke.js', async (request, reply) => {
        const { zoneId } = request.params;
        
        try {
            const response = await axios.get(
                `http://www.topcreativeformat.com/${zoneId}/invoke.js`,
                {
                    headers: {
                        'User-Agent': request.headers['user-agent'] || 'Mozilla/5.0'
                    },
                    timeout: 10000
                }
            );
            
            reply
                .header('Content-Type', 'application/javascript')
                .header('Cache-Control', 'public, max-age=3600')
                .send(response.data);
        } catch (error) {
            console.error('Monetag proxy error:', error.message);
            reply.code(500).send('// Monetag script unavailable');
        }
    });
}
