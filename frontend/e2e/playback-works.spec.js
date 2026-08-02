/*
 * Purpose: Real-browser smoke asserting the public playback page actually WORKS, not merely that it
 *          fits on screen.
 * Caller: playwright.config.js (npm run test:e2e; e2e job in CI).
 * Deps: @playwright/test, built dist served by vite preview; all /api/* mocked, external hosts blocked.
 * MainFuncs: source assignment, waiting-vs-verdict, control placement, view-mode persistence.
 * SideEffects: None outside the test browser.
 *
 * WHY THIS FILE EXISTS
 * The overflow suite proved the page did not widen the document. Every real defect of 2026-08 sailed
 * straight past it, because none of them changed the width:
 *   - the <video> ended up with an EMPTY src — no request, no error, just a dead player;
 *   - "Belum ada rekaman" was announced while the fetch was still in flight;
 *   - "Segmen Rekaman (0)" claimed a verdict before anything had been asked;
 *   - changing camera threw the visitor out of Simple view back into Full.
 * Each was found by hand, in production. These assertions are the cheapest way to stop that.
 *
 * WHAT CANNOT BE ASSERTED HERE
 * readyState: no real mp4 is served, so the element can never reach HAVE_CURRENT_DATA. That is fine —
 * every bug above was visible one step earlier, in whether a source was assigned at all.
 */

import { test, expect } from '@playwright/test';

const CAMERAS = [
    { id: 1, name: 'SIMPANG 3 JAMBEAN', location: 'JL. BASUKI RAHMAT', area_id: 1, area_name: 'KEC BOJONEGORO',
      status: 'active', enabled: 1, is_online: 1, enable_recording: 1, delivery_type: 'internal_hls' },
    { id: 2, name: 'PEREMPATAN SOSRODILOGO', location: 'JL. DR SOETOMO', area_id: 1, area_name: 'KEC BOJONEGORO',
      status: 'active', enabled: 1, is_online: 1, enable_recording: 1, delivery_type: 'internal_hls' },
];

/* delivery_type decides playback capability (getStreamCapabilities); without it the page correctly
 * renders "Belum Ada Recording Tersedia" and every assertion below would be testing nothing. */

/* Three ten-minute segments, newest last — the shape the recorder really produces. Written out
 * rather than computed: an earlier version derived end_time arithmetically and produced "07:60:00",
 * an invalid Date, which is a silly way for a regression suite to fail. */
const SEGMENTS = [
    { id: 1, filename: '20260802_074000.mp4', start_time: '2026-08-02T07:40:00.000Z',
      end_time: '2026-08-02T07:50:00.000Z', duration: 600, file_size: 73_000_000 },
    { id: 2, filename: '20260802_075000.mp4', start_time: '2026-08-02T07:50:00.000Z',
      end_time: '2026-08-02T08:00:00.000Z', duration: 600, file_size: 73_000_000 },
    { id: 3, filename: '20260802_080000.mp4', start_time: '2026-08-02T08:00:00.000Z',
      end_time: '2026-08-02T08:10:00.000Z', duration: 600, file_size: 73_000_000 },
];

const PLAYBACK_POLICY = {
    accessMode: 'public_preview',
    isPublicPreview: true,
    previewMinutes: 10,
    playbackWindowHours: null,
    tokenId: null,
    notice: { enabled: true, title: 'Akses Playback Publik Terbatas', text: 'Playback publik dibatasi.' },
    contact: null,
    deniedReason: null,
    segmentCount: SEGMENTS.length,
};

test.beforeEach(async ({ page, context }) => {
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        if (!local) return route.abort();

        const path = url.pathname;
        if (path.startsWith('/api/')) {
            if (/\/api\/recordings\/\d+\/segments/.test(path)) {
                return route.fulfill({
                    status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: true, data: { segments: SEGMENTS, playback_policy: PLAYBACK_POLICY } }),
                });
            }
            if (/\/api\/cameras\/(active|public)/.test(path)) {
                return route.fulfill({
                    status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: true, data: CAMERAS }),
                });
            }
            return route.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ success: true, data: [] }),
            });
        }
        // The recording files themselves: a request is all we need to see. Serving real video would
        // make the suite slow and flaky without testing anything extra.
        if (path.startsWith('/api/recordings') || path.endsWith('.mp4')) {
            return route.fulfill({ status: 200, contentType: 'video/mp4', body: '' });
        }
        return route.continue();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the player is given a source — an empty src is the bug this catches', async ({ page }) => {
    await page.goto('/playback?mode=full&view=playback&cam=1');

    const video = page.locator('video');
    await expect(video).toHaveCount(1);

    // The defect looked exactly like this and nothing else: src empty, NETWORK_EMPTY, no error at all.
    await expect.poll(
        () => video.evaluate((el) => el.getAttribute('src') || ''),
        { message: 'video never received a source', timeout: 15_000 },
    ).not.toBe('');
});

test('no verdict is delivered before the answer arrives', async ({ page }) => {
    await page.goto('/playback?mode=full&view=playback&cam=1');

    // With segments present, neither the empty state nor a zero count may ever settle on screen.
    await expect(page.getByText('Segmen Rekaman (3)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('playback-empty-state')).toHaveCount(0);
    await expect(page.getByText('Segmen Rekaman (0)')).toHaveCount(0);
});

test('segment controls render, are labelled, and sit within the first screen', async ({ page }) => {
    await page.goto('/playback?mode=full&view=playback&cam=1');

    const previous = page.getByLabel('Segmen sebelumnya (lebih lama)');
    await expect(previous).toBeVisible({ timeout: 15_000 });

    // The whole point of moving them up: reachable without scrolling to the foot of the page.
    const box = await previous.boundingBox();
    const viewport = page.viewportSize();
    expect(box.y).toBeLessThan(viewport.height);

    await expect(page.getByText(/Segmen 1 dari 3/)).toBeVisible();

    /*
     * Stepping itself is NOT asserted here, deliberately. Clicking a segment re-assigns the media
     * source, and this suite serves a zero-byte mp4 — the element errors, and the selection does not
     * settle the way it does against real files. Rather than weaken the assertion until it passes
     * regardless, direction and bounds are covered by PlaybackSegmentStepper.test.jsx (10 cases,
     * including that "Sebelumnya" moves EARLIER in time against a newest-first list). What this file
     * uniquely proves is that the control renders, is labelled, and is reachable without scrolling.
     */
});

test('the public notice never sits alongside an active-token panel', async ({ page }) => {
    await page.goto('/playback?mode=full&view=playback&cam=1');
    await expect(page.getByText('Segmen Rekaman (3)')).toBeVisible({ timeout: 15_000 });

    const publicNotice = await page.getByText('Akses Playback Publik Terbatas').count();
    const tokenPanel = await page.getByText('Akses playback aktif').count();
    expect(publicNotice > 0 && tokenPanel > 0).toBe(false);
});

test('choosing another camera keeps the visitor in Simple view', async ({ page }) => {
    await page.goto('/playback?mode=simple&view=playback&cam=1');
    await expect(page.getByText('Segmen Rekaman (3)')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /Kamera ·/i }).click();
    await page.getByRole('button', { name: /PEREMPATAN SOSRODILOGO/ }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('cam')).toContain('2');
    // buildPlaybackSearchParams strips `mode`; reading it back off the stripped object forced 'full'.
    expect(new URL(page.url()).searchParams.get('mode')).toBe('simple');
});
