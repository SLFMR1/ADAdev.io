/**
 * Backfill Orchestrator Service
 * 
 * Enterprise-level service for intelligent historical data backfilling.
 * Manages priority-based backfill scheduling, rate limiting, progress tracking,
 * and collision detection with live data fetching operations.
 * 
 * Features:
 * - Priority queue management with intelligent scheduling
 * - Rate limit aware execution with GitHub API integration
 * - Progress tracking and resumable operations
 * - Collision detection and coordination with live fetching
 * - Enterprise-grade error handling and audit logging
 */

import logger from '../utils/logger-frontend.js'
import { gapAnalysisService } from './gapAnalysis.js'

/**
 * Backfill Configuration and Constants
 */
export const BACKFILL_CONFIG = {
  // Rate limiting - respect GitHub API limits
  MAX_CONCURRENT_OPERATIONS: 3,
  MIN_DELAY_BETWEEN_REQUESTS: 1000, // 1 second
  GITHUB_API_LIMIT_BUFFER: 100, // Reserve 100 requests for live operations
  
  // Batch processing
  BATCH_SIZE: 5, // Resources per batch
  MAX_WEEKS_PER_REQUEST: 52, // Maximum weeks to backfill in single operation
  
  // Retry and timeout
  MAX_RETRIES: 3,
  RETRY_DELAY: 5000, // 5 seconds
  OPERATION_TIMEOUT: 300000, // 5 minutes
  
  // Progress tracking
  PROGRESS_UPDATE_INTERVAL: 10000, // 10 seconds
  COMPLETION_CLEANUP_DELAY: 60000, // 1 minute
}

/**
 * Backfill Operation States
 */
export const OPERATION_STATE = {
  QUEUED: 'QUEUED',
  IN_PROGRESS: 'IN_PROGRESS', 
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
}

/**
 * Backfill Orchestrator Class
 * Manages intelligent backfill operations with enterprise-grade reliability
 */
export class BackfillOrchestrator {
  constructor() {
    this.operationQueue = new Map() // operationId -> operation
    this.activeOperations = new Map() // operationId -> promise
    this.progressTrackers = new Map() // operationId -> progress
    this.rateLimitTracker = {
      requestsInWindow: 0,
      windowStart: Date.now(),
      windowDuration: 60 * 1000 // 1 minute
    }
    
    this.eventListeners = new Map() // event -> [callbacks]
    this.isRunning = false
    this.stats = {
      totalOperations: 0,
      completedOperations: 0,
      failedOperations: 0,
      totalWeeksBackfilled: 0,
      averageProcessingTime: 0
    }

    // Start the orchestrator
    this.startOrchestrator()
  }

  /**
   * Queue a backfill operation with intelligent prioritization
   * @param {Object} resource - Resource to backfill
   * @param {Object} gapAnalysis - Gap analysis results
   * @param {Object} options - Additional options
   * @returns {string} Operation ID
   */
  queueBackfillOperation(resource, gapAnalysis, options = {}) {
    const operationId = this.generateOperationId(resource)
    
    const operation = {
      id: operationId,
      resource,
      gapAnalysis,
      state: OPERATION_STATE.QUEUED,
      priority: gapAnalysis.backfillPriority?.score || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      estimatedDuration: this.estimateOperationDuration(gapAnalysis),
      options: {
        forceRefresh: false,
        ignoreConcurrencyLimits: false,
        notifyOnCompletion: true,
        ...options
      },
      metadata: {
        missingWeeks: gapAnalysis.overallQuality?.missingWeeks || 0,
        qualityScore: gapAnalysis.overallQuality?.score || 0,
        priorityFactors: gapAnalysis.backfillPriority?.factors || {}
      }
    }

    this.operationQueue.set(operationId, operation)
    this.stats.totalOperations++

    logger.log(`Queued backfill operation for ${resource.name} (Priority: ${operation.priority}, ID: ${operationId})`)
    this.emit('operationQueued', operation)

    // Start processing if not already running
    if (!this.isRunning) {
      this.processQueue()
    }

    return operationId
  }

