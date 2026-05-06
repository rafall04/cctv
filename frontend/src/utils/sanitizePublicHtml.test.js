/*
 * Purpose: Regression test for safe HTML sanitization on public landing content.
 * Caller: Frontend Vitest suite for public landing utilities.
 * Deps: Vitest, sanitizePublicHtml helper.
 * MainFuncs: Verifies unsafe markup is removed and safe markup is preserved.
 * SideEffects: None beyond test execution.
 */
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { sanitizePublicHtml } from './sanitizePublicHtml';

describe('sanitizePublicHtml', () => {
    it('menghapus tag berbahaya dan mempertahankan markup aman', () => {
        const html = sanitizePublicHtml(
            'Area <strong>aktif</strong> <script>alert(1)</script> <a href="javascript:alert(1)">bad</a> <a href="https://example.com/x">good</a>'
        );

        expect(html).toContain('<strong>aktif</strong>');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('javascript:');
        expect(html).toContain('good');
        expect(html).toContain('href="https://example.com/x"');
    });
});
