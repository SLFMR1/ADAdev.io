import React, { useState, useEffect } from 'react'
import { fetchGitHubUpdates } from '../services/github'
// Removed hybridDataFetcher and supabase imports - using server API instead
import { TrendingUp, Calendar, GitCommit } from 'lucide-react'
import logger from '../utils/logger-frontend'
import Portal from './Portal'

// Removed Supabase client initialization - using server API instead

// Helper to generate line chart points from weekly data
const getLineChartPoints = (data, width, height, padding) => {
  if (!data || data.length === 0) {
    return ''
  }
  
  // Ensure we have valid numeric values
  const validData = data.map(item => {
    const count = typeof item === 'object' ? (item.count || 0) : (item || 0)
    return Math.max(0, isNaN(count) ? 0 : count)
  })
  
  const max = Math.max(...validData, 1)
  const stepX = (width - 2 * padding) / (validData.length - 1 || 1)
  const points = validData.map((count, i) => {
    const x = padding + i * stepX
    const y = height - padding - (count / max) * (height - 2 * padding)
    return `${x},${y}`
  }).join(' ')
  return points
}

// NOTE: Synthetic data generation functions removed - using only accurate hybrid data

const WeeklyActivityChart = ({ resource, showThreeYearOption = true, hidePeriodSwitches = false, hideActivityLevelInfo = false, selectedPeriod = '3months', onPeriodChange, preloadedData = null, accentColor = { hex: '#FFFFFF', rgb: '255, 255, 255' } }) => {
  const [activityData, setActivityData] = useState(null)
  const [weeklyData, setWeeklyData] = useState([])
  const [historicalMaximums, setHistoricalMaximums] = useState({})
  const [historicalMetadata, setHistoricalMetadata] = useState({ hasHistoricalData: false, dataQuality: 'fallback' })
  const [isLoading, setIsLoading] = useState(!preloadedData || preloadedData.error)
  const [error, setError] = useState(null)
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, value: 0, label: '' })
  // Map selectedPeriod to weeks directly (no internal state needed)
  const periodToWeeks = {
    '4weeks': 5,
    '3months': 13,
    '52weeks': 52,
    '3years': 156
  }
  
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
          // Don't set loading state here - component should start unloaded when preloaded data exists
          
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
            
            // Determine number of weeks based on time period
            const weeks = periodToWeeks[selectedPeriod] || 4
            const trimmedData = validWeeklyData.slice(-weeks)
            setWeeklyData(trimmedData)
            
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
        
        // Determine number of weeks based on time period
        const weeks = periodToWeeks[selectedPeriod] || 4
        
        // Use server API for accurate data with proper current week exclusion
        logger.log(`🔄 Fetching server API data for ${resource.name} (period: ${selectedPeriod})`)
        
        // Map selectedPeriod to server API period format
        const periodMapping = {
          '4weeks': '5weeks',
          '3months': '3months', 
          '52weeks': '52weeks',
          '3years': '3years'
        }
        
        const serverPeriod = periodMapping[selectedPeriod] || 'monthly'
        
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
        
        logger.log(`✅ Server API data received - sources:`, resourceData.dataSources)
        
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
          
          // Only use as many weeks as available, up to the requested period
          const trimmedData = validWeeklyData.slice(-weeks)
          setWeeklyData(trimmedData)
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

  // Generate chart points with enhanced validation to prevent NaN coordinates
  const chartPoints = validWeeklyData.map((w, i) => {
    // Ensure we have valid inputs for calculations
    const dataLength = Math.max(validWeeklyData.length, 1)
    const safeMaxCommits = Math.max(maxCommits, 1) // Prevent division by zero
    const safeCount = Math.max(0, w.count || 0) // Ensure non-negative
    
    // Calculate coordinates with safe division
    const x = chartPadding + (dataLength > 1 ? (i / (dataLength - 1)) : 0.5) * (chartWidth - 2 * chartPadding)
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

  // Month label logic with enhanced validation
  let lastMonth = ''
  const monthLabels = validWeeklyData.map((w, i) => {
    try {
      const weekStart = w.weekStart;
      if (!weekStart) {
        console.warn(`Missing weekStart for week ${i}`);
        return '';
      }
      
      const weekStartDate = new Date(weekStart);
      if (isNaN(weekStartDate.getTime())) {
        console.warn(`Invalid weekStart date: ${weekStart} for week ${i}`);
        return '';
      }
      
      const month = weekStartDate.toLocaleString('default', { month: 'short' });
      if (month !== lastMonth && month !== 'Invalid Date') {
        lastMonth = month;
        return month;
      }
      return '';
    } catch (error) {
      console.warn(`Error processing month label for week ${i}:`, error);
      return '';
    }
  })

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
      const endOfWeek = new Date(weekStartDate);
      endOfWeek.setDate(weekStartDate.getDate() + 6);
      
      const label = `Week ${weekNumber} (${week.weekStart}–${endOfWeek.toISOString().slice(0, 10)}, ${month})`;
      
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
            {monthLabels.map((label, i) => {
              if (!label || i === 0) return null
              
              const dataLength = Math.max(validWeeklyData.length, 1)
              const x = chartPadding + (dataLength > 1 ? (i / (dataLength - 1)) : 0.5) * (chartWidth - 2 * chartPadding)
              
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
            {validWeeklyData.map((_, i) => {
              const dataLength = Math.max(validWeeklyData.length, 1)
              const x = chartPadding + (dataLength > 1 ? (i / (dataLength - 1)) : 0.5) * (chartWidth - 2 * chartPadding)
              
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
              // Use same safe calculation as chartPoints
              const dataLength = Math.max(validWeeklyData.length, 1)
              const safeMaxCommits = Math.max(maxCommits, 1)
              const safeCount = Math.max(0, w.count || 0)
              
              const x = chartPadding + (dataLength > 1 ? (i / (dataLength - 1)) : 0.5) * (chartWidth - 2 * chartPadding)
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
            
            {/* Month labels */}
            {validWeeklyData.map((w, i) => {
              try {
                const date = new Date(w.weekStart)
                if (isNaN(date.getTime())) return null // Invalid date
                
                const isMonthStart = date.getDate() <= 7 // first week of month
                const isYearStart = date.getMonth() === 0 && isMonthStart
                
                // Safe coordinate calculation
                const dataLength = Math.max(validWeeklyData.length, 1)
                const x = chartPadding + (dataLength > 1 ? (i / (dataLength - 1)) : 0.5) * (chartWidth - 2 * chartPadding)
                const safeX = isNaN(x) || !isFinite(x) ? chartPadding : Math.max(chartPadding, Math.min(x, chartWidth - chartPadding))
                
                if (isYearStart) {
                  return (
                    <text
                      key={`year-label-${i}`}
                      x={safeX}
                      y={chartHeight - bottomPadding / 2 + 32}
                      fontSize={window.innerWidth < 1024 ? "14" : "16"}
                      fill={accentColor.hex}
                      textAnchor="middle"
                      fontWeight="bold"
                    >{date.getFullYear()}</text>
                  )
                } else if (isMonthStart) {
                  return (
                    <text
                      key={`month-label-${i}`}
                      x={safeX}
                      y={chartHeight - bottomPadding / 2 + 18}
                      fontSize={window.innerWidth < 1024 ? "11" : "13"}
                      fill={accentColor.hex}
                      textAnchor="middle"
                      fontWeight="bold"
                    >{date.toLocaleString('default', { month: 'short' })}</text>
                  )
                }
                return null
              } catch (error) {
                console.warn(`Error rendering label for week ${i}:`, error)
                return null
              }
            })}
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
          </div>
        </div>

        {/* Bar Chart - uses historical maximums for meaningful progress bars */}
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
                  
                  // For longer periods, use historical maximum with graceful fallback
                  const periodMapping = { '4weeks': '5weeks', '3months': '3months', '52weeks': '52weeks', '3years': '3years' };
                  const serverPeriod = periodMapping[selectedPeriod] || selectedPeriod;
                  let historicalMax = historicalMaximums[serverPeriod];
                  
                  // Smart handling of insufficient historical data
                  if (!historicalMax || historicalMax === 0) {
                    // Insufficient data case - show 100% but we'll add indicators elsewhere
                    return "100%";
                  }
                  
                  // Calculate percentage with bounds checking (only when we have real historical data)
                  const percentage = (currentValue / historicalMax) * 100;
                  return `${Math.min(100, Math.max(0, Math.round(percentage)))}%`;
                })(),
                background: (() => {
                  const isLongerPeriod = selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years';
                  if (isLongerPeriod) {
                    const periodMapping = { '4weeks': '5weeks', '3months': '3months', '52weeks': '52weeks', '3years': '3years' };
                    const serverPeriod = periodMapping[selectedPeriod] || selectedPeriod;
                    const historicalMax = historicalMaximums[serverPeriod];
                    
                    // Subtle visual hint for insufficient data
                    if (!historicalMax || historicalMax === 0) {
                      return `linear-gradient(to right, ${accentColor.hex}99, ${accentColor.hex}77)`; // Slightly more transparent
                    }
                  }
                  return `linear-gradient(to right, ${accentColor.hex}, ${accentColor.hex}dd)`;
                })(),
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
                  const periodMapping = { '4weeks': '5weeks', '3months': '3months', '52weeks': '52weeks', '3years': '3years' };
                  const serverPeriod = periodMapping[selectedPeriod] || selectedPeriod;
                  const currentTotal = validWeeklyData.reduce((total, week) => total + (week.count || 0), 0);
                  let historicalMax = historicalMaximums[serverPeriod];
                  
                  // Use same logic as progress bar for consistency
                  if (!historicalMax || historicalMax === 0) {
                    // For display purposes, show current total when no historical data
                    return Math.max(currentTotal, 1);
                  }
                  
                  return historicalMax;
                } else {
                  return maxCommits;
                }
              })()}
            </span>
          </div>
          {/* Context-aware progress information */}
          {(selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years') && (
            <div className="text-center mt-2">
              <span className={`text-xs ${
                historicalMetadata.dataQuality === 'high' ? 'text-gray-400' : 
                historicalMetadata.dataQuality === 'limited' ? 'text-gray-400' :
                'text-gray-500' // Subtle - no obvious color differences for insufficient data
              }`}>
                {(() => {
                  const currentTotal = validWeeklyData.reduce((total, week) => total + (week.count || 0), 0);
                  const periodMapping = { '4weeks': '5weeks', '3months': '3months', '52weeks': '52weeks', '3years': '3years' };
                  const serverPeriod = periodMapping[selectedPeriod] || selectedPeriod;
                  const originalHistoricalMax = historicalMaximums[serverPeriod];
                  
                  if (historicalMetadata.dataQuality === 'high' && originalHistoricalMax && originalHistoricalMax > 0) {
                    const percentage = Math.round((currentTotal / originalHistoricalMax) * 100);
                    return `${percentage}% of historical peak (${originalHistoricalMax} commits)`;
                  } else if (historicalMetadata.dataQuality === 'limited' && originalHistoricalMax && originalHistoricalMax > 0) {
                    const percentage = Math.round((currentTotal / originalHistoricalMax) * 100);
                    return `${percentage}% of available data peak (${originalHistoricalMax} commits)`;
                  } else {
                    return '';
                  }
                })()}
              </span>
            </div>
          )}
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