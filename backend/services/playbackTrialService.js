/**
 * Purpose: Hand out the free playback trial exactly once per device.
 * Caller: playbackAccessController (public claim + status).
 * Deps: connectionPool, playbackProductService, playbackTokenService.
 * MainFuncs: getStatus, claim.
 * SideEffects: Writes playback_trial_claims; issues a playback token via playbackProductService.
 *
 * WHERE THE GUARANTEE ACTUALLY LIVES
 * `playback_trial_claims.device_hash` is the PRIMARY KEY. The check-then-insert below exists only to
 * produce a readable message; the thing that makes "one trial per device" true under two racing
 * double-taps is SQLite refusing the second row. That ordering matters: we insert the claim FIRST and
 * only mint the token if the insert won, so a lost race costs nothing. Minting first and inserting
 * after would leave orphan tokens behind every race.
 *
 * A device hash is attacker-controlled — someone can clear a cookie and claim again. That is accepted:
 * the trial deliberately grants only 1 hour of look-back, which lives entirely inside local recording
 * retention and therefore costs no Telegram traffic to serve. The per-IP cap is the brake that matters,
 * and it is on the PAID path (playbackOrderService), where each request opens a real charge.
 */

import { queryOne, execute } from '../database/connectionPool.js';
import playbackProductService from './playbackProductService.js';

const TRIAL_KEY = 'trial';

function conflict(message) {
    const err = new Error(message);
    err.statusCode = 409;
    err.expose = true;
    return err;
}

class PlaybackTrialService {
    /** What the public page needs to decide between "Coba Gratis" and "sudah pernah dipakai". */
    getStatus(deviceHash) {
        const product = playbackProductService.getByKey(TRIAL_KEY);
        const available = !!product && !!product.enabled;
        if (!deviceHash) {
            return { available, claimed: false, product: product ? { windowHours: product.window_hours, validityDays: product.validity_days } : null };
        }
        const claim = queryOne('SELECT token_id, claimed_at FROM playback_trial_claims WHERE device_hash = ?', [deviceHash]);
        return {
            available,
            claimed: !!claim,
            claimedAt: claim?.claimed_at || null,
            product: product ? { windowHours: product.window_hours, validityDays: product.validity_days } : null,
        };
    }

    claim(deviceHash, { ip = null } = {}) {
        if (!deviceHash || typeof deviceHash !== 'string') {
            const err = new Error('deviceHash wajib');
            err.statusCode = 400;
            throw err;
        }
        const product = playbackProductService.getByKey(TRIAL_KEY);
        if (!product || !product.enabled) {
            throw conflict('Masa coba gratis sedang tidak tersedia.');
        }

        // Claim the slot BEFORE minting. INSERT OR IGNORE + changes===0 is the race-proof test:
        // a plain SELECT first would still let two concurrent requests both pass.
        const claimed = execute(
            'INSERT OR IGNORE INTO playback_trial_claims (device_hash, request_ip) VALUES (?, ?)',
            [deviceHash, ip]
        );
        if (claimed.changes === 0) {
            throw conflict('Perangkat ini sudah pernah memakai masa coba gratis.');
        }

        let issued;
        try {
            issued = playbackProductService.issueTokenForProduct(product, {
                label: 'Coba gratis playback',
                note: `trial device ${deviceHash.slice(0, 12)}`,
            });
        } catch (error) {
            // Give the slot back — a failed mint must not burn the buyer's one and only trial.
            execute('DELETE FROM playback_trial_claims WHERE device_hash = ? AND token_id IS NULL', [deviceHash]);
            throw error;
        }

        // createToken returns { token, data, share_key, share_text } — the row id lives on `data`,
        // not at the root. Reading issued.id here would silently store NULL and orphan the token.
        execute('UPDATE playback_trial_claims SET token_id = ? WHERE device_hash = ?', [issued?.data?.id || null, deviceHash]);
        return issued;
    }
}

export default new PlaybackTrialService();
