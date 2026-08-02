/**
 * Purpose: Prove a page can hold the document title against the late branding fetch.
 * Caller: Frontend Vitest suite.
 * Deps: pageTitle utilities.
 * SideEffects: Writes document.title in jsdom.
 *
 * The defect: BrandingContext sets the title when its fetch resolves — asynchronously, therefore
 * AFTER any page effect — so /daftar and /admin/login both ended up wearing the landing title.
 */
// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { isPageTitleOwned, setPageTitle } from './pageTitle';

describe('pageTitle', () => {
    beforeEach(() => {
        document.title = 'awal';
        // Release anything a previous test claimed.
        setPageTitle('awal')();
    });

    it('claims the title and says so, which is what branding checks', () => {
        expect(isPageTitleOwned()).toBe(false);

        setPageTitle('Daftar Sewa CCTV - RAF');

        expect(document.title).toBe('Daftar Sewa CCTV - RAF');
        expect(isPageTitleOwned()).toBe(true);
    });

    it('releases on unmount, so the branding default takes over again', () => {
        const release = setPageTitle('Masuk Panel Admin - RAF');
        expect(isPageTitleOwned()).toBe(true);

        release();

        expect(isPageTitleOwned()).toBe(false);
    });

    it('lets the last page mounted own it', () => {
        setPageTitle('halaman satu');
        setPageTitle('halaman dua');

        expect(document.title).toBe('halaman dua');
        expect(isPageTitleOwned()).toBe(true);
    });
});
