/**
 * Optimistic Update Utilities
 * 
 * Provides functions for implementing optimistic UI updates with rollback capability.
 * 
 * Requirements: 4.9
 * - Toggle status optimistically
 * - Revert on API failure
 * - Show error toast
 */

/**
 * Create an optimistic update handler
 * 
 * @param {Object} options - Configuration options
 * @param {Function} options.updateState - Function to update local state
 * @param {Function} options.apiCall - Async function that makes the API call
 * @param {Function} [options.onError] - Callback when API call fails
 * @returns {Object} Handler with execute method
 */
export function createOptimisticUpdate(options) {
    const { updateState, apiCall, onError } = options;

    return {
        /**
         * Execute the optimistic update
         * @param {any} optimisticValue - Value to set optimistically
         * @param {any} previousValue - Previous value for rollback
         * @returns {Promise<{ success: boolean, rolledBack: boolean, error?: Error }>}
         */
        async execute(optimisticValue, previousValue) {
            // Apply optimistic update immediately
            updateState(optimisticValue);

            try {
                // Attempt API call
                const result = await apiCall(optimisticValue);
                
                if (result && result.success === false) {
                    // API returned failure, rollback
                    updateState(previousValue);
                    if (onError) {
                        onError(new Error(result.message || 'API call failed'));
                    }
                    return { success: false, rolledBack: true, error: new Error(result.message || 'API call failed') };
                }
                
                return { success: true, rolledBack: false };
            } catch (error) {
                // API call threw error, rollback
                updateState(previousValue);
                if (onError) {
                    onError(error);
                }
                return { success: false, rolledBack: true, error };
            }
        }
    };
}

/**
 * Apply optimistic toggle to a list item
 * 
 * @param {Array} items - Array of items
 * @param {string|number} itemId - ID of item to toggle
 * @param {string} field - Field name to toggle
 * @param {any} newValue - New value for the field
 * @returns {Array} New array with updated item
 */
export function applyOptimisticToggle(items, itemId, field, newValue) {
    return items.map(item => 
        item.id === itemId 
            ? { ...item, [field]: newValue }
            : item
    );
}

/**
 * Create a toggle handler with optimistic update and rollback
 * 
 * @param {Object} options - Configuration options
 * @param {Function} options.getItems - Function to get current items
 * @param {Function} options.setItems - Function to set items
 * @param {Function} options.apiCall - Async function that makes the API call (receives item and newValue)
 * @param {string} options.field - Field name to toggle
 * @param {Function} [options.onError] - Callback when API call fails
 * @returns {Function} Toggle handler function
 */
export function createToggleHandler(options) {
    const { getItems, setItems, apiCall, field, onError } = options;

    /**
     * Toggle an item's field value
     * @param {Object} item - Item to toggle
     * @returns {Promise<{ success: boolean, rolledBack: boolean, error?: Error }>}
     */
    return async function toggleItem(item) {
        const previousValue = item[field];
        const newValue = previousValue === 1 ? 0 : (previousValue === 0 ? 1 : !previousValue);
        
        // Get current items for potential rollback
        const currentItems = getItems();
        
        // Apply optimistic update
        const updatedItems = applyOptimisticToggle(currentItems, item.id, field, newValue);
        setItems(updatedItems);

        try {
            const result = await apiCall(item, newValue);
            
            if (result && result.success === false) {
                // Rollback on API failure
                const rolledBackItems = applyOptimisticToggle(updatedItems, item.id, field, previousValue);
                setItems(rolledBackItems);
                
                if (onError) {
                    onError(new Error(result.message || 'Toggle failed'));
                }
                
                return { success: false, rolledBack: true, error: new Error(result.message || 'Toggle failed') };
            }
            
            return { success: true, rolledBack: false };
        } catch (error) {
            // Rollback on error
            const rolledBackItems = applyOptimisticToggle(updatedItems, item.id, field, previousValue);
            setItems(rolledBackItems);
            
            if (onError) {
                onError(error);
            }
            
            return { success: false, rolledBack: true, error };
        }
    };
}

/**
 * Simulate an optimistic update scenario for testing
 * 
 * @param {Object} initialState - Initial state object
 * @param {any} optimisticValue - Value to set optimistically
 * @param {boolean} apiSuccess - Whether API call should succeed
 * @param {string} [errorMessage] - Error message if API fails
 * @returns {Object} Result with finalState and metadata
 */
export function simulateOptimisticUpdate(initialState, optimisticValue, apiSuccess, errorMessage = 'API Error') {
    let currentState = initialState;
    let rolledBack = false;
    let errorOccurred = null;

    // Apply optimistic update
    currentState = optimisticValue;

    if (!apiSuccess) {
        // Simulate rollback
        currentState = initialState;
        rolledBack = true;
        errorOccurred = new Error(errorMessage);
    }

    return {
        finalState: currentState,
        rolledBack,
        error: errorOccurred,
        wasOptimisticallyUpdated: true,
        apiSucceeded: apiSuccess
    };
}

export default {
    createOptimisticUpdate,
    applyOptimisticToggle,
    createToggleHandler,
    simulateOptimisticUpdate
};
