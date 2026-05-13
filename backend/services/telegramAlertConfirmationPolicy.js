/*
Purpose: Pure Telegram alert confirmation policy for delaying DOWN/UP sends until states are stable.
Caller: cameraHealthService and focused Telegram confirmation tests.
Deps: None.
MainFuncs: createTelegramAlertConfirmationState, evaluateTelegramAlertConfirmation.
SideEffects: None.
*/

const ALERT_STATES = new Set(['online', 'offline']);

export const DEFAULT_TELEGRAM_DOWN_CONFIRMATION_MS = 120 * 1000;
export const DEFAULT_TELEGRAM_UP_CONFIRMATION_MS = 60 * 1000;

function normalizeAlertState(state) {
    return ALERT_STATES.has(state) ? state : null;
}

export function createTelegramAlertConfirmationState(initialState = null, now = Date.now()) {
    return {
        confirmedState: normalizeAlertState(initialState),
        pendingTransition: null,
        pendingSince: null,
        lastObservedState: normalizeAlertState(initialState),
        lastUpdatedAt: now,
    };
}

export function evaluateTelegramAlertConfirmation(currentState = {}, options = {}) {
    const nextAlertState = normalizeAlertState(options.nextState);
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const downConfirmationMs = Number.isFinite(options.downConfirmationMs)
        ? Math.max(0, options.downConfirmationMs)
        : DEFAULT_TELEGRAM_DOWN_CONFIRMATION_MS;
    const upConfirmationMs = Number.isFinite(options.upConfirmationMs)
        ? Math.max(0, options.upConfirmationMs)
        : DEFAULT_TELEGRAM_UP_CONFIRMATION_MS;

    const state = {
        confirmedState: normalizeAlertState(currentState.confirmedState),
        pendingTransition: normalizeAlertState(currentState.pendingTransition),
        pendingSince: Number.isFinite(currentState.pendingSince) ? currentState.pendingSince : null,
        lastObservedState: normalizeAlertState(currentState.lastObservedState),
        lastUpdatedAt: now,
    };

    if (!nextAlertState) {
        return {
            transitionToSend: null,
            state: {
                ...state,
                pendingTransition: null,
                pendingSince: null,
                lastObservedState: null,
            },
        };
    }

    if (state.confirmedState === null) {
        return {
            transitionToSend: null,
            state: {
                ...state,
                confirmedState: nextAlertState,
                pendingTransition: null,
                pendingSince: null,
                lastObservedState: nextAlertState,
            },
        };
    }

    if (nextAlertState === state.confirmedState) {
        return {
            transitionToSend: null,
            state: {
                ...state,
                pendingTransition: null,
                pendingSince: null,
                lastObservedState: nextAlertState,
            },
        };
    }

    const pendingSince = state.pendingTransition === nextAlertState && state.pendingSince !== null
        ? state.pendingSince
        : now;
    const requiredMs = nextAlertState === 'offline' ? downConfirmationMs : upConfirmationMs;
    const isConfirmed = now - pendingSince >= requiredMs;

    if (!isConfirmed) {
        return {
            transitionToSend: null,
            state: {
                ...state,
                pendingTransition: nextAlertState,
                pendingSince,
                lastObservedState: nextAlertState,
            },
        };
    }

    return {
        transitionToSend: nextAlertState,
        state: {
            ...state,
            confirmedState: nextAlertState,
            pendingTransition: null,
            pendingSince: null,
            lastObservedState: nextAlertState,
        },
    };
}
