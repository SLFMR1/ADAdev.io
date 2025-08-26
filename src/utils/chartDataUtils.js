import { getWeekStart, getCurrentWeekStart, isCurrentWeek } from './weekCalculation'
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
    cacheTTL: 30 * 60 * 1000 // 30 minutes for current data (real-time updates)
  },
  '4weeks': {
    key: '4weeks',
    label: 'Last 4 Weeks',
    weeks: 4, // ResourceCard wants 4 weeks displayed
    isDaily: false,
    serverPeriod: '5weeks', // Maps to server's 5weeks endpoint
    useHybridData: false, // Database only
    cacheTTL: 30 * 24 * 60 * 60 * 1000 // 30 days for immutable weekly data
  },
  '5weeks': {
    key: '5weeks',
    label: 'Last 4 Weeks',
    weeks: 4, // Server sends 5 weeks, display 4 (excludes current)
    isDaily: false,
    serverPeriod: '5weeks',
    useHybridData: false, // Database only
    cacheTTL: 30 * 24 * 60 * 60 * 1000 // 30 days for immutable weekly data
  },
  '3months': {
    key: '3months',
    label: 'Last 3 Months',
    weeks: 13,
    isDaily: false,
    serverPeriod: '3months',
    useHybridData: false, // Database only
    cacheTTL: 90 * 24 * 60 * 60 * 1000 // 90 days for immutable historical data
  },
  '52weeks': {
    key: '52weeks',
    label: 'Last 12 Months',
    weeks: 52,
    isDaily: false,
    serverPeriod: '52weeks',
    useHybridData: false, // Database only
    cacheTTL: 180 * 24 * 60 * 60 * 1000 // 180 days for immutable historical data
  },
  '3years': {
    key: '3years',
    label: 'Last 3 Years',
    weeks: 156,
    isDaily: false,
    serverPeriod: '3years',
    useHybridData: false, // Database only
    cacheTTL: 365 * 24 * 60 * 60 * 1000 // 365 days for immutable historical data
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
  { key: 'current', label: 'Last 7 Days' }, // Add 7-day option for single resources
  { key: '4weeks', label: 'Last 4 Weeks' }, // Maps to 5weeks server period
  { key: '3months', label: 'Last 3 Months' },
  { key: '52weeks', label: 'Last 1 Year' },
  { key: '3years', label: 'Last 3 Years' }
]

