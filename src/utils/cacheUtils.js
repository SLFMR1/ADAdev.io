import { getCacheTTL, usesHybridData } from './chartDataUtils'
import logger from './logger-frontend'

/**
 * Unified caching utility for chart data
 * Implements smart caching strategy with tiered TTL based on data immutability
 */

// Global cache store for the session
const CACHE_STORE = new Map()

// Cache metadata store
const CACHE_METADATA = new Map()

/**
 * Generate cache key for chart data
 * @param {string} viewMode - 'repository' or 'organization'
 * @param {string} periodKey - Period key
 * @param {string} resourceId - Resource ID (optional, for resource-specific cache)
 * @returns {string} Cache key
 */
const generateCacheKey = (viewMode, periodKey, resourceId = null) => {
  const parts = ['chart', viewMode, periodKey]
  if (resourceId) {
    parts.push(resourceId)
  }
  return parts.join(':')
}

/**
 * Check if cached data is still valid
 * @param {string} cacheKey - Cache key
 * @returns {boolean} True if cache is valid
 */
const isCacheValid = (cacheKey) => {
  const metadata = CACHE_METADATA.get(cacheKey)
  if (!metadata) return false
  
  const now = Date.now()
  const isValid = now - metadata.timestamp < metadata.ttl
  
  if (!isValid) {
    logger.log(`Cache expired for ${cacheKey}`)
    // Clean up expired cache
    CACHE_STORE.delete(cacheKey)
    CACHE_METADATA.delete(cacheKey)
  }
  
  return isValid
}

/**
 * Store data in cache with appropriate TTL
 * @param {string} cacheKey - Cache key
 * @param {any} data - Data to cache
 * @param {string} periodKey - Period key (to determine TTL)
 */
const setCacheData = (cacheKey, data, periodKey) => {
  const ttl = getCacheTTL(periodKey)
  const isHybrid = usesHybridData(periodKey)
  
  CACHE_STORE.set(cacheKey, data)
  CACHE_METADATA.set(cacheKey, {
    timestamp: Date.now(),
    ttl: ttl,
    isHybrid: isHybrid,
    periodKey: periodKey
  })
  
  logger.log(`Cached data for ${cacheKey} with TTL: ${ttl / 1000 / 60} minutes`)
}

/**
 * Get cached data if valid
 * @param {string} cacheKey - Cache key
 * @returns {any|null} Cached data or null if not found/invalid
 */
const getCacheData = (cacheKey) => {
  if (!isCacheValid(cacheKey)) {
    return null
  }
  
  const data = CACHE_STORE.get(cacheKey)
  if (data) {
    logger.log(`⚡ Cache hit for ${cacheKey}`)
  }
  
  return data
}

/**
 * Clear cache for specific key or all cache
 * @param {string|null} cacheKey - Specific cache key to clear, or null to clear all
 */
const clearCache = (cacheKey = null) => {
  if (cacheKey) {
    CACHE_STORE.delete(cacheKey)
    CACHE_METADATA.delete(cacheKey)
    logger.log(`Cleared cache for ${cacheKey}`)
  } else {
    CACHE_STORE.clear()
    CACHE_METADATA.clear()
    logger.log('Cleared all cache')
  }
}

/**
 * Get cache statistics for debugging
 * @returns {Object} Cache statistics
 */
const getCacheStats = () => {
  const totalEntries = CACHE_STORE.size
  const validEntries = Array.from(CACHE_METADATA.keys()).filter(key => isCacheValid(key)).length
  const expiredEntries = totalEntries - validEntries
  
  return {
    totalEntries,
    validEntries,
    expiredEntries,
    cacheKeys: Array.from(CACHE_STORE.keys())
  }
}

/**
 * Unified cache manager for chart data
 */
export class ChartDataCache {
  /**
   * Get cached chart data for a specific configuration
   * @param {string} viewMode - 'repository' or 'organization'
   * @param {string} periodKey - Period key
   * @param {string} resourceId - Resource ID (optional)
   * @returns {any|null} Cached data or null
   */
  static get(viewMode, periodKey, resourceId = null) {
    const cacheKey = generateCacheKey(viewMode, periodKey, resourceId)
    return getCacheData(cacheKey)
  }
  
  /**
   * Store chart data in cache
   * @param {string} viewMode - 'repository' or 'organization'
   * @param {string} periodKey - Period key
   * @param {any} data - Data to cache
   * @param {string} resourceId - Resource ID (optional)
   */
  static set(viewMode, periodKey, data, resourceId = null) {
    const cacheKey = generateCacheKey(viewMode, periodKey, resourceId)
    setCacheData(cacheKey, data, periodKey)
  }
  
  /**
   * Check if cache exists and is valid
   * @param {string} viewMode - 'repository' or 'organization'
   * @param {string} periodKey - Period key
   * @param {string} resourceId - Resource ID (optional)
   * @returns {boolean} True if valid cache exists
   */
  static has(viewMode, periodKey, resourceId = null) {
    const cacheKey = generateCacheKey(viewMode, periodKey, resourceId)
    return isCacheValid(cacheKey)
  }
  
