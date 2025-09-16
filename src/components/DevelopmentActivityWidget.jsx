import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Activity, Share2, Loader2, GitCommit, ClipboardCheck } from 'lucide-react';
import { cardanoResources } from '../data/resources';
import logger from '../utils/logger-frontend';
import * as htmlToImage from 'html-to-image';
import AggregatedActivityChart from './AggregatedActivityChart';
import Portal from './Portal';
import PeriodDropdown from './PeriodDropdown';
import brandingLogo from '/adadev_io.svg';
import { 
  svgToPngBlob, 
  createIsolatedScreenshot, 
  mergeImagesWithGap, 
  shareToX, 
  generateTweetText, 
  getTop5HandlesOrNames 
} from '../utils/screenshotUtils';
import { getWeekStart, getCurrentWeekStart } from '../utils/weekCalculation';
import { 
  PERIOD_OPTIONS,
  transformChartData,
  validateNodeCount,
  getPeriodConfig
} from '../utils/chartDataUtils';
import { ChartDataCache } from '../utils/cacheUtils';

// Use centralized period options
const periodOptions = PERIOD_OPTIONS;

// Skeleton loading component
const SkeletonLoader = ({ className = "" }) => (
  <div className={`animate-pulse ${className}`}>
    <div className="bg-gray-700 rounded h-4 mb-2"></div>
    <div className="bg-gray-700 rounded h-4 mb-2 w-3/4"></div>
    <div className="bg-gray-700 rounded h-4 w-1/2"></div>
  </div>
);

// Skeleton leaderboard item
const SkeletonLeaderboardItem = ({ rank }) => (
  <div className="flex items-center space-x-4 p-3 rounded-lg bg-gray-800/30 animate-pulse">
    <div className="text-white text-sm font-bold flex-shrink-0 w-6 text-center">
      {rank}
    </div>
    <div className="flex-1 min-w-0">
      <div className="bg-gray-700 rounded h-4 mb-1 w-3/4"></div>
      <div className="bg-gray-700 rounded h-3 w-1/2"></div>
    </div>
    <div className="text-right flex-shrink-0">
      <div className="bg-gray-700 rounded h-4 mb-1 w-8"></div>
      <div className="bg-gray-700 rounded h-3 w-12"></div>
    </div>
  </div>
);

