/*
Purpose: Guard MapView's public popup against re-introducing the frontend/proxy viewer-session
         double-count (one human counted as two concurrent viewers). MapView no longer ships its own
         inline popup player — the map popup IS VideoPopup — so the proxied-HLS gate lives in
         VideoPopup. This test pins both the delegation (MapView -> VideoPopup, with no MapView-owned
         session logic) and the gate inside VideoPopup.
Caller: Vitest frontend component stability suite.
Deps: Node fs/path/url, MapView + VideoPopup source.
SideEffects: Reads component source from disk.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const mapViewSource = fs.readFileSync(path.join(dirname, 'MapView.jsx'), 'utf8');
const videoPopupSource = fs.readFileSync(
    path.join(dirname, 'MultiView', 'VideoPopup.jsx'),
    'utf8',
);

describe('MapView viewer-session tracking stability', () => {
    it('delegates its public popup to VideoPopup instead of an inline player', () => {
        // The map popup must render VideoPopup so it inherits the shared viewer-session gate rather
        // than re-implementing one. MapView itself must NOT open frontend viewer sessions, otherwise a
        // re-introduced inline player could double-count against the popup it delegates to.
        expect(mapViewSource).toContain('<VideoPopup');
        expect(mapViewSource).not.toContain('viewerService.startSession');
    });

    it('skips frontend viewer sessions for backend-proxied HLS streams (no double-count with the HLS proxy)', () => {
        // Same invariant enforced in VideoPopup / MultiViewVideoItem: a backend-proxied HLS stream is
        // already counted by the HLS proxy, so the frontend must NOT open a second session for it —
        // otherwise one viewer is recorded as two concurrent sessions.
        expect(videoPopupSource).toContain('const shouldTrackManualViewerSession');
        expect(videoPopupSource).toContain('isHlsDeliveryType(deliveryType)');
        expect(videoPopupSource).toContain('!isHlsCamera || isDirectStream');
        expect(videoPopupSource).toContain('!shouldTrackManualViewerSession) return;');
    });

    it('still opens a frontend session for direct / non-HLS streams that bypass the proxy', () => {
        // The gate only skips proxied HLS; direct external HLS, FLV and embeds have no proxy session,
        // so the frontend startSession call must stay reachable.
        expect(videoPopupSource).toContain('viewerService.startSession(camera.id)');
    });
});
