/**
 * Safe LocalStorage Utilities
 * Wraps localStorage with try-catch to prevent crashes
 * @author SOLITAIRE HACK
 */

/**
 * Safely get item from localStorage
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if not found or error
 * @returns {*} - Stored value or default
 */
export function safeGetItem(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(key);
    if (item === null) return defaultValue;

    // Try to parse as JSON
    try {
      return JSON.parse(item);
    } catch {
      return item;
    }
  } catch (error) {
    console.warn(`[safeStorage] Failed to get item "${key}":`, error.message);
    return defaultValue;
  }
}

/**
 * Safely set item in localStorage
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @returns {boolean} - Success status
 */
export function safeSetItem(key, value) {
  const valueToStore = typeof value === 'string' ? value : JSON.stringify(value);

  try {
    localStorage.setItem(key, valueToStore);
    return true;
  } catch (error) {
    // Detect quota errors across browsers
    const isQuotaError = error.name === 'QuotaExceededError' ||
      error.code === 22 ||
      (error instanceof DOMException && error.name === 'QuotaExceededError');

    if (isQuotaError) {
      console.error(`[safeStorage] Quota exceeded for key "${key}"`);
      // Clear old data and retry once
      cleanupStorage();

      // Retry the operation
      try {
        localStorage.setItem(key, valueToStore);
        console.log(`[safeStorage] Retry successful for key "${key}"`);
        return true;
      } catch (retryError) {
        console.error(`[safeStorage] Retry failed for key "${key}":`, retryError.message);
        return false;
      }
    } else {
      console.warn(`[safeStorage] Failed to set item "${key}":`, error.message);
      return false;
    }
  }
}

/**
 * Safely remove item from localStorage
 * @param {string} key - Storage key
 * @returns {boolean} - Success status
 */
export function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`[safeStorage] Failed to remove item "${key}":`, error.message);
    return false;
  }
}

/**
 * Clear old/unnecessary storage items
 */
export function cleanupStorage() {
  const keysToRemove = [];
  const preserveKeys = ['token', 'user', 'skill2cash_token', 'skill2cash_user'];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // Use exact match instead of substring matching to avoid preserving unrelated keys
    if (key && !preserveKeys.some(pk => key === pk)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach(key => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Ignore
    }
  });

  console.log(`[safeStorage] Cleaned up ${keysToRemove.length} storage items`);
}

/**
 * Clear all storage
 */
export function clearAllStorage() {
  try {
    localStorage.clear();
    return true;
  } catch (error) {
    console.error('[safeStorage] Failed to clear storage:', error.message);
    return false;
  }
}
