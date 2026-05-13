/*
Purpose: Verify pure Telegram alert confirmation timing before cameraHealthService sends DOWN/UP messages.
Caller: Backend Vitest suite for services/telegramAlertConfirmationPolicy.js.
Deps: Vitest, telegramAlertConfirmationPolicy.
MainFuncs: describe telegramAlertConfirmationPolicy.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    createTelegramAlertConfirmationState,
    evaluateTelegramAlertConfirmation,
} from '../services/telegramAlertConfirmationPolicy.js';

describe('telegramAlertConfirmationPolicy', () => {
    it('starts a DOWN candidate without sending immediately', () => {
        const state = createTelegramAlertConfirmationState('online', 1_000);

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'offline',
            now: 2_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBeNull();
        expect(result.state.pendingTransition).toBe('offline');
        expect(result.state.pendingSince).toBe(2_000);
        expect(result.state.confirmedState).toBe('online');
    });

    it('sends DOWN only after the offline candidate remains stable long enough', () => {
        const state = {
            confirmedState: 'online',
            pendingTransition: 'offline',
            pendingSince: 2_000,
            lastObservedState: 'offline',
        };

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'offline',
            now: 122_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBe('offline');
        expect(result.state.confirmedState).toBe('offline');
        expect(result.state.pendingTransition).toBeNull();
        expect(result.state.pendingSince).toBeNull();
    });

    it('cancels pending DOWN when the camera recovers before confirmation', () => {
        const state = {
            confirmedState: 'online',
            pendingTransition: 'offline',
            pendingSince: 2_000,
            lastObservedState: 'offline',
        };

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'online',
            now: 30_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBeNull();
        expect(result.state.confirmedState).toBe('online');
        expect(result.state.pendingTransition).toBeNull();
        expect(result.state.pendingSince).toBeNull();
    });

    it('sends UP only after the online candidate remains stable long enough', () => {
        const state = {
            confirmedState: 'offline',
            pendingTransition: 'online',
            pendingSince: 10_000,
            lastObservedState: 'online',
        };

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'online',
            now: 70_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBe('online');
        expect(result.state.confirmedState).toBe('online');
        expect(result.state.pendingTransition).toBeNull();
    });

    it('ignores non-alert states without starting a candidate', () => {
        const state = createTelegramAlertConfirmationState('online', 1_000);

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'stale',
            now: 2_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBeNull();
        expect(result.state.confirmedState).toBe('online');
        expect(result.state.pendingTransition).toBeNull();
    });
});
