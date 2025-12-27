import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    NETWORK_STATUS,
    getNetworkStatus,
    isOnline,
    isOffline,
    createNetworkStatusObserver,
} from '../hooks/useNetworkStatus';

/**
 * Feature: admin-ux-improvement
 * Property Tests for Network Status Detection
 * 
 * Tests the network status detection functionality including:
 * - Online/offline status detection
 * - Status change callbacks
 * - Observer pattern implementation
 * 
 * Property 13: Network Status Detection
 * Validates: Requirements 10.1, 10.2
 */

describe('Network Status Detection', () => {
    let originalNavigator;
    let mockOnLine;

    beforeEach(() => {
        // Store original navigator.onLine
        originalNavigator = Object.getOwnPropertyDescriptor(navigator, 'onLine');
        mockOnLine = true;
        
        // Mock navigator.onLine
        Object.defineProperty(navigator, 'onLine', {
            get: () => mockOnLine,
            configurable: true,
        });
    });

    afterEach(() => {
        // Restore original navigator.onLine
        if (originalNavigator) {
            Object.defineProperty(navigator, 'onLine', originalNavigator);
        }
        vi.restoreAllMocks();
    });

    /**
     * Feature: admin-ux-improvement
     * Property 13: Network Status Detection
     * Validates: Requirements 10.1, 10.2
     * 
     * For any change in network connectivity, the system SHALL detect the change
     * and update the UI accordingly: offline → show persistent banner, online →
     * show brief success notification and trigger data refresh.
     */
    describe('Property 13: Network Status Detection', () => {
        it('should correctly detect online status when navigator.onLine is true', () => {
            fc.assert(
                fc.property(
                    fc.constant(true),
                    () => {
                        mockOnLine = true;
                        
                        const status = getNetworkStatus();
                        
                        expect(status).toBe(NETWORK_STATUS.ONLINE);
                        expect(isOnline()).toBe(true);
                        expect(isOffline()).toBe(false);
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should correctly detect offline status when navigator.onLine is false', () => {
            fc.assert(
                fc.property(
                    fc.constant(false),
                    () => {
                        mockOnLine = false;
                        
                        const status = getNetworkStatus();
                        
                        expect(status).toBe(NETWORK_STATUS.OFFLINE);
                        expect(isOnline()).toBe(false);
                        expect(isOffline()).toBe(true);
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return mutually exclusive online/offline states', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    (onlineState) => {
                        mockOnLine = onlineState;
                        
                        // isOnline and isOffline should always be mutually exclusive
                        const online = isOnline();
                        const offline = isOffline();
                        
                        // XOR: exactly one should be true
                        expect(online !== offline).toBe(true);
                        
                        // Verify consistency with getNetworkStatus
                        const status = getNetworkStatus();
                        if (status === NETWORK_STATUS.ONLINE) {
                            expect(online).toBe(true);
                            expect(offline).toBe(false);
                        } else {
                            expect(online).toBe(false);
                            expect(offline).toBe(true);
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should trigger onOnline callback when status changes to online', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (transitionCount) => {
                        const onOnline = vi.fn();
                        const onOffline = vi.fn();
                        const onStatusChange = vi.fn();
                        
                        const observer = createNetworkStatusObserver({
                            onOnline,
                            onOffline,
                            onStatusChange,
                        });
                        
                        // Start in offline state
                        mockOnLine = false;
                        observer.start();
                        
                        // Simulate going online
                        mockOnLine = true;
                        observer.refresh();
                        
                        // onOnline should be called
                        expect(onOnline).toHaveBeenCalled();
                        expect(observer.getStatus()).toBe(NETWORK_STATUS.ONLINE);
                        
                        observer.stop();
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should trigger onOffline callback when status changes to offline', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    () => {
                        const onOnline = vi.fn();
                        const onOffline = vi.fn();
                        const onStatusChange = vi.fn();
                        
                        const observer = createNetworkStatusObserver({
                            onOnline,
                            onOffline,
                            onStatusChange,
                        });
                        
                        // Start in online state
                        mockOnLine = true;
                        observer.start();
                        
                        // Simulate going offline
                        mockOnLine = false;
                        observer.refresh();
                        
                        // onOffline should be called
                        expect(onOffline).toHaveBeenCalled();
                        expect(observer.getStatus()).toBe(NETWORK_STATUS.OFFLINE);
                        
                        observer.stop();
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should trigger onStatusChange callback with correct parameters', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    (startOnline) => {
                        const onStatusChange = vi.fn();
                        
                        const observer = createNetworkStatusObserver({
                            onStatusChange,
                        });
                        
                        // Start with initial state
                        mockOnLine = startOnline;
                        observer.start();
                        
                        // Toggle state
                        mockOnLine = !startOnline;
                        observer.refresh();
                        
                        // onStatusChange should be called with new and previous status
                        expect(onStatusChange).toHaveBeenCalled();
                        
                        const lastCall = onStatusChange.mock.calls[onStatusChange.mock.calls.length - 1];
                        const [newStatus, previousStatus] = lastCall;
                        
                        // New status should match current mockOnLine
                        expect(newStatus).toBe(
                            mockOnLine ? NETWORK_STATUS.ONLINE : NETWORK_STATUS.OFFLINE
                        );
                        
                        // Previous status should be opposite
                        expect(previousStatus).toBe(
                            startOnline ? NETWORK_STATUS.ONLINE : NETWORK_STATUS.OFFLINE
                        );
                        
                        observer.stop();
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not trigger callbacks when status does not change', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    fc.integer({ min: 1, max: 5 }),
                    (onlineState, refreshCount) => {
                        const onOnline = vi.fn();
                        const onOffline = vi.fn();
                        const onStatusChange = vi.fn();
                        
                        const observer = createNetworkStatusObserver({
                            onOnline,
                            onOffline,
                            onStatusChange,
                        });
                        
                        // Set initial state
                        mockOnLine = onlineState;
                        observer.start();
                        
                        // Clear any initial calls
                        onOnline.mockClear();
                        onOffline.mockClear();
                        onStatusChange.mockClear();
                        
                        // Refresh multiple times without changing state
                        for (let i = 0; i < refreshCount; i++) {
                            observer.refresh();
                        }
                        
                        // No callbacks should be triggered since status didn't change
                        expect(onOnline).not.toHaveBeenCalled();
                        expect(onOffline).not.toHaveBeenCalled();
                        expect(onStatusChange).not.toHaveBeenCalled();
                        
                        observer.stop();
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Observer Lifecycle', () => {
        it('should properly start and stop observer', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    () => {
                        const observer = createNetworkStatusObserver({});
                        
                        // Initially not active
                        expect(observer.isActive()).toBe(false);
                        
                        // Start observer
                        observer.start();
                        expect(observer.isActive()).toBe(true);
                        
                        // Stop observer
                        observer.stop();
                        expect(observer.isActive()).toBe(false);
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle multiple start/stop cycles', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
                    (actions) => {
                        const observer = createNetworkStatusObserver({});
                        
                        actions.forEach((shouldStart) => {
                            if (shouldStart) {
                                observer.start();
                                expect(observer.isActive()).toBe(true);
                            } else {
                                observer.stop();
                                expect(observer.isActive()).toBe(false);
                            }
                        });
                        
                        // Cleanup
                        observer.stop();
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct status via getStatus', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    (onlineState) => {
                        mockOnLine = onlineState;
                        
                        const observer = createNetworkStatusObserver({});
                        observer.start();
                        
                        const status = observer.getStatus();
                        const expectedStatus = onlineState 
                            ? NETWORK_STATUS.ONLINE 
                            : NETWORK_STATUS.OFFLINE;
                        
                        expect(status).toBe(expectedStatus);
                        
                        observer.stop();
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Network Status Constants', () => {
        it('should have valid network status constants', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        // NETWORK_STATUS should have ONLINE and OFFLINE
                        expect(NETWORK_STATUS.ONLINE).toBeDefined();
                        expect(NETWORK_STATUS.OFFLINE).toBeDefined();
                        
                        // They should be different values
                        expect(NETWORK_STATUS.ONLINE).not.toBe(NETWORK_STATUS.OFFLINE);
                        
                        // They should be strings
                        expect(typeof NETWORK_STATUS.ONLINE).toBe('string');
                        expect(typeof NETWORK_STATUS.OFFLINE).toBe('string');
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
