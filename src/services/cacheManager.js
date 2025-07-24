import logger from '../utils/logger-frontend'

/**
 * Client-side Cache Manager for optimizing performance
 */
class CacheManager {
  constructor() {
    this.cacheWarmingQueue = []
    this.isWarming = false
    this.cacheStats = {
      hits: 0,
      misses: 0,
      warmups: 0
    }
  }

  /**
   * Warm up cache for frequently accessed resources
   * @param {Array} resources - Array of resources to preload
   */
  async warmCache(resources) {
    if (this.isWarming) {
      logger.log('🔄 Cache warming already in progress')
      return
    }

    this.isWarming = true
    logger.log(`🔥 Starting cache warmup for ${resources.length} resources`)

    try {
      // Prioritize resources by popularity/importance
      const prioritizedResources = this.prioritizeResources(resources)
      
      // Warm up in batches to avoid overwhelming the server
      const batchSize = 3
      for (let i = 0; i < prioritizedResources.length; i += batchSize) {
        const batch = prioritizedResources.slice(i, i + batchSize)
        
        await Promise.allSettled(
          batch.map(async (resource) => {
            try {
              await this.warmResource(resource)
              this.cacheStats.warmups++
            } catch (error) {
              logger.warn(`Failed to warm cache for ${resource.name}:`, error.message)
            }
          })
        )

        // Small delay between batches
        if (i + batchSize < prioritizedResources.length) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }

      logger.log(`✅ Cache warmup complete: ${this.cacheStats.warmups} resources warmed`)
    } catch (error) {
      logger.error('Cache warmup failed:', error)
    } finally {
      this.isWarming = false
    }
  }

  /**
   * Prioritize resources for cache warming
   * @param {Array} resources - Array of resources
   * @returns {Array} Prioritized resources
   */
  prioritizeResources(resources) {
    return resources
      .filter(resource => resource.social?.github)
      .sort((a, b) => {
        // Prioritize by category importance and activity level
        const categoryPriority = {
          'Development Tools': 10,
          'Libraries & Languages': 9,
          'Infrastructure & APIs': 8,
          'Wallets & User Tools': 7,
          'Security & Auditing': 6,
          'Core Infrastructure': 5,
          'Minting and NFTs': 4,
          'Analytics & Data': 3,
          'Community & Engagement': 2,
          'Education & Documentation': 1
        }

        const aPriority = categoryPriority[a.category] || 0
        const bPriority = categoryPriority[b.category] || 0

        if (aPriority !== bPriority) {
          return bPriority - aPriority
        }

        // Secondary sort by name for consistency
        return a.name.localeCompare(b.name)
      })
      .slice(0, 20) // Limit to top 20 resources
  }

  /**
   * Warm up cache for a single resource
   * @param {Object} resource - Resource object
   */
  async warmResource(resource) {
    try {
      // Validate resource before sending
      if (!resource || !resource.name || !resource.social?.github) {
        logger.warn(`Skipping invalid resource for cache warming: ${resource?.name || 'undefined'}`)
        return
      }

      // Prefetch GitHub data
      const response = await fetch('/api/github/updates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(resource)
      })

      if (response.ok) {
        const data = await response.json()
        logger.log(`🔥 Warmed cache for ${resource.name}: ${data.releases?.length || 0} releases, ${data.commits?.length || 0} commits`)
      }
    } catch (error) {
      throw new Error(`Failed to warm resource ${resource.name}: ${error.message}`)
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      ...this.cacheStats,
      hitRate: this.cacheStats.hits + this.cacheStats.misses > 0 
        ? ((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100).toFixed(1)
        : 0
    }
  }

  /**
   * Record cache hit
   */
  recordHit() {
    this.cacheStats.hits++
  }

  /**
   * Record cache miss
   */
  recordMiss() {
    this.cacheStats.misses++
  }

  /**
   * Clear cache statistics
   */
  clearStats() {
    this.cacheStats = {
      hits: 0,
      misses: 0,
      warmups: 0
    }
  }

  /**
   * Get service worker cache status
   * @returns {Promise<Object>} Cache status
   */
  async getServiceWorkerCacheStatus() {
    return new Promise((resolve) => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const messageChannel = new MessageChannel()
        messageChannel.port1.onmessage = (event) => {
          resolve(event.data)
        }
        
        navigator.serviceWorker.controller.postMessage(
          { type: 'GET_CACHE_STATUS' },
          [messageChannel.port2]
        )
      } else {
        resolve({ success: false, error: 'Service Worker not available' })
      }
    })
  }

  /**
   * Clear service worker cache
   * @returns {Promise<Object>} Clear result
   */
  async clearServiceWorkerCache() {
    return new Promise((resolve) => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const messageChannel = new MessageChannel()
        messageChannel.port1.onmessage = (event) => {
          resolve(event.data)
        }
        
        navigator.serviceWorker.controller.postMessage(
          { type: 'CLEAR_CACHE' },
          [messageChannel.port2]
        )
      } else {
        resolve({ success: false, error: 'Service Worker not available' })
      }
    })
  }
}

// Create singleton instance
const cacheManager = new CacheManager()

export default cacheManager 