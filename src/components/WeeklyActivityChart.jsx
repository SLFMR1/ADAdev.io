import React, { useState, useEffect } from 'react'
import { fetchGitHubUpdates } from '../services/github'
import { TrendingUp, Calendar, GitCommit } from 'lucide-react'
import logger from '../utils/logger-frontend'
import Portal from './Portal'
import { getWeekStart, getCurrentWeekStart } from '../utils/weekCalculation'
import { 
  RESOURCE_CARD_PERIOD_MAPPING,
  getPeriodConfig,
  validateNodeCount,
  getCacheTTL,
  usesHybridData,
  getServerPeriod,
  transformChartData
} from '../utils/chartDataUtils'
import { ChartDataCache } from '../utils/cacheUtils'

// Removed Supabase client initialization - using server API instead

// Use centralized chart point generation - removed duplicate function

// NOTE: Synthetic data generation functions removed - using only accurate hybrid data

const WeeklyActivityChart = ({ resource, showThreeYearOption = true, hidePeriodSwitches = false, hideActivityLevelInfo = false, selectedPeriod = '3months', onPeriodChange, preloadedData = null, accentColor = { hex: '#FFFFFF', rgb: '255, 255, 255' } }) => {
  const [activityData, setActivityData] = useState(null)
  const [weeklyData, setWeeklyData] = useState([])
  const [historicalMaximums, setHistoricalMaximums] = useState({})
  const [historicalMetadata, setHistoricalMetadata] = useState({ hasHistoricalData: false, dataQuality: 'fallback' })
  // Smart loading state - don't show loading if we have preloaded data
  const [isLoading, setIsLoading] = useState(() => {
    return !preloadedData || preloadedData.error
  })
  const [error, setError] = useState(null)
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, value: 0, label: '' })
  // Use centralized period configuration - removed duplicate mapping
  
  // Use selectedPeriod directly instead of internal timePeriod state
  // const timePeriod = selectedPeriod // Not needed anymore

  useEffect(() => {
    const loadActivityData = async () => {
      try {
        setError(null)
        
        // If preloaded data is available for this period, use it immediately
        if (preloadedData && !preloadedData.error) {
          logger.log(`⚡ Using preloaded data for ${resource.name} (period: ${selectedPeriod})`)
          console.log('WeeklyActivityChart received preloaded data:', preloadedData)
          // Use preloaded data immediately without loading state
          
          // Process preloaded data the same way as fetched data
          const resourceData = preloadedData
          
          // Validate and process the preloaded data
          if (resourceData && resourceData.commitsPerWeekDetailed && Array.isArray(resourceData.commitsPerWeekDetailed) && resourceData.commitsPerWeekDetailed.length > 0) {
            // Use the detailed weekly data from preloaded cache
            const validWeeklyData = resourceData.commitsPerWeekDetailed
              .filter(week => {
                if (!week || typeof week !== 'object') return false;
                if (typeof week.count !== 'number' || isNaN(week.count)) return false;
                if (!week.weekStart) return false;
                
                const weekStartDate = new Date(week.weekStart);
                if (isNaN(weekStartDate.getTime())) {
                  console.warn(`Invalid weekStart date: ${week.weekStart}`);
                  return false;
                }
                
                return true;
              })
              .map(week => {
                const weekStartDate = new Date(week.weekStart);
                return {
                  count: Math.max(0, week.count),
                  weekStart: weekStartDate.toISOString().slice(0, 10)
                };
              })
            
            if (validWeeklyData.length === 0) {
              console.warn(`No valid preloaded weekly data found for ${resource.name}`);
              throw new Error('No valid weekly data available');
            }
            
            const currentWeek = validWeeklyData[validWeeklyData.length - 1]?.count || 0
            
            setActivityData({
              currentWeek: currentWeek,
              repoInfo: resourceData.repoInfo
            })
            setHistoricalMaximums(resourceData.historicalMaximums || {})
            setHistoricalMetadata(resourceData.historicalMetadata || { hasHistoricalData: false, dataQuality: 'fallback' })
            
            // Apply current week filtering and process data using centralized logic
            const filteredData = transformChartData([{ weeklyData: validWeeklyData }], selectedPeriod, `WeeklyActivityChart-${resource.name}-preloaded`)
            setWeeklyData(filteredData)
            
            setIsLoading(false)
            return
          } else {
            logger.warn(`Preloaded data for ${resource.name} lacks commitsPerWeekDetailed - skipping preloaded data`);
          }
        }
        
        // Fallback to fetching data if no preloaded data or preloaded data has error
        if (preloadedData?.error) {
          logger.warn(`Preloaded data has error for ${resource.name}: ${preloadedData.error}`);
        }
        
        // Only set loading state when making API calls
        setIsLoading(true)
        
        // Use centralized period configuration
        const config = getPeriodConfig(selectedPeriod)
        const expectedWeeks = config.weeks
        
        // Check if this period should use GitHub API (only 7-day period)
        if (usesHybridData(selectedPeriod)) {
          logger.log(`🔄 Fetching hybrid data for ${resource.name} (period: ${selectedPeriod})`)
          // This is the 7-day period that uses GitHub API + DB
        } else {
          logger.log(`🔄 Fetching database-only data for ${resource.name} (period: ${selectedPeriod})`)
        }
        
        const serverPeriod = getServerPeriod(selectedPeriod)
        
        // Use the proven server API with resource-specific parameters
        const params = new URLSearchParams({
          resourceId: resource.id?.toString() || resource.name,
          resourceName: resource.name,
          period: serverPeriod
        })
        
        const response = await fetch(`/api/development-activity?${params}`)
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}: ${response.statusText}`)
        }
        
        const serverData = await response.json()
        
        // Transform server response to expected format
        const resourceData = {
          commitsPerWeekDetailed: serverData.weeklyData || [],
          commitsPerWeek: serverData.commitsPerWeek || 0,
          repoInfo: serverData.repoInfo || null,
          dataSources: serverData.dataSources || { database: true, github: false },
          historicalMaximums: serverData.historicalMaximums || {},
          historicalMetadata: serverData.historicalMetadata || { hasHistoricalData: false, dataQuality: 'fallback' }
        }
        
        // Cache the data using centralized cache
        ChartDataCache.set('resource', selectedPeriod, resourceData, resource.id)
        
        logger.log(`✅ Server API data received - sources:`, resourceData.dataSources)
        
        // Validate node count for the period
        if (resourceData.commitsPerWeekDetailed) {
          validateNodeCount(resourceData.commitsPerWeekDetailed, selectedPeriod, `WeeklyActivityChart-${resource.name}`)
        }
        
        // Validate and process the response data
        if (resourceData && resourceData.commitsPerWeekDetailed && Array.isArray(resourceData.commitsPerWeekDetailed) && resourceData.commitsPerWeekDetailed.length > 0) {
          // Use the detailed weekly data from server with enhanced validation
          const validWeeklyData = resourceData.commitsPerWeekDetailed
            .filter(week => {
              // Enhanced validation
              if (!week || typeof week !== 'object') return false;
              if (typeof week.count !== 'number' || isNaN(week.count)) return false;
              if (!week.weekStart) return false;
              
              // Validate date format
              const weekStartDate = new Date(week.weekStart);
              if (isNaN(weekStartDate.getTime())) {
                console.warn(`Invalid weekStart date: ${week.weekStart}`);
                return false;
              }
              
              return true;
            })
            .map(week => {
              // Sanitize and format data
              const weekStartDate = new Date(week.weekStart);
              return {
                count: Math.max(0, week.count),
                weekStart: weekStartDate.toISOString().slice(0, 10)
              };
            })
          
          if (validWeeklyData.length === 0) {
            console.warn(`No valid weekly data found for ${resource.name}`);
            throw new Error('No valid weekly data available');
          }
          
          const currentWeek = validWeeklyData[validWeeklyData.length - 1]?.count || 0
          
          setActivityData({
            currentWeek: currentWeek,
            repoInfo: resourceData.repoInfo
          })
          setHistoricalMaximums(resourceData.historicalMaximums || {})
          setHistoricalMetadata(resourceData.historicalMetadata || { hasHistoricalData: false, dataQuality: 'fallback' })
          
          // Apply current week filtering and trim to requested period using centralized logic
          const filteredData = transformChartData([{ weeklyData: validWeeklyData }], selectedPeriod, `WeeklyActivityChart-${resource.name}`)
          setWeeklyData(filteredData)
          
          // Validate final node count
          validateNodeCount(filteredData, selectedPeriod, `WeeklyActivityChart-${resource.name}`)
        } else {
          // No valid weekly data available - throw error instead of showing synthetic data
          throw new Error('No accurate weekly data available')
        }
      } catch (error) {
        logger.error(`Error loading activity data for ${resource.name}:`, error)
        setError(error.message)
        
        // Set minimal data on error (no synthetic data)
        setActivityData({
          currentWeek: 0,
          repoInfo: null
        })
        setWeeklyData([])
        setHistoricalMaximums({})
        setHistoricalMetadata({ hasHistoricalData: false, dataQuality: 'fallback' })
      } finally {
        setIsLoading(false)
      }
    }
    loadActivityData()
  }, [resource, selectedPeriod, preloadedData])
  
  // Add cache check at component mount
  useEffect(() => {
    const cachedData = ChartDataCache.get('resource', selectedPeriod, resource.id)
    if (cachedData && !preloadedData) {
      logger.log(`⚡ Using cached data for ${resource.name}`)
      // Process cached data same as API response
      if (cachedData.commitsPerWeekDetailed && Array.isArray(cachedData.commitsPerWeekDetailed)) {
        // Apply current week filtering and trim to requested period using centralized logic
        const filteredData = transformChartData([{ weeklyData: cachedData.commitsPerWeekDetailed }], selectedPeriod, `WeeklyActivityChart-${resource.name}-cached`)
        
        setActivityData({
          currentWeek: filteredData[filteredData.length - 1]?.count || 0,
          repoInfo: cachedData.repoInfo
        })
        setWeeklyData(filteredData)
        setHistoricalMaximums(cachedData.historicalMaximums || {})
        setHistoricalMetadata(cachedData.historicalMetadata || {})
        setIsLoading(false)
      }
    }
  }, [resource.id, selectedPeriod, preloadedData])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
        <span className="ml-2 text-gray-400/30 text-sm">Loading activity...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <Calendar size={24} className="text-gray-400 mx-auto mb-2" />
        <p className="text-gray-400 text-sm">{error}</p>
      </div>
    )
  }

  if (!activityData || weeklyData.length === 0) {
    return (
      <div className="text-center py-8">
        <Calendar size={24} className="text-gray-400 mx-auto mb-2" />
        <p className="text-gray-400 text-sm">No activity data available</p>
      </div>
    )
  }

  // Calculate historical maximum without useMemo to avoid cache dependency issues
  const calculateHistoricalMax = () => {
    if (!weeklyData || weeklyData.length === 0) {
      return 1;
    }
    
    let maxWeekTotal = 0;
    const currentPeriodTotal = weeklyData.reduce((total, week) => total + (week.count || 0), 0);
    
    // Use all available periods for comprehensive historical comparison
    // Priority: 3years > 52weeks > 3months > 5weeks
    const periodsToCheck = ['3years', '52weeks', '3months', '5weeks'];
    
    for (const period of periodsToCheck) {
      const cachedPeriodData = ChartDataCache.get('resource', period, resource.id);
      if (cachedPeriodData && cachedPeriodData.commitsPerWeekDetailed) {
        const weeklyDataForTransform = cachedPeriodData.commitsPerWeekDetailed;
        
        if (weeklyDataForTransform && weeklyDataForTransform.length > 0) {
          // For longer periods, find maximum rolling period total
          if (period === '3years' || period === '52weeks' || period === '3months') {
            const config = getPeriodConfig(selectedPeriod);
            const currentPeriodWeeks = config.weeks || 4;
            
            // Calculate rolling maximums for the current period length
            for (let i = 0; i <= weeklyDataForTransform.length - currentPeriodWeeks; i++) {
              const rollingTotal = weeklyDataForTransform
                .slice(i, i + currentPeriodWeeks)
                .reduce((sum, w) => sum + (w && w.count ? w.count : 0), 0);
              maxWeekTotal = Math.max(maxWeekTotal, rollingTotal);
            }
          } else {
            // For similar period length, just get the total
            const periodTotal = weeklyDataForTransform.reduce((sum, w) => sum + (w && w.count ? w.count : 0), 0);
            maxWeekTotal = Math.max(maxWeekTotal, periodTotal);
          }
          
          console.log(`📊 Using ${period} data for ResourceCard comparison, found max: ${maxWeekTotal}`);
        }
        
        // Use only the first (longest) available period for most comprehensive comparison
        break;
      }
    }
    
    // If no historical data found, use current period as baseline
    if (maxWeekTotal === 0) {
      console.log('📊 No historical data found for ResourceCard comparison, using current period as baseline');
      return currentPeriodTotal || 1;
    }
    
    // Include current period in comparison - if it's a new record, it becomes the new max
    const trueHistoricalMax = Math.max(maxWeekTotal, currentPeriodTotal);
    
    console.log(`📊 ResourceCard historical max calculation: historicalMax=${maxWeekTotal}, currentPeriod=${currentPeriodTotal}, finalMax=${trueHistoricalMax}`);
    
    return trueHistoricalMax;
  };
  
  const weeklyHistoricalMax = calculateHistoricalMax();

  // Calculate if current period is a new record without useMemo to avoid cache dependency issues
  const calculateIsNewRecord = () => {
    if (!weeklyData || weeklyData.length === 0) {
      return false;
    }
    
    const currentPeriodTotal = weeklyData.reduce((total, week) => total + (week.count || 0), 0);
    
    // Get historical max (without current period)
    let historicalMax = 0;
    const periodsToCheck = ['3years', '52weeks', '3months', '5weeks'];
    
    for (const period of periodsToCheck) {
      const cachedPeriodData = ChartDataCache.get('resource', period, resource.id);
      if (cachedPeriodData && cachedPeriodData.commitsPerWeekDetailed) {
        const weeklyDataForTransform = cachedPeriodData.commitsPerWeekDetailed;
        
        if (weeklyDataForTransform && weeklyDataForTransform.length > 0) {
          if (period === '3years' || period === '52weeks' || period === '3months') {
            const config = getPeriodConfig(selectedPeriod);
            const currentPeriodWeeks = config.weeks || 4;
            
            // Calculate rolling maximums for the current period length
            for (let i = 0; i <= weeklyDataForTransform.length - currentPeriodWeeks; i++) {
              const rollingTotal = weeklyDataForTransform
                .slice(i, i + currentPeriodWeeks)
                .reduce((sum, w) => sum + (w && w.count ? w.count : 0), 0);
              historicalMax = Math.max(historicalMax, rollingTotal);
            }
          } else {
            const periodTotal = weeklyDataForTransform.reduce((sum, w) => sum + (w && w.count ? w.count : 0), 0);
            historicalMax = Math.max(historicalMax, periodTotal);
          }
        }
        
        break;
      }
    }
    
    return currentPeriodTotal > historicalMax;
  };
  
  const isNewRecord = calculateIsNewRecord();
  

  // Chart configuration - just made a bit wider
  const chartWidth = window.innerWidth < 1024 ? 300 : 850 
  const chartHeight = window.innerWidth < 1024 ? 180 : 320
  const chartPadding = window.innerWidth < 1024 ? 30 : 50
  const bottomPadding = window.innerWidth < 1024 ? 50 : 70
  
  // Validate and sanitize weekly data with enhanced error handling
  const validWeeklyData = weeklyData
    .filter(week => {
      if (!week) return false;
      if (typeof week !== 'object') return false;
      return true;
    })
    .map(week => {
      const count = typeof week.count === 'number' ? week.count : 0;
      let weekStart = week.weekStart;
      
      // Validate and fix weekStart date
      if (!weekStart) {
        weekStart = new Date().toISOString().slice(0, 10);
      } else {
        const weekStartDate = new Date(weekStart);
        if (isNaN(weekStartDate.getTime())) {
          console.warn(`Invalid weekStart date: ${weekStart}, using current date`);
          weekStart = new Date().toISOString().slice(0, 10);
        } else {
          weekStart = weekStartDate.toISOString().slice(0, 10);
        }
      }
      
      return {
        count: Math.max(0, isNaN(count) ? 0 : count),
        weekStart: weekStart
      };
    })
  
  const maxCommits = Math.max(...validWeeklyData.map(w => w.count), 1)
  const minCommits = Math.min(...validWeeklyData.map(w => w.count), 0)

  // Get expected period configuration for proper temporal positioning
  const config = getPeriodConfig(selectedPeriod)
  const expectedWeeks = config.weeks
  
  // Calculate the expected start date for the full period
  const now = new Date();
  const expectedStartDate = new Date(now.getTime() - expectedWeeks * 7 * 24 * 60 * 60 * 1000);
  
  // Generate chart points with proper temporal positioning
  const chartPoints = validWeeklyData.map((w, i) => {
    const safeMaxCommits = Math.max(maxCommits, 1) // Prevent division by zero
    const safeCount = Math.max(0, w.count || 0) // Ensure non-negative
    
    // Calculate the actual temporal position of this week within the expected period
    const weekDate = new Date(w.weekStart);
    const weeksSinceStart = Math.floor((weekDate.getTime() - expectedStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const normalizedPosition = Math.max(0, Math.min(1, weeksSinceStart / (expectedWeeks - 1)));
    
    // Calculate coordinates using temporal position, not array index
    const x = chartPadding + normalizedPosition * (chartWidth - 2 * chartPadding)
    const y = chartHeight - chartPadding - (safeCount / safeMaxCommits) * (chartHeight - 2 * chartPadding)
    
    // Triple validation to ensure no NaN coordinates
    let validX = x
    let validY = y
    
    // Check for NaN and provide fallbacks
    if (isNaN(validX) || !isFinite(validX)) {
      validX = chartPadding + (i * 10) // Simple fallback spacing
    }
    if (isNaN(validY) || !isFinite(validY)) {
      validY = chartHeight - chartPadding // Baseline fallback
    }
    
    // Clamp to chart boundaries
    validX = Math.max(chartPadding, Math.min(validX, chartWidth - chartPadding))
    validY = Math.max(chartPadding, Math.min(validY, chartHeight - chartPadding))
    
    // Final NaN check before returning
    if (isNaN(validX) || isNaN(validY)) {
      console.warn(`Invalid coordinates for point ${i}: x=${validX}, y=${validY}`)
      validX = chartPadding + i * 10
      validY = chartHeight / 2
    }
    
    return `${validX},${validY}`
  }).join(' ')


  // Tooltip handlers with error handling
  const handleNodeMouseOver = (e, value, weekIdx) => {
    try {
      const week = validWeeklyData[weekIdx];
      if (!week || !week.weekStart) {
        console.warn(`Invalid week data for tooltip at index ${weekIdx}`);
        return;
      }
      
      const weekStartDate = new Date(week.weekStart);
      if (isNaN(weekStartDate.getTime())) {
        console.warn(`Invalid weekStart date for tooltip: ${week.weekStart}`);
        return;
      }
      
      const weekNumber = weekIdx + 1;
      const month = weekStartDate.toLocaleString('default', { month: 'short' });
      
      // Always calculate correct Sunday-based week range regardless of stored weekStart
      const correctWeekStart = getWeekStart(weekStartDate);
      
      const correctEndOfWeek = new Date(correctWeekStart);
      correctEndOfWeek.setDate(correctWeekStart.getDate() + 6);
      
      const label = `Week ${weekNumber} (${correctWeekStart.toISOString().slice(0, 10)}–${correctEndOfWeek.toISOString().slice(0, 10)}, ${month})`;
      
      // Get viewport-relative position (don't add scroll offset since tooltip is fixed)
      const rect = e.target.getBoundingClientRect();
      const viewportX = rect.left;
      const viewportY = rect.top;
      
      setTooltip({
        show: true,
        x: viewportX,
        y: viewportY,
        value,
        label
      });
    } catch (error) {
      console.warn(`Error in tooltip handler for week ${weekIdx}:`, error);
    }
  }
  const handleNodeMouseOut = () => setTooltip({ show: false, x: 0, y: 0, value: 0, label: '' })



  return (
    <div className="w-full">
      {/* Line Chart */}
      <div className="bg-gray-800/50 rounded-lg p-4 sm:p-6" style={{ minHeight: window.innerWidth < 1024 ? 280 : 400 }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-400 text-xs">
            {selectedPeriod === '52weeks' ? 'Last 52 Weeks' : selectedPeriod === '3years' ? 'Last 3 Years' : selectedPeriod === '3months' ? 'Last 3 Months' : 'Last 4 Weeks'} (Historical Complete Weeks)
          </span>
          <div className="flex items-center space-x-1">
            <GitCommit size={12} style={{ color: accentColor.hex }} />
            <span className="font-bold text-lg" style={{ color: accentColor.hex }}>{validWeeklyData[validWeeklyData.length - 1]?.count || 0}</span>
            <span className="text-gray-400 text-xs">last complete week</span>
          </div>
        </div>

        {/* Line Chart */}
        <div className="relative">
          <svg width={chartWidth} height={chartHeight} className="w-full">
            {/* Definitions - must come first */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" strokeWidth="0.5" opacity="0.3"/>
              </pattern>
              <linearGradient id="accent-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={accentColor.hex} />
                <stop offset="50%" stopColor={accentColor.hex} />
                <stop offset="100%" stopColor={accentColor.hex} />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            
            {/* Background grid - transparent to show global gradient */}
            <rect width="100%" height="100%" fill="url(#grid)" opacity="0.2" />
            
            {/* Horizontal grid lines for better readability */}
            {(() => {
              const lines = []
              const maxLabel = Math.max(Math.ceil(maxCommits / 10) * 10, 10)
              const step = Math.max(1, Math.floor(maxLabel / 5))
              
              for (let i = 0; i <= maxLabel; i += step) {
                if (i <= maxCommits) {
                  const y = chartHeight - chartPadding - (i / maxCommits) * (chartHeight - 2 * chartPadding)
                  lines.push(
                    <line 
                      key={`grid-${i}`}
                      x1={chartPadding} 
                      y1={y} 
                      x2={chartWidth - chartPadding} 
                      y2={y}
                      stroke={accentColor.hex}
                      strokeDasharray="3 3"
                      strokeWidth="0.8"
                      opacity="0.25"
                    />
                  )
                }
              }
              return lines
            })()}

            {/* Month boundary grid lines */}
            {validWeeklyData.map((w, i) => {
              const weekDate = new Date(w.weekStart);
              const isMonthStart = weekDate.getDate() <= 7; // first week of month
              if (!isMonthStart || i === 0) return null
              
              // Use temporal positioning
              const weeksSinceStart = Math.floor((weekDate.getTime() - expectedStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
              const normalizedPosition = Math.max(0, Math.min(1, weeksSinceStart / (expectedWeeks - 1)));
              const x = chartPadding + normalizedPosition * (chartWidth - 2 * chartPadding)
              
              // Validate coordinates
              const safeX = isNaN(x) || !isFinite(x) ? chartPadding : Math.max(chartPadding, Math.min(x, chartWidth - chartPadding))
              
              return (
                <line
                  key={`month-grid-${i}`}
                  x1={safeX}
                  y1={chartPadding}
                  x2={safeX}
                  y2={chartHeight - bottomPadding}
                  stroke={accentColor.hex}
                  strokeDasharray="4 2"
                  strokeWidth="1"
                  opacity="0.25"
                />
              )
            })}

            {/* Week ticks */}
            {validWeeklyData.map((w, i) => {
              // Use temporal positioning
              const weekDate = new Date(w.weekStart);
              const weeksSinceStart = Math.floor((weekDate.getTime() - expectedStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
              const normalizedPosition = Math.max(0, Math.min(1, weeksSinceStart / (expectedWeeks - 1)));
              const x = chartPadding + normalizedPosition * (chartWidth - 2 * chartPadding)
              
              // Validate coordinates
              const safeX = isNaN(x) || !isFinite(x) ? chartPadding : Math.max(chartPadding, Math.min(x, chartWidth - chartPadding))
              
              return (
                <line
                  key={`tick-${i}`}
                  x1={safeX}
                  y1={chartHeight - bottomPadding}
                  x2={safeX}
                  y2={chartHeight - bottomPadding + 8}
                  stroke={accentColor.hex}
                  strokeWidth="1"
                  opacity="0.3"
                />
              )
            })}
            
            {/* Glow effect */}
            <polyline
              points={chartPoints}
              fill="none"
              stroke={accentColor.hex}
              strokeWidth="4"
              opacity="0.35"
              filter="url(#glow)"
            />
            
            {/* Main line */}
            <polyline
              points={chartPoints}
              fill="none"
              stroke="url(#accent-gradient)"
              strokeWidth="1"
                                style={{ filter: `drop-shadow(0 0 3px rgba(${accentColor.rgb},0.5))` }}
            />
            
            {/* Data points (nodes) with tooltips */}
            {validWeeklyData.map((w, i) => {
              // Use same temporal positioning calculation as chartPoints
              const safeMaxCommits = Math.max(maxCommits, 1)
              const safeCount = Math.max(0, w.count || 0)
              
              // Calculate the actual temporal position of this week within the expected period
              const weekDate = new Date(w.weekStart);
              const weeksSinceStart = Math.floor((weekDate.getTime() - expectedStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
              const normalizedPosition = Math.max(0, Math.min(1, weeksSinceStart / (expectedWeeks - 1)));
              
              const x = chartPadding + normalizedPosition * (chartWidth - 2 * chartPadding)
              const y = chartHeight - chartPadding - (safeCount / safeMaxCommits) * (chartHeight - 2 * chartPadding)
              
              // Validate coordinates
              let safeX = x
              let safeY = y
              
              if (isNaN(safeX) || !isFinite(safeX)) {
                safeX = chartPadding + (i * 10)
              }
              if (isNaN(safeY) || !isFinite(safeY)) {
                safeY = chartHeight - chartPadding
              }
              
              safeX = Math.max(chartPadding, Math.min(safeX, chartWidth - chartPadding))
              safeY = Math.max(chartPadding, Math.min(safeY, chartHeight - chartPadding))
              
              return (
                <g key={i}>
                  {/* Visible dot */}
                  <circle
                    cx={safeX}
                    cy={safeY}
                    r={w.count > 0 ? "4" : "2.5"}
                    fill="none"
                    stroke={w.count > 0 ? accentColor.hex : "#334155"}
                    strokeWidth="1.5"
                    opacity={w.count > 0 ? 1 : 0.5}
                    style={{ filter: w.count > 0 ? `drop-shadow(0 0 6px rgba(${accentColor.rgb},0.6))` : 'none' }}
                    pointerEvents="none"
                  />
                  {/* Larger invisible hover area */}
                  <circle
                    cx={safeX}
                    cy={safeY}
                    r="12"
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onMouseOver={e => handleNodeMouseOver(e, w.count, i)}
                    onMouseOut={handleNodeMouseOut}
                  />
                </g>
              )
            })}
            
            {/* Smart month/year labels with collision avoidance */}
            {(() => {
              const labels = [];
              const minLabelSpacing = window.innerWidth < 1024 ? 80 : 120; // Minimum pixels between labels
              let lastLabelX = -minLabelSpacing;
              
              // Calculate ideal number of labels based on chart width
              const maxLabels = Math.floor((chartWidth - 2 * chartPadding) / minLabelSpacing);
              const labelInterval = Math.max(1, Math.floor(validWeeklyData.length / maxLabels));
              
              validWeeklyData.forEach((w, i) => {
                try {
                  const date = new Date(w.weekStart);
                  if (isNaN(date.getTime())) return;
                  
                  // Use temporal positioning
                  const weeksSinceStart = Math.floor((date.getTime() - expectedStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
                  const normalizedPosition = Math.max(0, Math.min(1, weeksSinceStart / (expectedWeeks - 1)));
                  const x = chartPadding + normalizedPosition * (chartWidth - 2 * chartPadding);
                  const safeX = isNaN(x) || !isFinite(x) ? chartPadding : Math.max(chartPadding, Math.min(x, chartWidth - chartPadding));
                  
                  // Check if this position has enough space from the last label
                  if (safeX - lastLabelX < minLabelSpacing) return;
                  
                  const isYearStart = date.getMonth() === 0 && date.getDate() <= 7;
                  const isQuarterStart = [0, 3, 6, 9].includes(date.getMonth()) && date.getDate() <= 7;
                  
                  // Prioritize year labels, then quarters for longer periods
                  let shouldShowLabel = false;
                  let labelText = '';
                  let fontSize = window.innerWidth < 1024 ? "11" : "13";
                  let yOffset = 18;
                  
                  if (selectedPeriod === '3years') {
                    // For 3-year view, show years and quarters
                    if (isYearStart) {
                      shouldShowLabel = true;
                      labelText = date.getFullYear().toString();
                      fontSize = window.innerWidth < 1024 ? "14" : "16";
                      yOffset = 32;
                    } else if (isQuarterStart && i % Math.max(1, Math.floor(labelInterval / 2)) === 0) {
                      shouldShowLabel = true;
                      labelText = `Q${Math.floor(date.getMonth() / 3) + 1}`;
                    }
                  } else if (selectedPeriod === '52weeks') {
                    // For 1-year view, show quarters and some months
                    if (isQuarterStart) {
                      shouldShowLabel = true;
                      labelText = date.toLocaleString('default', { month: 'short' });
                    }
                  } else {
                    // For shorter periods, show months more frequently
                    const isMonthStart = date.getDate() <= 7;
                    if (isMonthStart && i % labelInterval === 0) {
                      shouldShowLabel = true;
                      labelText = date.toLocaleString('default', { month: 'short' });
                    }
                  }
                  
                  if (shouldShowLabel) {
                    lastLabelX = safeX;
                    labels.push(
                      <text
                        key={`smart-label-${i}`}
                        x={safeX}
                        y={chartHeight - bottomPadding / 2 + yOffset}
                        fontSize={fontSize}
                        fill={accentColor.hex}
                        textAnchor="middle"
                        fontWeight="bold"
                      >
                        {labelText}
                      </text>
                    );
                  }
                } catch (error) {
                  console.warn(`Error rendering smart label for week ${i}:`, error);
                }
              });
              
              return labels;
            })()}
            {/* Y-axis labels - improved visibility and more labels */}
            {(() => {
              const labels = []
              const maxLabel = Math.max(Math.ceil(maxCommits / 10) * 10, 10)
              const step = Math.max(1, Math.floor(maxLabel / 5))
              
              // Generate Y-axis labels
              for (let i = 0; i <= maxLabel; i += step) {
                if (i <= maxCommits) {
                  const y = chartHeight - chartPadding - (i / maxCommits) * (chartHeight - 2 * chartPadding)
                  labels.push(
                    <text 
                      key={`y-label-${i}`}
                      x={chartPadding - 12} 
                      y={y + 4} 
                      fontSize="12" 
                      fill={accentColor.hex} 
                      textAnchor="end"
                      fontWeight="500"
                      style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
                    >
                      {i}
                    </text>
                  )
                }
              }
              return labels
            })()}
          </svg>
          {/* Tooltip using Portal for proper overflow */}
          {tooltip.show && (
            <Portal>
              <div
                className="fixed z-[9999] px-2 py-1 rounded bg-gray-900 text-white text-xs border border-white shadow-lg pointer-events-none max-w-xs"
                style={{ 
                  left: Math.min(tooltip.x + 10, window.innerWidth - 250), 
                  top: Math.max(tooltip.y - 50, 10)
                }}
              >
                <div className="font-bold">{tooltip.label}</div>
                <div>{tooltip.value} commits</div>
              </div>
            </Portal>
          )}
        </div>
        
        {/* Chart info */}
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>Commits per week for this resource</span>
          <span>{validWeeklyData.filter(w => w.count > 0).length}/{validWeeklyData.length} active weeks</span>
        </div>
      </div>

      {/* Period-Based Stats */}
      <div className="bg-gray-800/50 rounded-lg p-3 mt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex flex-col">
            <span className="text-gray-400 text-xs">
              {selectedPeriod === '4weeks' ? 'Current 4-Week Total' : 
               selectedPeriod === '3months' ? 'Current 3-Month Total' : 
               selectedPeriod === '52weeks' ? 'Current 12-Month Total' : 
               selectedPeriod === '3years' ? 'Current 3-Year Total' : 'Last Complete Week'}
            </span>
            {(selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years') && (
              <span className="text-gray-500 text-xs mt-0.5">
                vs. best {selectedPeriod === '4weeks' ? '4-week' : 
                              selectedPeriod === '3months' ? '3-month' : 
                              selectedPeriod === '52weeks' ? '12-month' : '3-year'} period
              </span>
            )}
          </div>
          <div className="flex items-center space-x-1">
            <GitCommit size={12} style={{ color: accentColor.hex }} />
            <span className="font-bold text-lg" style={{ color: accentColor.hex }}>
              {selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years' ? 
                validWeeklyData.reduce((total, week) => total + (week.count || 0), 0) : 
                validWeeklyData[validWeeklyData.length - 1]?.count || 0}
            </span>
            <span className="text-gray-400 text-xs">commits</span>
            {(selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years') && isNewRecord && (
              <span 
                className="text-xs font-medium px-2 py-0.5 rounded ml-2"
                style={{ 
                  color: accentColor.hex,
                  backgroundColor: `rgba(${accentColor.rgb}, 0.1)`
                }}
              >
                new record
              </span>
            )}
          </div>
        </div>

        {/* Bar Chart - uses dynamic historical maximums for meaningful progress bars */}
        <div className="relative">
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="h-2 rounded-full transition-all duration-500 ease-out"
              style={{ 
                width: (() => {
                  const isLongerPeriod = selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years';
                  const currentValue = isLongerPeriod ? 
                    validWeeklyData.reduce((total, week) => total + (week.count || 0), 0) : 
                    validWeeklyData[validWeeklyData.length - 1]?.count || 0;
                  
                  if (!isLongerPeriod) {
                    // For single week, use max-min range (unchanged)
                    const maximum = maxCommits - minCommits || 1;
                    return `${Math.min(100, Math.max(0, ((currentValue - minCommits) / maximum) * 100))}%`;
                  }
                  
                  // For longer periods, use dynamic historical maximum
                  const historicalMax = weeklyHistoricalMax || 1;
                  
                  // Calculate percentage with bounds checking
                  const percentage = (currentValue / historicalMax) * 100;
                  return `${Math.min(100, Math.max(0, Math.round(percentage)))}%`;
                })(),
                background: `linear-gradient(to right, ${accentColor.hex}, ${accentColor.hex}dd)`,
                boxShadow: `0 0 8px rgba(${accentColor.rgb}, 0.3)`
              }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0</span>
            <span>
              {(() => {
                const isLongerPeriod = selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years';
                if (isLongerPeriod) {
                  return `${weeklyHistoricalMax || 1} (historical peak)`;
                } else {
                  return maxCommits;
                }
              })()}
            </span>
          </div>
        </div>
      </div>

      {/* Activity Level Indicator */}
      {!hideActivityLevelInfo && (
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${
            (validWeeklyData[validWeeklyData.length - 1]?.count || 0) >= 20 ? 'bg-red-500' :
            (validWeeklyData[validWeeklyData.length - 1]?.count || 0) >= 10 ? 'bg-orange-500' :
            (validWeeklyData[validWeeklyData.length - 1]?.count || 0) >= 5 ? 'bg-yellow-500' :
            (validWeeklyData[validWeeklyData.length - 1]?.count || 0) >= 2 ? 'bg-green-500' :
            'bg-gray-500'
          }`}></div>
          <span className="text-gray-400 text-xs">
            {(validWeeklyData[validWeeklyData.length - 1]?.count || 0) >= 20 ? 'Very High' :
             (validWeeklyData[validWeeklyData.length - 1]?.count || 0) >= 10 ? 'High' :
             (validWeeklyData[validWeeklyData.length - 1]?.count || 0) >= 5 ? 'Medium' :
             (validWeeklyData[validWeeklyData.length - 1]?.count || 0) >= 2 ? 'Low' :
             'Minimal'} Activity
          </span>
        </div>
      )}
      {/* Info */}
      {!hideActivityLevelInfo && (
        <div className="text-xs text-gray-500">
          <p>
            {activityData.repoInfo?.isOrganization 
              ? `Activity based on commits across ${activityData.repoInfo.totalRepos} repositories. Shows complete historical weeks only (excludes current incomplete week).`
              : 'Activity based on commits to the main repository. Shows complete historical weeks only (excludes current incomplete week).'
            }
          </p>
        </div>
      )}
    </div>
  )
}

export default WeeklyActivityChart 