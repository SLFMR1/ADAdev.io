import { getWeekStart, getCurrentWeekStart } from './weekCalculation'
import logger from './logger-frontend'

/**
 * Centralized chart data utilities
 * Single source of truth for all chart period configurations and data transformations
 */

// Centralized period configurations - single source of truth
export const PERIOD_CONFIGS = {
  current: {
    key: 'current',
    label: 'Last 7 Days',
    weeks: 1, // 7 days = 1 week period
    isDaily: true,
    serverPeriod: 'current',
    useHybridData: true, // Only period that uses DB + GitHub API
    cacheTTL: 2 * 60 * 60 * 1000 // 2 hours for hybrid data
  },
  '4weeks': {
    key: '4weeks',
    label: 'Last 4 Weeks',
    weeks: 4, // ResourceCard wants 4 weeks displayed
    isDaily: false,
    serverPeriod: '5weeks', // Maps to server's 5weeks endpoint
    useHybridData: false, // Database only
    cacheTTL: 24 * 60 * 60 * 1000 // 24 hours
  },
  '5weeks': {
    key: '5weeks',
    label: 'Last 4 Weeks',
    weeks: 4, // Server sends 5 weeks, display 4 (excludes current)
    isDaily: false,
    serverPeriod: '5weeks',
    useHybridData: false, // Database only
    cacheTTL: 24 * 60 * 60 * 1000 // 24 hours
  },
  '3months': {
    key: '3months',
    label: 'Last 3 Months',
    weeks: 13,
    isDaily: false,
    serverPeriod: '3months',
    useHybridData: false, // Database only
    cacheTTL: 7 * 24 * 60 * 60 * 1000 // 7 days for historical data
  },
  '52weeks': {
    key: '52weeks',
    label: 'Last 12 Months',
    weeks: 52,
    isDaily: false,
    serverPeriod: '52weeks',
    useHybridData: false, // Database only
    cacheTTL: 7 * 24 * 60 * 60 * 1000 // 7 days for historical data
  },
  '3years': {
    key: '3years',
    label: 'Last 3 Years',
    weeks: 156,
    isDaily: false,
    serverPeriod: '3years',
    useHybridData: false, // Database only
    cacheTTL: 14 * 24 * 60 * 60 * 1000 // 14 days for very historical data
  }
}

// Period options for dropdowns
export const PERIOD_OPTIONS = [
  { key: 'current', label: 'Last 7 Days', weeks: 1 },
  { key: '5weeks', label: 'Last 4 Weeks', weeks: 4 },
  { key: '3months', label: 'Last 3 Months', weeks: 13 },
  { key: '52weeks', label: 'Last 12 Months', weeks: 52 },
  { key: '3years', label: 'Last 3 Years', weeks: 156 }
]

// ResourceCard specific period options (subset)
export const RESOURCE_CARD_PERIOD_OPTIONS = [
  { key: '4weeks', label: 'Last 4 Weeks' }, // Maps to 5weeks server period
  { key: '3months', label: 'Last 3 Months' },
  { key: '52weeks', label: 'Last 1 Year' },
  { key: '3years', label: 'Last 3 Years' }
]

// Period mapping for ResourceCard (client → server)
export const RESOURCE_CARD_PERIOD_MAPPING = {
  '4weeks': '5weeks', // Client shows 4 weeks, server sends 5 weeks data
  '3months': '3months',
  '52weeks': '52weeks',
  '3years': '3years'
}

/**
 * Get period configuration by key
 * @param {string} periodKey - Period key
 * @returns {Object} Period configuration
 */
export const getPeriodConfig = (periodKey) => {
  return PERIOD_CONFIGS[periodKey] || PERIOD_CONFIGS.current
}

/**
 * Validate that chart data has the correct number of nodes for the period
 * @param {Array} chartData - Chart data array
 * @param {string} periodKey - Period key
 * @param {string} componentName - Component name for logging
 * @returns {boolean} True if node count is correct
 */