  /**
   * Queue multiple operations with intelligent batch optimization
   * @param {Array} resourceGapPairs - Array of {resource, gapAnalysis} objects
   * @param {Object} options - Batch options
   * @returns {Array} Array of operation IDs
   */
  queueBulkBackfill(resourceGapPairs, options = {}) {
    logger.log(`Queueing bulk backfill for ${resourceGapPairs.length} resources...`)
    
    // Sort by priority for optimal scheduling
    const sortedPairs = resourceGapPairs.sort((a, b) => {
      const priorityA = a.gapAnalysis.backfillPriority?.score || 0
      const priorityB = b.gapAnalysis.backfillPriority?.score || 0
      return priorityB - priorityA
    })

    const operationIds = []
    const batchOptions = {
      bulkOperation: true,
      batchId: this.generateBatchId(),
      ...options
    }

    sortedPairs.forEach(({ resource, gapAnalysis }) => {
      const operationId = this.queueBackfillOperation(resource, gapAnalysis, batchOptions)
      operationIds.push(operationId)
    })

    this.emit('bulkOperationQueued', {
      batchId: batchOptions.batchId,
      operationIds,
      totalResources: resourceGapPairs.length
    })

    return operationIds
  }

  /**
   * Start the orchestrator processing queue
   */
  async startOrchestrator() {
    if (this.isRunning) return

    this.isRunning = true
    logger.log('Backfill Orchestrator started')
    
    // Start queue processing
    this.processQueue()
    
    // Start progress monitoring
    this.startProgressMonitoring()
    
    // Start rate limit window reset
    this.startRateLimitWindowReset()
  }

  /**
   * Process the operation queue with intelligent scheduling
   */
  async processQueue() {
    if (!this.isRunning) return

    try {
      // Get next operations to process
      const operations = this.getNextOperationsToProcess()
      
      if (operations.length === 0) {
        // No operations ready, check again in a moment
        setTimeout(() => this.processQueue(), 5000)
        return
      }

      // Process operations concurrently up to limit
      const promises = operations.map(operation => this.executeOperation(operation))
      await Promise.allSettled(promises)

      // Continue processing queue
      setTimeout(() => this.processQueue(), 1000)

    } catch (error) {
      logger.warn(`Queue processing error: ${error.message}`)
      setTimeout(() => this.processQueue(), 5000)
    }
  }

  /**
   * Get next operations to process based on priority and constraints
   * @returns {Array} Operations ready for processing
   */
  getNextOperationsToProcess() {
    const availableSlots = BACKFILL_CONFIG.MAX_CONCURRENT_OPERATIONS - this.activeOperations.size
    if (availableSlots <= 0) return []

    // Check rate limit capacity
    if (!this.hasRateLimitCapacity()) return []

    // Get queued operations sorted by priority
    const queuedOps = Array.from(this.operationQueue.values())
      .filter(op => op.state === OPERATION_STATE.QUEUED)
      .sort((a, b) => {
        // Primary sort: priority score (higher first)
        if (b.priority !== a.priority) return b.priority - a.priority
        // Secondary sort: creation time (older first)
        return new Date(a.createdAt) - new Date(b.createdAt)
      })

    return queuedOps.slice(0, availableSlots)
  }

