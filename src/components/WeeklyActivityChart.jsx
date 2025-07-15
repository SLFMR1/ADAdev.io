import React, { useState, useEffect } from 'react'
import { fetchGitHubUpdates } from '../services/github'
import { getWeeklyActivity, hasRecentData } from '../services/supabase'
import { TrendingUp, Calendar, GitCommit } from 'lucide-react'
import logger from '../utils/logger'

// Helper to generate line chart points from weekly data
const getLineChartPoints = (data, width, height, padding) => {
  if (!data || data.length === 0) {
    console.log('⚠️ getLineChartPoints: No data provided')
    return ''
  }
  const max = Math.max(...data, 1)
  const stepX = (width - 2 * padding) / (data.length - 1)
  const points = data.map((count, i) => {
    const x = padding + i * stepX
    const y = height - padding - (count / max) * (height - 2 * padding)
    return `${x},${y}`
  }).join(' ')
  console.log('📊 getLineChartPoints result:', points)
  return points
}

// Helper to generate weekly data from monthly data and current week
const generateWeeklyData = (commitsPerMonth, currentWeekCommits) => {
  if (!commitsPerMonth || commitsPerMonth.length === 0) {
    // If no monthly data, create a simple array with current week
    return [currentWeekCommits]
  }
  
  // Convert monthly data to weekly data (approximate)
  const weeklyData = []
  commitsPerMonth.forEach(month => {
    // Distribute monthly commits across 4 weeks (approximate)
    const weeklyAverage = Math.floor(month.count / 4)
    for (let i = 0; i < 4; i++) {
      weeklyData.push(weeklyAverage)
    }
  })
  
  // Replace the last week with current week data
  if (weeklyData.length > 0) {
    weeklyData[weeklyData.length - 1] = currentWeekCommits
  } else {
    weeklyData.push(currentWeekCommits)
  }
  
  // Ensure we have at least 12 weeks of data
  while (weeklyData.length < 12) {
    weeklyData.unshift(0)
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

const WeeklyActivityChart = ({ resource, showThreeYearOption = true, hidePeriodSwitches = false, hideActivityLevelInfo = false }) => {
  const [activityData, setActivityData] = useState(null)
  const [weeklyData, setWeeklyData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, value: 0, label: '' })
  const [timePeriod, setTimePeriod] = useState('4weeks') // '4weeks', '3months', '52weeks', or '3years'

  // Map timePeriod to weeks
  const periodToWeeks = {
    '4weeks': 4,
    '3months': 13,
    '52weeks': 52,
    '3years': 156
  }

  useEffect(() => {
    const loadActivityData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        
        // Determine number of weeks based on time period
        const weeks = periodToWeeks[timePeriod] || 4
        
        console.log(`🔍 [WeeklyActivityChart] Loading data for ${resource.name} (${weeks} weeks)`)
        console.log(`🔍 [WeeklyActivityChart] Resource GitHub URL: ${resource.social?.github}`)
        
        // First, try to get data from Supabase
        const hasRecent = await hasRecentData(resource, 24) // 24 hours
        console.log(`🔍 [WeeklyActivityChart] Has recent data: ${hasRecent}`)
        
        if (hasRecent) {
          logger.log(`📊 Loading cached Supabase data for ${resource.name} (${weeks} weeks)`)
          const weeklyData = await getWeeklyActivity(resource, weeks)
          console.log(`🔍 [WeeklyActivityChart] Supabase weekly data:`, weeklyData)
          console.log(`🔍 [WeeklyActivityChart] Supabase data length: ${weeklyData?.length || 0}`)
          
          if (weeklyData && weeklyData.length > 0) {
            // Transform Supabase data to match expected format
            const transformedData = weeklyData.map(record => ({
              weekStart: record.week_start,
              count: record.commit_count
            }))
            
            console.log(`🔍 [WeeklyActivityChart] Transformed data sample:`, transformedData.slice(0, 3))
            console.log(`🔍 [WeeklyActivityChart] Transformed data length: ${transformedData.length}`)
            
            const currentWeek = transformedData[transformedData.length - 1]?.count || 0
            console.log(`🔍 [WeeklyActivityChart] Current week commits: ${currentWeek}`)
            
            setActivityData({
              currentWeek: currentWeek,
              repoInfo: null, // We'll get this from server if needed
            })
            // Only use as many weeks as available, up to the requested period
            const trimmedData = transformedData.slice(-weeks)
            setWeeklyData(trimmedData)
            setIsLoading(false)
            console.log(`✅ [WeeklyActivityChart] Successfully loaded Supabase data for ${resource.name}`)
            return
          } else {
            console.log(`⚠️ [WeeklyActivityChart] No Supabase data found for ${resource.name}`)
          }
        } else {
          console.log(`⚠️ [WeeklyActivityChart] No recent Supabase data for ${resource.name}`)
        }
        
        // Fallback to server data
        logger.log(`🔄 Fetching fresh data from server for ${resource.name}`)
        const resourceData = await fetchGitHubUpdates(resource)
        console.log(`🔍 [WeeklyActivityChart] Server data:`, resourceData)
        console.log(`🔍 [WeeklyActivityChart] Server commitsPerWeekDetailed:`, resourceData?.commitsPerWeekDetailed)
        
        if (resourceData && resourceData.commitsPerWeekDetailed && resourceData.commitsPerWeekDetailed.length > 0) {
          // Use only as many weeks as available, up to the selected period
          const allWeeks = resourceData.commitsPerWeekDetailed.slice(-weeks)
          setWeeklyData(allWeeks)
        } else {
          console.log(`⚠️ [WeeklyActivityChart] No server data available for ${resource.name}`)
          setError('No activity data available')
        }
      } catch (err) {
        logger.error(`Failed to load activity data for ${resource.name}:`, err)
        console.error(`❌ [WeeklyActivityChart] Error loading data for ${resource.name}:`, err)
        setError('Failed to load activity data')
      } finally {
        setIsLoading(false)
      }
    }
    loadActivityData()
  }, [resource, timePeriod])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400"></div>
        <span className="ml-2 text-gray-400 text-sm">Loading activity...</span>
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
  const maxCommits = Math.max(...weeklyData.map(w => w.count), 1)
  const minCommits = Math.min(...weeklyData.map(w => w.count), 0)
  const currentWeekCommits = weeklyData[weeklyData.length - 1]?.count || 0

  // Generate chart points
  const chartPoints = weeklyData.map((w, i) => {
    const x = chartPadding + (i / (weeklyData.length - 1 || 1)) * (chartWidth - 2 * chartPadding)
    const y = chartHeight - chartPadding - (w.count / maxCommits) * (chartHeight - 2 * chartPadding)
    return `${x},${y}`
  }).join(' ')

  // Month label logic
  let lastMonth = ''
  const monthLabels = weeklyData.map((w, i) => {
    const month = new Date(w.weekStart).toLocaleString('default', { month: 'short' })
    if (month !== lastMonth) {
      lastMonth = month
      return month
    }
    return ''
  })

  // Tooltip handlers
  const handleNodeMouseOver = (e, value, weekIdx) => {
    const week = weeklyData[weekIdx]
    const weekNumber = weekIdx + 1
    const month = new Date(week.weekStart).toLocaleString('default', { month: 'short' })
    const endOfWeek = new Date(week.weekStart)
    endOfWeek.setDate(endOfWeek.getDate() + 6)
    const label = `Week ${weekNumber} (${week.weekStart}–${endOfWeek.toISOString().slice(0, 10)}, ${month})`
    setTooltip({
      show: true,
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      value,
      label
    })
  }
  const handleNodeMouseOut = () => setTooltip({ show: false, x: 0, y: 0, value: 0, label: '' })

  // Period selection buttons - match DevelopmentActivityWidget labels
  const periodOptions = [
    { key: '4weeks', label: 'Last 4 Weeks' },
    { key: '3months', label: 'Last 3 Months' },
    { key: '52weeks', label: 'Last 1 Year' },
    ...(showThreeYearOption ? [{ key: '3years', label: 'Last 3 Years' }] : [])
  ]

  return (
    <div className="w-full">
      {!hidePeriodSwitches && (
        <div className="flex flex-wrap gap-2 mb-4">
          {periodOptions.map(opt => (
            <button
              key={opt.key}
              className={`px-2 sm:px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                timePeriod === opt.key ? 'btn-primary' : 'bg-gray-700 text-cyan-300 hover:bg-cyan-800 hover:text-white'
              }`}
              onClick={() => setTimePeriod(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <TrendingUp size={16} className="text-cyan-400" />
          <h4 className="text-white font-medium text-sm">
            Weekly Activity
            {activityData.repoInfo?.isOrganization && (
              <span className="text-gray-400 text-xs ml-1">(Organization)</span>
            )}
          </h4>
        </div>
        

      </div>

      {/* Line Chart */}
      <div className="bg-gray-800/50 rounded-lg p-4 sm:p-6" style={{ minHeight: window.innerWidth < 1024 ? 180 : 220 }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-400 text-xs">
            {timePeriod === '52weeks' ? 'Last 52 Weeks' : timePeriod === '3years' ? 'Last 3 Years' : timePeriod === '3months' ? 'Last 3 Months' : 'Last 4 Weeks'}
          </span>
          <div className="flex items-center space-x-1">
            <GitCommit size={12} className="text-cyan-400" />
            <span className="text-white font-bold text-lg">{currentWeekCommits}</span>
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
              <linearGradient id="teal-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="50%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#67e8f9" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            
            {/* Background grid */}
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Month boundary grid lines */}
            {monthLabels.map((label, i) => label && i !== 0 && (
              <line
                key={`month-grid-${i}`}
                x1={chartPadding + (i / (weeklyData.length - 1)) * (chartWidth - 2 * chartPadding)}
                y1={chartPadding}
                x2={chartPadding + (i / (weeklyData.length - 1)) * (chartWidth - 2 * chartPadding)}
                y2={chartHeight - bottomPadding}
                stroke="#22d3ee"
                strokeDasharray="4 2"
                strokeWidth="1"
                opacity="0.25"
              />
            ))}

            {/* Week ticks */}
            {weeklyData.map((_, i) => (
              <line
                key={`tick-${i}`}
                x1={chartPadding + (i / (weeklyData.length - 1)) * (chartWidth - 2 * chartPadding)}
                y1={chartHeight - bottomPadding}
                x2={chartPadding + (i / (weeklyData.length - 1)) * (chartWidth - 2 * chartPadding)}
                y2={chartHeight - bottomPadding + 8}
                stroke="#67e8f9"
                strokeWidth="1"
                opacity="0.3"
              />
            ))}
            
            {/* Glow effect */}
            <polyline
              points={chartPoints}
              fill="none"
              stroke="#22d3ee"
              strokeWidth="8"
              opacity="0.2"
              filter="url(#glow)"
            />
            
            {/* Main line */}
            <polyline
              points={chartPoints}
              fill="none"
              stroke="url(#teal-gradient)"
              strokeWidth="2"
              style={{ filter: 'drop-shadow(0 0 2.5px #22d3ee)' }}
            />
            
            {/* Data points (nodes) with tooltips */}
            {weeklyData.map((w, i) => {
              const x = chartPadding + (i / (weeklyData.length - 1)) * (chartWidth - 2 * chartPadding)
              const y = chartHeight - chartPadding - (w.count / maxCommits) * (chartHeight - 2 * chartPadding)
              return (
                <g key={i}>
                  <circle
                    cx={x}
                    cy={y}
                    r={w.count > 0 ? "5" : "2.5"}
                    fill={w.count > 0 ? "#22d3ee" : "#334155"}
                    stroke="#0f172a"
                    strokeWidth="1"
                    opacity={w.count > 0 ? 1 : 0.5}
                    style={{ filter: w.count > 0 ? 'drop-shadow(0 0 4px #22d3ee)' : 'none', cursor: 'pointer' }}
                    onMouseOver={e => handleNodeMouseOver(e, w.count, i)}
                    onMouseOut={handleNodeMouseOut}
                  />
                </g>
              )
            })}
            
            {/* Month labels */}
            {weeklyData.map((w, i) => {
              const date = new Date(w.weekStart)
              const isMonthStart = date.getDate() <= 7 // first week of month
              const isYearStart = date.getMonth() === 0 && isMonthStart
              if (isYearStart) {
                return (
                  <text
                    key={`year-label-${i}`}
                    x={chartPadding + (i / (weeklyData.length - 1)) * (chartWidth - 2 * chartPadding)}
                    y={chartHeight - bottomPadding / 2 + 32}
                    fontSize={window.innerWidth < 1024 ? "14" : "16"}
                    fill="#67e8f9"
                    textAnchor="middle"
                    fontWeight="bold"
                  >{date.getFullYear()}</text>
                )
              } else if (isMonthStart) {
                return (
                  <text
                    key={`month-label-${i}`}
                    x={chartPadding + (i / (weeklyData.length - 1)) * (chartWidth - 2 * chartPadding)}
                    y={chartHeight - bottomPadding / 2 + 18}
                    fontSize={window.innerWidth < 1024 ? "11" : "13"}
                    fill="#67e8f9"
                    textAnchor="middle"
                    fontWeight="bold"
                  >{date.toLocaleString('default', { month: 'short' })}</text>
                )
              }
              return null
            })}
            {/* Y-axis labels */}
            <text x={chartPadding - 8} y={chartPadding + 8} fontSize="10" fill="#64748b" textAnchor="end">{maxCommits}</text>
            <text x={chartPadding - 8} y={chartHeight - chartPadding + 8} fontSize="10" fill="#64748b" textAnchor="end">{minCommits}</text>
          </svg>
          {/* Tooltip */}
          {tooltip.show && (
            <div
              className="absolute z-50 px-2 py-1 rounded bg-gray-900 text-cyan-200 text-xs border border-cyan-400 shadow-lg pointer-events-none"
              style={{ left: tooltip.x + 10, top: tooltip.y - 30 }}
            >
              <div className="font-bold">{tooltip.label}</div>
              <div>{tooltip.value} commits</div>
            </div>
          )}
        </div>
        
        {/* Chart info */}
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>Commits per week for this resource</span>
          <span>{weeklyData.filter(w => w.count > 0).length}/{weeklyData.length} active weeks</span>
        </div>
      </div>

      {/* Current Week Stats */}
      <div className="bg-gray-800/50 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400 text-xs">This Week</span>
          <div className="flex items-center space-x-1">
            <GitCommit size={12} className="text-cyan-400" />
            <span className="text-white font-bold text-lg">{activityData.currentWeek}</span>
            <span className="text-gray-400 text-xs">commits</span>
          </div>
        </div>

        {/* Simple Bar Chart for current week, scaled to min-max */}
        <div className="relative">
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-cyan-400 to-cyan-500 h-2 rounded-full transition-all duration-500 ease-out shadow-lg"
              style={{ 
                width: `${((activityData.currentWeek - minCommits) / (maxCommits - minCommits || 1)) * 100}%`,
                boxShadow: '0 0 10px rgba(34, 211, 238, 0.5)'
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