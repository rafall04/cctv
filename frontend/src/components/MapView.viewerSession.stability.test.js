/*
Purpose: Guard MapView's public popup against re-introducing the frontend/proxy viewer-session
         double-count (one human counted as two concurrent viewers). The map popup was the only
         live surface missing the proxied-HLS gate that VideoPopup / MultiViewVideoItem already have.
Caller: Vitest frontend component stability suite.
Deps: Node fs/path/url, MapView source.
SideEffects: Reads component source from disk.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(dirname, 'MapView.jsx'), 'utf8');

describe('MapView viewer-session tracking stability', () => {
    it('skips frontend viewer sessions for backend-proxied HLS streams (no double-count with the HLS proxy)', () => {
        // Same invariant enforced in VideoPopup / MultiViewVideoItem: a backend-proxied HLS stream is
        // already counted by the HLS proxy, so the frontend must NOT open a second session for it —
        // otherwise one viewer is recorded as two concurrent sessions.
        expect(source).toContain('const shouldTrackFrontendViewerSession');
        expect(source).toContain('isHlsDeliveryType(getEffectiveDeliveryType(camera))');
        expect(source).toContain('.isDirectStream');
        expect(source).toContain('if (!shouldTrackFrontendViewerSession) return;');
    });

    it('still opens a frontend session for direct / non-HLS streams that bypass the proxy', () => {
        // The gate only skips proxied HLS; direct external HLS, FLV and embeds have no proxy session,
        // so the frontend startSession call must stay reachable.
        expect(source).toContain('viewerService.startSession(camera.id)');
    });
});
