/**
 * Gap Analysis Service
 * 
 * Enterprise-level service for detecting and analyzing historical data gaps
 * in the GitHub activity tracking system. Provides comprehensive gap detection,
 * data quality metrics, and intelligent backfill prioritization.
 * 
 * Architecture:
 * - Clean separation of concerns with dedicated gap detection logic
 * - Follows existing service layer patterns and error handling
 * - Enterprise-ready with performance monitoring and audit trails
 * - Integrates seamlessly with existing caching and rate limiting systems
 */

import logger from '../utils/logger-frontend.js'

/**
 * Data Quality Metrics and Constants
 */
export const DATA_QUALITY_THRESHOLDS = {
  EXCELLENT: 0.98,  // 98%+ completeness
  GOOD: 0.90,       // 90-98% completeness  
  FAIR: 0.75,       // 75-90% completeness
  POOR: 0.50,       // 50-75% completeness
  CRITICAL: 0.50    // <50% completeness
}

export const FRESHNESS_THRESHOLDS = {
  CURRENT: 2 * 24 * 60 * 60 * 1000,      // 2 days
  RECENT: 7 * 24 * 60 * 60 * 1000,       // 7 days
  STALE: 30 * 24 * 60 * 60 * 1000,       // 30 days
  CRITICAL: 90 * 24 * 60 * 60 * 1000     // 90 days
}

export const PERIOD_EXPECTATIONS = {
  '4weeks': { weeks: 4, days: 28 },
  '3months': { weeks: 13, days: 91 },
  '52weeks': { weeks: 52, days: 364 },
  '3years': { weeks: 156, days: 1095 }
}

/**
 * Gap Analysis Service Class
 * Provides comprehensive data gap detection and quality metrics
 */
export class GapAnalysisService {
  constructor() {
    this.analysisCache = new Map()
    this.cacheTimeout = 10 * 60 * 1000 // 10 minutes
  }