// Error boundary for chart rendering
class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('🚨 Chart Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-red-400 text-lg mb-2">Chart rendering failed</div>
            <div className="text-gray-500 text-sm mb-4">An error occurred while displaying the chart</div>
            <button 
              onClick={() => {
                this.setState({ hasError: false, error: null });
                if (this.props.onRetry) this.props.onRetry();
              }}
              className="px-4 py-2 bg-white hover:bg-gray-200 text-black rounded-lg transition-colors text-sm"
            >
              Retry Chart
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Accent color system matching widget sidebar colors
const accentColors = [
  { name: 'white', hex: '#FFFFFF', rgb: '255, 255, 255' },
  { name: 'amber', hex: '#FBB036', rgb: '251, 191, 54' },
  { name: 'purple', hex: '#A855F7', rgb: '168, 85, 247' },
  { name: 'teal', hex: '#14B8A6', rgb: '20, 184, 166' },
  { name: 'red', hex: '#F87171', rgb: '248, 113, 113' },
  { name: 'emerald', hex: '#34D399', rgb: '52, 211, 153' },
  { name: 'blue', hex: '#3B82F6', rgb: '59, 130, 246' },
  { name: 'NMKR green', hex: '#11F250', rgb: '17, 242, 80' },
  { name: 'Cyber Lime', hex: '#C8F560', rgb: '200, 245, 96' },
  { name: 'Electric Purple', hex: '#A259FF', rgb: '162, 89, 255' },
  { name: 'Hot Coral', hex: '#FF6B6B', rgb: '255, 107, 107' },
  { name: 'Dawn Blue', hex: '#4C6FFF', rgb: '76, 111, 255' },
];

const DevelopmentActivityWidget = ({ isExpanded, isAnyExpanded, onExpand, onCollapse, onNavigateToResource, animationState }) => {
  const [activityData, setActivityData] = useState(null);
  
  // Smart loading state - only show loading when no cached data is available
  const [isLoading, setIsLoading] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [hasDataLoadError, setHasDataLoadError] = useState(false);
  
  // Accent color state - defaults to white (index 0)
  const [accentColorIndex, setAccentColorIndex] = useState(() => {
    try {
      const saved = localStorage.getItem('developmentActivityWidget.accentColor');
      return saved !== null ? parseInt(saved) : 0;
    } catch {
      return 0;
    }
  });
  
  // Load persisted settings from localStorage with fallbacks
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    try {
      return localStorage.getItem('developmentActivityWidget.selectedPeriod') || 'current';
    } catch {
      return 'current';
    }
  });
  
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('developmentActivityWidget.viewMode') || 'repository';
    } catch {
      return 'repository';
    }
  });
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [currentShareType, setCurrentShareType] = useState(null);
  const [error, setError] = useState(null);
  
  
  const widgetRef = useRef(null);
  const chartRef = useRef(null);
  const leaderboardRef = useRef(null);
  const chartSvgRef = useRef(null);
  const chartInnerRef = useRef(null);
  const captureRef = useRef(null);
  const mobileChartCaptureRef = useRef(null);
  const [chartContainerWidth, setChartContainerWidth] = useState(0);


  // Use centralized caching - TTL is now determined per period in chartDataUtils

  // View mode options for dropdown
  const viewModeOptions = [
    { key: 'repository', label: 'Repository', description: 'Show individual repositories' },
    { key: 'organization', label: 'Organization', description: 'Show aggregated data by organization' }
  ];

  // Load activity data with server-side cache optimization
  const loadActivityData = useCallback(async (forceRefresh = false) => {
    // Cancel any existing request
    if (loadActivityData.controller) {
      loadActivityData.controller.abort();
    }
    
    // Create new AbortController for this request
    const controller = new AbortController();
    loadActivityData.controller = controller;
    
    try {
      const currentViewMode = viewMode || 'repository';
      const currentPeriod = selectedPeriod || 'current';
      
      console.log(`🔍 DEBUG: loadActivityData called - viewMode: ${currentViewMode}, period: ${currentPeriod}, forceRefresh: ${forceRefresh}`);
      
      // Check centralized cache first
      const cachedData = ChartDataCache.get(currentViewMode, currentPeriod);
      
      console.log(`🔍 DEBUG: Cache check - cachedData exists: ${!!cachedData}`);
      
      if (!forceRefresh && cachedData) {
        console.log('⚡ INSTANT SWITCH: Using cached data!');
        const periodData = { ...cachedData, period: currentPeriod, viewMode: currentViewMode };
        console.log(`🔍 DEBUG: Setting cached data - dailyLeaderboard: ${periodData.dailyLeaderboard?.length || 0}, weeklyLeaderboard: ${periodData.weeklyLeaderboard?.length || 0}`);
        setActivityData(periodData);
        
        // Dispatch event for other components
        const event = new CustomEvent('activityDataUpdated', {
          detail: periodData.metrics?.daily || periodData.metrics?.weekly
        });
        document.dispatchEvent(event);
        
        setIsLoading(false);
        setError(null);
        return;
      }

      // Smart loading state - only show loading when we have no cached data
      if (!ChartDataCache.has(currentViewMode, currentPeriod)) {
        setIsLoading(true);
      }
      setError(null);
      setHasDataLoadError(false);
      
      console.log(`🚀 Loading ${currentViewMode} data from server (server-side cache optimized)...`);
      
      // Add cache busting parameter to force fresh data when view mode changes
      const cacheBuster = forceRefresh ? `&_t=${Date.now()}` : '';
      const response = await fetch(`/api/development-activity?viewMode=${currentViewMode}&period=${currentPeriod}${cacheBuster}`, {
        signal: controller.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      console.log(`🔍 DEBUG: API response received - hasDaily: ${!!data.dailyLeaderboard}, hasWeekly: ${!!data.weeklyLeaderboard}, hasPreloaded: ${!!data.preloadedPeriods}`);
      
      if (data && (data.dailyLeaderboard || data.weeklyLeaderboard || data.preloadedPeriods)) {
        // Store all periods in centralized cache
        if (data.preloadedPeriods) {
          Object.entries(data.preloadedPeriods).forEach(([periodKey, periodData]) => {
            ChartDataCache.set(currentViewMode, periodKey, periodData);
          });
        }
        
        // Set current period data
        let currentData;
        if (data.preloadedPeriods && data.preloadedPeriods[currentPeriod]) {
          currentData = { ...data.preloadedPeriods[currentPeriod], period: currentPeriod, viewMode: currentViewMode };
        } else {
          currentData = { ...data, period: currentPeriod, viewMode: currentViewMode };
          // Cache single period data too
          ChartDataCache.set(currentViewMode, currentPeriod, data);
        }
        
        console.log(`🔍 DEBUG: Setting API data - currentData dailyLeaderboard: ${currentData.dailyLeaderboard?.length || 0}, weeklyLeaderboard: ${currentData.weeklyLeaderboard?.length || 0}`);
        
        setActivityData(currentData);
        setError(null);
        setHasDataLoadError(false);
        
        // Dispatch event for other components
        const event = new CustomEvent('activityDataUpdated', {
          detail: currentData.metrics?.daily || currentData.metrics?.weekly
        });
        document.dispatchEvent(event);
        
        console.log(`✅ LOADED ${Object.keys(data.preloadedPeriods || {}).length} periods from server: ${currentData.dailyLeaderboard?.length || 0} resources with activity`);
      } else {
        console.log('🔍 DEBUG: Invalid data format received:', data);
        throw new Error('Invalid data format received');
      }
    } catch (error) {
      // Don't show error for aborted requests
      if (error.name === 'AbortError') {
        console.log('🚫 Request cancelled');
        return;
      }
      
      console.error('❌ Failed to load activity data:', error);
      setError(error.message);
      setHasDataLoadError(true);
    } finally {
      setIsLoading(false);
      // Clear the controller reference
      if (loadActivityData.controller === controller) {
        loadActivityData.controller = null;
      }
    }
  }, [viewMode, selectedPeriod]);

  // Load data on mount or when first expanded - optimized for server cache
  useEffect(() => {
    if (!isExpanded) return;
    
    // Add a small delay to prevent rapid-fire calls during animation
    const timer = setTimeout(() => {
      // Check centralized cache for current view mode and period
      const cachedData = ChartDataCache.get(viewMode, selectedPeriod);
      
      if (cachedData) {
        console.log('📦 Widget expanded - using cached data');
        const periodData = { ...cachedData, period: selectedPeriod, viewMode: viewMode };
        setActivityData(periodData);
        setIsLoading(false);
      } else {
        console.log('📦 Widget expanded - loading from server');
        loadActivityData();
      }
    }, 100); // Small delay to let animation settle
    
    return () => clearTimeout(timer);
  }, [isExpanded]);

  // Cleanup: Cancel any pending requests when component unmounts
  useEffect(() => {
    return () => {
      if (loadActivityData.controller) {
        loadActivityData.controller.abort();
        loadActivityData.controller = null;
      }
    };
  }, []);

  // Measure chart container width on mobile to avoid clipping
  useEffect(() => {
    const element = chartInnerRef.current;
    if (!element) return;
    const measure = () => {
      try {
        setChartContainerWidth(element.clientWidth || 0);
      } catch {}
    };
    measure();
    let resizeObserver;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(element);
    } else {
      window.addEventListener('resize', measure);
    }
    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [isExpanded]);

  // Handle view mode changes more gracefully
  const viewModeRef = useRef(viewMode);
  
  useEffect(() => {
    // Update ref first to prevent stale references
    const previousViewMode = viewModeRef.current;
    viewModeRef.current = viewMode;
    
    // Only trigger if viewMode actually changed (not on initial mount)
    if (isExpanded && viewMode && previousViewMode && previousViewMode !== viewMode) {
      console.log(`🔄 View mode changed from ${previousViewMode} to ${viewMode}`);
      
      // Check centralized cache for new view mode
      const cachedData = ChartDataCache.get(viewMode, selectedPeriod);
      if (cachedData) {
        console.log('⚡ Using cached data for view mode switch');
        const periodData = { ...cachedData, period: selectedPeriod, viewMode: viewMode };
        setActivityData(periodData);
        setIsLoading(false);
        
        // Dispatch event for other components
        const event = new CustomEvent('activityDataUpdated', {
          detail: periodData.metrics?.daily || periodData.metrics?.weekly
        });
        document.dispatchEvent(event);
      } else {
        console.log('🔄 Loading fresh data for new view mode...');
        loadActivityData(true);
      }
    }
  }, [viewMode, isExpanded, selectedPeriod, loadActivityData]);

  // Listen for accent color changes from other components
  useEffect(() => {
    const handleAccentColorChange = (event) => {
      const { colorIndex, source } = event.detail;
      if (source !== 'developmentActivityWidget') {
        setAccentColorIndex(colorIndex);
      }
    };
    
    document.addEventListener('accentColorChanged', handleAccentColorChange);
    return () => document.removeEventListener('accentColorChanged', handleAccentColorChange);
  }, []);

  // Period changes are now handled instantly via preloaded data in the dropdown onChange handler


  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isExpanded && !event.target.closest('.dev-activity-widget')) {
        onCollapse();
      }
    };
    
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded, onCollapse]);

  // Handle share menu
  useEffect(() => {
    const handleShareMenuClickOutside = (event) => {
      if (shareMenuOpen && !event.target.closest('.share-menu-container') && !event.target.closest('.share-button')) {
        setShareMenuOpen(false);
      }
    };
    
    if (shareMenuOpen) {
      const timer = setTimeout(() => {
        document.addEventListener('click', handleShareMenuClickOutside);
      }, 100);
      
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handleShareMenuClickOutside);
      };
    }
  }, [shareMenuOpen]);

  // Screenshot mode timer
  useEffect(() => {
    if (screenshotMode) {
      const timer = setTimeout(() => {
        setScreenshotMode(false);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [selectedPeriod, screenshotMode]);

  // Use centralized data transformation - removed 180 lines of duplicate logic

  // Get current period data based on selection with proper current week filtering
  const currentPeriodData = useMemo(() => {
    if (!activityData) {
      console.log('🔍 DEBUG: currentPeriodData - no activityData');
      return null;
    }
    
    // Handle different data structures for organization vs repository view
    const dailyLeaderboard = activityData.dailyLeaderboard || [];
    const weeklyLeaderboard = activityData.weeklyLeaderboard || [];
    const dailyChartData = activityData.dailyChartData || [];
    const weeklyChartData = activityData.weeklyChartData || [];
    
    console.log(`🔍 DEBUG: currentPeriodData - period: ${selectedPeriod}, dailyLeaderboard: ${dailyLeaderboard.length}, weeklyLeaderboard: ${weeklyLeaderboard.length}, dailyChartData: ${dailyChartData.length}, weeklyChartData: ${weeklyChartData.length}`);
    
    // Use centralized period configuration
    const config = getPeriodConfig(selectedPeriod);
    const isDaily = config.isDaily;
    const periodLabel = config.label;
    
    // Use appropriate data based on period type
    const rawChartData = isDaily ? dailyChartData : weeklyChartData;
    const leaderboard = isDaily ? dailyLeaderboard : weeklyLeaderboard;
    
    // Use centralized data transformation
    let transformedChartData = transformChartData(rawChartData, selectedPeriod, 'DevelopmentActivityWidget');
    
    // Validate node count
    validateNodeCount(transformedChartData, selectedPeriod, 'DevelopmentActivityWidget');
    
    console.log(`🔍 DEBUG: currentPeriodData result - leaderboard: ${leaderboard.length}, transformedChartData: ${transformedChartData.length}, isDaily: ${isDaily}`);

    return {
      leaderboard,
      chartData: transformedChartData,
      metrics: isDaily ? activityData.metrics?.daily : activityData.metrics?.weekly,
      periodLabel,
      isDaily,
      rawChartData // Keep raw data for contributing resources
    };
  }, [activityData, selectedPeriod, viewMode]);

  // Calculate filtered leaderboard totals from the exact same data used by chart tooltips
  const filteredLeaderboard = useMemo(() => {
    // Only apply filtering to periods that have discrepancies
    // Daily was working correctly, so leave it unchanged
    if (!currentPeriodData || currentPeriodData.isDaily) {
      return currentPeriodData?.leaderboard || [];
    }

    const { leaderboard, chartData, rawChartData, isDaily } = currentPeriodData;

    if (!leaderboard || !chartData || !rawChartData) {
      return leaderboard || [];
    }

    // Calculate totals by summing each resource's contribution to each chart data point
    const resourceTotals = new Map();


    // Use the EXACT same logic as contributingResources (lines 542-571)
    chartData.forEach((dataPoint) => {
      rawChartData.forEach(resourceData => {
        let resourceCount = 0;

        if (isDaily && resourceData.dailyCounts) {
          // For daily periods, find matching day in dailyCounts
          const dayIndex = chartData.findIndex(dp => dp.weekStart === dataPoint.weekStart);
          if (dayIndex >= 0 && dayIndex < resourceData.dailyCounts.length) {
            resourceCount = resourceData.dailyCounts[dayIndex] || 0;
          }
        } else if (!isDaily && resourceData.weeklyData) {
          // For weekly periods, match by weekStart date (most reliable)
          const weekData = resourceData.weeklyData.find(w => w.weekStart === dataPoint.weekStart);
          resourceCount = weekData?.count || 0;
        } else if (!isDaily && resourceData.weeklyCounts) {
          // Fallback: if weeklyData not available, match by date in weeklyCounts
          const weekIndex = chartData.findIndex(dp => dp.weekStart === dataPoint.weekStart);
          if (weekIndex >= 0 && weekIndex < resourceData.weeklyCounts.length) {
            resourceCount = resourceData.weeklyCounts[weekIndex] || 0;
          }
        }

        if (resourceCount > 0) {
          const resourceId = resourceData.resource?.id || resourceData.resource?.name;
          const currentTotal = resourceTotals.get(resourceId) || 0;
          resourceTotals.set(resourceId, currentTotal + resourceCount);
        }
      });
    });

    // Update leaderboard with chart-consistent totals
    return leaderboard.map(item => {
      const resourceId = item.resource?.id || item.resource?.name;
      const chartTotal = resourceTotals.get(resourceId);

      return {
        ...item,
        totalCommits: chartTotal !== undefined ? chartTotal : item.totalCommits // Safe fallback
      };
    }).sort((a, b) => b.totalCommits - a.totalCommits); // Re-sort after recalculation

  }, [currentPeriodData]);

  // Extract contributing resources for each data point
  const contributingResources = useMemo(() => {
    if (!currentPeriodData?.rawChartData || !currentPeriodData?.chartData) {
      return null;
    }
    
    const { rawChartData, chartData, isDaily } = currentPeriodData;
    
    // For both organization and repository views, we have individual resource contributions
    if (rawChartData.length > 0) {
      return chartData.map((dataPoint) => {
        const contributors = rawChartData
          .map(resourceData => {
            let resourceCount = 0;
            
            if (isDaily && resourceData.dailyCounts) {
              // For daily periods, find matching day in dailyCounts
              const dayIndex = chartData.findIndex(dp => dp.weekStart === dataPoint.weekStart);
              if (dayIndex >= 0 && dayIndex < resourceData.dailyCounts.length) {
                resourceCount = resourceData.dailyCounts[dayIndex] || 0;
              }
            } else if (!isDaily && resourceData.weeklyData) {
              // For weekly periods, match by weekStart date (most reliable)
              const weekData = resourceData.weeklyData.find(w => w.weekStart === dataPoint.weekStart);
              resourceCount = weekData?.count || 0;
            } else if (!isDaily && resourceData.weeklyCounts) {
              // Fallback: if weeklyData not available, match by date in weeklyCounts
              // This assumes weeklyCounts corresponds to the same weeks as chartData
              const weekIndex = chartData.findIndex(dp => dp.weekStart === dataPoint.weekStart);
              if (weekIndex >= 0 && weekIndex < resourceData.weeklyCounts.length) {
                resourceCount = resourceData.weeklyCounts[weekIndex] || 0;
              }
            }
            
            return {
              resource: resourceData.resource,
              count: resourceCount
            };
          })
          .filter(item => item.count > 0)
          .sort((a, b) => b.count - a.count);
        
        return contributors;
      });
    }
    
    return null;
  }, [currentPeriodData, viewMode]);

  // Get activity level
  const getActivityLevel = (commitsPerWeek) => {
    if (commitsPerWeek >= 20) return 'Very High';
    if (commitsPerWeek >= 10) return 'High';
    if (commitsPerWeek >= 5) return 'Medium';
    if (commitsPerWeek >= 2) return 'Low';
    return 'Minimal';
  };

  // Share functionality
  const [shareMessage, setShareMessage] = useState('');
  const [shareMessageType, setShareMessageType] = useState('success');

  const showShareSuccess = (message) => {
    setShareMessage(message);
    setShareMessageType('success');
    setTimeout(() => setShareMessage(''), 10000);
  };

  const showShareError = (message) => {
    setShareMessage(message);
    setShareMessageType('error');
    setTimeout(() => setShareMessage(''), 4000);
  };

  const shareToXHandler = async (element, shareType = 'chart') => {
    if (!element) {
      console.error('No element provided to shareToX');
      return;
    }

    setIsSharing(true);
    setScreenshotMode(true);
    setCurrentShareType(shareType);

    try {
        // Wait for screenshot mode to apply and layout to stabilize
        await new Promise(resolve => setTimeout(resolve, 500));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      
      let targetElement;

      // Determine the correct element to capture based on share type and screen size
      if (shareType === 'full') {
        targetElement = captureRef.current || widgetRef.current;
      } else if (shareType === 'leaderboard') {
        targetElement = leaderboardRef.current;
      } else if (shareType === 'chart') {
        if (window.innerWidth < 768) {
          // On mobile, use the special container that includes metrics
          targetElement = mobileChartCaptureRef.current;
        } else {
          // On desktop, use the chart-only container
          targetElement = chartRef.current;
        }
      }

      // Fallback to the passed element if not determined by shareType
      if (!targetElement) {
        targetElement = element;
      }
      
      if (!targetElement) {
        showShareError('Could not find element to capture.');
        console.error('Share error: target element is null for shareType:', shareType);
        // Reset state even on error
        setScreenshotMode(false);
        setCurrentShareType(null);
        setIsSharing(false);
        return;
      }
      
      // Capture widget first to get actual image dimensions
      const dataUrl = await htmlToImage.toPng(targetElement, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: 'transparent', // Keep transparent to avoid double backgrounds
        skipFonts: false
      });
      
      // Load image to get true dimensions
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      
      // Use actual image dimensions for canvas sizing
      const paddingX = 35; // Horizontal padding
      const paddingTop = 33; // Top padding
      const paddingBottom = 10; // Bottom padding (above branding area)
      const finalWidth = img.width + (paddingX * 2);
      
      // Prepare branding logo and compute dynamic padding before sizing canvas
      const logoImg = new Image();
      logoImg.src = brandingLogo;
      await new Promise((resolve, reject) => {
        logoImg.onload = resolve;
        logoImg.onerror = reject;
      });
      const logoAspectRatio = logoImg.width / logoImg.height;
      const logoTargetWidth = Math.min(420, finalWidth * 0.28);
      const computedLogoHeight = Math.max(28, Math.round(logoTargetWidth / logoAspectRatio));
      const brandingPadding = computedLogoHeight + 20; // space for logo + margin
      const finalHeight = img.height + paddingTop + paddingBottom + brandingPadding;
      
      // Create canvas with proper background matching your page
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      
      // Base gradient - lighter
      const gradient = ctx.createLinearGradient(0, 0, finalWidth, finalHeight);
      gradient.addColorStop(0, '#1E1E1E');
      gradient.addColorStop(0.5, '#0F0F0F');
      gradient.addColorStop(1, '#1A1A1A');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
      
      // Add subtle color overlays
      // Purple gradient at 20% 80%
      const purpleGradient = ctx.createRadialGradient(finalWidth * 0.2, finalHeight * 0.8, 0, finalWidth * 0.2, finalHeight * 0.8, finalWidth * 0.5);
      purpleGradient.addColorStop(0, 'rgba(120, 119, 198, 0.1)');
      purpleGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = purpleGradient;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
      
      // Pink gradient at 80% 20%
      const pinkGradient = ctx.createRadialGradient(finalWidth * 0.8, finalHeight * 0.2, 0, finalWidth * 0.8, finalHeight * 0.2, finalWidth * 0.5);
      pinkGradient.addColorStop(0, 'rgba(255, 119, 198, 0.1)');
      pinkGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = pinkGradient;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
      
      // Blue gradient at 40% 40%
      const blueGradient = ctx.createRadialGradient(finalWidth * 0.4, finalHeight * 0.4, 0, finalWidth * 0.4, finalHeight * 0.4, finalWidth * 0.5);
      blueGradient.addColorStop(0, 'rgba(120, 219, 255, 0.1)');
      blueGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = blueGradient;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
      
      const centerX = paddingX; // Since canvas width = img.width + padding*2
      const centerY = paddingTop;
      ctx.drawImage(img, centerX, centerY);
      
      // Draw branding logo centered at bottom
      const logoWidth = Math.round(logoTargetWidth);
      const logoHeight = computedLogoHeight;
      const logoX = Math.round((finalWidth - logoWidth) / 2);
      const logoY = Math.round(finalHeight - logoHeight - 15);
      ctx.drawImage(logoImg, logoX, logoY, logoWidth, logoHeight);
      
      // Convert to blob
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/png', 1.0);
      });

      const handles = getTop5HandlesOrNames(currentPeriodData?.leaderboard || []);
      const tweetText = generateTweetText(handles, shareType, currentPeriodData?.leaderboard || []);

      const result = await shareToX(blob, tweetText, handles);
      
      if (result.success) {
        showShareSuccess(`Copied! Paste anywhere you like,<br>or <a href="https://x.com/intent/tweet" target="_blank" rel="noopener noreferrer" style="color: #FFFFFF; text-decoration: underline;">open X</a>`);
      } else {
        showShareError(result.message);
      }
    } catch (error) {
      console.error('Share error:', error);
      showShareError('Failed to generate image. Please try again.');
    } finally {
      setScreenshotMode(false);
      setCurrentShareType(null);
      setTimeout(() => {
        setIsSharing(false);
      }, 1000);
    }
  };

  const handleShareChart = () => {
    setShareMenuOpen(false);
    shareToXHandler(chartRef.current, 'chart');
  };

  const handleShareChartLeaderboard = () => {
    setShareMenuOpen(false);
    shareToXHandler(captureRef.current, 'full');
  };

  const handleShareLeaderboard = () => {
    setShareMenuOpen(false);
    shareToXHandler(leaderboardRef.current, 'leaderboard');
  };

  const { chartData, metrics } = currentPeriodData || {};
  const leaderboard = filteredLeaderboard;

  // Labels for screenshot mode (dropdowns become static text)
  const selectedPeriodLabel = useMemo(() => {
    const opt = periodOptions.find(o => o.value === selectedPeriod || o.key === selectedPeriod || o.id === selectedPeriod);
    return opt?.label || currentPeriodData?.periodLabel || selectedPeriod;
  }, [selectedPeriod, currentPeriodData]);
  const viewModeLabel = useMemo(() => {
    const opt = viewModeOptions.find(o => o.key === viewMode);
    return opt?.label || viewMode;
  }, [viewMode]);



  // Helper function to calculate sequential period maximum for longer periods with date metadata
  const calculateLongerPeriodHistoricalMax = useCallback((currentTotal) => {
    if (!chartData) return null; // insufficient data
    
    // Map period to number of weeks for sequential calculation
    const periodWeeks = {
      '5weeks': 4,
      '3months': 12,
      '52weeks': 52,
      '3years': 156
    };
    
    const weeksInPeriod = periodWeeks[selectedPeriod];
    if (!weeksInPeriod) return null; // unknown period
    
    let maxSequentialTotal = 0;
    let peakPeriodStartDate = null;
    let peakPeriodEndDate = null;
    const periodsToCheck = ['3years', '52weeks', '3months', '5weeks'];
    
    for (const period of periodsToCheck) {
      const cachedPeriodData = ChartDataCache.get(viewMode, period);
      if (cachedPeriodData && cachedPeriodData.weeklyChartData) {
        const transformedData = transformChartData(cachedPeriodData.weeklyChartData, period, 'LongerPeriodHistoricalMax');
        
        if (transformedData && transformedData.length > weeksInPeriod) {
          // Calculate rolling sums for sequential periods
          for (let i = 0; i <= transformedData.length - weeksInPeriod; i++) {
            const periodSlice = transformedData.slice(i, i + weeksInPeriod);
            const sequentialSum = periodSlice.reduce((sum, week) => sum + (week.count || 0), 0);
            
            if (sequentialSum > maxSequentialTotal) {
              maxSequentialTotal = sequentialSum;
              // Extract start and end dates from the period slice
              peakPeriodStartDate = periodSlice[0]?.weekStart || null;
              peakPeriodEndDate = periodSlice[periodSlice.length - 1]?.weekStart || null;
              
              // For end date, add 6 days to get the end of the week
              if (peakPeriodEndDate) {
                const endDate = new Date(peakPeriodEndDate);
                endDate.setDate(endDate.getDate() + 6);
                peakPeriodEndDate = endDate.toISOString().split('T')[0];
              }
            }
          }
          
          console.log(`📊 Using ${period} data for ${selectedPeriod} comparison (${transformedData.length} weeks), found max sequential ${weeksInPeriod}-week period: ${maxSequentialTotal}`);
          if (peakPeriodStartDate && peakPeriodEndDate) {
            console.log(`📅 Peak period: ${peakPeriodStartDate} to ${peakPeriodEndDate}`);
          }
        }
        
        // Use only the first (longest) available period
        break;
      }
    }
    
    // If no historical data found, return null to indicate insufficient data
    if (maxSequentialTotal === 0) {
      console.log(`📊 No historical data found for ${selectedPeriod} comparison, insufficient data for meaningful comparison`);
      return null;
    }
    
    // Include current period in comparison
    const trueHistoricalMax = Math.max(maxSequentialTotal, currentTotal);
    
    console.log(`📊 ${selectedPeriod} historical max: historical=${maxSequentialTotal}, current=${currentTotal}, final=${trueHistoricalMax}`);
    console.log(`📊 DATA VERIFICATION - ${selectedPeriod} calculation details:`, {
      weeksInPeriod,
      currentTotal,
      maxSequentialTotal,
      finalResult: trueHistoricalMax,
      usedHistoricalData: maxSequentialTotal > 0,
      fallbackUsed: maxSequentialTotal === 0,
      peakPeriodDates: { start: peakPeriodStartDate, end: peakPeriodEndDate }
    });
    
    return {
      value: trueHistoricalMax,
      peakStartDate: peakPeriodStartDate,
      peakEndDate: peakPeriodEndDate,
      peakValue: maxSequentialTotal
    };
  }, [chartData, viewMode, selectedPeriod]);

  // Date formatting utility for period ranges
  const formatPeriodDateRange = (startDate, endDate, periodType) => {
    if (!startDate || !endDate) return null;
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Format options
    const monthOptions = { month: 'short' };
    
    const startMonth = start.toLocaleDateString('en-US', monthOptions);
    const endMonth = end.toLocaleDateString('en-US', monthOptions);
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();
    
    // Different formatting based on period type and date span
    if (periodType === 'current') {
      // For 7-day periods, show specific dates
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (startYear === endYear) {
      // Same year: "Jan - Mar 2024"
      if (startMonth === endMonth) {
        // Same month: "Jan 2024"
        return `${startMonth} ${startYear}`;
      } else {
        return `${startMonth} - ${endMonth} ${startYear}`;
      }
    } else {
      // Different years: "Dec 2023 - Feb 2024"
      return `${startMonth} ${startYear} - ${endMonth} ${endYear}`;
    }
  };

  // Enhanced 7-day historical maximum with date metadata
  const weeklyHistoricalMaxWithDates = useMemo(() => {
    if (selectedPeriod !== 'current' || !chartData) {
      return null;
    }
    
    let maxWeekTotal = 0;
    let peakWeekStartDate = null;
    let peakWeekEndDate = null;
    
    // For 7-day view, chartData contains daily data points, so sum them to get current week total
    const currentWeekTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
    
    // Use only the longest available period for consistent comparison
    const periodsToCheck = ['3years', '52weeks', '3months', '5weeks'];
    
    for (const period of periodsToCheck) {
      const cachedPeriodData = ChartDataCache.get(viewMode, period);
      if (cachedPeriodData && cachedPeriodData.weeklyChartData) {
        const transformedData = transformChartData(cachedPeriodData.weeklyChartData, period, 'WeeklyHistoricalMax');
        
        if (transformedData && transformedData.length > 0) {
          // Find maximum from the aggregated weekly totals
          transformedData.forEach(week => {
            const weekCommits = week.count || 0;
            if (weekCommits > maxWeekTotal) {
              maxWeekTotal = weekCommits;
              peakWeekStartDate = week.weekStart;
              
              // Calculate end date (6 days after start)
              if (peakWeekStartDate) {
                const endDate = new Date(peakWeekStartDate);
                endDate.setDate(endDate.getDate() + 6);
                peakWeekEndDate = endDate.toISOString().split('T')[0];
              }
            }
          });
          
          console.log(`📊 Using ${period} data for 7-day comparison (${transformedData.length} weeks), found max week: ${maxWeekTotal}`);
          if (peakWeekStartDate && peakWeekEndDate) {
            console.log(`📅 Peak week: ${peakWeekStartDate} to ${peakWeekEndDate}`);
          }
        }
        
        // Use only the first (longest) available period
        break;
      }
    }
    
    // If no historical data found, use current week as baseline
    if (maxWeekTotal === 0) {
      console.log('📊 No historical weekly data found for 7-day comparison, using current week as baseline');
      return {
        value: currentWeekTotal || 1,
        peakStartDate: null,
        peakEndDate: null,
        peakValue: 0
      };
    }
    
    // Include current week in comparison
    const trueHistoricalMax = Math.max(maxWeekTotal, currentWeekTotal);
    
    console.log(`📊 7-day historical max calculation: historicalMax=${maxWeekTotal}, currentWeek=${currentWeekTotal}, finalMax=${trueHistoricalMax}`);
    
    return {
      value: trueHistoricalMax,
      peakStartDate: peakWeekStartDate,
      peakEndDate: peakWeekEndDate,
      peakValue: maxWeekTotal
    };
  }, [selectedPeriod, chartData, viewMode]);

  // Check if current week is a new record
  const isNewRecord = useMemo(() => {
    if (selectedPeriod !== 'current' || !chartData || !weeklyHistoricalMaxWithDates) {
      return false;
    }
    const currentWeekTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
    
    // Use the enhanced weekly historical data
    const historicalMaxData = weeklyHistoricalMaxWithDates;
    if (!historicalMaxData) return false;
    
    // Check if current week exceeds the historical peak value (not including current week in the peak calculation)
    return currentWeekTotal > (historicalMaxData.peakValue || 0);
  }, [selectedPeriod, chartData, weeklyHistoricalMaxWithDates]);

  // Current accent color
  const currentAccentColor = accentColors[accentColorIndex];

  // Handle accent color change
  const handleAccentColorChange = () => {
    const newIndex = (accentColorIndex + 1) % accentColors.length;
    setAccentColorIndex(newIndex);
    try {
      localStorage.setItem('developmentActivityWidget.accentColor', newIndex.toString());
      localStorage.setItem('resourceCard.accentColor', newIndex.toString());
    } catch {}
    
    // Dispatch global event to sync other components
    const event = new CustomEvent('accentColorChanged', {
      detail: { colorIndex: newIndex, source: 'developmentActivityWidget' }
    });
    document.dispatchEvent(event);
  };

  return (
    <>
      {!isExpanded ? (
        <div
          className="relative z-50 w-16 h-16"
          onClick={onExpand}
        >
          <div className="flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl">
            <Activity size={24} className="text-[#C8F560]" />
          </div>
        </div>
      ) : (
        <Portal>
          {isSharing && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[10000] flex flex-col items-center justify-center text-white">
              <ClipboardCheck size={48} className="text-[#C8F560]" />
              <p className="mt-4 text-lg font-medium text-[#C8F560]">Copied to clipboard</p>
            </div>
          )}
          <div
            ref={widgetRef}
            className={`dev-activity-widget ${screenshotMode ? 'absolute top-0 left-0 w-[1400px]' : 'fixed z-[9999] left-1/2 top-1/2 w-[75vw] max-w-[1600px] max-h-[95vh] min-w-[900px] min-h-[700px] md:w-[75vw] md:max-w-[1600px] md:min-w-[900px] md:min-h-[700px]'} ${screenshotMode ? 'bg-card-bg/90' : 'bg-card-bg/40'} border border-gray-800 rounded-xl shadow-lg ${screenshotMode ? 'overflow-visible' : 'overflow-hidden'} widget-crossfade-enter-active mobile:inset-4 mobile:w-auto mobile:h-auto mobile:min-w-0 mobile:min-h-0 mobile:max-w-none mobile:max-h-none mobile:bg-card-bg/40 mobile:border-gray-700 mobile:rounded-2xl mobile:overflow-y-auto`}
            style={{ 
              borderRadius: '32px',
              ...(screenshotMode ? { 
                transform: 'none',
                position: 'absolute',
                zIndex: 'auto'
              } : (window.innerWidth < 768 ? {
                transform: 'none',
                position: 'fixed',
                borderRadius: '16px'
              } : {
                transform: 'translate(-50%, -50%)'
              }))
            }}
            data-widget="development-activity"
          >
            {/* Mobile top action bar with heading and mobile buttons */}
            <div className={`absolute top-6 left-6 right-6 z-50 hidden mobile:flex items-center justify-between ${screenshotMode ? 'mobile:hidden' : ''}`}>
              {/* Mobile heading */}
              <div className="flex items-center gap-3">
                <Activity size={20} className="text-[#C8F560] flex-shrink-0" />
                <h3 className="text-white font-semibold text-lg">Development Activity</h3>
              </div>
              
              {/* Mobile action buttons */}
              <div className="flex items-center gap-3">
                {/* Mobile Share Button - Icon Only */}
                <div className="relative">
                  <button
                    className={`share-button text-white hover:text-gray-300 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 hover:bg-gray-800/50 ${
                      isSharing ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    onClick={() => {
                      if (!isSharing) {
                        setShareMenuOpen(v => !v);
                      }
                    }}
                    title="Share Development Activity"
                    disabled={isSharing}
                  >
                    {isSharing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                  </button>
                  {shareMenuOpen && !screenshotMode && (
                    <div className="share-menu-container absolute right-0 top-full mt-1 w-48 bg-gray-800/40 backdrop-blur-sm border border-gray-600/50 rounded-lg shadow-lg z-50">
                      <div className="px-3 py-2 border-b border-gray-700">
                        <div className="text-xs text-gray-400 font-medium">Share Options</div>
                      </div>
                      <button 
                        className="block w-full text-left px-3 py-2 text-sm transition-colors duration-200 hover:bg-gray-700/50 text-gray-300"
                        onClick={handleShareChart}
                        disabled={isSharing}
                      >
                        <div className="flex items-center justify-between">
                          <span className="mobile:hidden">Chart Only</span>
                          <span className="hidden mobile:block">Chart + Metrics</span>
                          <span className="text-xs text-gray-400">Copy & Tweet</span>
                        </div>
                      </button>
                      <button 
                        className="block w-full text-left px-3 py-2 text-sm transition-colors duration-200 hover:bg-gray-700/50 text-gray-300 mobile:hidden"
                        onClick={handleShareChartLeaderboard}
                        disabled={isSharing}
                      >
                        <div className="flex items-center justify-between">
                          <span>Complete</span>
                          <span className="text-xs text-gray-400">Copy & Tweet</span>
                        </div>
                      </button>
                      <button 
                        className="block w-full text-left px-3 py-2 text-sm transition-colors duration-200 hover:bg-gray-700/50 text-gray-300"
                        onClick={handleShareLeaderboard}
                        disabled={isSharing}
                      >
                        <div className="flex items-center justify-between">
                          <span>Leaderboard Only</span>
                          <span className="text-xs text-gray-400">Copy & Tweet</span>
                        </div>
                      </button>
                      <div className="px-3 py-2 border-t border-gray-700">
                        <div className="text-xs text-gray-400">
                          Copies image + text to clipboard.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Mobile Color Picker - Dot Only */}
                <button
                  onClick={handleAccentColorChange}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 hover:bg-gray-800/50"
                  title={`Current accent color: ${currentAccentColor.name}`}
                >
                  <div 
                    className="w-3 h-3 rounded-full border border-gray-600/50 transition-all duration-200 hover:scale-110"
                    style={{
                      backgroundColor: currentAccentColor.hex,
                      boxShadow: `0 0 6px rgba(${currentAccentColor.rgb}, 0.4), 0 0 12px rgba(${currentAccentColor.rgb}, 0.2)`
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.boxShadow = `0 0 12px rgba(${currentAccentColor.rgb}, 0.8), 0 0 18px rgba(${currentAccentColor.rgb}, 0.5)`;
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.boxShadow = `0 0 6px rgba(${currentAccentColor.rgb}, 0.4), 0 0 6px rgba(${currentAccentColor.rgb}, 0.2)`;
                    }}
                  />
                </button>
                
                {/* Close Button */}
                <button
                  className="text-gray-400 hover:text-white transition-all duration-200 w-8 h-8 flex items-center justify-center"
                  onClick={onCollapse}
                  aria-label="Close"
                >
                  <span style={{ fontSize: 24, fontWeight: 'bold', lineHeight: 1 }}>×</span>
                </button>
              </div>
            </div>
            
            {/* Desktop close button - positioned separately */}
            <button
              className={`absolute top-6 right-6 z-50 mobile:hidden text-gray-400 hover:text-white transition-all duration-200 ${screenshotMode ? 'hidden' : ''}`}
              onClick={onCollapse}
              aria-label="Close"
            >
              <span style={{ fontSize: 24, fontWeight: 'bold', lineHeight: 1 }}>×</span>
            </button>
            
            {/* Main Content Container */}
            <div ref={captureRef} className={`w-full flex flex-col ${screenshotMode ? 'h-auto overflow-visible' : 'h-full overflow-hidden mobile:h-auto mobile:overflow-visible'}`}>
              {/* Header Section */}
              <div className={`flex-shrink-0 px-8 mobile:px-6 ${screenshotMode ? 'pt-4 pb-2' : 'pt-8 pb-4 mobile:pt-16 mobile:pb-6'} min-h-0`}>
                <div className="flex items-center justify-between gap-4 mobile:flex-col mobile:items-stretch mobile:gap-6">
                  <div className="flex items-center gap-4 mobile:gap-3 min-w-0 flex-1 mobile:justify-center mobile:hidden">
                    <Activity size={screenshotMode ? 24 : 20} className="text-[#C8F560] flex-shrink-0" />
                    <h3 className={`text-white font-semibold ${screenshotMode ? 'text-lg' : 'text-base'}`}>Development Activity</h3>
                    {!screenshotMode ? (
                      <>
                        <div className="mobile:hidden flex gap-4 items-center">
                          <PeriodDropdown
                            value={selectedPeriod}
                            onChange={(newPeriod) => {
                              console.log(`⚡ INSTANT PERIOD SWITCH: ${selectedPeriod} → ${newPeriod}`);
                              
                              // Always set the new period first
                              setSelectedPeriod(newPeriod);
                              try {
                                localStorage.setItem('developmentActivityWidget.selectedPeriod', newPeriod);
                              } catch {}
                              
                              // Check centralized cache for instant switching
                              const cachedData = ChartDataCache.get(viewMode, newPeriod);
                              if (cachedData) {
                                console.log('✅ Using cached data for instant period switch!');
                                
                                // Update activity data with cached data
                                const periodData = { ...cachedData, period: newPeriod, viewMode: viewMode };
                                
                                setActivityData(periodData);
                                
                                // Dispatch event for other components
                                const event = new CustomEvent('activityDataUpdated', {
                                  detail: periodData.metrics?.daily || periodData.metrics?.weekly
                                });
                                document.dispatchEvent(event);
                                
                                console.log(`⚡ INSTANT SWITCH COMPLETE: Now showing ${newPeriod} with ${periodData.dailyLeaderboard?.length || periodData.weeklyLeaderboard?.length || 0} resources`);
                              } else {
                                console.log('⏳ No cached data available, will load from API...');
                                loadActivityData();
                              }
                            }}
                            options={periodOptions}
                            placeholder="Select period..."
                            className={`w-48 flex-shrink-0 ${screenshotMode ? 'screenshot-dropdown' : ''}`}
                            screenshotMode={screenshotMode}
                          />
                          <PeriodDropdown
                            value={viewMode}
                            onChange={(newViewMode) => {
                              if (newViewMode !== viewMode) {
                                console.log(`🔄 View mode changing from ${viewMode} to ${newViewMode}`);
                                setViewMode(newViewMode);
                                try {
                                  localStorage.setItem('developmentActivityWidget.viewMode', newViewMode);
                                } catch {}
                              }
                            }}
                            options={viewModeOptions}
                            placeholder="Select view mode..."
                            className={`w-52 flex-shrink-0 ${screenshotMode ? 'screenshot-dropdown' : ''}`}
                            screenshotMode={screenshotMode}
                          />
                          
                          {/* Desktop action buttons - directly next to dropdowns */}
                          <div className="relative"> 
                            <button
                              className={`share-button text-white hover:text-gray-300 bg-gray-800/30 backdrop-blur-sm border border-gray-600/50 rounded-md px-3 py-1.5 transition-all duration-200 text-sm touch-target hover:border-gray-500 hover:bg-white/10 ${
                                isSharing ? 'opacity-50 cursor-not-allowed' : ''
                              }`}
                              onClick={() => {
                                if (!isSharing) {
                                  setShareMenuOpen(v => !v);
                                }
                              }}
                              title="Share Development Activity"
                              disabled={isSharing}
                            >
                              {isSharing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Share2 className="w-4 h-4" />
                              )}
                            </button>
                            {shareMenuOpen && !screenshotMode && (
                              <div className="share-menu-container absolute left-0 top-full mt-1 w-64 bg-gray-800/40 backdrop-blur-sm border border-gray-600/50 rounded-lg shadow-lg z-50">
                                <div className="px-3 py-2 border-b border-gray-700">
                                  <div className="text-xs text-gray-400 font-medium">Share Options</div>
                                </div>
                                <button 
                                  className="block w-full text-left px-3 py-2 text-sm transition-colors duration-200 hover:bg-gray-700/50 text-gray-300"
                                  onClick={handleShareChart}
                                  disabled={isSharing}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="mobile:hidden">Chart Only</span>
                                    <span className="hidden mobile:block">Chart + Metrics</span>
                                    <span className="text-xs text-gray-400">Copy & Tweet</span>
                                  </div>
                                </button>
                                <button 
                                  className="block w-full text-left px-3 py-2 text-sm transition-colors duration-200 hover:bg-gray-700/50 text-gray-300"
                                  onClick={handleShareChartLeaderboard}
                                  disabled={isSharing}
                                >
                                  <div className="flex items-center justify-between">
                                    <span>Complete</span>
                                    <span className="text-xs text-gray-400">Copy & Tweet</span>
                                  </div>
                                </button>
                                <button 
                                  className="block w-full text-left px-3 py-2 text-sm transition-colors duration-200 hover:bg-gray-700/50 text-gray-300"
                                  onClick={handleShareLeaderboard}
                                  disabled={isSharing}
                                >
                                  <div className="flex items-center justify-between">
                                    <span>Leaderboard Only</span>
                                    <span className="text-xs text-gray-400">Copy & Tweet</span>
                                  </div>
                                </button>
                                <div className="px-3 py-2 border-t border-gray-700">
                                  <div className="text-xs text-gray-400">
                                    Copies image + text to clipboard.
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {/* Desktop Accent Color Picker Dot */}
                          <div className="relative">
                            <button
                              onClick={handleAccentColorChange}
                              className="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 hover:bg-gray-800/30"
                              title={`Current accent color: ${currentAccentColor.name}`}
                            >
                              <div 
                                className="w-2 h-2 rounded-full border border-gray-600/50 transition-all duration-200 hover:scale-85"
                                style={{
                                  backgroundColor: currentAccentColor.hex,
                                  boxShadow: `0 0 6px rgba(${currentAccentColor.rgb}, 0.4), 0 0 12px rgba(${currentAccentColor.rgb}, 0.2)`
                                }}
                                onMouseEnter={(e) => {
                                  e.target.style.boxShadow = `0 0 12px rgba(${currentAccentColor.rgb}, 0.8), 0 0 24px rgba(${currentAccentColor.rgb}, 0.5)`;
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.boxShadow = `0 0 6px rgba(${currentAccentColor.rgb}, 0.4), 0 0 12px rgba(${currentAccentColor.rgb}, 0.2)`;
                                }}
                              />
                            </button>
                          </div>
                          
                          {/* Share status message - positioned directly after controls */}
                          {shareMessage && (
                            <div className={`text-sm font-medium transition-all duration-300 max-w-64 text-left ml-4 ${
                              shareMessageType === 'success' 
                                ? 'bg-gradient-to-r from-[#C8F560] to-[#C8F560] bg-clip-text text-transparent' 
                                : 'bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-transparent'
                            }`} dangerouslySetInnerHTML={{ __html: shareMessage }}>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-48 mobile:w-24 flex-shrink-0">
                          <div className="text-[11px] mobile:text-[9px] uppercase tracking-wide text-gray-500">Period</div>
                          <div className="text-white text-sm mobile:text-xs font-semibold truncate">{selectedPeriodLabel}</div>
                        </div>
                        <div className="w-52 mobile:w-28 flex-shrink-0">
                          <div className="text-[11px] mobile:text-[9px] uppercase tracking-wide text-gray-500">View</div>
                          <div className="text-white text-sm mobile:text-xs font-semibold truncate">{viewModeLabel}</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Mobile dropdowns section */}
              <div className={`hidden mobile:block px-6 pt-2 pb-4 ${screenshotMode ? 'hidden' : ''}`}>
                <div className="flex gap-3 w-full">
                  <PeriodDropdown
                    value={selectedPeriod}
                    onChange={(newPeriod) => {
                      console.log(`⚡ INSTANT PERIOD SWITCH: ${selectedPeriod} → ${newPeriod}`);
                      
                      // Always set the new period first
                      setSelectedPeriod(newPeriod);
                      try {
                        localStorage.setItem('developmentActivityWidget.selectedPeriod', newPeriod);
                      } catch {}
                      
                      // Check centralized cache for instant switching
                      const cachedData = ChartDataCache.get(viewMode, newPeriod);
                      if (cachedData) {
                        console.log('✅ Using cached data for instant period switch!');
                        
                        // Update activity data with cached data
                        const periodData = { ...cachedData, period: newPeriod, viewMode: viewMode };
                        
                        setActivityData(periodData);
                        
                        // Dispatch event for other components
                        const event = new CustomEvent('activityDataUpdated', {
                          detail: periodData.metrics?.daily || periodData.metrics?.weekly
                        });
                        document.dispatchEvent(event);
                        
                        console.log(`⚡ INSTANT SWITCH COMPLETE: Now showing ${newPeriod} with ${periodData.dailyLeaderboard?.length || periodData.weeklyLeaderboard?.length || 0} resources`);
                      } else {
                        console.log('⏳ No cached data available, will load from API...');
                        loadActivityData();
                      }
                    }}
                    options={periodOptions}
                    placeholder="Select period..."
                    className={`flex-1 flex-shrink-0 ${screenshotMode ? 'screenshot-dropdown' : ''}`}
                    screenshotMode={screenshotMode}
                  />
                  <PeriodDropdown
                    value={viewMode}
                    onChange={(newViewMode) => {
                      if (newViewMode !== viewMode) {
                        console.log(`🔄 View mode changing from ${viewMode} to ${newViewMode}`);
                        setViewMode(newViewMode);
                        try {
                          localStorage.setItem('developmentActivityWidget.viewMode', newViewMode);
                        } catch {}
                      }
                    }}
                    options={viewModeOptions}
                    placeholder="Select view mode..."
                    className={`flex-1 flex-shrink-0 ${screenshotMode ? 'screenshot-dropdown' : ''}`}
                    screenshotMode={screenshotMode}
                  />
                </div>
              </div>
              
              {/* Mobile separator below header */}
              <div className="hidden mobile:block h-px bg-gray-800/80" />

              {/* Content Section */}
              <div className={`${screenshotMode ? '' : 'flex-1 min-h-0'} px-8 mobile:px-6 ${screenshotMode ? 'pb-4' : 'pb-8 mobile:pb-6'}`}>
                {error ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="text-red-400 text-lg mb-2">Failed to load data</div>
                      <div className="text-gray-400 text-sm mb-4">{error}</div>
                      <button 
                        onClick={loadActivityData}
                        className="px-4 py-2 bg-white hover:bg-gray-200 text-black rounded-lg transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ) : (
                <>
                {/* Mobile Chart Capture Container - includes header, metrics, chart, and performance indicator for mobile chart screenshots */}
                <div 
                  ref={mobileChartCaptureRef} 
                  className={`
                    ${screenshotMode && currentShareType === 'chart' && window.innerWidth < 768
                      ? 'block bg-card-bg/90 rounded-xl py-4 px-2'
                      : 'hidden'
                    }
                  `}
                >
                  {/* Mobile Chart Screenshot Header - only visible in mobile chart screenshot mode */}
                  {screenshotMode && currentShareType === 'chart' && (
                    <div className="mb-6 pb-4 border-b border-gray-700/30">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2" style={{ marginTop: '-6px' }}>
                          <Activity size={20} className="text-[#C8F560] flex-shrink-0" />
                          <h3 className="text-white font-semibold text-lg">Development Activity</h3>
                        </div>
                        <div className="flex flex-col gap-1 text-sm text-right">
                          <div className="flex items-end justify-end gap-1">
                            <span className="text-gray-500">View:</span>
                            <span className="text-gray-300 font-medium">{viewModeLabel}</span>
                          </div>
                          <div className="text-gray-300 font-medium">
                            {selectedPeriodLabel}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Clone Metrics Bar for Mobile Chart Screenshot */}
                  {screenshotMode && currentShareType === 'chart' && (
                    <div className={`grid grid-cols-3 gap-2 py-3 px-4 rounded-lg items-center flex-shrink-0 border border-gray-700/30 mb-4`}>
                      {isLoading ? (
                        <>
                          <SkeletonLoader className="text-center" />
                          <SkeletonLoader className="text-center" />
                          <SkeletonLoader className="text-center" />
                        </>
                      ) : metrics ? (
                        <>
                          <div className="text-center">
                            <div className="text-white font-bold text-xl">
                              {metrics.totalActiveRepos}
                            </div>
                            <div className="text-gray-400 text-xs">Active Repos</div>
                          </div>
                          <div className="text-center">
                            <div className="text-white font-bold text-xl">
                              {metrics.avgCommitsPerRepo}
                            </div>
                            <div className="text-gray-400 text-xs">Avg Commits/Repo</div>
                          </div>
                          <div className="text-center">
                            <div className="text-white font-bold text-xl">
                              {metrics.totalCommits}
                            </div>
                            <div className="text-gray-400 text-xs">Total Commits</div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-center">
                            <div className="text-white font-bold text-lg">0</div>
                            <div className="text-gray-400 text-xs">Active Repos</div>
                          </div>
                          <div className="text-center">
                            <div className="text-white font-bold text-lg">0</div>
                            <div className="text-gray-400 text-xs">Avg Commits/Repo</div>
                          </div>
                          <div className="text-center">
                            <div className="text-white font-bold text-lg">0</div>
                            <div className="text-gray-400 text-xs">Total Commits</div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Clone Chart for Mobile Chart Screenshot */}
                  {screenshotMode && currentShareType === 'chart' && (
                    <div className="rounded-lg border border-gray-700/30 overflow-visible mb-4" style={{ padding: '20px' }}>
                      {!chartData || chartData.length === 0 ? (
                        <div className="flex items-center justify-center h-32">
                          <div className="text-center">
                            <div className="text-gray-400 text-lg mb-2">No activity data available</div>
                            <div className="text-gray-500 text-sm">Try switching to a different time period</div>
                          </div>
                        </div>
                      ) : (
                        <div className="chart-responsive flex items-center justify-center overflow-hidden">
                          <AggregatedActivityChart
                            weeklyData={chartData}
                            width={950}
                            height={580}
                            padding={25}
                            period={selectedPeriod}
                            screenshotMode={screenshotMode}
                            accentColor={currentAccentColor}
                            contributingResources={contributingResources}
                            isMobileScreenshot={true}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clone Performance Indicator for Mobile Chart Screenshot */}
                  {screenshotMode && currentShareType === 'chart' && currentPeriodData && chartData && chartData.length > 0 && (
                    <div className="bg-gray-800/50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex flex-col whitespace-nowrap">
                          <span className="text-gray-400 text-xs whitespace-nowrap">
                            {selectedPeriod === 'current' ? 'Current 7-Day Total' : 
                             selectedPeriod === '5weeks' ? 'Current 4-Week Total' : 
                             selectedPeriod === '3months' ? 'Current 3-Month Total' : 
                             selectedPeriod === '52weeks' ? 'Current 12-Month Total' : 
                             selectedPeriod === '3years' ? 'Current 3-Year Total' : 'Current Period Total'}
                            {selectedPeriod === 'current' && isNewRecord && (
                              <span 
                                className="ml-2 text-xs opacity-75"
                                style={{ color: currentAccentColor.hex }}
                              >
                                • new record
                              </span>
                            )}
                          </span>
                          {selectedPeriod !== 'current' && (
                            <span className="text-gray-500 text-xs mt-0.5">
                              {(() => {
                                const currentTotal = chartData?.reduce((total, item) => total + (item.count || 0), 0) || 0;
                                const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                                if (!historicalMaxData || historicalMaxData === null) {
                                  return 'current maximum';
                                }
                                const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, selectedPeriod);
                                const periodLabel = selectedPeriod === '5weeks' ? '4-week' : 
                                                  selectedPeriod === '3months' ? '3-month' : 
                                                  selectedPeriod === '52weeks' ? '12-month' : 
                                                  selectedPeriod === '3years' ? '3-year' : '';
                                return `vs. best ${periodLabel} period${dateRange ? ` (${dateRange})` : ''}`;
                              })()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-1">
                          <GitCommit size={12} style={{ color: currentAccentColor.hex }} />
                          <span 
                            className="font-bold text-lg" 
                            style={{ color: currentAccentColor.hex }}
                          >
                            {chartData.reduce((total, item) => total + (item.count || 0), 0)}
                          </span>
                        </div>
                      </div>
                      <div className="relative">
                        <div className="w-full bg-gray-700 rounded-full h-2">
                          <div 
                            className="h-2 rounded-full transition-all duration-500 ease-out"
                            style={{ 
                              width: (() => {
                                if (selectedPeriod === 'current') {
                                  const currentValue = chartData.reduce((total, item) => total + (item.count || 0), 0);
                                  const historicalMaxData = weeklyHistoricalMaxWithDates;
                                  const historicalMax = historicalMaxData?.value || 1;
                                  return `${Math.min(100, Math.max(0, (currentValue / historicalMax) * 100))}%`;
                                }
                                const currentTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
                                const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                                if (!historicalMaxData || historicalMaxData === null) {
                                  return '100%';
                                }
                                const historicalMaxValue = historicalMaxData.value || historicalMaxData;
                                const percentage = (currentTotal / historicalMaxValue) * 100;
                                return `${Math.min(100, Math.max(0, Math.round(percentage)))}%`;
                              })(),
                              background: `linear-gradient(to right, ${currentAccentColor.hex}, ${currentAccentColor.hex}dd)`,
                              boxShadow: `0 0 8px rgba(${currentAccentColor.rgb}, 0.3)`
                            }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                          <span>0</span>
                          <span>
                            {(() => {
                              if (selectedPeriod === 'current') {
                                const historicalMaxData = weeklyHistoricalMaxWithDates;
                                if (!historicalMaxData || !historicalMaxData.peakStartDate) {
                                  return `${historicalMaxData?.value || 1} (historical peak)`;
                                }
                                const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, 'current');
                                return `${historicalMaxData.value} (peak: ${dateRange})`;
                              }
                              const currentTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
                              const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                              if (!historicalMaxData || historicalMaxData === null) {
                                return 'Insufficient historical data for meaningful comparison';
                              }
                              const historicalMaxValue = historicalMaxData.value || historicalMaxData;
                              const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, selectedPeriod);
                              return `${Math.round(historicalMaxValue)} (peak${dateRange ? `: ${dateRange}` : ''})`;
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className={`grid grid-cols-5 mobile:grid-cols-1 gap-8 mobile:gap-6 ${screenshotMode ? '' : 'h-full mobile:h-auto'}`}>
                  {/* Left Column - Metrics Bar and Chart */}
                  <div className={`col-span-3 mobile:col-span-1 flex flex-col space-y-3 ${screenshotMode ? '' : 'h-full mobile:h-auto'} min-h-0`}>
                      {/* Metrics Bar */}
                    <div className={`grid grid-cols-3 gap-2 ${screenshotMode ? 'py-4 px-6' : 'py-3 px-4 mobile:py-2.5'} rounded-lg items-center flex-shrink-0 ${
                      screenshotMode ? 'border border-gray-700/30' : 'bg-gray-800/50'
                    }`}>
                        {isLoading ? (
                          <>
                            <SkeletonLoader className="text-center" />
                            <SkeletonLoader className="text-center" />
                            <SkeletonLoader className="text-center" />
                          </>
                        ) : metrics ? (
                          <>
                      <div className="text-center">
                              <div 
                                className={`text-white font-bold ${screenshotMode ? 'text-2xl' : 'text-lg mobile:text-base'}`}
                                title={`Repositories with at least one commit in this ${selectedPeriod === 'current' ? '7-day' : selectedPeriod === '5weeks' ? '4-week' : selectedPeriod === '3months' ? '3-month' : selectedPeriod === '52weeks' ? '12-month' : selectedPeriod === '3years' ? '3-year' : ''} period`}
                              >
                                {metrics.totalActiveRepos}
                              </div>
                        <div className={`text-gray-400 ${screenshotMode ? 'text-sm' : 'text-xs mobile:text-xs'}`}>Active Repos</div>
                      </div>
                      <div className="text-center">
                              <div 
                                className={`text-white font-bold ${screenshotMode ? 'text-2xl' : 'text-lg mobile:text-base'}`}
                                title={"Average commits per active repository during this period"}
                              >
                                {metrics.avgCommitsPerRepo}
                              </div>
                        <div className={`text-gray-400 ${screenshotMode ? 'text-sm' : 'text-xs mobile:text-xs'}`}>
                                {'Avg Commits/Repo'}
                        </div>
                      </div>
                      <div className="text-center">
                              <div 
                                className={`text-white font-bold ${screenshotMode ? 'text-2xl' : 'text-lg mobile:text-base'}`}
                                title={"Total commits across all repositories during this period"}
                              >
                                {metrics.totalCommits}
                              </div>
                        <div className={`text-gray-400 ${screenshotMode ? 'text-sm' : 'text-xs mobile:text-xs'}`}>
                                {'Total Commits'}
                        </div>
                      </div>
                          </>
                        ) : (
                          <>
                            <div className="text-center">
                              <div className="text-white font-bold text-lg">0</div>
                              <div className="text-gray-400 text-xs">Active Repos</div>
                            </div>
                            <div className="text-center">
                              <div className="text-white font-bold text-lg">0</div>
                              <div className="text-gray-400 text-xs">Avg Commits/Repo</div>
                            </div>
                            <div className="text-center">
                              <div className="text-white font-bold text-lg">0</div>
                              <div className="text-gray-400 text-xs">Total Commits</div>
                            </div>
                          </>
                        )}
                    </div>

                      {/* Chart Container */}
                    <div ref={chartRef} className={`flex-1 ${screenshotMode ? 'overflow-visible' : 'overflow-hidden'} min-h-0`}>
                      <div ref={chartInnerRef} className={`rounded-lg chart-container-padding ${screenshotMode ? '' : 'h-full'} ${
                        screenshotMode ? 'border border-gray-700/30 overflow-visible' : 'bg-gray-800/50 overflow-hidden'
                      } mobile:border mobile:border-gray-800/60 mobile:bg-gray-800/40`}>
                          {/* Header for Chart Screenshot Mode - Show only for chart-only screenshots */}
                          {screenshotMode && currentShareType === 'chart' && (
                            <div className="mb-4 pb-3 border-b border-gray-700/30">
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2" style={{ marginTop: '-6px' }}>
                                  <Activity size={20} className="text-[#C8F560] flex-shrink-0" />
                                  <h3 className="text-white font-semibold text-lg">Development Activity</h3>
                                </div>
                                <div className="flex flex-col gap-1 text-sm text-right">
                                  <div className="flex items-end justify-end gap-1">
                                    <span className="text-gray-500">View:</span>
                                    <span className="text-gray-300 font-medium">{viewModeLabel}</span>
                                  </div>
                                  <div className="text-gray-300 font-medium">
                                    {selectedPeriodLabel}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {isLoading ? (
                          <div className="flex items-center justify-center h-full">
                            <div className="flex items-center space-x-3 text-white">
                              <Loader2 className="w-6 h-6 animate-spin" />
                              <span className="text-sm font-medium text-gray-400/30">
                                  Loading from server cache...
                              </span>
                            </div>
                          </div>
                          ) : !chartData || chartData.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                              <div className="text-center">
                                {hasDataLoadError ? (
                                  <>
                                    <div className="text-red-400 text-lg mb-2">Failed to load chart data</div>
                                    <div className="text-gray-500 text-sm mb-4">Please try switching view modes or refreshing</div>
                                    <button 
                                      onClick={() => loadActivityData(true)}
                                      className="px-4 py-2 bg-white hover:bg-gray-200 text-black rounded-lg transition-colors text-sm"
                                    >
                                      Retry Load
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <div className="text-gray-400 text-lg mb-2">No activity data available</div>
                                    <div className="text-gray-500 text-sm">Try switching to a different time period</div>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : (
                            <ChartErrorBoundary onRetry={() => loadActivityData(true)}>
                              <div 
                                className="chart-responsive flex items-center justify-center overflow-hidden" 
                                style={{
                                  pointerEvents: 'auto'
                                }} 
                                data-screenshot-mode={screenshotMode}
                              >
                                <AggregatedActivityChart
                                  weeklyData={chartData}
                                  width={screenshotMode ? 850 : (window.innerWidth < 768 ? Math.max(600, chartContainerWidth - 10) : 800)}
                                  height={screenshotMode ? 480 : (window.innerWidth < 768 ? Math.max(450, Math.round((chartContainerWidth - 10) * 0.8)) : 400)}
                                  padding={10}
                                  period={selectedPeriod}
                                  screenshotMode={screenshotMode}
                                  accentColor={currentAccentColor}
                                  contributingResources={contributingResources}
                                  ref={chartSvgRef}
                                />
                              </div>
                            </ChartErrorBoundary>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Mobile Performance Indicator - positioned above leaderboard on mobile only */}
                  {currentPeriodData && chartData && chartData.length > 0 && (
                    <div className="hidden mobile:block mobile:col-span-1 bg-gray-800/50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex flex-col whitespace-nowrap">
                          <span 
                            className="text-gray-400 text-xs whitespace-nowrap"
                            title={(() => {
                              if (selectedPeriod === 'current') {
                                const historicalMaxData = weeklyHistoricalMaxWithDates;
                                const dateRange = historicalMaxData?.peakStartDate ? 
                                  formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, 'current') : null;
                                return `Current 7-day period performance vs. best historical 7-day period${dateRange ? ` (${dateRange})` : ''}. Includes today's incomplete data.`;
                              } else if (selectedPeriod === '5weeks') {
                                return 'Current 4-week period performance vs. best historical sequential 4-week period. Excludes current incomplete week.';
                              } else if (selectedPeriod === '3months') {
                                return 'Current 3-month period performance vs. best historical sequential 3-month period. Excludes current incomplete week.';
                              } else if (selectedPeriod === '52weeks') {
                                return 'Current 12-month period performance vs. best historical sequential 12-month period. Excludes current incomplete week.';
                              } else if (selectedPeriod === '3years') {
                                return 'Current 3-year period performance vs. best historical sequential 3-year period. Excludes current incomplete week.';
                              }
                              return 'Current period performance vs. historical maximum';
                            })()}
                          >
                            {selectedPeriod === 'current' ? 'Current 7-Day Total' : 
                             selectedPeriod === '5weeks' ? 'Current 4-Week Total' : 
                             selectedPeriod === '3months' ? 'Current 3-Month Total' : 
                             selectedPeriod === '52weeks' ? 'Current 12-Month Total' : 
                             selectedPeriod === '3years' ? 'Current 3-Year Total' : 'Current Period Total'}
                            {selectedPeriod === 'current' && isNewRecord && (
                              <span 
                                className="ml-2 text-xs opacity-75"
                                style={{ color: currentAccentColor.hex }}
                                title="This current 7-day period has set a new record!"
                              >
                                • new record
                              </span>
                            )}
                          </span>
                          {selectedPeriod !== 'current' && (
                            <span 
                              className="text-gray-500 text-xs mt-0.5"
                              title={(() => {
                                const currentTotal = chartData?.reduce((total, item) => total + (item.count || 0), 0) || 0;
                                const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                                if (!historicalMaxData || historicalMaxData === null) {
                                  return 'Current period performance (no historical data for comparison)';
                                }
                                const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, selectedPeriod);
                                return `Comparison against the best performing sequential ${selectedPeriod === '5weeks' ? '4-week' : selectedPeriod === '3months' ? '3-month' : selectedPeriod === '52weeks' ? '12-month' : selectedPeriod === '3years' ? '3-year' : ''} period${dateRange ? ` (${dateRange})` : ''} found in historical data`;
                              })()}
                            >
                              {(() => {
                                const currentTotal = chartData?.reduce((total, item) => total + (item.count || 0), 0) || 0;
                                const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                                if (!historicalMaxData || historicalMaxData === null) {
                                  return 'current maximum';
                                }
                                const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, selectedPeriod);
                                const periodLabel = selectedPeriod === '5weeks' ? '4-week' : 
                                                  selectedPeriod === '3months' ? '3-month' : 
                                                  selectedPeriod === '52weeks' ? '12-month' : 
                                                  selectedPeriod === '3years' ? '3-year' : '';
                                return `vs. best ${periodLabel} period${dateRange ? ` (${dateRange})` : ''}`;
                              })()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-1">
                          <GitCommit size={12} style={{ color: currentAccentColor.hex }} />
                          <span 
                            className="font-bold text-lg" 
                            style={{ color: currentAccentColor.hex }}
                            title={(() => {
                              if (selectedPeriod === 'current') {
                                return 'Total commits across the current 7-day period (includes today\'s incomplete data)';
                              } else if (selectedPeriod === '5weeks') {
                                return 'Total commits across the current 4-week period (Excludes current incomplete week)';
                              } else if (selectedPeriod === '3months') {
                                return 'Total commits across the current 3-month period (Excludes current incomplete week)';
                              } else if (selectedPeriod === '52weeks') {
                                return 'Total commits across the current 12-month period (Excludes current incomplete week)';
                              } else if (selectedPeriod === '3years') {
                                return 'Total commits across the current 3-year period (Excludes current incomplete week)';
                              }
                              return 'Total commits for the current period';
                            })()}
                          >
                            {(() => {
                              if (selectedPeriod === 'current') {
                                // For 7-day period, show total commits across all 7 days
                                return chartData.reduce((total, item) => total + (item.count || 0), 0);
                              } else {
                                // For longer periods, show total commits across all weeks
                                return chartData.reduce((total, item) => total + (item.count || 0), 0);
                              }
                            })()}
                          </span>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="relative">
                        <div className="w-full bg-gray-700 rounded-full h-2">
                          <div 
                            className="h-2 rounded-full transition-all duration-500 ease-out"
                            style={{ 
                              width: (() => {
                                if (selectedPeriod === 'current') {
                                  // For 7-day period (1 week), use enhanced historical maximum with dates
                                  const currentValue = chartData.reduce((total, item) => total + (item.count || 0), 0);
                                  const historicalMaxData = weeklyHistoricalMaxWithDates;
                                  const historicalMax = historicalMaxData?.value || 1;
                                  return `${Math.min(100, Math.max(0, (currentValue / historicalMax) * 100))}%`;
                                }
                                
                                const currentTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
                                const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                                if (!historicalMaxData || historicalMaxData === null) {
                                  return '100%'; // Current period is the maximum for young repos
                                }
                                const historicalMaxValue = historicalMaxData.value || historicalMaxData;
                                const percentage = (currentTotal / historicalMaxValue) * 100;
                                return `${Math.min(100, Math.max(0, Math.round(percentage)))}%`;
                              })(),
                              background: `linear-gradient(to right, ${currentAccentColor.hex}, ${currentAccentColor.hex}dd)`,
                              boxShadow: `0 0 8px rgba(${currentAccentColor.rgb}, 0.3)`
                            }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                          <span>0</span>
                          <span>
                            {(() => {
                              if (selectedPeriod === 'current') {
                                // For 7-day period, use enhanced historical maximum with dates
                                const historicalMaxData = weeklyHistoricalMaxWithDates;
                                if (!historicalMaxData || !historicalMaxData.peakStartDate) {
                                  return `${historicalMaxData?.value || 1} (historical peak)`;
                                }
                                const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, 'current');
                                return `${historicalMaxData.value} (peak: ${dateRange})`;
                              }
                              const currentTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
                              const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                              if (!historicalMaxData || historicalMaxData === null) {
                                return 'Insufficient historical data for meaningful comparison';
                              }
                              const historicalMaxValue = historicalMaxData.value || historicalMaxData;
                              const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, selectedPeriod);
                              return `${Math.round(historicalMaxValue)} (peak${dateRange ? `: ${dateRange}` : ''})`;
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Right Column - Leaderboard */}
                  <div 
                    ref={leaderboardRef} 
                    className={`col-span-2 mobile:col-span-1 flex flex-col h-full mobile:h-auto min-h-0 ${screenshotMode ? 'rounded-lg border border-gray-700/30' : ''}`}
                    style={screenshotMode ? { padding: '12px 16px', marginTop: 0 } : { padding: '0 8px 0 8px', marginTop: '0px' }}
                    data-screenshot-mode={screenshotMode}
                  >
                      {/* Mobile Section Divider */}
                      <div className="hidden mobile:block h-px bg-gray-800/80 my-4" />
                      {/* Header for Screenshot Mode - Show only for leaderboard-only screenshots */}
                      {screenshotMode && currentShareType === 'leaderboard' && (
                        <div className="mb-4 pb-3 border-b border-gray-700/30">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2" style={{ marginTop: '-6px' }}>
                              <Activity size={20} className="text-[#C8F560] flex-shrink-0" />
                              <h3 className="text-white font-semibold text-lg">Development Activity</h3>
                            </div>
                            <div className="flex flex-col gap-1 text-sm text-right">
                              <div className="flex items-end justify-end gap-1">
                                <span className="text-gray-500">View:</span>
                                <span className="text-gray-300 font-medium">{viewModeLabel}</span>
                              </div>
                              <div className="text-gray-300 font-medium">
                                {selectedPeriodLabel}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Top 3 Items */}
                      <div className="flex-shrink-0 mb-3 relative" style={{ zIndex: 10 }}>
                        {isLoading ? (
                          <>
                            <SkeletonLeaderboardItem rank={1} />
                            <SkeletonLeaderboardItem rank={2} />
                            <SkeletonLeaderboardItem rank={3} />
                          </>
                        ) : !leaderboard || leaderboard.length === 0 ? (
                        <div className="flex items-center justify-center h-32">
                            <div className="text-center">
                              <div className="text-gray-400 text-sm">No active repositories</div>
                          </div>
                        </div>
                      ) : (
                          leaderboard.slice(0, 3).map((item, index) => {
                          let containerStyle = {};
                          let isWinner = false;

                          if (index === 0) {
                            containerStyle = {
                              boxShadow: `0 0 0 1px rgba(${currentAccentColor.rgb}, 0.85), 0 0 8px 1px rgba(${currentAccentColor.rgb}, 0.5), inset 0 0 0 1px rgba(${currentAccentColor.rgb}, 0.75), inset 0 0 8px 1px rgba(${currentAccentColor.rgb}, 0.45)`,
                              border: `1px solid rgba(${currentAccentColor.rgb}, 0.6)`,
                              outline: `1px solid rgba(${currentAccentColor.rgb}, 1)`,
                              outlineOffset: '0px',
                              transform: 'scale(1.02)',
                              transition: 'transform 200ms ease, box-shadow 200ms ease',
                              backgroundImage: `linear-gradient(90deg, rgba(${currentAccentColor.rgb}, 0.10), rgba(${currentAccentColor.rgb}, 0.06) 40%, rgba(${currentAccentColor.rgb}, 0.00))`,
                              backdropFilter: 'blur(2px)',
                              zIndex: 13
                            };
                            isWinner = true;
                          } else if (index === 1) {
                            containerStyle = {
                              boxShadow: `0 0 0 1px rgba(${currentAccentColor.rgb}, 0.65), 0 0 6px 1px rgba(${currentAccentColor.rgb}, 0.35), inset 0 0 0 1px rgba(${currentAccentColor.rgb}, 0.55), inset 0 0 6px 1px rgba(${currentAccentColor.rgb}, 0.3)`,
                              border: `1px solid rgba(${currentAccentColor.rgb}, 0.45)`,
                              outline: `1px solid rgba(${currentAccentColor.rgb}, 0.7)`,
                              outlineOffset: '0px',
                              zIndex: 12
                            };
                          } else if (index === 2) {
                            containerStyle = {
                              boxShadow: `0 0 0 1px rgba(${currentAccentColor.rgb}, 0.35), 0 0 4px 1px rgba(${currentAccentColor.rgb}, 0.25), inset 0 0 0 1px rgba(${currentAccentColor.rgb}, 0.45), inset 0 0 4px 1px rgba(${currentAccentColor.rgb}, 0.2)`,
                              border: `1px solid rgba(${currentAccentColor.rgb}, 0.25)`,
                              outline: `1px solid rgba(${currentAccentColor.rgb}, 0.3)`,
                              outlineOffset: '0px',
                              zIndex: 11
                            };
                          }

                          return (
                            <div 
                              key={`top-${item.resource.id}`} 
                              className={`flex items-center space-x-4 py-3 px-3 rounded-lg transition-colors cursor-pointer ${
                                screenshotMode 
                                  ? 'text-[14px] leading-[20px] bg-gray-800/30' 
                                  : 'bg-gray-800/30 hover:bg-gray-800/50'
                              }`}
                              style={{ 
                                margin: '6px 0', 
                                position: 'relative', 
                                ...containerStyle 
                              }}
                              onClick={() => {
                                if (onNavigateToResource) {
                                  onNavigateToResource(item.resource.id, item.resource.name);
                                }
                              }}
                            >
                              <div className="text-white text-sm font-bold flex-shrink-0 w-6 text-center">
                                {index + 1}
                              </div>
                              <div className="flex-1 min-w-0 overflow-hidden">
                                <div className={`${isWinner ? 'font-semibold' : 'font-normal'} ${screenshotMode ? 'text-[17px] leading-[24px]' : 'text-base mobile:text-sm'} text-white truncate`} style={isWinner ? { textShadow: `0 0 6px rgba(${currentAccentColor.rgb}, 0.35)` } : undefined}>
                                  {item.resource.name}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <div className={`${isWinner ? 'font-bold' : 'font-normal'} ${screenshotMode ? 'text-[15px] leading-[21px]' : 'text-base mobile:text-sm'} text-white`} style={isWinner ? { textShadow: `0 0 6px rgba(${currentAccentColor.rgb}, 0.35)` } : undefined}>
                                    {item.totalCommits}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                      {/* Scrollable List */}
                    <div 
                      className="overflow-y-auto space-y-2 pr-2 relative scrollbar-hide mobile:max-h-96" 
                      style={{ 
                          height: screenshotMode ? 'auto' : (window.innerWidth < 768 ? 'auto' : '320px'),
                        transform: 'translateZ(0)', 
                        willChange: 'scroll-position',
                        zIndex: 1
                      }}
                    >
                        {isLoading ? (
                          Array.from({ length: 10 }, (_, i) => (
                            <SkeletonLeaderboardItem key={i} rank={i + 4} />
                          ))
                        ) : !leaderboard || leaderboard.length === 0 ? (
                          <div className="flex items-center justify-center h-32">
                            <div className="text-center">
                              <div className="text-gray-400 text-sm">No repositories found</div>
                            </div>
                          </div>
                        ) : (
                          (screenshotMode ? leaderboard.slice(3, 10) : leaderboard.slice(3)).map((item, index) => {
                          const adjustedIndex = index + 3;

                          return (
                            <div 
                              key={item.resource.id} 
                              className={`flex items-center space-x-4 py-2.5 px-3 rounded-lg transition-colors cursor-pointer ${
                                screenshotMode 
                                  ? 'text-[14px] leading-[20px] bg-gray-800/30' 
                                  : 'bg-gray-800/30 hover:bg-gray-800/50'
                              }`}
                              onClick={() => {
                                if (onNavigateToResource) {
                                  onNavigateToResource(item.resource.id, item.resource.name);
                                }
                              }}
                            >
                              <div className="text-white text-sm font-bold flex-shrink-0 w-6 text-center">
                                {adjustedIndex + 1}
                              </div>
                              <div className="flex-1 min-w-0 overflow-hidden">
                                <div className={`font-normal ${screenshotMode ? 'text-[17px] leading-[24px]' : 'text-base mobile:text-sm'} text-white truncate`}>
                                  {item.resource.name}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <div className={`font-normal ${screenshotMode ? 'text-[15px] leading-[21px]' : 'text-base mobile:text-sm'} text-white`}>
                                    {item.totalCommits}
                                </div>
                              </div>
                            </div>
                          );
                        })
                        )}
                    </div>
                  </div>
                </div>
                </>
                )}
                
                {/* Global Performance Indicator - Desktop only */}
                {currentPeriodData && chartData && chartData.length > 0 && (
                  <div className="bg-gray-800/50 rounded-lg p-4 mt-4 mobile:hidden">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex flex-col whitespace-nowrap">
                        <span 
                          className="text-gray-400 text-xs whitespace-nowrap"
                          title={(() => {
                            if (selectedPeriod === 'current') {
                              const historicalMaxData = weeklyHistoricalMaxWithDates;
                              const dateRange = historicalMaxData?.peakStartDate ? 
                                formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, 'current') : null;
                              return `Current 7-day period performance vs. best historical 7-day period${dateRange ? ` (${dateRange})` : ''}. Includes today's incomplete data.`;
                            } else if (selectedPeriod === '5weeks') {
                              return 'Current 4-week period performance vs. best historical sequential 4-week period. Excludes current incomplete week.';
                            } else if (selectedPeriod === '3months') {
                              return 'Current 3-month period performance vs. best historical sequential 3-month period. Excludes current incomplete week.';
                            } else if (selectedPeriod === '52weeks') {
                              return 'Current 12-month period performance vs. best historical sequential 12-month period. Excludes current incomplete week.';
                            } else if (selectedPeriod === '3years') {
                              return 'Current 3-year period performance vs. best historical sequential 3-year period. Excludes current incomplete week.';
                            }
                            return 'Current period performance vs. historical maximum';
                          })()}
                        >
                          {selectedPeriod === 'current' ? 'Current 7-Day Total' : 
                           selectedPeriod === '5weeks' ? 'Current 4-Week Total' : 
                           selectedPeriod === '3months' ? 'Current 3-Month Total' : 
                           selectedPeriod === '52weeks' ? 'Current 12-Month Total' : 
                           selectedPeriod === '3years' ? 'Current 3-Year Total' : 'Current Period Total'}
                          {selectedPeriod === 'current' && isNewRecord && (
                            <span 
                              className="ml-2 text-xs opacity-75"
                              style={{ color: currentAccentColor.hex }}
                              title="This current 7-day period has set a new record!"
                            >
                              • new record
                            </span>
                          )}
                        </span>
                        {selectedPeriod !== 'current' && (
                          <span 
                            className="text-gray-500 text-xs mt-0.5"
                            title={(() => {
                              const currentTotal = chartData?.reduce((total, item) => total + (item.count || 0), 0) || 0;
                              const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                              if (!historicalMaxData || historicalMaxData === null) {
                                return 'Current period performance (no historical data for comparison)';
                              }
                              const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, selectedPeriod);
                              return `Comparison against the best performing sequential ${selectedPeriod === '5weeks' ? '4-week' : selectedPeriod === '3months' ? '3-month' : selectedPeriod === '52weeks' ? '12-month' : selectedPeriod === '3years' ? '3-year' : ''} period${dateRange ? ` (${dateRange})` : ''} found in historical data`;
                            })()}
                          >
                            {(() => {
                              const currentTotal = chartData?.reduce((total, item) => total + (item.count || 0), 0) || 0;
                              const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                              if (!historicalMaxData || historicalMaxData === null) {
                                return 'current maximum';
                              }
                              const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, selectedPeriod);
                              const periodLabel = selectedPeriod === '5weeks' ? '4-week' : 
                                                selectedPeriod === '3months' ? '3-month' : 
                                                selectedPeriod === '52weeks' ? '12-month' : 
                                                selectedPeriod === '3years' ? '3-year' : '';
                              return `vs. best ${periodLabel} period${dateRange ? ` (${dateRange})` : ''}`;
                            })()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1">
                        <GitCommit size={12} style={{ color: currentAccentColor.hex }} />
                        <span 
                          className="font-bold text-lg" 
                          style={{ color: currentAccentColor.hex }}
                          title={(() => {
                            if (selectedPeriod === 'current') {
                              return 'Total commits across the current 7-day period (includes today\'s incomplete data)';
                            } else if (selectedPeriod === '5weeks') {
                              return 'Total commits across the current 4-week period (Excludes current incomplete week)';
                            } else if (selectedPeriod === '3months') {
                              return 'Total commits across the current 3-month period (Excludes current incomplete week)';
                            } else if (selectedPeriod === '52weeks') {
                              return 'Total commits across the current 12-month period (Excludes current incomplete week)';
                            } else if (selectedPeriod === '3years') {
                              return 'Total commits across the current 3-year period (Excludes current incomplete week)';
                            }
                            return 'Total commits for the current period';
                          })()}
                        >
                          {(() => {
                            if (selectedPeriod === 'current') {
                              // For 7-day period, show total commits across all 7 days
                              return chartData.reduce((total, item) => total + (item.count || 0), 0);
                            } else {
                              // For longer periods, show total commits across all weeks
                              return chartData.reduce((total, item) => total + (item.count || 0), 0);
                            }
                          })()}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="relative">
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div 
                          className="h-2 rounded-full transition-all duration-500 ease-out"
                          style={{ 
                            width: (() => {
                              if (selectedPeriod === 'current') {
                                // For 7-day period (1 week), use enhanced historical maximum with dates
                                const currentValue = chartData.reduce((total, item) => total + (item.count || 0), 0);
                                const historicalMaxData = weeklyHistoricalMaxWithDates;
                                const historicalMax = historicalMaxData?.value || 1;
                                return `${Math.min(100, Math.max(0, (currentValue / historicalMax) * 100))}%`;
                              }
                              
                              const currentTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
                              const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                              if (!historicalMaxData || historicalMaxData === null) {
                                return '100%'; // Current period is the maximum for young repos
                              }
                              const historicalMaxValue = historicalMaxData.value || historicalMaxData;
                              const percentage = (currentTotal / historicalMaxValue) * 100;
                              return `${Math.min(100, Math.max(0, Math.round(percentage)))}%`;
                            })(),
                            background: `linear-gradient(to right, ${currentAccentColor.hex}, ${currentAccentColor.hex}dd)`,
                            boxShadow: `0 0 8px rgba(${currentAccentColor.rgb}, 0.3)`
                          }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-400 mt-1">
                        <span>0</span>
                        <span>
                          {(() => {
                            if (selectedPeriod === 'current') {
                              // For 7-day period, use enhanced historical maximum with dates
                              const historicalMaxData = weeklyHistoricalMaxWithDates;
                              if (!historicalMaxData || !historicalMaxData.peakStartDate) {
                                return `${historicalMaxData?.value || 1} (historical peak)`;
                              }
                              const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, 'current');
                              return `${historicalMaxData.value} (peak: ${dateRange})`;
                            }
                            const currentTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
                            const historicalMaxData = metrics?.historicalMax || calculateLongerPeriodHistoricalMax(currentTotal);
                            if (!historicalMaxData || historicalMaxData === null) {
                              return 'Insufficient historical data for meaningful comparison';
                            }
                            const historicalMaxValue = historicalMaxData.value || historicalMaxData;
                            const dateRange = formatPeriodDateRange(historicalMaxData.peakStartDate, historicalMaxData.peakEndDate, selectedPeriod);
                            return `${Math.round(historicalMaxValue)} (peak${dateRange ? `: ${dateRange}` : ''})`;
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* adadev.io branding for screenshots */}
              {/* Branding overlay removed to avoid duplication; branding is added to final canvas */}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
};

export default DevelopmentActivityWidget;