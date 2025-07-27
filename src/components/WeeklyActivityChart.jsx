import React, { useState, useEffect } from 'react'
import { fetchGitHubUpdates } from '../services/github'
import { TrendingUp, Calendar, GitCommit } from 'lucide-react'
import logger from '../utils/logger-frontend'
import Portal from './Portal'

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

// Helper to generate weekly data from monthly data and current week
const generateWeeklyData = (commitsPerMonth, currentWeekCommits) => {
  if (!commitsPerMonth || commitsPerMonth.length === 0) {
    // If no monthly data, create a simple array with current week
    return [{ count: currentWeekCommits || 0, weekStart: new Date().toISOString().slice(0, 10) }]
  }
  
  // Convert monthly data to weekly data (approximate)
  const weeklyData = []
  commitsPerMonth.forEach(month => {
    // Distribute monthly commits across 4 weeks (approximate)
    const weeklyAverage = Math.floor((month.count || 0) / 4)
    for (let i = 0; i < 4; i++) {
      weeklyData.push({ 
        count: weeklyAverage, 
        weekStart: new Date().toISOString().slice(0, 10) 
      })
    }
  })
  
  // Replace the last week with current week data
  if (weeklyData.length > 0) {
    weeklyData[weeklyData.length - 1] = { 
      count: currentWeekCommits || 0, 
      weekStart: new Date().toISOString().slice(0, 10) 
    }
  } else {
    weeklyData.push({ 
      count: currentWeekCommits || 0, 
      weekStart: new Date().toISOString().slice(0, 10) 
    })
  }
  
  // Ensure we have at least 12 weeks of data
  while (weeklyData.length < 12) {
    weeklyData.unshift({ count: 0, weekStart: new Date().toISOString().slice(0, 10) })
  }
  
  // Take the last 12 weeks
  return weeklyData.slice(-12)
}

// Helper to get month names for the last N weeks
const getMonthLabels = (commitsPerMonth, weeks) => {
  if (!commitsPerMonth || commitsPerMonth.length === 0) return Array(weeks).fill('')
  // Get the last N months
  const months = commitsPerMonth.slice(-Math.ceil(weeks / 4)).map(m => m.month)
  // Expand to weeks (4 per month)
  let labels = []
  months.forEach((month, i) => {
    for (let j = 0; j < 4; j++) {
      labels.push(i === 0 && j === 0 ? month : (j === 0 ? month : ''))
    }
  })
  // Take the last N
  return labels.slice(-weeks)
}