// Period mapping for ResourceCard (client → server)
export const RESOURCE_CARD_PERIOD_MAPPING = {
  'current': 'current', // Direct mapping for 7-day period
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
  
  // Check if we have dailyCounts (DevelopmentActivityWidget format) or weeklyData (WeeklyActivityChart format)
  const hasDailyCounts = rawData.some(item => item.dailyCounts && Array.isArray(item.dailyCounts))
  const hasWeeklyData = rawData.some(item => item.weeklyData && Array.isArray(item.weeklyData))
  
  if (hasDailyCounts) {
    // DevelopmentActivityWidget format - use dailyCounts
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
  } else if (hasWeeklyData) {
    // WeeklyActivityChart format - use weeklyData (which contains daily data for 'current' period)
    const maxDays = Math.max(...rawData.map(item => item.weeklyData?.length || 0))
    
    // Ensure we get exactly 7 days
    const daysToShow = Math.min(maxDays, 7)
    
    for (let day = 0; day < daysToShow; day++) {
      const totalCount = rawData.reduce((sum, item) => {
        const dayData = item.weeklyData?.[day]
        return sum + (dayData?.count || 0)
      }, 0)
      
      // Use the weekStart from the first item's data (they should all have the same dates)
      const firstItem = rawData.find(item => item.weeklyData?.[day])
      const weekStart = firstItem?.weeklyData?.[day]?.weekStart
      
      aggregatedData.push({
        count: totalCount,
        weekStart: weekStart || new Date().toISOString().slice(0, 10)
      })
    }
  } else {
    logger.warn(`${componentName}: No valid daily data structure found`)
    return []
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
  
  // **FIX**: Aggregate all data into a map FIRST to ensure consistent counts.
  const aggregatedCommitMap = new Map()
  rawData.forEach(item => {
    if (item.weeklyData && Array.isArray(item.weeklyData)) {
      item.weeklyData.forEach(weekData => {
        if (weekData && weekData.weekStart && typeof weekData.count === 'number') {
          const currentCount = aggregatedCommitMap.get(weekData.weekStart) || 0
          aggregatedCommitMap.set(weekData.weekStart, currentCount + weekData.count)
        }
      })
    }
  })

  // Convert map to a sorted array of unique weeks.
  const allAggregatedWeeks = Array.from(aggregatedCommitMap.entries())
    .map(([weekStart, count]) => ({ weekStart, count }))
    .sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart))

  if (allAggregatedWeeks.length === 0) {
    logger.warn(`${componentName}: No valid week starts found in data for ${periodKey}`)
    return []
  }

  // **FIX**: Perform filtering and slicing on the fully aggregated data.
  const allWeekStarts = allAggregatedWeeks.map(w => w.weekStart)

  // Filter out current incomplete week for non-daily periods only.
  const shouldExcludeCurrentWeekForPeriod = shouldExcludeCurrentWeek(periodKey)
  let completedWeeksData = allAggregatedWeeks
  if (shouldExcludeCurrentWeekForPeriod) {
    completedWeeksData = allAggregatedWeeks.filter(week => !isCurrentWeek(`${week.weekStart}T00:00:00`))
  }

  // Prioritize most recent weeks.
  const availableWeeks = completedWeeksData.length
  const requestedWeeks = config.weeks
  const weeksToUse = availableWeeks >= requestedWeeks
    ? completedWeeksData.slice(-requestedWeeks) // Slice the correct number of weeks from the end.
    : completedWeeksData // Use all available data if less than requested.
  
  // Log data completeness for debugging.
  if (weeksToUse.length < config.weeks) {
    logger.warn(`${componentName}: Incomplete data for ${periodKey} - expected ${config.weeks} weeks, got ${weeksToUse.length} weeks`);
  }
  
  // The data is already aggregated, so we can just return it.
  const finalChartData = weeksToUse;

  // Validate node count.
  validateNodeCount(finalChartData, periodKey, componentName)
  
  logger.log(`${componentName}: ✓ Transformed weekly data for ${periodKey}: ${finalChartData.length} weeks ${shouldExcludeCurrentWeekForPeriod ? '(current week excluded)' : '(current week included)'}`)
  return finalChartData
}

/**
 * Generate line chart points for SVG polyline
 * Uses linear scale: each data point gets fixed position based on array index
 * @param {Array} data - Chart data array
 * @param {number} width - Chart width
 * @param {number} height - Chart height
 * @param {number} padding - Left padding
 * @param {number} rightPadding - Right padding
 * @param {string} period - Period key for scaling adjustments
 * @returns {string} SVG points string
 */
