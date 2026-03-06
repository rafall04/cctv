import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brandingService } from './brandingService';
import { getPublicSaweriaConfig } from './saweriaService';

const { get } = vi.hoisted(() => ({
    get: vi.fn(),
}));

vi.mock('./apiClient', () => ({
    default: {
        get,
    },
}));

describe('public services recovery config', () => {
    beforeEach(() => {
        get.mockReset();
    });

    it('meminta public branding tanpa toast error global', async () => {
        get.mockResolvedValue({
            data: {
                success: true,
                data: { company_name: 'RAF NET' },
            },
        });

        await brandingService.getPublicBranding();

        expect(get).toHaveBeenCalledWith('/api/branding/public', {
            skipGlobalErrorNotification: true,
        });
    });

    it('meminta public saweria config tanpa toast error global', async () => {
        get.mockResolvedValue({
            data: {
                success: true,
                data: { enabled: false },
            },
        });

        await getPublicSaweriaConfig();

        expect(get).toHaveBeenCalledWith('/api/saweria/config', {
            skipGlobalErrorNotification: true,
        });
    });
});
