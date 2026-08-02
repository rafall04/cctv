/**
 * Purpose: Keep expected client refusals off the stream reserved for real faults.
 * Caller: Vitest backend suite.
 * Deps: utils/controllerErrorLog.
 * MainFuncs: logControllerError.
 * SideEffects: None; logger is injected.
 */
import { describe, expect, it, vi } from 'vitest';
import { logControllerError } from '../utils/controllerErrorLog.js';

function makeLogger() {
    return { log: vi.fn(), error: vi.fn() };
}

function withStatus(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

describe('logControllerError', () => {
    /*
     * REGRESSION: production filed 52 "Token playback tidak mencakup kamera ini"
     * plus 9 heartbeat refusals as application errors, each with a full stack
     * trace. Those are 403s — the gate doing its job on a share link that does not
     * cover the requested camera. Burying real faults under them is how the
     * ERR_HTTP_HEADERS_SENT double-reply stayed hidden for months.
     */
    it('sends a 403 refusal to stdout as a single line, with no stack', () => {
        const logger = makeLogger();
        logControllerError(
            'Activate playback token',
            withStatus('Token playback tidak mencakup kamera ini', 403),
            logger
        );

        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledTimes(1);
        expect(logger.log).toHaveBeenCalledWith(
            'Activate playback token: 403 Token playback tidak mencakup kamera ini'
        );
        // A string, not an Error — so pm2 never receives the stack.
        expect(typeof logger.log.mock.calls[0][0]).toBe('string');
        expect(logger.log.mock.calls[0]).toHaveLength(1);
    });

    it.each([400, 401, 404, 409, 429])('treats %d as an outcome, not a fault', (status) => {
        const logger = makeLogger();
        logControllerError('Handler', withStatus('refused', status), logger);

        expect(logger.log).toHaveBeenCalledTimes(1);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('keeps 5xx on stderr, with the error object intact for its stack', () => {
        const logger = makeLogger();
        const error = withStatus('boom', 500);
        logControllerError('Handler', error, logger);

        expect(logger.log).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith('Handler:', error);
    });

    it('keeps an unclassified throw on stderr — no statusCode means the code broke', () => {
        const logger = makeLogger();
        const error = new TypeError("Cannot read properties of undefined (reading 'x')");
        logControllerError('Handler', error, logger);

        expect(logger.error).toHaveBeenCalledWith('Handler:', error);
        expect(logger.log).not.toHaveBeenCalled();
    });

    it('does not mistake a non-numeric statusCode for a client error', () => {
        const logger = makeLogger();
        logControllerError('Handler', withStatus('weird', 'nope'), logger);

        expect(logger.error).toHaveBeenCalled();
        expect(logger.log).not.toHaveBeenCalled();
    });
});