export const generateChartPoints = (data, width, height, padding = 40, rightPadding = 30, period = null) => {
  if (!data || data.length === 0) return ''
  
  // Ensure we have valid data
  const validData = data.filter(item => item && typeof item.count === 'number' && !isNaN(item.count))
  if (validData.length === 0) return ''
  
  const max = Math.max(...validData.map(item => item.count), 1)
  
  // Adjust padding based on period
  let effectivePadding = padding
  let effectiveRightPadding = rightPadding
  
  if (period === 'current' && validData.length === 7) {
    // 7-day chart: use minimal padding for maximum width utilization
    effectivePadding = Math.max(20, padding * 0.6)
    effectiveRightPadding = Math.max(15, rightPadding * 0.6)
  } else if (period === '3years' && validData.length > 100) {
    // 3-year chart: slightly more padding for readability
    effectivePadding = padding * 1.2
    effectiveRightPadding = rightPadding * 1.2
  }
  
  // Linear scale: each data point gets fixed position based on array index
  const availableWidth = width - effectivePadding - effectiveRightPadding
  
  // For single point, center it
  if (validData.length === 1) {
    const x = effectivePadding + availableWidth / 2
    const y = height - effectivePadding - (validData[0].count / max) * (height - 2 * effectivePadding)
    return `${x},${y}`
  }
  
  // Linear spacing: each position is exactly the same distance apart
  const stepX = availableWidth / (validData.length - 1)
  
  return validData.map((item, i) => {
    // Fixed linear position based on array index
    const x = effectivePadding + i * stepX
    const y = height - effectivePadding - (item.count / max) * (height - 2 * effectivePadding)
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

/**
 * Generates smart x-axis labels for charts based on the selected period.
 * @param {Array} data - The chart data array, containing objects with a `weekStart` property.
 * @param {string} period - The selected time period (e.g., 'current', '5weeks', '3months').
 * @returns {Array} An array of label objects with properties { x, text, priority, ... } to be rendered.
 */
export const generateChartXAxisLabels = (data, period) => {
  if (!data || data.length === 0) {
    return [];
  }

  const labels = [];
  
  let lastMonth = -1;
  let lastYear = -1;

  data.forEach((d, i) => {
    const date = new Date(d.weekStart);
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    const prevDate = i > 0 ? new Date(data[i - 1].weekStart) : null;
    if(prevDate) {
      prevDate.setMinutes(prevDate.getMinutes() + prevDate.getTimezoneOffset());
    }

    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();

    let label = null;

    switch (period) {
      case 'current': // 7 days
        if (i === 0 || date.getDate() === 1) {
            label = { text: month, priority: 2, type: 'month' };
        } else {
            label = { text: date.toLocaleString('default', { weekday: 'short' }), priority: 1, type: 'day' };
        }
        break;
      
      case '4weeks':
      case '5weeks': // 4 weeks
        const weekEndDate = new Date(date);
        weekEndDate.setDate(date.getDate() + 6);
        if (i === 0 || (prevDate && date.getMonth() !== prevDate.getMonth())) {
          label = { text: month, priority: 2, type: 'month' };
        } else {
          label = { text: weekEndDate.getDate().toString(), priority: 1, type: 'date' };
        }
        break;

      case '3months':
        if (date.getMonth() !== lastMonth) {
          label = { text: month, priority: 2, type: 'month' };
          lastMonth = date.getMonth();
        }
        break;

      case '52weeks': // 12 months
        // Check if this week spans into a new year (week end date crosses Jan 1st)
        const weekEnd52 = new Date(date);
        weekEnd52.setDate(date.getDate() + 6);
        const weekEndYear = weekEnd52.getFullYear();
        
        if (weekEndYear !== lastYear) {
          label = { text: weekEndYear.toString(), priority: 2, type: 'year' };
          lastYear = weekEndYear;
          lastMonth = -1; // Reset month tracking on year change
        }
        if (!label && date.getMonth() !== lastMonth) {
          label = { text: month, priority: 1, type: 'month' };
          lastMonth = date.getMonth();
        }
        break;

      case '3years':
        // Check if this week spans into a new year (week end date crosses Jan 1st)
        const weekEnd3y = new Date(date);
        weekEnd3y.setDate(date.getDate() + 6);
        const weekEndYear3y = weekEnd3y.getFullYear();
        
        if (weekEndYear3y !== lastYear) {
          label = { text: weekEndYear3y.toString(), priority: 2, type: 'year' };
          lastYear = weekEndYear3y;
          lastMonth = -1; // Reset month tracking
        }
        if (!label && date.getMonth() === 6 && lastMonth !== 6) {
          label = { text: 'Jul', priority: 1, type: 'month' };
          lastMonth = 6;
        }
        break;
        
      default:
        break;
    }

    if (label) {
      labels.push({ ...label, index: i });
    }
  });

  return labels;
};