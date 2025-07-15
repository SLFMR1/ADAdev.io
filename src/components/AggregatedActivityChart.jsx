import React, { useState, forwardRef } from 'react'

// Helper to generate line chart points from data
const getLineChartPoints = (data, width, height, padding, rightPadding) => {
  if (!data || data.length === 0) return ''
  const max = Math.max(...data.map(w => w.count), 1)
  const stepX = (width - padding - rightPadding) / (data.length - 1)
  return data.map((w, i) => {
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
  
  // Tooltip handlers
  const handleNodeMouseOver = (e, value, weekIdx) => {
    const w = weeklyData[weekIdx]
    let label
    if (period === '12months' && w.label) {
      label = w.label
    } else {
      const weekNumber = weekIdx + 1
      const month = new Date(w.weekStart).toLocaleString('default', { month: 'short' })
      const endOfWeek = new Date(w.weekStart)
      endOfWeek.setDate(endOfWeek.getDate() + 6)
      label = `Week ${weekNumber} (${w.weekStart}–${endOfWeek.toISOString().slice(0, 10)}, ${month})`
    }
    setTooltip({
      show: true,
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
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
        
        {/* Background grid */}
        <rect width="100%" height="100%" fill="url(#grid)" />
        
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
          label && typeof label === 'object' && (
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
        {weeklyData.map((_, i) => (
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
          strokeWidth="6"
          opacity="0.3"
          filter="url(#glow)"
        />
        {/* Main Line */}
        <polyline
          points={chartPoints}
          fill="none"
          stroke="url(#teal-gradient)"
          strokeWidth="2"
          style={{ filter: 'drop-shadow(0 0 3px #22d3ee)' }}
        />
        {/* Dots for tooltips */}
        {weeklyData.map((w, i) => {
          const stepX = (effectiveWidth - effectivePadding - effectiveRightPadding) / (weeklyData.length - 1)
          const x = effectivePadding + i * stepX
          const y = height - effectivePadding - (w.count / maxCommits) * (height - 2 * effectivePadding)
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={w.count > 0 ? "5" : "3"}
              fill={w.count > 0 ? "#22d3ee" : "#64748b"}
              stroke="#0f172a"
              strokeWidth="1"
              style={{ 
                filter: w.count > 0 ? 'drop-shadow(0 0 4px #22d3ee)' : 'none', 
                cursor: 'pointer' 
              }}
              onMouseOver={e => handleNodeMouseOver(e, w.count, i)}
              onMouseOut={handleNodeMouseOut}
            />
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
      {/* Tooltip */}
      {tooltip.show && (
        <div
          className="absolute z-10 px-3 py-2 bg-gray-900 text-cyan-200 text-sm rounded-lg shadow-lg pointer-events-none border border-gray-700"
          style={{ left: tooltip.x + 10, top: tooltip.y - 40 }}
        >
          <div className="font-semibold">{tooltip.value} commits</div>
          <div className="text-gray-400 text-xs">{tooltip.label}</div>
        </div>
      )}
    </div>
  )
})

export default AggregatedActivityChart 