  /**
   * Clear specific cache entry
   * @param {string} viewMode - 'repository' or 'organization'
   * @param {string} periodKey - Period key
   * @param {string} resourceId - Resource ID (optional)
   */
  static clear(viewMode, periodKey, resourceId = null) {
    const cacheKey = generateCacheKey(viewMode, periodKey, resourceId)
    clearCache(cacheKey)
  }
  
  /**
   * Clear all cache
   */
  static clearAll() {
    clearCache()
  }
  
  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  static getStats() {
    return getCacheStats()
  }
  
  /**
   * Pre-warm cache with multiple periods for a view mode
   * @param {string} viewMode - 'repository' or 'organization'
   * @param {Array} periods - Array of period keys to pre-warm
   * @param {Function} dataFetcher - Function to fetch data (viewMode, periodKey) => Promise<data>
   * @param {string} resourceId - Resource ID (optional)
   */
  static async preWarm(viewMode, periods, dataFetcher, resourceId = null) {
    logger.log(`Pre-warming cache for ${viewMode} with ${periods.length} periods`)
    
    const promises = periods.map(async (periodKey) => {
      try {
        // Skip if already cached and valid
        if (ChartDataCache.has(viewMode, periodKey, resourceId)) {
          logger.log(`Skipping pre-warm for ${periodKey} - already cached`)
          return
        }
        
        const data = await dataFetcher(viewMode, periodKey, resourceId)
        if (data) {
          ChartDataCache.set(viewMode, periodKey, data, resourceId)
          logger.log(`✓ Pre-warmed cache for ${periodKey}`)
        }
      } catch (error) {
        logger.error(`Failed to pre-warm cache for ${periodKey}:`, error)
      }
    })
    
    await Promise.allSettled(promises)
    logger.log(`Cache pre-warming completed for ${viewMode}`)
  }
}

/**
 * Local storage cache for persistent caching across sessions
 * Used for truly immutable historical data
 */
export class PersistentCache {
  static PREFIX = 'ada_chart_cache_'
  
  /**
   * Generate localStorage key
   * @param {string} viewMode - View mode
   * @param {string} periodKey - Period key
   * @param {string} resourceId - Resource ID (optional)
   * @returns {string} localStorage key
   */
  static getStorageKey(viewMode, periodKey, resourceId = null) {
    const parts = [PersistentCache.PREFIX, viewMode, periodKey]
    if (resourceId) {
      parts.push(resourceId)
    }
    return parts.join('_')
  }
  
  /**
   * Store data in localStorage with metadata
   * @param {string} viewMode - View mode
   * @param {string} periodKey - Period key
   * @param {any} data - Data to store
   * @param {string} resourceId - Resource ID (optional)
   */
  static set(viewMode, periodKey, data, resourceId = null) {
    try {
      const storageKey = PersistentCache.getStorageKey(viewMode, periodKey, resourceId)
      const ttl = getCacheTTL(periodKey)
      
      const cacheEntry = {
        data: data,
        timestamp: Date.now(),
        ttl: ttl,
        periodKey: periodKey
      }
      
      localStorage.setItem(storageKey, JSON.stringify(cacheEntry))
      logger.log(`Stored persistent cache for ${storageKey}`)
    } catch (error) {
      logger.warn('Failed to store persistent cache:', error)
    }
  }
  
  /**
   * Get data from localStorage if valid
   * @param {string} viewMode - View mode
   * @param {string} periodKey - Period key
   * @param {string} resourceId - Resource ID (optional)
   * @returns {any|null} Cached data or null
   */
  static get(viewMode, periodKey, resourceId = null) {
    try {
      const storageKey = PersistentCache.getStorageKey(viewMode, periodKey, resourceId)
      const cached = localStorage.getItem(storageKey)
      
      if (!cached) return null
      
      const cacheEntry = JSON.parse(cached)
      const now = Date.now()
      
      // Check if cache is still valid
      if (now - cacheEntry.timestamp > cacheEntry.ttl) {
        localStorage.removeItem(storageKey)
        logger.log(`Expired persistent cache removed for ${storageKey}`)
        return null
      }
      
      logger.log(`⚡ Persistent cache hit for ${storageKey}`)
      return cacheEntry.data
    } catch (error) {
      logger.warn('Failed to read persistent cache:', error)
      return null
    }
  }
  
  /**
   * Clear persistent cache
   * @param {string} viewMode - View mode (optional)
   * @param {string} periodKey - Period key (optional)
   * @param {string} resourceId - Resource ID (optional)
   */
  static clear(viewMode = null, periodKey = null, resourceId = null) {
    try {
      if (viewMode && periodKey) {
        // Clear specific entry
        const storageKey = PersistentCache.getStorageKey(viewMode, periodKey, resourceId)
        localStorage.removeItem(storageKey)
        logger.log(`Cleared persistent cache for ${storageKey}`)
      } else {
        // Clear all chart cache entries
        const keysToRemove = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith(PersistentCache.PREFIX)) {
            keysToRemove.push(key)
          }
        }
        
        keysToRemove.forEach(key => localStorage.removeItem(key))
        logger.log(`Cleared ${keysToRemove.length} persistent cache entries`)
      }
    } catch (error) {
      logger.warn('Failed to clear persistent cache:', error)
    }
  }
}

// Export default cache instance
export const chartCache = ChartDataCache