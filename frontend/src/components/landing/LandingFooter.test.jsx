// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingFooter from './LandingFooter';

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: [{ id: 1 }, { id: 2 }],
        areas: [{ id: 1 }],
    }),
}));

const branding = {
    logo_text: 'R',
    company_name: 'RAF NET',
    company_description: 'Deskripsi perusahaan',
    copyright_text: 'Penyedia Internet & CCTV',
    meta_keywords: 'cctv, wifi',
    whatsapp_number: '628111111111',
    show_powered_by: 'true',
};

describe('LandingFooter', () => {
    it('merender footer ringan tanpa mengulang badge Ramadan besar', () => {
        render(
            <LandingFooter
                saweriaEnabled={false}
                saweriaLink=""
                branding={branding}
            />
        );

        const stack = screen.getByTestId('landing-footer-brand-stack');
        expect(stack.className).toContain('flex-col');
        expect(screen.getAllByText('RAF NET').length).toBeGreaterThan(0);
        expect(screen.queryByText('Ramadan Kareem 1447 H')).toBeNull();
    });
});
