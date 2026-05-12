/*
Purpose: Verify public landing scheduled content helpers without mounting the full landing shell.
Caller: Vitest focused low-end public UI optimization suite.
Deps: Vitest and landingScheduledContent helpers.
MainFuncs: hasLandingScheduleWindow.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';

import { hasLandingScheduleWindow } from './landingScheduledContent';

describe('landingScheduledContent schedule window detection', () => {
    it('skips timer rechecks when no enabled scheduled content has a schedule window', () => {
        expect(hasLandingScheduleWindow({
            eventBanner: {
                enabled: false,
                start_at: '2026-05-12T08:00:00.000Z',
                end_at: '',
            },
            announcement: {
                enabled: true,
                start_at: '',
                end_at: '',
            },
        })).toBe(false);
    });

    it('enables timer rechecks when enabled content has a start or end window', () => {
        expect(hasLandingScheduleWindow({
            eventBanner: {
                enabled: true,
                start_at: '',
                end_at: '2026-05-12T09:00:00.000Z',
            },
        })).toBe(true);

        expect(hasLandingScheduleWindow({
            announcement: {
                enabled: true,
                start_at: '2026-05-12T08:00:00.000Z',
                end_at: '',
            },
        })).toBe(true);
    });
});
