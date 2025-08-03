import logger from './logger-frontend'
import { getPeriodConfig } from './chartDataUtils'

/**
 * Simple utility to extract individual resource data from DevelopmentActivityWidget's rawChartData
 * Uses the same data structure that powers the widget's tooltip functionality
 */
export class WidgetDataExtractor {
  
  /**
   * Extract individual resource data from widget cache rawChartData
   * @param {Object} widgetCacheData - Cached data from DevelopmentActivityWidget
   * @param {Object} targetResource - Resource object with id and name
   * @param {string} selectedPeriod - Period key (e.g., 'current', '4weeks')
   * @returns {Object|null} Extracted resource data or null if not found
   */
  static extractResourceData(widgetCacheData, targetResource, selectedPeriod) {
    try {
      if (!widgetCacheData || !targetResource || !selectedPeriod) {
        return null
      }

      // Get period configuration to determine data source
      const config = getPeriodConfig(selectedPeriod)
      const isDaily = config.isDaily

      // Select appropriate rawChartData array based on period type (same as widget logic)
      const rawChartData = isDaily 
        ? (widgetCacheData.dailyChartData || [])
        : (widgetCacheData.weeklyChartData || [])

      logger.log(`WidgetDataExtractor: Period=${selectedPeriod}, isDaily=${isDaily}, rawChartData.length=${rawChartData.length}`)

      if (!Array.isArray(rawChartData) || rawChartData.length === 0) {
        logger.warn(`WidgetDataExtractor: No rawChartData available for ${selectedPeriod} (isDaily: ${isDaily}) - cache exists but data is empty`)
        return null
      }

      // Find the target resource in rawChartData (same logic as contributingResources)
      const resourceMatch = rawChartData.find(resourceData => {
        const resource = resourceData.resource
        if (!resource) return false
        
        // Match by ID first (most reliable)
        if (targetResource.id && resource.id) {
          return resource.id === targetResource.id || 
                 resource.id === targetResource.id.toString() ||
                 resource.id === parseInt(targetResource.id)
        }
        
        // Fallback to name matching
        if (targetResource.name && resource.name) {
          return resource.name.toLowerCase() === targetResource.name.toLowerCase()
        }
        
        return false
      })

      if (!resourceMatch) {
        logger.warn(`WidgetDataExtractor: Resource ${targetResource.name} (ID: ${targetResource.id}) not found in rawChartData`)
        logger.log(`WidgetDataExtractor: Available resources: ${rawChartData.map(r => r.resource?.name || 'unnamed').join(', ')}`)
        return null
      }

      // Extract time-series data using the same pattern as contributingResources
      const timeSeriesCounts = isDaily 
        ? (resourceMatch.dailyCounts || [])
        : (resourceMatch.weeklyCounts || [])

      if (!Array.isArray(timeSeriesCounts) || timeSeriesCounts.length === 0) {
        return null
      }

      // Transform to commitsPerWeekDetailed format expected by WeeklyActivityChart
      const commitsPerWeekDetailed = this._transformToWeeklyFormat(timeSeriesCounts, isDaily)

      if (!commitsPerWeekDetailed || commitsPerWeekDetailed.length === 0) {
        return null
      }

      // Build extracted data in expected format
      const extractedData = {
        commitsPerWeekDetailed: commitsPerWeekDetailed,
        repoInfo: resourceMatch.resource.repoInfo || null,
        historicalMaximums: resourceMatch.historicalMaximums || {},
        historicalMetadata: resourceMatch.historicalMetadata || { hasHistoricalData: false, dataQuality: 'widget-extracted' }
      }

      logger.log(`WidgetDataExtractor: Successfully extracted ${commitsPerWeekDetailed.length} data points for ${targetResource.name}`)
      
      return extractedData

    } catch (error) {
      logger.error('WidgetDataExtractor: Error during extraction:', error)
      return null
    }
  }

  /**
   * Transform dailyCounts/weeklyCounts array to commitsPerWeekDetailed format
   * @private
   */
  static _transformToWeeklyFormat(countsArray, isDaily) {
    const result = []
    const today = new Date()

    countsArray.forEach((count, index) => {
      let weekStart
      
      if (isDaily) {
        // For daily data, calculate day date (going backwards from today)
        const dayDate = new Date(today)
        dayDate.setDate(today.getDate() - (countsArray.length - 1 - index))
        weekStart = dayDate.toISOString().slice(0, 10)
      } else {
        // For weekly data, calculate week start date
        const weeksBack = countsArray.length - 1 - index
        const weekDate = new Date(today.getTime() - weeksBack * 7 * 24 * 60 * 60 * 1000)
        
        // Adjust to week start (Monday = 0)
        const dayOfWeek = weekDate.getDay()
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1
        weekDate.setDate(weekDate.getDate() - daysToSubtract)
        
        weekStart = weekDate.toISOString().slice(0, 10)
      }

      result.push({
        count: Math.max(0, count || 0),
        weekStart: weekStart
      })
    })

    return result
  }
}

export default WidgetDataExtractor