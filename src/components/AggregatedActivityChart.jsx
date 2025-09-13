import React, { useState, forwardRef } from 'react'
import Portal from './Portal'
import { getWeekStart } from '../utils/weekCalculation'
import { generateChartPoints, validateNodeCount, generateChartXAxisLabels } from '../utils/chartDataUtils'

// Use centralized chart point generation - removed duplicate function

const AggregatedActivityChart = forwardRef(({ weeklyData, width = 700, height = 300, padding = 40, rightPadding, period, screenshotMode = false, accentColor = { hex: '#FFFFFF', rgb: '255, 255, 255' }, contributingResources = null, isMobileScreenshot = false }, svgRef) => {
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, value: 0, label: '' })
  const areaGradientId = `aggregated-area-gradient-${(accentColor.hex || '#FFFFFF').replace('#','')}`
  
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
  
  const xAxisLabels = generateChartXAxisLabels(weeklyData, period);
  
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
  const isMobile = window.innerWidth < 768;
  const fontSize = isMobileScreenshot ? 24 : (isMobile ? 20 : 13);
  const charWidth = fontSize * 0.6; // More accurate character width based on font size
  const maxLabelWidth = Math.max(...uniqueLabels.map(label => label.toString().length)) * charWidth;
  const basePadding = screenshotMode ? 50 : 35; // Slightly increased base padding
  const effectivePadding = Math.max(basePadding, maxLabelWidth + 25); // Increased margin for mobile
  const effectiveRightPadding = 15; // Reduced to match tighter spacing
  // Use actual chart height - labels are positioned within chart area
  const svgHeight = height;
  // Adjust width for balanced padding
  const effectiveWidth = width;
  
  // Generate chart points with calculated dimensions
  const chartPoints = generateChartPoints(weeklyData, effectiveWidth, height, effectivePadding, effectiveRightPadding);
  const areaBaselineY = height - effectivePadding
  const areaLeftX = effectivePadding
  const areaRightX = effectiveWidth - effectiveRightPadding
  const areaPoints = `${areaLeftX},${areaBaselineY} ${chartPoints} ${areaRightX},${areaBaselineY}`
  
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
          <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor.hex} stopOpacity="0.35" />
            <stop offset="80%" stopColor={accentColor.hex} stopOpacity="0.12" />
            <stop offset="100%" stopColor={accentColor.hex} stopOpacity="0" />
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
        {xAxisLabels.map((label, i) =>
          label && label.type && (
            // Show all labels for short periods, filter for longer periods
            (period === 'current' || period === '4weeks' || period === '5weeks' || 
             ['year', 'month', 'day', 'date', 'midmonth'].includes(label.type)) && (
            <line
              key={`month-grid-${i}`}
              x1={effectivePadding + (label.index / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
              y1={effectivePadding}
              x2={effectivePadding + (label.index / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding)}
              y2={height - effectivePadding}
              stroke={accentColor.hex}
              strokeDasharray={label.type === 'year' ? "6 3" : label.type === 'day' ? "2 2" : label.type === 'date' || label.type === 'midmonth' ? "3 1" : "4 2"}
              strokeWidth={label.type === 'year' ? "1.5" : label.type === 'day' || label.type === 'date' || label.type === 'midmonth' ? "0.8" : "1"}
              opacity={label.type === 'year' ? "0.4" : label.type === 'day' || label.type === 'date' || label.type === 'midmonth' ? "0.2" : "0.25"}
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
            opacity="0.15"
          />
        ))}

        {/* Glow */}
        {/* Area under the line */}
        <polygon
          points={areaPoints}
          fill={`url(#${areaGradientId})`}
          stroke="none"
        />
        <polyline
          points={chartPoints}
          fill="none"
          stroke={accentColor.hex}
          strokeWidth={window.innerWidth < 768 ? "6" : "4"}
          opacity="0.4"
          filter="url(#glow)"
        />
        {/* Main Line */}
        <polyline
          points={chartPoints}
          fill="none"
          stroke="url(#accent-gradient)"
          strokeWidth={window.innerWidth < 768 ? "2" : "1"}
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
                r={window.innerWidth < 768 ? (w.count > 0 ? "6" : "4") : (w.count > 0 ? "4" : "2.5")}
                fill="none"
                stroke={w.count > 0 ? accentColor.hex : "#64748b"}
                strokeWidth={window.innerWidth < 768 ? "2.5" : "1.5"}
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
          const isMobile = window.innerWidth < 768;
          return (
            <text
              key={i}
              x={effectivePadding - labelSpacing - leftPadding}
              y={y + 4}
              fontSize={isMobileScreenshot ? "24" : (isMobile ? "20" : "13")}
              fill={accentColor.hex}
              textAnchor="end"
              dominantBaseline="middle"
              fontWeight="300"
              style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
            >
              {Number.isInteger(label) ? label : label.toFixed(2).replace(/\.?0+$/, '')}
            </text>
          )
        })}
        
        {/* X-axis labels */}
        {(() => {
          const labels = [];
          const placed = [];
          const canPlace = (x) => placed.every(p => Math.abs(p.x - x) >= minLabelSpacing);
          // More lenient spacing for shorter periods
          const minLabelSpacing = (period === 'current' || period === '4weeks' || period === '5weeks')
            ? 40
            : 40;

          // Build candidates with x positions
          const candidates = xAxisLabels
            .filter(item => item.text);

          // Place labels by priority groups, but always left-to-right to avoid rightmost blocking earlier ones
          const priorityOrder = [2, 1];
          priorityOrder.forEach(priority => {
            candidates
              .filter(c => c.priority === priority)
              .sort((a, b) => a.index - b.index)
              .forEach(c => {
                const x = effectivePadding + (c.index / (weeklyData.length - 1)) * (effectiveWidth - effectivePadding - effectiveRightPadding);
                if (canPlace(x)) {
                  placed.push({ x });
                  const isMobile = window.innerWidth < 768;
                  labels.push(
                    <text
                      key={`x-label-${c.index}`}
                      x={x}
                      y={height - effectivePadding + (screenshotMode ? 18 : 24) + (c.type === 'year' ? 5 : 0)}
                      fontSize={isMobileScreenshot
                        ? (c.type === 'year' ? '26' : c.type === 'month' ? '24' : '22')
                        : (isMobile 
                          ? (c.type === 'year' ? '22' : c.type === 'month' ? '20' : '18')
                          : (c.type === 'year' ? '15' : c.type === 'month' ? '13' : '12')
                        )
                      }
                      fontWeight="300"
                      fill={accentColor.hex}
                      textAnchor="middle"
                      style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
                    >
                      {c.text}
                    </text>
                  );
                }
              });
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