  /**
   * Analyze data gaps for a specific resource across all periods
   * @param {Object} resource - Resource object with id, name, type
   * @param {Array} weeklyData - Weekly activity data from database
   * @returns {Object} Comprehensive gap analysis
   */
  analyzeResourceGaps(resource, weeklyData) {
    try {
      const cacheKey = `gap_analysis_${resource.id}_${resource.name}`
      const cached = this.analysisCache.get(cacheKey)
      
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        logger.log(`Using cached gap analysis for ${resource.name}`)
        return cached.data
      }

      logger.log(`Analyzing data gaps for ${resource.name}...`)
      
      const analysis = {
        resource: {
          id: resource.id,
          name: resource.name,
          type: resource.type
        },
        timestamp: new Date().toISOString(),
        overallQuality: this.calculateOverallQuality(weeklyData),
        periodAnalysis: this.analyzePeriods(weeklyData),
        gapDetails: this.identifySpecificGaps(weeklyData),
        freshness: this.assessDataFreshness(weeklyData),
        recommendations: this.generateRecommendations(weeklyData, resource),
        backfillPriority: this.calculateBackfillPriority(resource, weeklyData)
      }

      // Cache the analysis
      this.analysisCache.set(cacheKey, {
        data: analysis,
        timestamp: Date.now()
      })

      logger.log(`Gap analysis complete for ${resource.name}: ${analysis.overallQuality.score}% quality`)
      return analysis

    } catch (error) {
      logger.warn(`Gap analysis failed for ${resource.name}: ${error.message}`)
      return this.createErrorAnalysis(resource, error)
    }
  }

  /**
   * Calculate overall data quality score
   * @param {Array} weeklyData - Weekly activity data
   * @returns {Object} Quality metrics
   */
  calculateOverallQuality(weeklyData) {
    if (!weeklyData || weeklyData.length === 0) {
      return {
        score: 0,
        level: 'CRITICAL',
        totalWeeks: 0,
        availableWeeks: 0,
        missingWeeks: 0,
        details: 'No data available'
      }
    }

    // Calculate expected weeks based on data span
    const sortedData = [...weeklyData].sort((a, b) => new Date(a.week_start) - new Date(b.week_start))
    const firstWeek = new Date(sortedData[0].week_start)
    const lastWeek = new Date(sortedData[sortedData.length - 1].week_start)
    const weeksDifference = Math.ceil((lastWeek - firstWeek) / (7 * 24 * 60 * 60 * 1000)) + 1
    
    const availableWeeks = weeklyData.length
    const expectedWeeks = Math.max(weeksDifference, availableWeeks)
    const missingWeeks = expectedWeeks - availableWeeks
    const score = Math.round((availableWeeks / expectedWeeks) * 100)

    let level = 'CRITICAL'
    if (score >= DATA_QUALITY_THRESHOLDS.EXCELLENT * 100) level = 'EXCELLENT'
    else if (score >= DATA_QUALITY_THRESHOLDS.GOOD * 100) level = 'GOOD'
    else if (score >= DATA_QUALITY_THRESHOLDS.FAIR * 100) level = 'FAIR'
    else if (score >= DATA_QUALITY_THRESHOLDS.POOR * 100) level = 'POOR'

    return {
      score,
      level,
      totalWeeks: expectedWeeks,
      availableWeeks,
      missingWeeks,
      details: `${availableWeeks} of ${expectedWeeks} weeks available`
    }
  }

  /**
   * Analyze gaps for specific periods (4weeks, 3months, 52weeks, 3years)
   * @param {Array} weeklyData - Weekly activity data
   * @returns {Object} Period-specific analysis
   */
  analyzePeriods(weeklyData) {
    const analysis = {}
    const now = new Date()

    Object.entries(PERIOD_EXPECTATIONS).forEach(([periodKey, expectations]) => {
      const startDate = new Date(now.getTime() - expectations.days * 24 * 60 * 60 * 1000)
      
      // Filter data for this period
      const periodData = weeklyData.filter(week => {
        const weekDate = new Date(week.week_start)
        return weekDate >= startDate && weekDate <= now
      })

      const availableWeeks = periodData.length
      const expectedWeeks = expectations.weeks
      const missingWeeks = Math.max(0, expectedWeeks - availableWeeks)
      const completeness = expectedWeeks > 0 ? (availableWeeks / expectedWeeks) : 0

      analysis[periodKey] = {
        expectedWeeks,
        availableWeeks,
        missingWeeks,
        completeness: Math.round(completeness * 100),
        isComplete: missingWeeks === 0,
        quality: this.getQualityLevel(completeness),
        gaps: this.findPeriodGaps(periodData, startDate, now)
      }
    })

    return analysis
  }

  /**
   * Identify specific missing date ranges
   * @param {Array} weeklyData - Weekly activity data
   * @returns {Array} Array of gap objects
   */
  identifySpecificGaps(weeklyData) {
    if (!weeklyData || weeklyData.length === 0) {
      return [{
        type: 'TOTAL_ABSENCE',
        startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date().toISOString(),
        duration: 52,
        severity: 'CRITICAL'
      }]
    }

    const gaps = []
    const sortedData = [...weeklyData].sort((a, b) => new Date(a.week_start) - new Date(b.week_start))
    
    // Check for gaps between consecutive weeks
    for (let i = 0; i < sortedData.length - 1; i++) {
      const currentWeek = new Date(sortedData[i].week_start)
      const nextWeek = new Date(sortedData[i + 1].week_start)
      const expectedNextWeek = new Date(currentWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
      
      const weeksDifference = Math.round((nextWeek - expectedNextWeek) / (7 * 24 * 60 * 60 * 1000))
      
      if (weeksDifference > 0) {
        gaps.push({
          type: 'SEQUENCE_GAP',
          startDate: expectedNextWeek.toISOString(),
          endDate: new Date(nextWeek.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          duration: weeksDifference,
          severity: this.getGapSeverity(weeksDifference)
        })
      }
    }

    // Check for recent gaps (missing current week)
    const lastWeek = new Date(sortedData[sortedData.length - 1].week_start)
    const currentWeek = this.getCurrentWeekStart()
    const weeksSinceLastData = Math.round((currentWeek - lastWeek) / (7 * 24 * 60 * 60 * 1000))
    
    if (weeksSinceLastData > 1) {
      gaps.push({
        type: 'RECENT_GAP',
        startDate: new Date(lastWeek.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: currentWeek.toISOString(),
        duration: weeksSinceLastData - 1,
        severity: this.getGapSeverity(weeksSinceLastData - 1)
      })
    }

    return gaps
  }

  /**
   * Assess data freshness based on most recent data point
   * @param {Array} weeklyData - Weekly activity data
   * @returns {Object} Freshness assessment
   */
  assessDataFreshness(weeklyData) {
    if (!weeklyData || weeklyData.length === 0) {
      return {
        level: 'NO_DATA',
        daysSinceLastUpdate: null,
        lastUpdateDate: null,
        isFresh: false,
        details: 'No data available'
      }
    }

    const sortedData = [...weeklyData].sort((a, b) => new Date(b.week_start) - new Date(a.week_start))
    const lastUpdate = new Date(sortedData[0].week_start)
    const now = new Date()
    const daysSinceLastUpdate = Math.floor((now - lastUpdate) / (24 * 60 * 60 * 1000))

    let level = 'CRITICAL'
    let isFresh = false

    if (daysSinceLastUpdate <= 2) {
      level = 'CURRENT'
      isFresh = true
    } else if (daysSinceLastUpdate <= 7) {
      level = 'RECENT'
      isFresh = true
    } else if (daysSinceLastUpdate <= 30) {
      level = 'STALE'
    } else {
      level = 'CRITICAL'
    }

    return {
      level,
      daysSinceLastUpdate,
      lastUpdateDate: lastUpdate.toISOString(),
      isFresh,
      details: `Last updated ${daysSinceLastUpdate} days ago`
    }
  }

  /**
   * Generate actionable recommendations based on gap analysis
   * @param {Array} weeklyData - Weekly activity data
   * @param {Object} resource - Resource object
   * @returns {Array} Array of recommendation objects
   */
  generateRecommendations(weeklyData, resource) {
    const recommendations = []
    const quality = this.calculateOverallQuality(weeklyData)
    const freshness = this.assessDataFreshness(weeklyData)

    // Data quality recommendations
    if (quality.score < DATA_QUALITY_THRESHOLDS.POOR * 100) {
      recommendations.push({
        type: 'CRITICAL',
        category: 'DATA_QUALITY',
        message: `Critical data gaps detected for ${resource.name}`,
        action: 'IMMEDIATE_BACKFILL',
        priority: 'HIGH',
        details: `Only ${quality.score}% data completeness. Missing ${quality.missingWeeks} weeks.`
      })
    } else if (quality.score < DATA_QUALITY_THRESHOLDS.GOOD * 100) {
      recommendations.push({
        type: 'WARNING',
        category: 'DATA_QUALITY',
        message: `Moderate data gaps detected for ${resource.name}`,
        action: 'SCHEDULED_BACKFILL',
        priority: 'MEDIUM',
        details: `${quality.score}% data completeness. Consider backfilling ${quality.missingWeeks} missing weeks.`
      })
    }

    // Freshness recommendations
    if (freshness.level === 'CRITICAL') {
      recommendations.push({
        type: 'CRITICAL',
        category: 'DATA_FRESHNESS',
        message: `Stale data detected for ${resource.name}`,
        action: 'CHECK_RESOURCE_STATUS',
        priority: 'HIGH',
        details: `No updates for ${freshness.daysSinceLastUpdate} days. Resource may be inactive or have connectivity issues.`
      })
    } else if (freshness.level === 'STALE') {
      recommendations.push({
        type: 'WARNING',
        category: 'DATA_FRESHNESS',
        message: `Data becoming stale for ${resource.name}`,
        action: 'REFRESH_DATA',
        priority: 'MEDIUM',
        details: `Last updated ${freshness.daysSinceLastUpdate} days ago.`
      })
    }

    return recommendations
  }

  /**
   * Calculate backfill priority score for intelligent scheduling
   * @param {Object} resource - Resource object
   * @param {Array} weeklyData - Weekly activity data
   * @returns {Object} Priority scoring
   */
  calculateBackfillPriority(resource, weeklyData) {
    let score = 0
    const factors = {}

    // Data quality factor (0-40 points)
    const quality = this.calculateOverallQuality(weeklyData)
    const qualityScore = Math.max(0, 40 - (quality.score / 100 * 40))
    score += qualityScore
    factors.dataQuality = qualityScore

    // Freshness factor (0-30 points)
    const freshness = this.assessDataFreshness(weeklyData)
    const freshnessScore = freshness.daysSinceLastUpdate ? Math.min(30, freshness.daysSinceLastUpdate) : 30
    score += freshnessScore
    factors.freshness = freshnessScore

    // Resource importance factor (0-20 points)
    const importanceScore = this.getResourceImportance(resource)
    score += importanceScore
    factors.importance = importanceScore

    // Gap severity factor (0-10 points)
    const gaps = this.identifySpecificGaps(weeklyData)
    const severityScore = Math.min(10, gaps.length * 2)
    score += severityScore
    factors.gapSeverity = severityScore

    const priority = score >= 70 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW'

    return {
      score: Math.round(score),
      priority,
      factors,
      estimatedBackfillTime: this.estimateBackfillTime(quality.missingWeeks),
      shouldBackfill: score >= 30
    }
  }

  /**
   * Helper Methods
   */

  getCurrentWeekStart() {
    const now = new Date()
    const dayOfWeek = now.getDay()
    const monday = new Date(now.getTime() - dayOfWeek * 24 * 60 * 60 * 1000)
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  getQualityLevel(completeness) {
    if (completeness >= DATA_QUALITY_THRESHOLDS.EXCELLENT) return 'EXCELLENT'
    if (completeness >= DATA_QUALITY_THRESHOLDS.GOOD) return 'GOOD'
    if (completeness >= DATA_QUALITY_THRESHOLDS.FAIR) return 'FAIR'
    if (completeness >= DATA_QUALITY_THRESHOLDS.POOR) return 'POOR'
    return 'CRITICAL'
  }

  getGapSeverity(weeksDuration) {
    if (weeksDuration >= 12) return 'CRITICAL'
    if (weeksDuration >= 4) return 'HIGH'
    if (weeksDuration >= 2) return 'MEDIUM'
    return 'LOW'
  }

  getResourceImportance(resource) {
    // Score based on resource type and category
    const typeScores = {
      'organization': 15,
      'repository': 10
    }

    const categoryScores = {
      'Core Infrastructure': 20,
      'Libraries & Languages': 15,
      'Development Platforms': 12,
      'Wallets & User Tools': 10,
      'DeFi & DEXs': 8,
      'Analytics & Data': 8,
      'Default': 5
    }

    const typeScore = typeScores[resource.type] || 5
    const categoryScore = categoryScores[resource.category] || categoryScores['Default']
    
    return Math.min(20, (typeScore + categoryScore) / 2)
  }

  estimateBackfillTime(missingWeeks) {
    // Conservative estimate: 1 week = 2 seconds of processing
    const seconds = missingWeeks * 2
    if (seconds < 60) return `${seconds} seconds`
    if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`
    return `${Math.round(seconds / 3600)} hours`
  }

  findPeriodGaps(periodData, startDate, endDate) {
    const gaps = []
    const expectedWeeks = Math.ceil((endDate - startDate) / (7 * 24 * 60 * 60 * 1000))
    
    if (periodData.length < expectedWeeks) {
      gaps.push({
        duration: expectedWeeks - periodData.length,
        type: 'MISSING_WEEKS'
      })
    }

    return gaps
  }

  createErrorAnalysis(resource, error) {
    return {
      resource: {
        id: resource.id,
        name: resource.name,
        type: resource.type
      },
      timestamp: new Date().toISOString(),
      error: true,
      errorMessage: error.message,
      overallQuality: { score: 0, level: 'ERROR' },
      recommendations: [{
        type: 'ERROR',
        category: 'SYSTEM',
        message: `Failed to analyze ${resource.name}`,
        action: 'CHECK_LOGS',
        priority: 'HIGH',
        details: error.message
      }]
    }
  }

  /**
   * Bulk analysis for multiple resources
   * @param {Array} resources - Array of resource objects
   * @param {Object} allWeeklyData - Keyed weekly data by resource
   * @returns {Array} Array of analysis results
   */
  async analyzeBulkGaps(resources, allWeeklyData) {
    logger.log(`Starting bulk gap analysis for ${resources.length} resources...`)
    
    const results = []
    const batchSize = 10

    for (let i = 0; i < resources.length; i += batchSize) {
      const batch = resources.slice(i, i + batchSize)
      
      const batchPromises = batch.map(resource => {
        const weeklyData = allWeeklyData[resource.id] || allWeeklyData[resource.name] || []
        return Promise.resolve(this.analyzeResourceGaps(resource, weeklyData))
      })

      const batchResults = await Promise.allSettled(batchPromises)
      const validResults = batchResults
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value)

      results.push(...validResults)

      // Small delay between batches
      if (i + batchSize < resources.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    logger.log(`Bulk gap analysis complete: ${results.length} resources analyzed`)
    return results
  }

  /**
   * Clear analysis cache
   */
  clearCache() {
    this.analysisCache.clear()
    logger.log('Gap analysis cache cleared')
  }
}

// Export singleton instance
export const gapAnalysisService = new GapAnalysisService()
export default gapAnalysisService