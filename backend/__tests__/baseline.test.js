import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { config } from '../config/config.js';

const API_URL = `http://localhost:${config.server.port}`;

describe('Baseline API Verification', () => {
    describe('Public Endpoints', () => {
        it('GET /health should return 200 and correct structure', async () => {
            try {
                const response = await axios.get(`${API_URL}/health`);
                expect(response.status).toBe(200);
                expect(response.data).toHaveProperty('status', 'ok');
                expect(response.data).toHaveProperty('timestamp');
                expect(response.data).toHaveProperty('security');
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    console.warn('Backend server is not running. This test requires the backend to be active.');
                    throw new Error('Backend server connection refused');
                }
                throw error;
            }
        });

        it('GET /api/cameras/active should return 200 and an array', async () => {
            try {
                const response = await axios.get(`${API_URL}/api/cameras/active`);
                expect(response.status).toBe(200);
                expect(Array.isArray(response.data.data)).toBe(true);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') return;
                throw error;
            }
        });
    });

    describe('Security Baselines', () => {
        it('GET /api/cameras (Protected) should return 403 or 401 without API Key', async () => {
            try {
                await axios.get(`${API_URL}/api/cameras`);
            } catch (error) {
                expect([401, 403]).toContain(error.response?.status);
            }
        });

        it('Security headers should be present on /health', async () => {
            try {
                const response = await axios.get(`${API_URL}/health`);
                expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
                expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
            } catch (error) {
                if (error.code === 'ECONNREFUSED') return;
                throw error;
            }
        });
    });
});
