import React, { useState, useEffect, useRef } from 'react'
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
  transformChartData,
  generateChartXAxisLabels
} from '../utils/chartDataUtils'
import { ChartDataCache } from '../utils/cacheUtils'
import { WidgetDataExtractor } from '../utils/widgetDataExtractor'

// Removed Supabase client initialization - using server API instead

// Use centralized chart point generation - removed duplicate function

// NOTE: Synthetic data generation functions removed - using only accurate hybrid data

const WeeklyActivityChart = ({ resource, showThreeYearOption = true, hidePeriodSwitches = false, hideActivityLevelInfo = false, selectedPeriod = '3months', onPeriodChange, preloadedData = null, accentColor = { hex: '#FFFFFF', rgb: '255, 255, 255' }, screenshotMode = false }) => {
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
  const [containerWidth, setContainerWidth] = useState(0)
  const containerRef = useRef(null)
  
  // Use centralized period configuration - removed duplicate mapping
  
  // Use selectedPeriod directly instead of internal timePeriod state
  // const timePeriod = selectedPeriod // Not needed anymore

  // Measure container width on mount and resize
  useEffect(() => {
    const updateContainerWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth
        setContainerWidth(width)
      }
    }

    updateContainerWidth()
    
    // Use ResizeObserver for more efficient container size monitoring
    let resizeObserver
    if (containerRef.current && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(updateContainerWidth)
      resizeObserver.observe(containerRef.current)
    } else {
      // Fallback to window resize listener
      window.addEventListener('resize', updateContainerWidth)
    }
    
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect()
      } else {
        window.removeEventListener('resize', updateContainerWidth)
      }
    }
  }, [])

  useEffect(() => {
        // This effect now fetches both activity data and historical maximums
        const loadAllChartData = async () => {
            try {
                setError(null);
                setIsLoading(true);

                // Fetch both activity data and historical maximums in parallel
                const [activityResponse, maximumsResponse] = await Promise.all([
                    fetch(`/api/development-activity?${new URLSearchParams({
                        resourceId: resource.id?.toString() || resource.name,
                        resourceName: resource.name,
                        period: getServerPeriod(selectedPeriod)
                    })}`),
                    fetch('/api/github/historical-maximums', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(resource)
                    })
                ]);

                if (!activityResponse.ok) {
                    throw new Error(`Activity data fetch failed: ${activityResponse.statusText}`);
                }
                if (!maximumsResponse.ok) {
                    throw new Error(`Historical maximums fetch failed: ${maximumsResponse.statusText}`);
                }

                const activityServerData = await activityResponse.json();
                const maximumsData = await maximumsResponse.json();

                // Process historical maximums
                setHistoricalMaximums(maximumsData.maximums || {});
                setHistoricalMetadata(maximumsData.metadata || { hasHistoricalData: false, dataQuality: 'fallback' });

                // Process activity data
                const resourceData = {
                    commitsPerWeekDetailed: activityServerData.weeklyData || [],
                    repoInfo: activityServerData.repoInfo || null,
                };
                
                if (resourceData.commitsPerWeekDetailed.length > 0) {
                    const validWeeklyData = resourceData.commitsPerWeekDetailed.map(week => ({
                        count: Math.max(0, week.count || 0),
                        weekStart: new Date(week.weekStart).toISOString().slice(0, 10)
                    }));

                    setActivityData({
                        currentWeek: validWeeklyData[validWeeklyData.length - 1]?.count || 0,
                        repoInfo: resourceData.repoInfo
                    });

                    const filteredData = transformChartData([{ weeklyData: validWeeklyData }], selectedPeriod, `WeeklyActivityChart-${resource.name}`);
                    setWeeklyData(filteredData);
                } else {
                    setActivityData({ currentWeek: 0, repoInfo: null });
                    setWeeklyData([]);
                }

            } catch (error) {
                logger.error(`Error loading all chart data for ${resource.name}:`, error);
                setError(error.message);
                setActivityData({ currentWeek: 0, repoInfo: null });
                setWeeklyData([]);
                setHistoricalMaximums({});
            } finally {
                setIsLoading(false);
            }
        };

        if (!preloadedData) {
            loadAllChartData();
        } else {
            // Still use preloaded data if available to keep initial load instant
            const resourceData = preloadedData;
             if (resourceData && resourceData.commitsPerWeekDetailed && Array.isArray(resourceData.commitsPerWeekDetailed) && resourceData.commitsPerWeekDetailed.length > 0) {
                const validWeeklyData = resourceData.commitsPerWeekDetailed.map(week => ({
                    count: Math.max(0, week.count || 0),
                    weekStart: new Date(week.weekStart).toISOString().slice(0, 10)
                }));

                setActivityData({
                    currentWeek: validWeeklyData[validWeeklyData.length - 1]?.count || 0,
                    repoInfo: resourceData.repoInfo
                });
                setHistoricalMaximums(resourceData.historicalMaximums || {});
                setHistoricalMetadata(resourceData.historicalMetadata || {});

                const filteredData = transformChartData([{ weeklyData: validWeeklyData }], selectedPeriod, `WeeklyActivityChart-${resource.name}-preloaded`);
                setWeeklyData(filteredData);
                setIsLoading(false);
            }
        }
    }, [resource, selectedPeriod, preloadedData]);

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

  // Historical max and new record calculations are now removed from the client-side.
  // The component will use the state `historicalMaximums` and `historicalMetadata` directly.
  
  const isNewRecord = (() => {
    if (!historicalMetadata.hasHistoricalData || !weeklyData || weeklyData.length === 0) {
      return false;
    }
    const currentPeriodTotal = weeklyData.reduce((total, week) => total + (week.count || 0), 0);
    const historicalMaxForPeriod = historicalMaximums[getServerPeriod(selectedPeriod)];
    
    // A new record is set if the current total is greater than the historical max *before* this period.
    // The server-side `calculateHistoricalMaximums` provides the max *of all historical periods*.
    // We need to compare against the max that does not include the current period's data.
    // For simplicity here, we consider it a new record if it matches or exceeds the all-time high.
    return historicalMaxForPeriod !== null && currentPeriodTotal >= historicalMaxForPeriod;
  })();

  // Chart configuration - responsive to container width
  const chartWidth = containerWidth || (window.innerWidth < 1024 ? 300 : 850)
  const chartHeight = Math.max(175, Math.min(400, chartWidth * 0.4)) // Responsive height based on width - reduced by 5px for label space
  const chartPadding = window.innerWidth < 1024 ? 15 : 25
  const bottomPadding = window.innerWidth < 1024 ? 25 : 30
  
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
  
  const xAxisLabels = generateChartXAxisLabels(validWeeklyData, selectedPeriod === '4weeks' ? '5weeks' : selectedPeriod);
  
  const maxCommits = Math.max(...validWeeklyData.map(w => w.count), 1)

  // Get expected period configuration for proper temporal positioning
  const config = getPeriodConfig(selectedPeriod)
  const expectedWeeks = config.weeks
  
  // Calculate the expected start date for the full period
  const now = new Date();
  const expectedStartDate = new Date(now.getTime() - expectedWeeks * 7 * 24 * 60 * 60 * 1000);
  
  // Generate chart points with linear scale (same as nodes)
  const chartPoints = validWeeklyData.map((w, i) => {
    const safeMaxCommits = Math.max(maxCommits, 1)
    const safeCount = Math.max(0, w.count || 0)
    
    // Calculate period-aware spacing (same as nodes)
    let effectivePadding = chartPadding
    let effectiveRightPadding = chartPadding
    
    if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
      effectivePadding = Math.max(10, chartPadding * 0.4)
      effectiveRightPadding = Math.max(8, chartPadding * 0.4)
    } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
      effectivePadding = chartPadding * 0.8
      effectiveRightPadding = chartPadding * 0.8
    }
    
    // Linear scale: each position is exactly the same distance apart
    const availableWidth = chartWidth - effectivePadding - effectiveRightPadding
    const stepX = validWeeklyData.length > 1 ? availableWidth / (validWeeklyData.length - 1) : 0
    
    // Fixed linear position based on array index (same as nodes)
    const x = effectivePadding + i * stepX
    // Use consistent padding for Y calculation to avoid misplaced 0-commit points
    const yCalculationPadding = chartPadding  // Always use standard padding for Y positioning
    const y = chartHeight - yCalculationPadding - (safeCount / safeMaxCommits) * (chartHeight - 2 * yCalculationPadding)
    
    // Validate coordinates
    let validX = x
    let validY = y
    
    if (isNaN(validX) || !isFinite(validX)) {
      validX = effectivePadding + (i * 10)
    }
    if (isNaN(validY) || !isFinite(validY)) {
      validY = chartHeight - yCalculationPadding
    }
    
    validX = Math.max(effectivePadding, Math.min(validX, chartWidth - effectiveRightPadding))
    validY = Math.max(yCalculationPadding, Math.min(validY, chartHeight - yCalculationPadding))
    
    if (isNaN(validX) || isNaN(validY)) {
      console.warn(`Invalid coordinates for point ${i}: x=${validX}, y=${validY}`)
      validX = effectivePadding + i * 10
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
      
      // Format dates nicely
      const formatDate = (date) => {
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: 'numeric'
        });
      };
      
      const weekNumber = weekIdx + 1;
      let label;

      if (selectedPeriod === 'current') {
        // For daily view, show the specific date
        const periodLabel = `Day ${weekNumber}`;
        const dayDate = formatDate(weekStartDate);
        label = `${periodLabel} • ${dayDate}`;
      } else {
        // For weekly views, calculate and show the week range
        const correctWeekStart = getWeekStart(weekStartDate);
        const correctEndOfWeek = new Date(correctWeekStart);
        correctEndOfWeek.setDate(correctWeekStart.getDate() + 6);
        
        const startDate = formatDate(correctWeekStart);
        const endDate = formatDate(correctEndOfWeek);
        
        const periodLabel = `Week ${weekNumber}`;
        label = `${periodLabel} • ${startDate} – ${endDate}`;
      }
      
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
    <div className="w-full" ref={containerRef}>
      {/* Line Chart */}
      <div className="bg-gray-800/50 rounded-lg p-4 sm:p-6" style={{ minHeight: Math.max(280, chartHeight + 100) }}>
        <div className={`flex items-center justify-between ${screenshotMode ? 'mb-6' : 'mb-3'}`}>
          <span className={`text-gray-400 ${screenshotMode ? 'text-base' : 'text-xs'}`}>
            {selectedPeriod === '52weeks' ? 'Last 52 Weeks' : selectedPeriod === '3years' ? 'Last 3 Years' : selectedPeriod === '3months' ? 'Last 3 Months' : 'Last 4 Weeks'} (Historical Complete Weeks)
          </span>
          <div className="flex items-center space-x-2">
            <GitCommit size={screenshotMode ? 18 : 12} style={{ color: accentColor.hex }} />
            <span className={`font-bold ${screenshotMode ? 'text-3xl' : 'text-lg'}`} style={{ color: accentColor.hex }}>
              {(() => {
                const total = validWeeklyData.reduce((sum, week) => sum + (week.count || 0), 0)
                if (selectedPeriod === 'current') {
                  return Math.round(total / 7) // Daily average for 7-day view
                } else {
                  return Math.round(total / validWeeklyData.length) // Weekly average
                }
              })()}
            </span>
            <span className={`text-gray-400 ${screenshotMode ? 'text-base' : 'text-xs'}`}>
              {selectedPeriod === 'current' ? 'avg per day' : 'avg per week'}
            </span>
          </div>
        </div>

        {/* Line Chart */}
        <div className="relative">
          <svg width="100%" height={chartHeight + 60} viewBox={`0 0 ${chartWidth} ${chartHeight + 60}`} preserveAspectRatio="xMidYMid meet">
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
              <linearGradient id={`weekly-area-gradient-${(accentColor.hex || '#FFFFFF').replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor.hex} stopOpacity="0.35" />
                <stop offset="80%" stopColor={accentColor.hex} stopOpacity="0.12" />
                <stop offset="100%" stopColor={accentColor.hex} stopOpacity="0" />
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
              // For year transitions, use week end date (same logic as X-axis labels)
              const weekEndDate = new Date(weekDate);
              weekEndDate.setDate(weekDate.getDate() + 6);
              
              const month = weekDate.getMonth();
              const day = weekDate.getDate();
              const weekEndYear = weekEndDate.getFullYear();
              const weekStartYear = weekDate.getFullYear();
              
              // Only show grid lines for important markers
              let shouldShowGrid = false;
              let gridStyle = {};
              
              if (selectedPeriod === '3years') {
                // Year transition: when week end crosses into new year
                if (weekEndYear !== weekStartYear) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "6 3", strokeWidth: "1.5", opacity: "0.4" };
                } else if ([0, 3, 6, 9].includes(month) && day <= 7 && i % 3 === 0) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "4 2", strokeWidth: "1", opacity: "0.25" };
                }
              } else if (selectedPeriod === '52weeks') {
                // Year transition: when week end crosses into new year
                if (weekEndYear !== weekStartYear) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "6 3", strokeWidth: "1.5", opacity: "0.4" };
                } else if ([0, 3, 6, 9].includes(month) && day <= 7) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "4 2", strokeWidth: "1", opacity: "0.25" };
                }
              } else if (selectedPeriod === '3months') {
                // Show months and some weeks for 3-month view
                if (day <= 7) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "4 2", strokeWidth: "1", opacity: "0.25" };
                } else if (i % 2 === 0) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "2 2", strokeWidth: "0.8", opacity: "0.2" };
                }
              } else if (selectedPeriod === '4weeks' || selectedPeriod === 'current') {
                // For 4-week and current views: show all grid lines
                shouldShowGrid = true;
                if (day <= 7) {
                  gridStyle = { strokeDasharray: "4 2", strokeWidth: "1", opacity: "0.25" };
                } else {
                  gridStyle = { strokeDasharray: "2 2", strokeWidth: "0.8", opacity: "0.2" };
                }
              } else {
                // For other periods: show months and some weeks
                if (day <= 7) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "4 2", strokeWidth: "1", opacity: "0.25" };
                } else if (i % 2 === 0) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "2 2", strokeWidth: "0.8", opacity: "0.2" };
                }
              }
              
              if (!shouldShowGrid) return null;
              
              // Use linear positioning (same as nodes and labels) for proper alignment
              let effectivePadding = chartPadding;
              let effectiveRightPadding = chartPadding;
              
              if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                effectivePadding = Math.max(10, chartPadding * 0.4);
                effectiveRightPadding = Math.max(8, chartPadding * 0.4);
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                effectivePadding = chartPadding * 0.8;
                effectiveRightPadding = chartPadding * 0.8;
              }
              
              const availableWidth = chartWidth - effectivePadding - effectiveRightPadding;
              const stepX = validWeeklyData.length > 1 ? availableWidth / (validWeeklyData.length - 1) : 0;
              const x = effectivePadding + i * stepX;
              
              // Validate coordinates
              const safeX = isNaN(x) || !isFinite(x) ? effectivePadding : Math.max(effectivePadding, Math.min(x, chartWidth - effectiveRightPadding));
              
              return (
                <line
                  key={`month-grid-${i}`}
                  x1={safeX}
                  y1={chartPadding}
                  x2={safeX}
                  y2={chartHeight - bottomPadding + 25}
                  stroke={accentColor.hex}
                  {...gridStyle}
                />
              )
            })}

            {/* Area under the line */}
            {(() => {
              // Calculate area baseline and points for gradient fill
              const areaBaselineY = chartHeight - chartPadding;
              
              // Get the left and right X positions from chart points
              let areaLeftX = chartPadding;
              let areaRightX = chartWidth - chartPadding;
              
              if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                areaLeftX = Math.max(10, chartPadding * 0.4);
                areaRightX = chartWidth - Math.max(8, chartPadding * 0.4);
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                areaLeftX = chartPadding * 0.8;
                areaRightX = chartWidth - chartPadding * 0.8;
              }
              
              const areaPoints = `${areaLeftX},${areaBaselineY} ${chartPoints} ${areaRightX},${areaBaselineY}`;
              const areaGradientId = `weekly-area-gradient-${(accentColor.hex || '#FFFFFF').replace('#','')}`;
              
              return (
                <polygon
                  points={areaPoints}
                  fill={`url(#${areaGradientId})`}
                  stroke="none"
                />
              );
            })()}

            {/* Week ticks */}
            {validWeeklyData.map((w, i) => {
              // Use linear scale: fixed position based on array index (same as chart points)
              let effectivePadding = chartPadding
              let effectiveRightPadding = chartPadding
              
              if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                effectivePadding = Math.max(10, chartPadding * 0.4)
                effectiveRightPadding = Math.max(8, chartPadding * 0.4)
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                effectivePadding = chartPadding * 0.8
                effectiveRightPadding = chartPadding * 0.8
              }
              
              const availableWidth = chartWidth - effectivePadding - effectiveRightPadding;
              const stepX = validWeeklyData.length > 1 ? availableWidth / (validWeeklyData.length - 1) : 0;
              const x = effectivePadding + i * stepX;
              
              // Validate coordinates
              const safeX = isNaN(x) || !isFinite(x) ? effectivePadding : Math.max(effectivePadding, Math.min(x, chartWidth - effectiveRightPadding));
              
              return (
                <line
                  key={`tick-${i}`}
                  x1={safeX}
                  y1={chartHeight - bottomPadding + 25}
                  x2={safeX}
                  y2={chartHeight - bottomPadding + 33}
                  stroke={accentColor.hex}
                  strokeWidth="1"
                  opacity="0.15"
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
              // Use linear scale: fixed position based on array index
              const safeMaxCommits = Math.max(maxCommits, 1)
              const safeCount = Math.max(0, w.count || 0)
              
              // Calculate period-aware spacing (same as generateChartPoints)
              let effectivePadding = chartPadding
              let effectiveRightPadding = chartPadding
              
              if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                effectivePadding = Math.max(10, chartPadding * 0.4)
                effectiveRightPadding = Math.max(8, chartPadding * 0.4)
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                effectivePadding = chartPadding * 0.8
                effectiveRightPadding = chartPadding * 0.8
              }
              
              // Linear scale: each position is exactly the same distance apart
              const availableWidth = chartWidth - effectivePadding - effectiveRightPadding
              const stepX = validWeeklyData.length > 1 ? availableWidth / (validWeeklyData.length - 1) : 0
              
              // Fixed linear position based on array index
              const x = effectivePadding + i * stepX
              // Use consistent padding for Y calculation to avoid misplaced 0-commit points
              const yCalculationPadding = chartPadding  // Always use standard padding for Y positioning
              const y = chartHeight - yCalculationPadding - (safeCount / safeMaxCommits) * (chartHeight - 2 * yCalculationPadding)
              
              // Validate coordinates
              let safeX = x
              let safeY = y
              
              if (isNaN(safeX) || !isFinite(safeX)) {
                safeX = effectivePadding + (i * 10)
              }
              if (isNaN(safeY) || !isFinite(safeY)) {
                safeY = chartHeight - yCalculationPadding
              }
              
              safeX = Math.max(effectivePadding, Math.min(safeX, chartWidth - effectiveRightPadding))
              safeY = Math.max(yCalculationPadding, Math.min(safeY, chartHeight - yCalculationPadding))
              
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
              const labelsToRender = [];
              // For 7-day view, show all labels; for others, use collision avoidance
              const minLabelSpacing = selectedPeriod === 'current'
                ? 0  // No spacing limit for 7-day view - show all labels
                : selectedPeriod === '4weeks'
                ? 40
                : 40;
              let lastLabelX = -minLabelSpacing;

              const sortedLabels = xAxisLabels.sort((a, b) => b.priority - a.priority);

              sortedLabels.forEach(label => {
                // Use linear positioning to match nodes (fixed position based on array index)
                let effectivePadding = chartPadding;
                let effectiveRightPadding = chartPadding;
                
                if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                  effectivePadding = Math.max(10, chartPadding * 0.4);
                  effectiveRightPadding = Math.max(8, chartPadding * 0.4);
                } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                  effectivePadding = chartPadding * 0.8;
                  effectiveRightPadding = chartPadding * 0.8;
                }
                
                const availableWidth = chartWidth - effectivePadding - effectiveRightPadding;
                const stepX = validWeeklyData.length > 1 ? availableWidth / (validWeeklyData.length - 1) : 0;
                const x = effectivePadding + label.index * stepX;

                if (x - lastLabelX >= minLabelSpacing) {
                  labelsToRender.push(
                    <text
                      key={`label-${label.index}`}
                      x={x}
                      y={chartHeight - bottomPadding + 55}
                      fontSize={screenshotMode ? (label.priority > 1 ? "20" : "18") : (label.priority > 1 ? "14" : "12")}
                      fill={accentColor.hex}
                      textAnchor="middle"
                      fontWeight="300"
                    >
                      {label.text}
                    </text>
                  );
                  lastLabelX = x;
                }
              });

              return labelsToRender;
            })()}
            {/* Y-axis labels - improved visibility and more labels */}
            {(() => {
              const labels = []
              const maxLabel = Math.max(Math.ceil(maxCommits / 10) * 10, 10)
              const step = Math.max(1, Math.floor(maxLabel / 5))
              
              // Calculate effective padding for Y-axis label positioning
              let yAxisLabelPadding = chartPadding
              if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                yAxisLabelPadding = Math.max(10, chartPadding * 0.4)
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                yAxisLabelPadding = chartPadding * 0.8
              }

              // Generate Y-axis labels
              for (let i = 0; i <= maxLabel; i += step) {
                if (i <= maxCommits) {
                  const y = chartHeight - chartPadding - (i / maxCommits) * (chartHeight - 2 * chartPadding)
                  labels.push(
                    <text 
                      key={`y-label-${i}`}
                      x={yAxisLabelPadding - 12} 
                      y={y + 4} 
                      fontSize={screenshotMode ? "18" : "12"} 
                      fill={accentColor.hex} 
                      textAnchor="end"
                      fontWeight="300"
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
                className="fixed z-[9999] px-4 py-3 rounded-lg bg-gray-900/95 backdrop-blur-sm text-white text-sm shadow-xl pointer-events-none max-w-xs"
                style={{ 
                  left: Math.min(tooltip.x + 10, window.innerWidth - 280), 
                  top: Math.max(tooltip.y - 60, 10),
                  boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4)`
                }}
              >
                {tooltip.label ? (
                  <>
                    <div className="font-semibold mb-1" style={{ color: accentColor.hex }}>
                      {tooltip.value} commits
                    </div>
                    <div className="text-gray-300 text-xs leading-relaxed">
                      {tooltip.label}
                    </div>
                  </>
                ) : (
                  <div className="text-gray-300 text-xs leading-relaxed">
                    {tooltip.value}
                  </div>
                )}
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
                          {selectedPeriod === 'current' ? 'Current 7-Day Total' :
             selectedPeriod === '4weeks' ? 'Current 4-Week Total' :
             selectedPeriod === '3months' ? 'Current 3-Month Total' :
             selectedPeriod === '52weeks' ? 'Current 12-Month Total' :
             selectedPeriod === '3years' ? 'Current 3-Year Total' : 'Last Complete Week'}
            </span>
                          {(selectedPeriod === 'current' || selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years') && (
              <span className="text-gray-500 text-xs mt-0.5 whitespace-nowrap">
                vs. best {selectedPeriod === 'current' ? '7-day' :
                              selectedPeriod === '4weeks' ? '4-week' : 
                              selectedPeriod === '3months' ? '3-month' : 
                              selectedPeriod === '52weeks' ? '12-month' : '3-year'} period
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {(selectedPeriod === 'current' || selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years') && isNewRecord && (
              <span 
                className="text-xs font-medium px-2 py-0.5 rounded mr-1"
                style={{ 
                  color: accentColor.hex,
                  backgroundColor: `rgba(${accentColor.rgb}, 0.1)`
                }}
              >
                new record
              </span>
            )}
            <GitCommit size={12} style={{ color: accentColor.hex }} />
            <span className="font-bold text-lg" style={{ color: accentColor.hex }}>
              {selectedPeriod === 'current' || selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years' ? 
                validWeeklyData.reduce((total, week) => total + (week.count || 0), 0) : 
                validWeeklyData[validWeeklyData.length - 1]?.count || 0}
            </span>
            <span className="text-gray-400 text-xs">commits</span>
          </div>
        </div>

        {/* Bar Chart - uses dynamic historical maximums for meaningful progress bars */}
        <div className="relative">
          <div 
            className="w-full bg-gray-700 rounded-full h-2"
          >
            <div 
              className="h-2 rounded-full transition-all duration-500 ease-out"
              style={{ 
                width: (() => {
                  const isLongerPeriod = selectedPeriod !== 'current';
                  let currentValue;
                  let historicalMaxToUse;
                  
                  if (isLongerPeriod) {
                    // For longer periods, use total sum
                    currentValue = validWeeklyData.reduce((total, week) => total + (week.count || 0), 0);
                    // Use period-total historical maximum
                    const historicalMaxData = historicalMaximums[getServerPeriod(selectedPeriod)];
                    historicalMaxToUse = historicalMaxData?.value;
                  } else {
                    // For 'current' period (7-day view), use total sum across all 7 days
                    currentValue = validWeeklyData.reduce((total, week) => total + (week.count || 0), 0);
                    // Use server-provided historical maximum for 7-day period totals
                    const historicalMaxData = historicalMaximums[getServerPeriod(selectedPeriod)];
                    historicalMaxToUse = historicalMaxData?.value;
                  }
                  
                  if (!historicalMaxToUse || historicalMaxToUse <= 0) {
                    return '100%';
                  }
                  
                  const percentage = (currentValue / historicalMaxToUse) * 100;
                  return `${Math.min(100, Math.max(0, Math.round(percentage)))}%`;
                })(),
                background: `linear-gradient(to right, ${accentColor.hex}, ${accentColor.hex}dd)`,
                boxShadow: `0 0 8px rgba(${accentColor.rgb}, 0.3)`
              }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0</span>
            <span 
              className="cursor-help relative"
              onMouseEnter={(e) => {
                const rect = e.target.getBoundingClientRect();
                setTooltip({
                  show: true,
                  x: rect.right,
                  y: rect.top,
                  value: 'Historical maximum may include the current incomplete week',
                  label: ''
                });
              }}
              onMouseLeave={() => setTooltip({ show: false, x: 0, y: 0, value: 0, label: '' })}
            >
              {(() => {
                const isLongerPeriod = selectedPeriod !== 'current';
                
                if (isLongerPeriod) {
                  // For longer periods, show period-total historical maximum with dates
                  const serverPeriod = getServerPeriod(selectedPeriod);
                  const historicalMaxData = historicalMaximums[serverPeriod];
                  
                  if (!historicalMaxData || historicalMaxData.value === null) {
                    return 'insufficient historical data';
                  }

                  const formatDate = (dateString) => {
                    if (!dateString) return '';
                    const date = new Date(dateString);
                    // Add timezone offset to prevent off-by-one day errors
                    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
                    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
                  };

                  const startDate = formatDate(historicalMaxData.startDate);
                  const endDate = formatDate(historicalMaxData.endDate);
                  const tooltipText = `Historical Peak from ${startDate} - ${endDate}`;
                  
                  return (
                    <span title={tooltipText} className="whitespace-nowrap">
                      {`historical peak ${historicalMaxData.value || 1} (${startDate}-${endDate})`}
                    </span>
                  );
                } else {
                  // For 'current' period (7-day view), show server-provided historical maximum with dates
                  const serverPeriod = getServerPeriod(selectedPeriod);
                  const historicalMaxData = historicalMaximums[serverPeriod];
                  
                  if (!historicalMaxData || historicalMaxData.value === null) {
                    return 'insufficient historical data';
                  }

                  const formatDate = (dateString) => {
                    if (!dateString) return '';
                    const date = new Date(dateString);
                    // Add timezone offset to prevent off-by-one day errors
                    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
                    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
                  };

                  const startDate = formatDate(historicalMaxData.startDate);
                  const endDate = formatDate(historicalMaxData.endDate);
                  const tooltipText = `Historical Peak from ${startDate} - ${endDate}`;
                  
                  return (
                    <span title={tooltipText} className="whitespace-nowrap">
                      {`historical peak ${historicalMaxData.value || 1} (${startDate}-${endDate})`}
                    </span>
                  );
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