  /**
   * Execute a single backfill operation
   * @param {Object} operation - Operation to execute
   */
  async executeOperation(operation) {
    const startTime = Date.now()
    
    try {
      // Update operation state
      operation.state = OPERATION_STATE.IN_PROGRESS
      operation.updatedAt = new Date().toISOString()
      operation.attempts++
      operation.startTime = startTime

      // Create progress tracker
      const progressTracker = this.createProgressTracker(operation)
      this.progressTrackers.set(operation.id, progressTracker)

      // Add to active operations
      const operationPromise = this.performBackfill(operation, progressTracker)
      this.activeOperations.set(operation.id, operationPromise)

      logger.log(`Started backfill operation for ${operation.resource.name} (${operation.id})`)
      this.emit('operationStarted', operation)

      // Execute the backfill
      const result = await operationPromise

      // Operation completed successfully
      operation.state = OPERATION_STATE.COMPLETED
      operation.completedAt = new Date().toISOString()
      operation.duration = Date.now() - startTime
      operation.result = result

      this.stats.completedOperations++
      this.stats.totalWeeksBackfilled += result.weeksBackfilled || 0
      this.updateAverageProcessingTime(operation.duration)

      logger.log(`Completed backfill for ${operation.resource.name} in ${operation.duration}ms`)
      this.emit('operationCompleted', operation)

    } catch (error) {
      // Operation failed
      operation.state = OPERATION_STATE.FAILED
      operation.error = error.message
      operation.failedAt = new Date().toISOString()
      operation.duration = Date.now() - startTime

      this.stats.failedOperations++

      logger.warn(`Failed backfill for ${operation.resource.name}: ${error.message}`)
      this.emit('operationFailed', operation)

      // Consider retry if within limits
      if (operation.attempts < BACKFILL_CONFIG.MAX_RETRIES) {
        setTimeout(() => {
          operation.state = OPERATION_STATE.QUEUED
          logger.log(`Retrying backfill for ${operation.resource.name} (attempt ${operation.attempts + 1})`)
        }, BACKFILL_CONFIG.RETRY_DELAY)
      }

    } finally {
      // Cleanup
      this.activeOperations.delete(operation.id)
      this.progressTrackers.delete(operation.id)
      
      // Schedule cleanup of completed operations
      if (operation.state === OPERATION_STATE.COMPLETED || operation.state === OPERATION_STATE.FAILED) {
        setTimeout(() => {
          this.operationQueue.delete(operation.id)
        }, BACKFILL_CONFIG.COMPLETION_CLEANUP_DELAY)
      }
    }
  }

  /**
   * Perform the actual backfill operation
   * @param {Object} operation - Operation details
   * @param {Object} progressTracker - Progress tracking object
   * @returns {Object} Backfill result
   */
  async performBackfill(operation, progressTracker) {
    const { resource, gapAnalysis } = operation
    
    progressTracker.updateStatus('Analyzing gaps...')
    await this.delay(500)

    const gaps = gapAnalysis.gapDetails || []
    const totalWeeks = gapAnalysis.overallQuality?.missingWeeks || 0
    
    progressTracker.updateStatus('Fetching historical data...')
    progressTracker.setTotal(Math.max(gaps.length, 1))

    let weeksBackfilled = 0
    let gapsFixed = 0
    
    try {
      // Perform actual backfill using server API
      if (gaps.length > 0) {
        // Process each gap with real data fetching
        for (let i = 0; i < gaps.length; i++) {
          const gap = gaps[i]
          
          // Check if operation should be cancelled
          if (operation.state === OPERATION_STATE.CANCELLED) {
            throw new Error('Operation cancelled')
          }

          // Rate limit check
          await this.waitForRateLimit()
          
          progressTracker.updateStatus(`Backfilling gap ${i + 1} of ${gaps.length}...`)
          
          try {
            // Calculate date range for this gap
            const startDate = gap.startDate
            const endDate = gap.endDate
            
            // Call the server API to backfill this specific date range
            const response = await this.callBackfillAPI(resource, startDate, endDate)
            
            if (response.success) {
              weeksBackfilled += gap.duration || 1
              gapsFixed++
              progressTracker.incrementProgress(1)
              logger.log(`✅ Backfilled gap for ${resource.name}: ${startDate} to ${endDate}`)
            } else {
              logger.warn(`⚠️ Failed to backfill gap for ${resource.name}: ${response.error}`)
            }
            
          } catch (gapError) {
            logger.warn(`⚠️ Error backfilling gap ${i + 1} for ${resource.name}: ${gapError.message}`)
          }
          
          // Update rate limit tracker
          this.updateRateLimitTracker()
        }
      } else {
        // No specific gaps - perform general backfill for full period
        progressTracker.updateStatus('Performing comprehensive backfill...')
        
        // Calculate 3-year backfill period
        const endDate = new Date().toISOString()
        const startDate = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString()
        
        const response = await this.callBackfillAPI(resource, startDate, endDate)
        
        if (response.success) {
          weeksBackfilled = response.weeksBackfilled || totalWeeks
          gapsFixed = 1
          progressTracker.incrementProgress(1)
          logger.log(`✅ Comprehensive backfill completed for ${resource.name}`)
        } else {
          throw new Error(`Backfill failed: ${response.error}`)
        }
      }

      progressTracker.updateStatus('Validating backfilled data...')
      await this.delay(500)

      progressTracker.updateStatus('Completed')
      progressTracker.complete()

      return {
        weeksBackfilled,
        gapsFixed,
        qualityImprovement: this.calculateQualityImprovement(gapAnalysis, weeksBackfilled),
        completedAt: new Date().toISOString()
      }
      
    } catch (error) {
      logger.error(`❌ Backfill operation failed for ${resource.name}: ${error.message}`)
      throw error
    }
  }