export const validateNodeCount = (chartData, periodKey, componentName = 'Chart') => {
  if (!chartData || !Array.isArray(chartData)) {
    logger.warn(`${componentName}: Invalid chart data`)
    return false
  }

  const config = getPeriodConfig(periodKey)
  const expectedNodes = config.isDaily ? 7 : config.weeks
  const actualNodes = chartData.length

  if (actualNodes !== expectedNodes) {
    logger.warn(`${componentName}: Node count mismatch for ${periodKey}. Expected: ${expectedNodes}, Actual: ${actualNodes}`)
    return false
  }

  logger.log(`${componentName}: ✓ Node count correct for ${periodKey}: ${actualNodes} nodes`)
  return true
}

/**
 * Check if current week should be excluded based on period type
 * @param {string} periodKey - Period key
 * @returns {boolean} True if current week should be excluded
 */
export const shouldExcludeCurrentWeek = (periodKey) => {
  const config = getPeriodConfig(periodKey)
  // Only daily (7-day) period includes current incomplete data
  return !config.isDaily
}

/**
 * Unified data transformation for all chart components
 * Ensures 1 week = 1 node for weekly periods, 1 day = 1 node for daily periods
 * @param {Array} rawData - Raw data from API
 * @param {string} periodKey - Period key
 * @param {string} componentName - Component name for logging
 * @returns {Array} Transformed chart data with correct node count
 */
export const transformChartData = (rawData, periodKey, componentName = 'Chart') => {
  if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
    logger.warn(`${componentName}: No data to transform for ${periodKey}`)
    return []
  }

  const config = getPeriodConfig(periodKey)
  logger.log(`${componentName}: Transforming ${rawData.length} data points for ${periodKey}`)

  if (config.isDaily) {
    // Daily period - transform to daily data points
    return transformDailyData(rawData, componentName)
  } else {
    // Weekly periods - transform to weekly data points
    return transformWeeklyData(rawData, periodKey, componentName)
  }
}

/**
 * Transform data for daily (7-day) period
 * @param {Array} rawData - Raw data with dailyCounts
 * @param {string} componentName - Component name for logging
 * @returns {Array} Daily chart data (7 nodes)
 */
const transformDailyData = (rawData, componentName) => {
  const aggregatedData = []
  const maxDays = Math.max(...rawData.map(item => item.dailyCounts?.length || 0))
  const today = new Date()
  
  // Ensure we get exactly 7 days
  const daysToShow = Math.min(maxDays, 7)
  
  for (let day = 0; day < daysToShow; day++) {
    const totalCount = rawData.reduce((sum, item) => sum + (item.dailyCounts?.[day] || 0), 0)
    
    // Calculate correct date for each day (going backwards from today)
    const dayDate = new Date(today)
    dayDate.setDate(today.getDate() - (daysToShow - 1 - day))
    
    aggregatedData.push({
      count: totalCount,
      weekStart: dayDate.toISOString().slice(0, 10)
    })
  }
  
  // Validate we have exactly 7 nodes
  if (aggregatedData.length !== 7) {
    logger.warn(`${componentName}: Daily data should have 7 nodes, got ${aggregatedData.length}`)
  }
  
  return aggregatedData
}

/**
 * Transform data for weekly periods
 * @param {Array} rawData - Raw data with weeklyData
 * @param {string} periodKey - Period key
 * @param {string} componentName - Component name for logging
 * @returns {Array} Weekly chart data with correct node count
 */
