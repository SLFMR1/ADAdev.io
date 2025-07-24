import React, { useState, forwardRef } from 'react'
import Portal from './Portal'

// Helper to generate line chart points from data
const getLineChartPoints = (data, width, height, padding, rightPadding) => {
  if (!data || data.length === 0) return ''
  
  // Ensure we have valid data
  const validData = data.filter(w => w && typeof w.count === 'number' && !isNaN(w.count))
  if (validData.length === 0) return ''
  
  const max = Math.max(...validData.map(w => w.count), 1)
  const stepX = validData.length > 1 ? (width - padding - rightPadding) / (validData.length - 1) : 0
  
  return validData.map((w, i) => {
    const x = padding + i * stepX
    const y = height - padding - (w.count / max) * (height - 2 * padding)
    return `${x},${y}`
  }).join(' ')
}

const AggregatedActivityChart = forwardRef(({ weeklyData, width = 700, height = 200, padding = 30, rightPadding, period, screenshotMode = false }, svgRef) => {
  // Use more left padding in screenshot mode
  const effectivePadding = screenshotMode ? 64 : 32;
  const effectiveRightPadding = 24;
  // Always use tight SVG height (enough for chart and axis labels)
  const svgHeight = height + 12;
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
  
  // Adjust padding for screenshot mode
  const effectiveWidth = screenshotMode ? width + 30 : width
  
  console.log('AggregatedActivityChart - screenshotMode:', screenshotMode, 'effectivePadding:', effectivePadding, 'effectiveWidth:', effectiveWidth)
  
  const chartPoints = getLineChartPoints(weeklyData, effectiveWidth, height, effectivePadding, effectiveRightPadding)
  
  // X-axis label logic - improved for 3 years
  let lastMonth = ''
  const xLabels = weeklyData.map((w, i) => {
    const date = new Date(w.weekStart)
    if (period === '3years') {
      // Show only for first week of each quarter and handle missing data
      const month = date.getMonth()
      const year = date.getFullYear()
      const currentYear = new Date().getFullYear()
      
      // Only show labels for recent years (within 3 years from now)
      if (year >= currentYear - 2) {
        // Jan (0), Apr (3), Jul (6), Oct (9)
        if ((month === 0 || month === 3 || month === 6 || month === 9) && date.getDate() <= 7) {
          // If January, show year
          if (month === 0) return { type: 'year', value: String(year).slice(-2) }
          return { type: 'month', value: date.toLocaleString('default', { month: 'short' }) }
        }
      }
      return ''
    }
    if (period === '12months' && w.label) return { type: 'month', value: w.label }
    // Otherwise, show month for first week of each month
    const month = date.toLocaleString('default', { month: 'short' })
    if (month !== lastMonth) {
      lastMonth = month
      if (date.getMonth() === 0) return { type: 'year', value: String(date.getFullYear()).slice(-2) }
      return { type: 'month', value: month }
    }
    return ''
  })
  
  // Tooltip handlers with viewport-relative positioning
  const handleNodeMouseOver = (e, value, weekIdx) => {
    const w = weeklyData[weekIdx]
    let label
    if (period === '12months' && w.label) {
      label = w.label
    } else {
      const month = new Date(w.weekStart).toLocaleString('default', { month: 'short' })
      const year = new Date(w.weekStart).getFullYear()
      const endOfWeek = new Date(w.weekStart)
      endOfWeek.setDate(endOfWeek.getDate() + 6)
      
      // Improved label for different periods
      if (period === 'current') {
        // For 7-day period, show the actual date
        const date = new Date(w.weekStart)
        const dayName = date.toLocaleString('default', { weekday: 'short' })
        const dayOfMonth = date.getDate()
        label = `${dayName}, ${month} ${dayOfMonth}`
      } else if (period === '3years') {
        label = `${w.weekStart}–${endOfWeek.toISOString().slice(0, 10)} (${month} ${year})`
      } else if (period === '52weeks') {
        const weekNumber = weekIdx + 1
        label = `Week ${weekNumber} (${w.weekStart}–${endOfWeek.toISOString().slice(0, 10)}, ${month} ${year})`
      } else {
        const weekNumber = weekIdx + 1
        label = `Week ${weekNumber} (${w.weekStart}–${endOfWeek.toISOString().slice(0, 10)}, ${month})`
      }
    }
    
    // Get viewport-relative position
    const rect = e.target.getBoundingClientRect()
    const viewportX = rect.left + window.scrollX
    const viewportY = rect.top + window.scrollY
    
    setTooltip({
      show: true,
      x: viewportX,
      y: viewportY,
      value,
      label
    })
  }
  const handleNodeMouseOut = () => setTooltip({ show: false, x: 0, y: 0, value: 0, label: '' })
  
  // Calculate Y-axis labels
  const yAxisLabels = []
  const maxLabel = Math.ceil(maxCommits / 10) * 10 // Round up to nearest 10
  const step = Math.max(1, Math.floor(maxLabel / 5)) // 5 labels max
  
  for (let i = 0; i <= maxLabel; i += step) {
    yAxisLabels.push(i)
  }
  
  return (
    <div className="relative">
      <svg ref={svgRef} width={effectiveWidth} height={svgHeight} className="w-full" viewBox={`0 0 ${effectiveWidth} ${svgHeight}`} preserveAspectRatio="xMidYMid meet">
        {/* Background grid */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" strokeWidth="0.5" opacity="0.3"/>
          </pattern>
          <linearGradient id="teal-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#67e8f9" />
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
        {yAxisLabels.map((label, i) => {
          const y = height - effectivePadding - (label / maxCommits) * (height - 2 * effectivePadding)
          return (
            <line
              key={`grid-line-${i}`}
              x1={effectivePadding}
              y1={y}
              x2={effectiveWidth - effectiveRightPadding}
              y2={y}
              stroke="#22d3ee"
              strokeDasharray="4 2"
              strokeWidth="1"
              opacity="0.25"
            />
          )
        })}
        
        {/* Vertical month boundary grid lines */}
        {xLabels.map((label, i) =>
          label && typeof label === 'object' && weeklyData.length > 1 && (
            <line
              key={`month-grid-${i}`}
              x1={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
              y1={effectivePadding}
              x2={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
              y2={height - effectivePadding}
              stroke="#22d3ee"
              strokeDasharray="4 2"
              strokeWidth="1"
              opacity="0.25"
            />
          )
        )}
        {/* Short week tick marks */}
        {weeklyData.map((_, i) => weeklyData.length > 1 && (
          <line
            key={`tick-${i}`}
            x1={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
            y1={height - effectivePadding}
            x2={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
            y2={height - effectivePadding + 8}
            stroke="#67e8f9"
            strokeWidth="1"
            opacity="0.3"
          />
        ))}

        {/* Glow */}
        <polyline
          points={chartPoints}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="4"
          opacity="0.4"
          filter="url(#glow)"
        />
        {/* Main Line */}
        <polyline
          points={chartPoints}
          fill="none"
          stroke="url(#teal-gradient)"
          strokeWidth="1"
          style={{ filter: 'drop-shadow(0 0 3px rgba(34,211,238,0.5))' }}
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
                stroke={w.count > 0 ? "#22d3ee" : "#64748b"}
                strokeWidth="1.5"
                style={{ 
                  filter: w.count > 0 ? 'drop-shadow(0 0 6px rgba(34,211,238,0.6))' : 'none'
                }}
                pointerEvents="none"
              />
              {/* Larger invisible hover area */}
              <circle
                cx={x}
                cy={y}
                r="12"
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseOver={e => handleNodeMouseOver(e, w.count, i)}
                onMouseOut={handleNodeMouseOut}
              />
            </g>
          )
        })}
        
        {/* Y-axis labels */}
        {yAxisLabels.map((label, i) => {
          const y = height - effectivePadding - (label / maxCommits) * (height - 2 * effectivePadding)
          const labelSpacing = 8; // reduced space between y-axis and label (always)
          const leftPadding = 8; // always use 8px for left padding
          return (
            <text
              key={i}
              x={effectivePadding - labelSpacing - leftPadding}
              y={y + 4}
              fontSize="12"
              fill="#67e8f9"
              textAnchor="end"
              dominantBaseline="middle"
              style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
            >
              {label}
            </text>
          )
        })}
        
        {/* X-axis labels */}
        {xLabels.map((label, i) => label && (
          typeof label === 'object' ? (
            <text
              key={i}
              x={effectivePadding + (i / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
              y={height - effectivePadding + (screenshotMode ? 8 : 12)}
              fontSize={label.type === 'year' ? '14' : '12'}
              fontWeight={label.type === 'year' ? 'bold' : 'normal'}
              fill="#67e8f9"
              textAnchor="middle"
              style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
            >
              {label.value}
            </text>
          ) : null
        ))}
      </svg>
      {/* Tooltip using Portal for proper overflow */}
      {tooltip.show && (
        <Portal>
          <div
            className="fixed z-[9999] px-3 py-2 bg-gray-900 text-cyan-200 text-sm rounded-lg shadow-lg pointer-events-none border border-gray-700 max-w-xs"
            style={{ 
              left: Math.min(tooltip.x + 10, window.innerWidth - 200), 
              top: Math.max(tooltip.y - 60, 10)
            }}
          >
            <div className="font-semibold">{tooltip.value} commits</div>
            <div className="text-gray-400 text-xs">{tooltip.label}</div>
          </div>
        </Portal>
      )}
    </div>
  )
})

export default AggregatedActivityChart 