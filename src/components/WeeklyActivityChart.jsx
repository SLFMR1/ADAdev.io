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
import { WidgetDataExtractor } from '../utils/widgetDataExtractor'

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
        
        // 1. CHECK WIDGET CACHE FIRST - single source of truth for rawChartData
        const widgetCachedData = ChartDataCache.get('repository', selectedPeriod) || 
                                ChartDataCache.get('organization', selectedPeriod);
        if (widgetCachedData) {
          const extractedData = WidgetDataExtractor.extractResourceData(widgetCachedData, resource, selectedPeriod);
          if (extractedData) {
            logger.log(`⚡ Using DevelopmentActivityWidget rawChartData for ${resource.name} (period: ${selectedPeriod})`);
            
            const filteredData = transformChartData([{ weeklyData: extractedData.commitsPerWeekDetailed }], selectedPeriod, `WeeklyActivityChart-${resource.name}-widget-raw`);
            
            setActivityData({
              currentWeek: filteredData[filteredData.length - 1]?.count || 0,
              repoInfo: extractedData.repoInfo
            });
            setWeeklyData(filteredData);
            setHistoricalMaximums(extractedData.historicalMaximums || {});
            setHistoricalMetadata(extractedData.historicalMetadata || {});
            setIsLoading(false);
            return; // Exit early - no API call needed
          }
        }

        // 2. CACHE CHECK FALLBACK - check for existing cached data
        // Use 'repository' viewMode since this is for individual resource charts
        const cachedData = ChartDataCache.get('repository', selectedPeriod, resource.id)
        if (cachedData && !preloadedData) {
          logger.log(`⚡ Using cached data for ${resource.name} (period: ${selectedPeriod})`)
          
          if (cachedData.commitsPerWeekDetailed && Array.isArray(cachedData.commitsPerWeekDetailed)) {
            const filteredData = transformChartData([{ weeklyData: cachedData.commitsPerWeekDetailed }], selectedPeriod, `WeeklyActivityChart-${resource.name}-cached`)
            
            setActivityData({
              currentWeek: filteredData[filteredData.length - 1]?.count || 0,
              repoInfo: cachedData.repoInfo
            })
            setWeeklyData(filteredData)
            setHistoricalMaximums(cachedData.historicalMaximums || {})
            setHistoricalMetadata(cachedData.historicalMetadata || {})
            setIsLoading(false)
            return // Exit early - no API call needed
          }
        }
        
        // 2. If preloaded data is available for this period, use it immediately
        if (preloadedData && !preloadedData.error) {
          logger.log(`⚡ Using preloaded data for ${resource.name} (period: ${selectedPeriod})`)
          logger.debug('WeeklyActivityChart received preloaded data:', preloadedData)
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
              console.warn(`No valid preloaded activityfound for ${resource.name}`);
              throw new Error('No activity in this period or no data available. Please try again later.');
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
        
        // 3. Fallback to API if no cached or preloaded data available
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
        
        // Use the proven server API with organization detection (same as DevelopmentActivityWidget)
        const isOrganization = resource.type === 'organization'
        
        let apiUrl
        if (isOrganization) {
          // For organizations: use viewMode approach like DevelopmentActivityWidget
          apiUrl = `/api/development-activity?viewMode=organization&period=${serverPeriod}`
        } else {
          // For repositories: use resource-specific parameters
          const params = new URLSearchParams({
            resourceId: resource.id?.toString() || resource.name,
            resourceName: resource.name,
            period: serverPeriod
          })
          apiUrl = `/api/development-activity?${params}`
        }
        
        const response = await fetch(apiUrl)
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}: ${response.statusText}`)
        }
        
        const serverData = await response.json()
        
        let resourceData
        if (isOrganization) {
          // For organizations: extract specific resource from aggregated data (same as fetchGitHubUpdates)
          let organizationData = null
          
          // Check preloaded periods data
          if (serverData.preloadedPeriods && serverData.preloadedPeriods[serverPeriod]) {
            const periodData = serverData.preloadedPeriods[serverPeriod]
            const chartData = periodData.weeklyChartData || periodData.dailyChartData || []
            
            // Find matching resource by name or GitHub URL
            organizationData = chartData.find(item => {
              if (!item.resource) return false
              
              const nameMatch = item.resource.name === resource.name
              const githubMatch = item.resource.social?.github === resource.social.github
              const githubUrlMatch = item.resource.social?.github && resource.social?.github && 
                item.resource.social.github.toLowerCase() === resource.social.github.toLowerCase()
              
              return nameMatch || githubMatch || githubUrlMatch
            })
          }
          
          if (!organizationData) {
            throw new Error(`Organization data not found for ${resource.name}`)
          }
          
          // Transform organizational data to expected format
          const commitsPerWeekDetailed = organizationData.weeklyCounts ? 
            organizationData.weeklyCounts.map((count, index) => {
              // Calculate week start date going backwards from today
              const today = new Date()
              const weekStart = new Date(today)
              weekStart.setDate(today.getDate() - (organizationData.weeklyCounts.length - 1 - index) * 7)
              
              // Adjust to Sunday of that week (GitHub standard)
              const dayOfWeek = weekStart.getDay()
              weekStart.setDate(weekStart.getDate() - dayOfWeek)
              
              return {
                weekStart: weekStart.toISOString().slice(0, 10),
                count: count,
                year: weekStart.getFullYear(),
                week: Math.ceil((weekStart.getTime() - new Date(weekStart.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))
              }
            }) : []
          
          resourceData = {
            commitsPerWeekDetailed: commitsPerWeekDetailed,
            commitsPerWeek: organizationData.totalCommits || 0,
            repoInfo: {
              name: resource.name,
              htmlUrl: resource.social?.github,
              isOrganization: true,
              stargazersCount: organizationData.resource?.stargazersCount || 0,
              forksCount: organizationData.resource?.forksCount || 0,
              language: organizationData.resource?.language || null
            },
            dataSources: { database: true, github: false },
            historicalMaximums: {},
            historicalMetadata: { hasHistoricalData: true, dataQuality: 'database' }
          }
        } else {
          // For repositories: use direct response format
          resourceData = {
            commitsPerWeekDetailed: serverData.weeklyData || [],
            commitsPerWeek: serverData.commitsPerWeek || 0,
            repoInfo: serverData.repoInfo || null,
            dataSources: serverData.dataSources || { database: true, github: false },
            historicalMaximums: serverData.historicalMaximums || {},
            historicalMetadata: serverData.historicalMetadata || { hasHistoricalData: false, dataQuality: 'fallback' }
          }
        }
        
        // Cache the data using centralized cache with correct viewMode
        const cacheViewMode = isOrganization ? 'organization' : 'repository'
        ChartDataCache.set(cacheViewMode, selectedPeriod, resourceData, resource.id)
        
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
            throw new Error('No activity in this period or no data available. Please try again later.');
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
          throw new Error('No activity in this period or no data available. Please try again later.')
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

  // Calculate historical maximum without useMemo to avoid cache dependency issues
  const calculateHistoricalMax = () => {
    if (!weeklyData || weeklyData.length === 0) {
      return 1;
    }
    
    // Special handling for 3-year period: check if we have sufficient historical data
    if (selectedPeriod === '3years') {
      // For 3-year period, we need more than 3 years of data to have meaningful historical comparison
      // Since we only cache 3 years, there's no historical data beyond the current period
      return null; // Return null to indicate insufficient historical data
    }
    
    let maxWeekTotal = 0;
    const currentPeriodTotal = weeklyData.reduce((total, week) => total + (week.count || 0), 0);
    
    // Check repository age to determine realistic historical periods
    let availablePeriods = ['3years', '52weeks', '3months', '5weeks'];
    
    if (activityData?.repoInfo?.createdAt || activityData?.repoInfo?.created_at) {
      const repoCreatedDate = new Date(activityData.repoInfo.createdAt || activityData.repoInfo.created_at);
      const now = new Date();
      const repoAgeMonths = Math.floor((now.getTime() - repoCreatedDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
      const repoAgeWeeks = Math.floor((now.getTime() - repoCreatedDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
      
      // Filter out periods longer than repository age
      availablePeriods = availablePeriods.filter(period => {
        if (period === '3years' && repoAgeMonths < 36) return false;
        if (period === '52weeks' && repoAgeWeeks < 52) return false;
        if (period === '3months' && repoAgeMonths < 3) return false;
        return true;
      });
      
      logger.debug(`📊 Repository age: ${repoAgeMonths} months (${repoAgeWeeks} weeks), checking periods: ${availablePeriods.join(', ')}`);
    }
    
    // Use available periods for historical comparison (longest to shortest priority)
    for (const period of availablePeriods) {
      const cachedPeriodData = ChartDataCache.get('repository', period, resource.id);
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
          
          logger.debug(`📊 Using ${period} data for ResourceCard comparison, found max: ${maxWeekTotal}`);
        }
        
        // Use only the first (longest) available period for most comprehensive comparison
        break;
      }
    }
    
    // If no historical data found, use current period as baseline
    if (maxWeekTotal === 0) {
      logger.debug('📊 No historical data found for ResourceCard comparison, using current period as baseline');
      return currentPeriodTotal || 1;
    }
    
    // Include current period in comparison - if it's a new record, it becomes the new max
    const trueHistoricalMax = Math.max(maxWeekTotal, currentPeriodTotal);
    
    logger.debug(`📊 ResourceCard historical max calculation: historicalMax=${maxWeekTotal}, currentPeriod=${currentPeriodTotal}, finalMax=${trueHistoricalMax}`);
    
    return trueHistoricalMax;
  };
  
  const weeklyHistoricalMax = calculateHistoricalMax();

  // Calculate if current period is a new record without useMemo to avoid cache dependency issues
  const calculateIsNewRecord = () => {
    if (!weeklyData || weeklyData.length === 0) {
      return false;
    }
    
    // Special handling for 3-year period: no new record possible without sufficient historical data
    if (selectedPeriod === '3years') {
      return false; // Can't be a new record without historical comparison data
    }
    
    const currentPeriodTotal = weeklyData.reduce((total, week) => total + (week.count || 0), 0);
    
    // Get historical max (without current period)
    let historicalMax = 0;
    const periodsToCheck = ['3years', '52weeks', '3months', '5weeks'];
    
    for (const period of periodsToCheck) {
      const cachedPeriodData = ChartDataCache.get('repository', period, resource.id);
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
  
  // Generate chart points with linear scale (same as nodes)
  const chartPoints = validWeeklyData.map((w, i) => {
    const safeMaxCommits = Math.max(maxCommits, 1)
    const safeCount = Math.max(0, w.count || 0)
    
    // Calculate period-aware spacing (same as nodes)
    let effectivePadding = chartPadding
    let effectiveRightPadding = chartPadding
    
    if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
      effectivePadding = Math.max(20, chartPadding * 0.6)
      effectiveRightPadding = Math.max(15, chartPadding * 0.6)
    } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
      effectivePadding = chartPadding * 1.2
      effectiveRightPadding = chartPadding * 1.2
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
      
      // Always calculate correct Sunday-based week range regardless of stored weekStart
      const correctWeekStart = getWeekStart(weekStartDate);
      const correctEndOfWeek = new Date(correctWeekStart);
      correctEndOfWeek.setDate(correctWeekStart.getDate() + 6);
      
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
      const weekNumber = weekIdx + 1;
      
      // Create period-appropriate labels
      let periodLabel = '';
      if (selectedPeriod === 'current') {
        periodLabel = `Day ${weekNumber}`;
      } else if (selectedPeriod === '4weeks' || selectedPeriod === '5weeks') {
        periodLabel = `Week ${weekNumber}`;
      } else {
        periodLabel = `Week ${weekNumber}`;
      }
      
      const label = `${periodLabel} • ${startDate} – ${endDate}`;
      
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
            <span className="font-bold text-lg" style={{ color: accentColor.hex }}>
              {selectedPeriod === 'current' 
                ? validWeeklyData.reduce((total, week) => total + (week.count || 0), 0)
                : validWeeklyData[validWeeklyData.length - 1]?.count || 0
              }
            </span>
            <span className="text-gray-400 text-xs">
              {selectedPeriod === 'current' ? 'total' : 'last complete week'}
            </span>
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
              const month = weekDate.getMonth();
              const day = weekDate.getDate();
              
              // Only show grid lines for important markers
              let shouldShowGrid = false;
              let gridStyle = {};
              
              if (selectedPeriod === '3years') {
                if (month === 0 && day <= 7) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "6 3", strokeWidth: "1.5", opacity: "0.4" };
                } else if ([0, 3, 6, 9].includes(month) && day <= 7 && i % 3 === 0) {
                  shouldShowGrid = true;
                  gridStyle = { strokeDasharray: "4 2", strokeWidth: "1", opacity: "0.25" };
                }
              } else if (selectedPeriod === '52weeks') {
                if (month === 0 && day <= 7) {
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
              
              // Use linear scale: fixed position based on array index (same as chart points)
              let effectivePadding = chartPadding
              let effectiveRightPadding = chartPadding
              
              if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                effectivePadding = Math.max(20, chartPadding * 0.6)
                effectiveRightPadding = Math.max(15, chartPadding * 0.6)
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                effectivePadding = chartPadding * 1.2
                effectiveRightPadding = chartPadding * 1.2
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
                  y1={effectivePadding}
                  x2={safeX}
                  y2={chartHeight - bottomPadding}
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
                areaLeftX = Math.max(20, chartPadding * 0.6);
                areaRightX = chartWidth - Math.max(15, chartPadding * 0.6);
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                areaLeftX = chartPadding * 1.2;
                areaRightX = chartWidth - chartPadding * 1.2;
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
                effectivePadding = Math.max(20, chartPadding * 0.6)
                effectiveRightPadding = Math.max(15, chartPadding * 0.6)
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                effectivePadding = chartPadding * 1.2
                effectiveRightPadding = chartPadding * 1.2
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
              // Use linear scale: fixed position based on array index
              const safeMaxCommits = Math.max(maxCommits, 1)
              const safeCount = Math.max(0, w.count || 0)
              
              // Calculate period-aware spacing (same as generateChartPoints)
              let effectivePadding = chartPadding
              let effectiveRightPadding = chartPadding
              
              if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                effectivePadding = Math.max(20, chartPadding * 0.6)
                effectiveRightPadding = Math.max(15, chartPadding * 0.6)
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                effectivePadding = chartPadding * 1.2
                effectiveRightPadding = chartPadding * 1.2
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
              const labels = [];
              // More lenient spacing for shorter periods
              const minLabelSpacing = selectedPeriod === '4weeks' || selectedPeriod === 'current' 
                ? (window.innerWidth < 1024 ? 40 : 50)  // Tighter spacing for short periods
                : (window.innerWidth < 1024 ? 60 : 80); // Standard spacing for longer periods
              let lastLabelX = -minLabelSpacing;
              
              // Calculate important time markers based on period
              const importantMarkers = [];
              
              validWeeklyData.forEach((w, i) => {
                try {
                  const date = new Date(w.weekStart);
                  if (isNaN(date.getTime())) return;
                  
                  // Use temporal positioning
                  const weeksSinceStart = Math.floor((date.getTime() - expectedStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
                  const normalizedPosition = Math.max(0, Math.min(1, weeksSinceStart / (expectedWeeks - 1)));
                  const x = chartPadding + normalizedPosition * (chartWidth - 2 * chartPadding);
                  const safeX = isNaN(x) || !isFinite(x) ? chartPadding : Math.max(chartPadding, Math.min(x, chartWidth - chartPadding));
                  
                  const month = date.getMonth();
                  const year = date.getFullYear();
                  const day = date.getDate();
                  
                  // Determine if this is an important marker
                  let markerType = null;
                  let labelText = '';
                  let fontSize = window.innerWidth < 1024 ? "11" : "13";
                  let yOffset = 18;
                  
                  if (selectedPeriod === '3years') {
                    // For 3-year view: show years prominently, quarters moderately
                    if (month === 0 && day <= 7) {
                      markerType = 'year';
                      labelText = year.toString();
                      fontSize = window.innerWidth < 1024 ? "14" : "16";
                      yOffset = 32;
                    } else if ([0, 3, 6, 9].includes(month) && day <= 7 && i % 3 === 0) {
                      markerType = 'quarter';
                      labelText = `Q${Math.floor(month / 3) + 1}`;
                    }
                  } else if (selectedPeriod === '52weeks') {
                    // For 1-year view: show quarters and key months
                    if (month === 0 && day <= 7) {
                      markerType = 'year';
                      labelText = year.toString();
                      fontSize = window.innerWidth < 1024 ? "14" : "16";
                      yOffset = 32;
                    } else if ([0, 3, 6, 9].includes(month) && day <= 7) {
                      markerType = 'quarter';
                      labelText = date.toLocaleString('default', { month: 'short' });
                    } else if (day <= 7 && i % 4 === 0) {
                      markerType = 'month';
                      labelText = date.toLocaleString('default', { month: 'short' });
                    }
                  } else if (selectedPeriod === '3months') {
                    // For 3-month view: show months and weeks
                    if (day <= 7) {
                      markerType = 'month';
                      labelText = date.toLocaleString('default', { month: 'short' });
                    } else if (i % 2 === 0) {
                      markerType = 'week';
                      labelText = `W${Math.floor(i / 2) + 1}`;
                    }
                  } else if (selectedPeriod === '4weeks' || selectedPeriod === 'current') {
                    // For 4-week and current (7-day) views: show all labels when space allows
                    if (day <= 7) {
                      markerType = 'month';
                      labelText = date.toLocaleString('default', { month: 'short' });
                    } else {
                      markerType = 'week';
                      labelText = `W${i + 1}`;
                    }
                  } else {
                    // For shorter periods: show weeks and key dates
                    if (day <= 7) {
                      markerType = 'month';
                      labelText = date.toLocaleString('default', { month: 'short' });
                    } else if (i % 2 === 0) {
                      markerType = 'week';
                      labelText = `W${Math.floor(i / 2) + 1}`;
                    }
                  }
                  
                  if (markerType) {
                    importantMarkers.push({
                      x: safeX,
                      text: labelText,
                      type: markerType,
                      fontSize,
                      yOffset,
                      priority: markerType === 'year' ? 3 : markerType === 'quarter' ? 2 : 1
                    });
                  }
                } catch (error) {
                  console.warn(`Error processing marker for week ${i}:`, error);
                }
              });
              
              // Sort by priority and apply collision detection
              importantMarkers
                .sort((a, b) => b.priority - a.priority)
                .forEach(marker => {
                  if (marker.x - lastLabelX >= minLabelSpacing) {
                    lastLabelX = marker.x;
                    labels.push(
                      <text
                        key={`smart-label-${marker.x}`}
                        x={marker.x}
                        y={chartHeight - bottomPadding / 2 + marker.yOffset}
                        fontSize={marker.fontSize}
                        fill={accentColor.hex}
                        textAnchor="middle"
                        fontWeight={marker.type === 'year' ? 'bold' : '500'}
                        style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
                      >
                        {marker.text}
                      </text>
                    );
                  }
                });
              
              return labels;
            })()}
            {/* Y-axis labels - improved visibility and more labels */}
            {(() => {
              const labels = []
              const maxLabel = Math.max(Math.ceil(maxCommits / 10) * 10, 10)
              const step = Math.max(1, Math.floor(maxLabel / 5))
              
              // Calculate effective padding for Y-axis label positioning
              let yAxisLabelPadding = chartPadding
              if (selectedPeriod === 'current' && validWeeklyData.length === 7) {
                yAxisLabelPadding = Math.max(20, chartPadding * 0.6)
              } else if (selectedPeriod === '3years' && validWeeklyData.length > 100) {
                yAxisLabelPadding = chartPadding * 1.2
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
              <span className="text-gray-500 text-xs mt-0.5">
                vs. best {selectedPeriod === 'current' ? '7-day' :
                              selectedPeriod === '4weeks' ? '4-week' : 
                              selectedPeriod === '3months' ? '3-month' : 
                              selectedPeriod === '52weeks' ? '12-month' : '3-year'} period
              </span>
            )}
          </div>
          <div className="flex items-center space-x-1">
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
                  const isLongerPeriod = selectedPeriod === 'current' || selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years';
                  const currentValue = isLongerPeriod ? 
                    validWeeklyData.reduce((total, week) => total + (week.count || 0), 0) : 
                    validWeeklyData[validWeeklyData.length - 1]?.count || 0;
                  
                  if (!isLongerPeriod) {
                    // For single week, use max-min range (unchanged)
                    const maximum = maxCommits - minCommits || 1;
                    return `${Math.min(100, Math.max(0, ((currentValue - minCommits) / maximum) * 100))}%`;
                  }
                  
                  // For longer periods, use dynamic historical maximum
                  const historicalMax = weeklyHistoricalMax;
                  
                  // Handle insufficient historical data case
                  if (historicalMax === null) {
                    return '0%'; // No progress bar for insufficient data
                  }
                  
                  // Calculate percentage with bounds checking
                  const percentage = (currentValue / (historicalMax || 1)) * 100;
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
                const isLongerPeriod = selectedPeriod === 'current' || selectedPeriod === '4weeks' || selectedPeriod === '3months' || selectedPeriod === '52weeks' || selectedPeriod === '3years';
                if (isLongerPeriod) {
                  if (weeklyHistoricalMax === null) {
                    return 'insufficient historical data';
                  }
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