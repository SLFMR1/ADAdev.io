import React, { useState, forwardRef } from 'react'
import Portal from './Portal'
import { getWeekStart } from '../utils/weekCalculation'
import { generateChartPoints, validateNodeCount } from '../utils/chartDataUtils'

// Use centralized chart point generation - removed duplicate function

const AggregatedActivityChart = forwardRef(({ weeklyData, width = 700, height = 300, padding = 40, rightPadding, period, screenshotMode = false, accentColor = { hex: '#FFFFFF', rgb: '255, 255, 255' }, contributingResources = null }, svgRef) => {
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, value: 0, label: '' })
  
  if (!weeklyData || weeklyData.length === 0) {
    return (
      <div className="text-center py-8">
        <span className="text-gray-400 text-sm">No activity data available</span>
      </div>
    )
  }

  // Filter out weeks with no activity to avoid repeating patterns
  const activeWeeks = weeklyData.filter(w => w.count > 0)
  const hasRealData = activeWeeks.length > 0
  
  // If no real data, show empty state
  if (!hasRealData) {
    return (
      <div className="text-center py-8">
        <span className="text-gray-400 text-sm">No historical activity data available</span>
      </div>
    )
  }

  const maxCommits = Math.max(...weeklyData.map(w => w.count), 1)
  
  // Validate node count for the period
  validateNodeCount(weeklyData, period, 'AggregatedActivityChart')
  
  // X-axis label logic - improved for all periods
  const xLabels = weeklyData.map((w, i) => {
    const date = new Date(w.weekStart)
    const month = date.getMonth()
    const year = date.getFullYear()
    const day = date.getDate()
    const currentYear = new Date().getFullYear()
    
    // Determine important markers based on period
    if (period === '3years') {
      // Show years prominently and quarters moderately
      if (month === 0 && day <= 7) {
        return { type: 'year', value: year.toString(), priority: 3 }
      } else if ([0, 3, 6, 9].includes(month) && day <= 7 && i % 3 === 0) {
        return { type: 'quarter', value: `Q${Math.floor(month / 3) + 1}`, priority: 2 }
      }
    } else if (period === '52weeks') {
      // Show year and quarters for 1-year view
      if (month === 0 && day <= 7) {
        return { type: 'year', value: year.toString(), priority: 3 }
      } else if ([0, 3, 6, 9].includes(month) && day <= 7) {
        return { type: 'quarter', value: date.toLocaleString('default', { month: 'short' }), priority: 2 }
      } else if (day <= 7 && i % 4 === 0) {
        return { type: 'month', value: date.toLocaleString('default', { month: 'short' }), priority: 1 }
      }
    } else if (period === '3months') {
      // Show months and some weeks for 3-month view
      if (day <= 7) {
        return { type: 'month', value: date.toLocaleString('default', { month: 'short' }), priority: 2 }
      } else if (i % 2 === 0) {
        return { type: 'week', value: `W${Math.floor(i / 2) + 1}`, priority: 1 }
      }
    } else if (period === 'current') {
      // For 7-day view, show day names for all days
      const dayName = date.toLocaleString('default', { weekday: 'short' })
      return { type: 'day', value: dayName, priority: 2 }
    } else if (period === '4weeks' || period === '5weeks') {
      // For 4-5 week views, show all weeks
      if (day <= 7) {
        return { type: 'month', value: date.toLocaleString('default', { month: 'short' }), priority: 2 }
      } else {
        return { type: 'week', value: `W${i + 1}`, priority: 1 }
      }
    } else {
      // For other periods, show months and weeks
      if (day <= 7) {
        return { type: 'month', value: date.toLocaleString('default', { month: 'short' }), priority: 2 }
      } else if (i % 2 === 0) {
        return { type: 'week', value: `W${Math.floor(i / 2) + 1}`, priority: 1 }
      }
    }
    
    return null
  })
  
  // Tooltip handlers with viewport-relative positioning
  const handleNodeMouseOver = (e, value, weekIdx) => {
    const w = weeklyData[weekIdx]
    let label
    if (period === '12months' && w.label) {
      label = w.label
    } else {
      const weekStartDate = new Date(w.weekStart)
      
      // Use centralized week calculation to ensure consistency with server
      const correctWeekStart = getWeekStart(weekStartDate)
      const correctEndOfWeek = new Date(correctWeekStart)
      correctEndOfWeek.setDate(correctWeekStart.getDate() + 6)
      
      // Format dates nicely
      const formatDate = (date) => {
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: 'numeric'
        });
      };
      
      const startDate = formatDate(correctWeekStart);
      const endDate = formatDate(correctEndOfWeek);
      
      // Create period-appropriate labels
      if (period === 'current') {
        // For 7-day period, show the actual date
        const date = new Date(w.weekStart)
        const dayName = date.toLocaleString('default', { weekday: 'long' })
        const dayOfMonth = date.getDate()
        const month = date.toLocaleString('default', { month: 'short' })
        label = `${dayName} • ${month} ${dayOfMonth}`
      } else if (period === '3years') {
        const weekNumber = weekIdx + 1
        label = `Week ${weekNumber} • ${startDate} – ${endDate}`
      } else if (period === '52weeks') {
        const weekNumber = weekIdx + 1
        label = `Week ${weekNumber} • ${startDate} – ${endDate}`
      } else if (period === '4weeks' || period === '5weeks') {
        const weekNumber = weekIdx + 1
        label = `Week ${weekNumber} • ${startDate} – ${endDate}`
      } else {
        const weekNumber = weekIdx + 1
        label = `Week ${weekNumber} • ${startDate} – ${endDate}`
      }
    }
    
    // Get contributing resources for this data point
    let contributors = [];
    if (contributingResources && contributingResources[weekIdx]) {
      contributors = contributingResources[weekIdx]
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 4); // Show top 4 contributors
    }
    
    // Get viewport-relative position - use getBoundingClientRect for fixed positioning
    const rect = e.target.getBoundingClientRect()
    const viewportX = rect.left
    const viewportY = rect.top
    
    setTooltip({
      show: true,
      x: viewportX,
      y: viewportY,
      value,
      label,
      contributors
    })
  }
  const handleNodeMouseOut = () => {
    setTooltip({ show: false, x: 0, y: 0, value: 0, label: '' })
  }
  
  // Calculate Y-axis labels - ensure we always show meaningful scale
  const yAxisLabels = []
  const maxLabel = Math.max(Math.ceil(maxCommits / 10) * 10, 10) // Minimum scale of 10
  const step = Math.max(1, Math.floor(maxLabel / 6)) // 6-7 labels for better granularity
  
  // Always include 0 and ensure we have good distribution
  yAxisLabels.push(0)
  for (let i = step; i <= maxLabel; i += step) {
    yAxisLabels.push(i)
  }
  
  // Ensure we don't have duplicate 0
  const uniqueLabels = [...new Set(yAxisLabels)].sort((a, b) => a - b)
  
  // Dynamic padding based on max number width + screenshot mode
  const maxLabelWidth = Math.max(...uniqueLabels.map(label => label.toString().length)) * 8; // ~8px per digit
  const basePadding = screenshotMode ? 50 : 30; // Reduced base padding
  const effectivePadding = Math.max(basePadding, maxLabelWidth + 15); // Reduced margin
  const effectiveRightPadding = 15; // Reduced to match tighter spacing
  // Use actual chart height - labels are positioned within chart area
  const svgHeight = height;
  // Adjust width for balanced padding
  const effectiveWidth = width;
  
  // Generate chart points with calculated dimensions
  const chartPoints = generateChartPoints(weeklyData, effectiveWidth, height, effectivePadding, effectiveRightPadding);
  
  return (
    <div className="relative">
      <svg ref={svgRef} width={effectiveWidth} height={svgHeight} className="w-full" viewBox={`0 0 ${effectiveWidth} ${svgHeight}`} preserveAspectRatio="xMidYMid meet">
        {/* Background grid */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" strokeWidth="0.5" opacity="0.3"/>
          </pattern>
          <linearGradient id="accent-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accentColor.hex} />
            <stop offset="100%" stopColor={accentColor.hex} />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        
        {/* Background grid - transparent to show global gradient */}
        <rect width="100%" height="100%" fill="url(#grid)" opacity="0.3" />
        
        {/* Horizontal grid lines for Y-axis labels */}
        {uniqueLabels.map((label, i) => {
          const y = height - effectivePadding - (label / maxCommits) * (height - 2 * effectivePadding)
          return (
            <line
              key={`grid-line-${i}`}
              x1={effectivePadding}
              y1={y}
              x2={effectiveWidth - effectiveRightPadding}
              y2={y}
              stroke={accentColor.hex}
              strokeDasharray="3 3"
              strokeWidth="0.8"
              opacity="0.3"
            />
          )
        })}
        
        {/* Vertical month boundary grid lines */}
        {xLabels.map((label, i) =>
          label && label.type && (
            // Show all labels for short periods, filter for longer periods
            (period === 'current' || period === '4weeks' || period === '5weeks' || 
             ['year', 'quarter', 'month'].includes(label.type)) && (
            <line
              key={`month-grid-${i}`}
              x1={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
              y1={effectivePadding}
              x2={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
              y2={height - effectivePadding}
              stroke={accentColor.hex}
              strokeDasharray={label.type === 'year' ? "6 3" : label.type === 'day' ? "2 2" : "4 2"}
              strokeWidth={label.type === 'year' ? "1.5" : label.type === 'day' ? "0.8" : "1"}
              opacity={label.type === 'year' ? "0.4" : label.type === 'day' ? "0.2" : "0.25"}
            />
          ))
        )}
        {/* Short week tick marks */}
        {weeklyData.map((_, i) => weeklyData.length > 1 && (
          <line
            key={`tick-${i}`}
            x1={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
            y1={height - effectivePadding}
            x2={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
            y2={height - effectivePadding + 8}
            stroke={accentColor.hex}
            strokeWidth="1"
            opacity="0.3"
          />
        ))}

        {/* Glow */}
        <polyline
          points={chartPoints}
          fill="none"
          stroke={accentColor.hex}
          strokeWidth="4"
          opacity="0.4"
          filter="url(#glow)"
        />
        {/* Main Line */}
        <polyline
          points={chartPoints}
          fill="none"
          stroke="url(#accent-gradient)"
          strokeWidth="1"
                            style={{ filter: `drop-shadow(0 0 3px rgba(${accentColor.rgb},0.5))` }}
        />
        {/* Invisible larger hover areas for tooltips */}
        {weeklyData.map((w, i) => {
          const stepX = (effectiveWidth - effectivePadding - effectiveRightPadding) / (weeklyData.length - 1)
          const x = effectivePadding + i * stepX
          const y = height - effectivePadding - (w.count / maxCommits) * (height - 2 * effectivePadding)
          return (
            <g key={i}>
              {/* Visible dot */}
              <circle
                cx={x}
                cy={y}
                r={w.count > 0 ? "4" : "2.5"}
                fill="none"
                stroke={w.count > 0 ? accentColor.hex : "#64748b"}
                strokeWidth="1.5"
                style={{ 
                  filter: w.count > 0 ? `drop-shadow(0 0 6px rgba(${accentColor.rgb},0.6))` : 'none'
                }}
                pointerEvents="none"
              />
              {/* Larger invisible hover area */}
              <circle
                cx={x}
                cy={y}
                r="12"
                fill="transparent"
                style={{ cursor: screenshotMode ? 'default' : 'pointer' }}
                onMouseOver={screenshotMode ? undefined : (e => handleNodeMouseOver(e, w.count, i))}
                onMouseOut={screenshotMode ? undefined : handleNodeMouseOut}
              />
            </g>
          )
        })}
        
        {/* Y-axis labels */}
        {uniqueLabels.map((label, i) => {
          const y = height - effectivePadding - (label / maxCommits) * (height - 2 * effectivePadding)
          const labelSpacing = 12; // increased space for better readability
          const leftPadding = 8;
          return (
            <text
              key={i}
              x={effectivePadding - labelSpacing - leftPadding}
              y={y + 4}
              fontSize="13"
              fill={accentColor.hex}
              textAnchor="end"
              dominantBaseline="middle"
              fontWeight="500"
              style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
            >
              {label}
            </text>
          )
        })}
        
        {/* X-axis labels */}
        {(() => {
          const labels = [];
          // More lenient spacing for shorter periods
          const minLabelSpacing = (period === 'current' || period === '4weeks' || period === '5weeks') 
            ? 40  // Tighter spacing for short periods
            : 60; // Standard spacing for longer periods
          let lastLabelX = -minLabelSpacing;
          
          // Sort labels by priority and apply collision detection
          xLabels
            .map((label, i) => ({ label, index: i }))
            .filter(item => item.label)
            .sort((a, b) => (b.label.priority || 0) - (a.label.priority || 0))
            .forEach(({ label, index }) => {
              const x = effectivePadding + (index / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding);
              
              if (x - lastLabelX >= minLabelSpacing) {
                lastLabelX = x;
                labels.push(
                  <text
                    key={`x-label-${index}`}
                    x={x}
                    y={height - effectivePadding + (screenshotMode ? 12 : 16)}
                    fontSize={label.type === 'year' ? '15' : label.type === 'quarter' ? '13' : '12'}
                    fontWeight={label.type === 'year' ? 'bold' : label.type === 'quarter' ? '600' : '500'}
                    fill={accentColor.hex}
                    textAnchor="middle"
                    style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
                  >
                    {label.value}
                  </text>
                );
              }
            });
          
          return labels;
        })()}
      </svg>
      {/* Tooltip using Portal for proper overflow */}
      {tooltip.show && !screenshotMode && (
        <Portal>
          <div
            className="fixed z-[10000] px-4 py-3 rounded-lg bg-gray-900/95 backdrop-blur-sm text-white text-sm shadow-xl pointer-events-none max-w-xs"
            style={{ 
              left: Math.min(tooltip.x + 10, window.innerWidth - 280), 
              top: Math.max(tooltip.y - 60, 10),
              boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4)`
            }}
          >
            <div className="font-semibold mb-1" style={{ color: accentColor.hex }}>
              {tooltip.value} commits
            </div>
            <div className="text-gray-300 text-xs leading-relaxed mb-2">
              {tooltip.label}
            </div>
            {tooltip.contributors && tooltip.contributors.length > 0 && tooltip.contributors.some(c => c.count > 0) && (
              <div className="border-t border-gray-700 pt-2">
                <div className="text-gray-400 text-xs mb-1">Top contributors:</div>
                {tooltip.contributors.map((contributor, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-300 truncate flex-1 mr-2">
                      {contributor.resource?.name || contributor.name || `Resource ${idx + 1}`}
                    </span>
                    <span className="text-gray-400 font-medium" style={{ color: accentColor.hex }}>
                      {contributor.count}
                    </span>
                  </div>
                ))}
                {tooltip.contributors.length >= 4 && (
                  <div className="text-gray-500 text-xs italic">
                    +{Math.max(0, tooltip.value - tooltip.contributors.reduce((sum, c) => sum + c.count, 0))} more
                  </div>
                )}
              </div>
            )}
          </div>
        </Portal>
      )}
    </div>
  )
})

export default AggregatedActivityChart 