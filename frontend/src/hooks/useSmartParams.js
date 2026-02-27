import { useSearchParams } from 'react-router-dom';

/**
 * Custom hook for smart URL parameter management.
 * Prevents destructive overwriting of existing parameters.
 */
export function useSmartParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * Updates a specific parameter without touching others.
   * @param {string} key 
   * @param {string} value 
   */
  const updateParam = (key, value) => {
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      if (value === undefined || value === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
      return newParams;
    }, { replace: true });
  };

  /**
   * Removes a specific parameter without touching others.
   * @param {string} key 
   */
  const removeParam = (key) => {
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      newParams.delete(key);
      return newParams;
    }, { replace: true });
  };

  /**
   * Clears multiple parameters at once.
   * @param {string[]} keys 
   */
  const removeParams = (keys) => {
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      keys.forEach(key => newParams.delete(key));
      return newParams;
    }, { replace: true });
  };

  return {
    searchParams,
    updateParam,
    removeParam,
    removeParams
  };
}