const WeeklyActivityChart = ({ resource, showThreeYearOption = true, hidePeriodSwitches = false, hideActivityLevelInfo = false, selectedPeriod = '4weeks', onPeriodChange, preloadedData = null, accentColor = { hex: '#FFFFFF', rgb: '255, 255, 255' } }) => {
  const [activityData, setActivityData] = useState(null)
  const [weeklyData, setWeeklyData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, value: 0, label: '' })
  // Map selectedPeriod to weeks directly (no internal state needed)
  const periodToWeeks = {
    '4weeks': 4,
    '3months': 13,
    '52weeks': 52,
    '3years': 156
  }
  
  // Use selectedPeriod directly instead of internal timePeriod state
  // const timePeriod = selectedPeriod // Not needed anymore

  useEffect(() => {
    const loadActivityData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        
        // If preloaded data is available for this period, use it immediately
        if (preloadedData && !preloadedData.error) {
          logger.log(`⚡ Using preloaded data for ${resource.name} (period: ${selectedPeriod})`)
          console.log('WeeklyActivityChart received preloaded data:', preloadedData)
          
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
            
            // Determine number of weeks based on time period
            const weeks = periodToWeeks[selectedPeriod] || 4
            const trimmedData = validWeeklyData.slice(-weeks)
            setWeeklyData(trimmedData)
            
            setIsLoading(false)
            return
          } else if (resourceData && (resourceData.commitsPerWeek || resourceData.commitsPerMonth)) {
            // Fallback to basic preloaded data
            const currentWeek = resourceData.commitsPerWeek || 0
            
            setActivityData({
              currentWeek: currentWeek,
              repoInfo: resourceData.repoInfo
            })
            
            const weeklyData = generateWeeklyData(resourceData.commitsPerMonth, currentWeek)
            setWeeklyData(weeklyData)
            
            setIsLoading(false)
            return
          }
        }
        
        // Fallback to fetching data if no preloaded data or preloaded data has error
        if (preloadedData?.error) {
          logger.warn(`Preloaded data has error for ${resource.name}: ${preloadedData.error}`);
        }
        
        // Determine number of weeks based on time period
        const weeks = periodToWeeks[selectedPeriod] || 4
        
        // Get data from server API with period parameter
        logger.log(`🔄 Fetching data from server for ${resource.name} (period: ${selectedPeriod})`)
        const resourceData = await fetchGitHubUpdates(resource, selectedPeriod)
        
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
          
          // Only use as many weeks as available, up to the requested period
          const trimmedData = validWeeklyData.slice(-weeks)
          setWeeklyData(trimmedData)
        } else if (resourceData && (resourceData.commitsPerWeek || resourceData.commitsPerMonth)) {
          // Fallback to basic data
          const currentWeek = resourceData.commitsPerWeek || 0
          
          setActivityData({
            currentWeek: currentWeek,
            repoInfo: resourceData.repoInfo
          })
          
          // Generate weekly data from monthly data
          const weeklyData = generateWeeklyData(resourceData.commitsPerMonth, currentWeek)
          setWeeklyData(weeklyData)
        } else {
          // No valid data available
          setActivityData({
            currentWeek: 0,
            repoInfo: null
          })
          
          // Generate empty weekly data
          const emptyWeeklyData = generateWeeklyData([], 0)
          setWeeklyData(emptyWeeklyData)
        }
      } catch (error) {
        logger.error(`Error loading activity data for ${resource.name}:`, error)
        setError(error.message)
        
        // Set fallback data on error
        setActivityData({
          currentWeek: 0,
          repoInfo: null
        })
        setWeeklyData(generateWeeklyData([], 0))
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

  // Chart configuration
  const chartWidth = window.innerWidth < 1024 ? 350 : 700 // Responsive width
  const chartHeight = window.innerWidth < 1024 ? 150 : 200 // Responsive height
  const chartPadding = window.innerWidth < 1024 ? 20 : 30 // Responsive padding
  const bottomPadding = window.innerWidth < 1024 ? 30 : 40 // Responsive bottom padding
  
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
  const currentWeekCommits = validWeeklyData[validWeeklyData.length - 1]?.count || 0

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
      <div className="bg-gray-800/50 rounded-lg p-4 sm:p-6" style={{ minHeight: window.innerWidth < 1024 ? 180 : 220 }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-400 text-xs">
            {selectedPeriod === '52weeks' ? 'Last 52 Weeks' : selectedPeriod === '3years' ? 'Last 3 Years' : selectedPeriod === '3months' ? 'Last 3 Months' : 'Last 4 Weeks'}
          </span>
          <div className="flex items-center space-x-1">
            <GitCommit size={12} style={{ color: accentColor.hex }} />
            <span className="font-bold text-lg" style={{ color: accentColor.hex }}>{currentWeekCommits}</span>
            <span className="text-gray-400 text-xs">this week</span>
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
            <rect width="100%" height="100%" fill="url(#grid)" opacity="0.3" />

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
            {/* Y-axis labels */}
            <text x={chartPadding - 8} y={chartPadding + 8} fontSize="10" fill="#64748b" textAnchor="end">{maxCommits}</text>
            <text x={chartPadding - 8} y={chartHeight - chartPadding + 8} fontSize="10" fill="#64748b" textAnchor="end">{minCommits}</text>
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

      {/* Current Week Stats */}
      <div className="bg-gray-800/50 rounded-lg p-3 mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400 text-xs">This Week</span>
          <div className="flex items-center space-x-1">
            <GitCommit size={12} style={{ color: accentColor.hex }} />
            <span className="font-bold text-lg" style={{ color: accentColor.hex }}>{activityData.currentWeek}</span>
            <span className="text-gray-400 text-xs">commits</span>
          </div>
        </div>

        {/* Simple Bar Chart for current week, scaled to min-max */}
        <div className="relative">
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="h-2 rounded-full transition-all duration-500 ease-out"
              style={{ 
                width: `${((activityData.currentWeek - minCommits) / (maxCommits - minCommits || 1)) * 100}%`,
                background: `linear-gradient(to right, ${accentColor.hex}, ${accentColor.hex}dd)`,
                boxShadow: `0 0 8px rgba(${accentColor.rgb}, 0.3)`
              }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{minCommits}</span>
            <span>{maxCommits}</span>
          </div>
        </div>
      </div>

      {/* Activity Level Indicator */}
      {!hideActivityLevelInfo && (
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${
            activityData.currentWeek >= 20 ? 'bg-red-500' :
            activityData.currentWeek >= 10 ? 'bg-orange-500' :
            activityData.currentWeek >= 5 ? 'bg-yellow-500' :
            activityData.currentWeek >= 2 ? 'bg-green-500' :
            'bg-gray-500'
          }`}></div>
          <span className="text-gray-400 text-xs">
            {activityData.currentWeek >= 20 ? 'Very High' :
             activityData.currentWeek >= 10 ? 'High' :
             activityData.currentWeek >= 5 ? 'Medium' :
             activityData.currentWeek >= 2 ? 'Low' :
             'Minimal'} Activity
          </span>
        </div>
      )}
      {/* Info */}
      {!hideActivityLevelInfo && (
        <div className="text-xs text-gray-500">
          <p>
            {activityData.repoInfo?.isOrganization 
              ? `Activity based on commits across ${activityData.repoInfo.totalRepos} repositories in the last week.`
              : 'Activity based on commits to the main repository in the last week.'
            }
          </p>
        </div>
      )}
    </div>
  )
}

export default WeeklyActivityChart 