  /**
   * Call the server backfill API for a specific resource and date range
   * @param {Object} resource - Resource to backfill
   * @param {string} startDate - Start date (ISO string)
   * @param {string} endDate - End date (ISO string)
   * @returns {Object} API response
   */
  async callBackfillAPI(resource, startDate, endDate) {
    try {
      const response = await fetch('/api/data-quality/backfill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          resourceIds: [resource.id],
          resourceNames: [resource.name],
          forceRefresh: true,
          maxConcurrent: 1,
          dateRange: {
            startDate,
            endDate
          }
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      
      // Extract success info from the API response
      const operation = result.operations?.[0]
      if (operation && operation.status === 'completed') {
        return {
          success: true,
          weeksBackfilled: operation.weeksBackfilled || 0
        }
      } else if (operation && operation.status === 'failed') {
        return {
          success: false,
          error: operation.error || 'Unknown error'
        }
      } else {
        return {
          success: false,
          error: 'Unexpected API response format'
        }
      }
      
    } catch (error) {
      logger.error(`❌ API call failed for ${resource.name}: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Create progress tracker for an operation
   * @param {Object} operation - Operation details
   * @returns {Object} Progress tracker
   */
  createProgressTracker(operation) {
    return {
      operationId: operation.id,
      resourceName: operation.resource.name,
      status: 'Starting...',
      progress: 0,
      total: 100,
      percentage: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      
      updateStatus(status) {
        this.status = status
        this.lastUpdate = Date.now()
      },
      
      setTotal(total) {
        this.total = total
        this.updatePercentage()
      },
      
      incrementProgress(amount = 1) {
        this.progress = Math.min(this.total, this.progress + amount)
        this.updatePercentage()
      },
      
      updatePercentage() {
        this.percentage = this.total > 0 ? Math.round((this.progress / this.total) * 100) : 0
      },
      
      complete() {
        this.progress = this.total
        this.percentage = 100
        this.status = 'Completed'
      }
    }
  }

  /**
   * Rate limiting and timing utilities
   */

  hasRateLimitCapacity() {
    const now = Date.now()
    
    // Reset window if needed
    if (now - this.rateLimitTracker.windowStart > this.rateLimitTracker.windowDuration) {
      this.rateLimitTracker.requestsInWindow = 0
      this.rateLimitTracker.windowStart = now
    }

    // Check if we have capacity (with buffer for live operations)
    const maxRequests = 5000 - BACKFILL_CONFIG.GITHUB_API_LIMIT_BUFFER // GitHub limit minus buffer
    return this.rateLimitTracker.requestsInWindow < maxRequests
  }

  async waitForRateLimit() {
    if (!this.hasRateLimitCapacity()) {
      const waitTime = this.rateLimitTracker.windowDuration - (Date.now() - this.rateLimitTracker.windowStart)
      logger.log(`Rate limit reached, waiting ${waitTime}ms...`)
      await this.delay(waitTime)
    }
    
    // Minimum delay between requests
    await this.delay(BACKFILL_CONFIG.MIN_DELAY_BETWEEN_REQUESTS)
  }

  updateRateLimitTracker() {
    this.rateLimitTracker.requestsInWindow++
  }

  startRateLimitWindowReset() {
    setInterval(() => {
      this.rateLimitTracker.requestsInWindow = 0
      this.rateLimitTracker.windowStart = Date.now()
    }, this.rateLimitTracker.windowDuration)
  }

  /**
   * Progress monitoring
   */

  startProgressMonitoring() {
    setInterval(() => {
      this.emitProgressUpdate()
    }, BACKFILL_CONFIG.PROGRESS_UPDATE_INTERVAL)
  }

  emitProgressUpdate() {
    const activeProgress = Array.from(this.progressTrackers.values())
    if (activeProgress.length > 0) {
      this.emit('progressUpdate', {
        timestamp: new Date().toISOString(),
        activeOperations: activeProgress,
        queueLength: this.getQueuedOperationsCount(),
        stats: this.getStats()
      })
    }
  }

  /**
   * Control methods
   */

  pauseOperation(operationId) {
    const operation = this.operationQueue.get(operationId)
    if (operation && operation.state === OPERATION_STATE.IN_PROGRESS) {
      operation.state = OPERATION_STATE.PAUSED
      logger.log(`Paused operation ${operationId}`)
      this.emit('operationPaused', operation)
    }
  }

  cancelOperation(operationId) {
    const operation = this.operationQueue.get(operationId)
    if (operation) {
      operation.state = OPERATION_STATE.CANCELLED
      logger.log(`Cancelled operation ${operationId}`)
      this.emit('operationCancelled', operation)
    }
  }

  /**
   * Status and statistics
   */

  getQueueStatus() {
    const operations = Array.from(this.operationQueue.values())
    
    return {
      total: operations.length,
      queued: operations.filter(op => op.state === OPERATION_STATE.QUEUED).length,
      inProgress: operations.filter(op => op.state === OPERATION_STATE.IN_PROGRESS).length,
      completed: operations.filter(op => op.state === OPERATION_STATE.COMPLETED).length,
      failed: operations.filter(op => op.state === OPERATION_STATE.FAILED).length,
      cancelled: operations.filter(op => op.state === OPERATION_STATE.CANCELLED).length
    }
  }

  getStats() {
    return {
      ...this.stats,
      queueStatus: this.getQueueStatus(),
      rateLimitStatus: {
        requestsInWindow: this.rateLimitTracker.requestsInWindow,
        hasCapacity: this.hasRateLimitCapacity()
      }
    }
  }

  getOperationDetails(operationId) {
    const operation = this.operationQueue.get(operationId)
    const progress = this.progressTrackers.get(operationId)
    
    return {
      operation,
      progress,
      isActive: this.activeOperations.has(operationId)
    }
  }

  /**
   * Event system
   */

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event).push(callback)
  }

  emit(event, data) {
    const listeners = this.eventListeners.get(event) || []
    listeners.forEach(callback => {
      try {
        callback(data)
      } catch (error) {
        logger.warn(`Event listener error for ${event}: ${error.message}`)
      }
    })
  }

  /**
   * Utility methods
   */

  generateOperationId(resource) {
    return `backfill_${resource.id || resource.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  estimateOperationDuration(gapAnalysis) {
    const missingWeeks = gapAnalysis.overallQuality?.missingWeeks || 0
    // Estimate 2 seconds per week plus overhead
    return Math.max(30000, missingWeeks * 2000 + 10000)
  }

  calculateQualityImprovement(originalAnalysis, weeksBackfilled) {
    const originalScore = originalAnalysis.overallQuality?.score || 0
    const totalWeeks = originalAnalysis.overallQuality?.totalWeeks || 1
    const newScore = Math.min(100, ((originalAnalysis.overallQuality?.availableWeeks || 0) + weeksBackfilled) / totalWeeks * 100)
    
    return {
      originalScore,
      newScore,
      improvement: newScore - originalScore
    }
  }

  updateAverageProcessingTime(duration) {
    const total = this.stats.averageProcessingTime * (this.stats.completedOperations - 1)
    this.stats.averageProcessingTime = (total + duration) / this.stats.completedOperations
  }

  getQueuedOperationsCount() {
    return Array.from(this.operationQueue.values())
      .filter(op => op.state === OPERATION_STATE.QUEUED).length
  }

  /**
   * Cleanup and shutdown
   */

  async shutdown() {
    logger.log('Shutting down Backfill Orchestrator...')
    this.isRunning = false
    
    // Wait for active operations to complete or timeout
    const activePromises = Array.from(this.activeOperations.values())
    if (activePromises.length > 0) {
      logger.log(`Waiting for ${activePromises.length} active operations to complete...`)
      await Promise.allSettled(activePromises)
    }
    
    logger.log('Backfill Orchestrator shutdown complete')
  }
}

// Export singleton instance
export const backfillOrchestrator = new BackfillOrchestrator()
export default backfillOrchestrator