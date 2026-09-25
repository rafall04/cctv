/*
 * Purpose: JSON schemas for the TOTP/2FA endpoints. Kept in a dedicated module because
 *          schemaValidators.js is frozen at the size ratchet — extraction to a focused
 *          module is the sanctioned way to add schemas without growing that ceiling.
 * Caller: authRoutes.js (login challenge + required enrollment), userRoutes.js (self-service).
 * Deps: none — pure JSON Schema objects.
 * MainFuncs: totpVerifySchema, totpEnrollSetupSchema, totpEnrollConfirmSchema, totpCodeSchema.
 * SideEffects: none.
 */

// A `code` is either a live 6-digit authenticator code or a one-time recovery code
// ("km3p-9wqs" — dash optional; totpService.hashRecoveryCode normalizes case/separators).
const totpCodeProp = {
    type: 'string',
    pattern: '^(\\d{6}|[a-zA-Z0-9]{4}-?[a-zA-Z0-9]{4})$',
    maxLength: 16,
};

const totpTokenProp = { type: 'string', minLength: 1, maxLength: 2048 };

/** POST /api/auth/totp/verify — pending token + code → session. */
export const totpVerifySchema = {
    body: {
        type: 'object',
        required: ['pendingToken', 'code'],
        properties: { pendingToken: totpTokenProp, code: totpCodeProp },
        additionalProperties: false,
    },
};

/** POST /api/auth/totp/enroll-setup — enroll token → new pending seed. */
export const totpEnrollSetupSchema = {
    body: {
        type: 'object',
        required: ['enrollToken'],
        properties: { enrollToken: totpTokenProp },
        additionalProperties: false,
    },
};

/** POST /api/auth/totp/enroll-confirm — enroll token + first valid code → session. */
export const totpEnrollConfirmSchema = {
    body: {
        type: 'object',
        required: ['enrollToken', 'code'],
        properties: { enrollToken: totpTokenProp, code: totpCodeProp },
        additionalProperties: false,
    },
};

/** POST /api/users/totp/{confirm,disable} — session JWT is the credential; body is the code. */
export const totpCodeSchema = {
    body: {
        type: 'object',
        required: ['code'],
        properties: { code: totpCodeProp },
        additionalProperties: false,
    },
};