const transformWeeklyData = (rawData, periodKey, componentName) => {
  const config = getPeriodConfig(periodKey)
  const aggregatedData = []
  
  // Get all unique weekStart dates from database
  const allWeekStartsSet = new Set()
  
  rawData.forEach(item => {
    if (item.weeklyData && Array.isArray(item.weeklyData)) {
      item.weeklyData.forEach(weekData => {
        if (weekData && weekData.weekStart) {
          allWeekStartsSet.add(weekData.weekStart)
        }
      })
    }
  })
  
  // Convert to sorted array (chronological order)
  const allWeekStarts = Array.from(allWeekStartsSet).sort()
  
  if (allWeekStarts.length === 0) {
    logger.warn(`${componentName}: No valid week starts found in data for ${periodKey}`)
    return []
  }
  
  // Filter out current incomplete week for non-daily periods only
  const currentWeekStart = getCurrentWeekStart()
  const currentWeekKey = currentWeekStart.toISOString().slice(0, 10)
  
  // Only exclude current week for non-daily periods (4weeks, 3months, 52weeks, 3years)
  const shouldExcludeCurrentWeekForPeriod = shouldExcludeCurrentWeek(periodKey)
  const completedWeeks = shouldExcludeCurrentWeekForPeriod 
    ? allWeekStarts.filter(weekStart => weekStart !== currentWeekKey)
    : allWeekStarts
  
  // Take exactly the number of weeks expected for this period
  const weeksToUse = completedWeeks.slice(-config.weeks)
  
  // Generate chart data ensuring continuous sequence (current week included/excluded based on period type)
  weeksToUse.forEach(weekStart => {
    let totalCount = 0
    
    // Sum commits for this specific week across all resources
    rawData.forEach(item => {
      if (item.weeklyData && Array.isArray(item.weeklyData)) {
        const weekData = item.weeklyData.find(w => w.weekStart === weekStart)
        if (weekData && typeof weekData.count === 'number') {
          totalCount += weekData.count
        }
      }
    })
    
    aggregatedData.push({
      count: totalCount,
      weekStart: weekStart
    })
  })
  
  // Validate node count
  validateNodeCount(aggregatedData, periodKey, componentName)
  
  logger.log(`${componentName}: ✓ Transformed weekly data for ${periodKey}: ${aggregatedData.length} weeks ${shouldExcludeCurrentWeekForPeriod ? '(current week excluded)' : '(current week included)'}`)
  return aggregatedData
}

/**
 * Generate line chart points for SVG polyline
 * Centralized function used by all chart components
 * @param {Array} data - Chart data array
 * @param {number} width - Chart width
 * @param {number} height - Chart height
 * @param {number} padding - Left padding
 * @param {number} rightPadding - Right padding
 * @returns {string} SVG points string
 */
export const generateChartPoints = (data, width, height, padding = 40, rightPadding = 30) => {
  if (!data || data.length === 0) return ''
  
  // Ensure we have valid data
  const validData = data.filter(item => item && typeof item.count === 'number' && !isNaN(item.count))
  if (validData.length === 0) return ''
  
  const max = Math.max(...validData.map(item => item.count), 1)
  const stepX = validData.length > 1 ? (width - padding - rightPadding) / (validData.length - 1) : 0
  
  return validData.map((item, i) => {
    const x = padding + i * stepX
    const y = height - padding - (item.count / max) * (height - 2 * padding)
    return `${x},${y}`
  }).join(' ')
}

/**
 * Get cache TTL for a period
 * @param {string} periodKey - Period key
 * @returns {number} Cache TTL in milliseconds
 */
export const getCacheTTL = (periodKey) => {
  const config = getPeriodConfig(periodKey)
  return config.cacheTTL
}

/**
 * Check if a period uses hybrid data (DB + GitHub API)
 * @param {string} periodKey - Period key
 * @returns {boolean} True if period uses hybrid data
 */
export const usesHybridData = (periodKey) => {
  const config = getPeriodConfig(periodKey)
  return config.useHybridData
}

/**
 * Get server period key for API calls
 * @param {string} clientPeriod - Client period key
 * @returns {string} Server period key
 */
export const getServerPeriod = (clientPeriod) => {
  const config = getPeriodConfig(clientPeriod)
  return config.serverPeriod
}