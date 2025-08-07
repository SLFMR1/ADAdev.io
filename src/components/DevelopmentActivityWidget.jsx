import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Activity, Share2, Loader2, GitCommit } from 'lucide-react';
import { cardanoResources } from '../data/resources';
import logger from '../utils/logger-frontend';
import * as htmlToImage from 'html-to-image';
import AggregatedActivityChart from './AggregatedActivityChart';
import Portal from './Portal';
import PeriodDropdown from './PeriodDropdown';
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
  const [error, setError] = useState(null);
  
  const widgetRef = useRef(null);
  const chartRef = useRef(null);
  const leaderboardRef = useRef(null);
  const chartSvgRef = useRef(null);

  // Use centralized caching - TTL is now determined per period in chartDataUtils

  // View mode options for dropdown
  const viewModeOptions = [
    { key: 'repository', label: 'Repository View', description: 'Show individual repositories' },
    { key: 'organization', label: 'Organization View', description: 'Show aggregated data by organization' }
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

  // Extract contributing resources for each data point
  const contributingResources = useMemo(() => {
    if (!currentPeriodData?.rawChartData || !currentPeriodData?.chartData) {
      return null;
    }
    
    const { rawChartData, chartData } = currentPeriodData;
    
    // For both organization and repository views, we have individual resource contributions
    if (rawChartData.length > 0) {
      return chartData.map((dataPoint, dataIdx) => {
        const contributors = rawChartData
          .map(resourceData => {
            const resourceCount = resourceData.dailyCounts?.[dataIdx] || resourceData.weeklyCounts?.[dataIdx] || 0;
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
    setTimeout(() => setShareMessage(''), 4000);
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

    try {
        // Wait for screenshot mode to apply
        await new Promise(resolve => setTimeout(resolve, 200));
      
      let targetElement = element;
      
      if (shareType === 'full') {
        targetElement = widgetRef.current;
      } else if (shareType === 'leaderboard') {
        targetElement = leaderboardRef.current;
      } else if (shareType === 'chart') {
        targetElement = chartRef.current;
      }
      
      // Capture widget first to get actual image dimensions
      const dataUrl = await htmlToImage.toPng(targetElement, {
        quality: 1.0,
        pixelRatio: 1,
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
      const padding = 35;
      const finalWidth = img.width + (padding * 2);
      const finalHeight = img.height + (padding * 2) + 80; // Extra for branding
      
      // Create canvas with proper background matching your page
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      
      // Recreate a lighter page background
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
      
      const centerX = padding; // Since canvas width = img.width + padding*2
      const centerY = padding;
      ctx.drawImage(img, centerX, centerY);
      
      ctx.font = '200 27px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(156, 163, 175, 0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('adadev.io', finalWidth / 2, finalHeight - 20);
      
      // Convert to blob
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/png', 1.0);
      });

      const handles = getTop5HandlesOrNames(currentPeriodData?.leaderboard || []);
      const tweetText = generateTweetText(handles, shareType);

      const result = await shareToX(blob, tweetText, handles);
      
      if (result.success) {
        showShareSuccess(result.message);
        setTimeout(() => {
          window.open('https://x.com/intent/tweet', '_blank');
        }, result.message.includes('Opening X') ? 3000 : 2000);
      } else {
        showShareError(result.message);
      }
    } catch (error) {
      console.error('Share error:', error);
      showShareError('Failed to generate image. Please try again.');
    } finally {
      setScreenshotMode(false);
      setIsSharing(false);
    }
  };

  const handleShareChart = () => {
    setShareMenuOpen(false);
    shareToXHandler(chartRef.current, 'chart');
  };

  const handleShareChartLeaderboard = () => {
    setShareMenuOpen(false);
    shareToXHandler(widgetRef.current, 'full');
  };

  const handleShareLeaderboard = () => {
    setShareMenuOpen(false);
    shareToXHandler(leaderboardRef.current, 'leaderboard');
  };

  const { leaderboard, chartData, metrics, isDaily } = currentPeriodData || {};

  // Labels for screenshot mode (dropdowns become static text)
  const selectedPeriodLabel = useMemo(() => {
    const opt = periodOptions.find(o => o.value === selectedPeriod || o.key === selectedPeriod || o.id === selectedPeriod);
    return opt?.label || currentPeriodData?.periodLabel || selectedPeriod;
  }, [selectedPeriod, currentPeriodData]);
  const viewModeLabel = useMemo(() => {
    const opt = [{ key: 'repository', label: 'Repository View' }, { key: 'organization', label: 'Organization View' }].find(o => o.key === viewMode);
    return opt?.label || viewMode;
  }, [viewMode]);

  // Memoized calculation for 7-day period historical maximum (performance optimized)
  const weeklyHistoricalMax = useMemo(() => {
    if (selectedPeriod !== 'current' || !chartData) {
      return null;
    }
    
    let maxWeekTotal = 0;
    // For 7-day view, chartData contains daily data points, so sum them to get current week total
    // For consistency with historical data which represents weekly totals
    const currentWeekTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
    
    
    // Use only the longest available period for consistent comparison
    // Priority: 3years > 52weeks > 3months > 5weeks
    const periodsToCheck = ['3years', '52weeks', '3months', '5weeks'];
    
    for (const period of periodsToCheck) {
      const cachedPeriodData = ChartDataCache.get(viewMode, period);
      if (cachedPeriodData && cachedPeriodData.weeklyChartData) {
        // Use the already-aggregated weekly data, not the raw resource data
        const transformedData = transformChartData(cachedPeriodData.weeklyChartData, period, 'PerformanceIndicator');
        
        if (transformedData && transformedData.length > 0) {
          // Find maximum from the aggregated weekly totals (same as what the chart shows)
          const periodMaxCommits = Math.max(...transformedData.map(w => w.count || 0));
          maxWeekTotal = Math.max(maxWeekTotal, periodMaxCommits);
          
          console.log(`📊 Using ${period} data for 7-day comparison (${transformedData.length} weeks), found max: ${periodMaxCommits}`);
        }
        
        // Use only the first (longest) available period
        break;
      }
    }
    
    // If no historical data found, use current week as baseline (will show 100%)
    if (maxWeekTotal === 0) {
      console.log('📊 No historical weekly data found for 7-day comparison, using current week as baseline');
      return currentWeekTotal || 1;
    }
    
    // Include current week in comparison - if it's a new record, it becomes the new max
    const trueHistoricalMax = Math.max(maxWeekTotal, currentWeekTotal);
    
    console.log(`📊 7-day historical max calculation: historicalMax=${maxWeekTotal}, currentWeek=${currentWeekTotal}, finalMax=${trueHistoricalMax}`);
    
    return trueHistoricalMax;
  }, [selectedPeriod, chartData, viewMode]);

  // Check if current week is a new record
  const isNewRecord = useMemo(() => {
    if (selectedPeriod !== 'current' || !chartData || !weeklyHistoricalMax) {
      return false;
    }
    const currentWeekTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
    
    // Get historical max (without current week)
    let historicalMax = 0;
    const periodsToCheck = ['3years', '52weeks', '3months', '5weeks'];
    
    for (const period of periodsToCheck) {
      const cachedPeriodData = ChartDataCache.get(viewMode, period);
      if (cachedPeriodData && cachedPeriodData.weeklyChartData) {
        const transformedData = transformChartData(cachedPeriodData.weeklyChartData, period, 'RecordCheck');
        if (transformedData && transformedData.length > 0) {
          historicalMax = Math.max(...transformedData.map(w => w.count || 0));
          break;
        }
      }
    }
    
    return currentWeekTotal > historicalMax;
  }, [selectedPeriod, chartData, viewMode, weeklyHistoricalMax]);

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
          <div
            ref={widgetRef}
            className={`dev-activity-widget ${screenshotMode ? 'absolute top-0 left-0 w-[1400px] h-auto' : 'fixed z-[9999] flex items-center justify-center left-1/2 top-1/2 w-[75vw] max-w-[1600px] max-h-[95vh] min-w-[900px] min-h-[700px]'} ${screenshotMode ? 'bg-card-bg/90' : 'bg-card-bg/40'} border border-gray-800 rounded-xl shadow-lg ${screenshotMode ? 'overflow-visible' : 'overflow-hidden'} widget-crossfade-enter-active`}
            style={{ 
              borderRadius: '32px',
              ...(screenshotMode ? { 
                transform: 'none',
                position: 'absolute',
                zIndex: 'auto'
              } : {
                transform: 'translate(-50%, -50%)'
              })
            }}
            data-widget="development-activity"
          >
            <button
              className={`absolute top-6 right-6 z-50 text-gray-400 hover:text-white transition-all duration-200 ${screenshotMode ? 'hidden' : ''}`}
              onClick={onCollapse}
              aria-label="Close"
            >
              <span style={{ fontSize: 24, fontWeight: 'bold', lineHeight: 1 }}>×</span>
            </button>
            
            {/* Main Content Container */}
            <div className="w-full h-full flex flex-col overflow-hidden">
              {/* Header Section */}
              <div className="flex-shrink-0 px-8 pt-8 pb-4 min-h-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <Activity size={20} className="text-[#C8F560] flex-shrink-0" />
                    <h3 className="text-white font-semibold text-sm">Development Activity</h3>
                    {!screenshotMode ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <div className="w-48 flex-shrink-0">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">Period</div>
                          <div className="text-white text-sm font-semibold truncate">{selectedPeriodLabel}</div>
                        </div>
                        <div className="w-52 flex-shrink-0">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">View</div>
                          <div className="text-white text-sm font-semibold truncate">{viewModeLabel}</div>
                        </div>
                      </>
                    )}
                    <div className={`relative ${screenshotMode ? 'hidden' : ''}`}>
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
                              <span>Chart Only</span>
                              <span className="text-xs text-gray-400">Copy & Tweet</span>
                            </div>
                          </button>
                          <button 
                            className="block w-full text-left px-3 py-2 text-sm transition-colors duration-200 hover:bg-gray-700/50 text-gray-300"
                            onClick={handleShareChartLeaderboard}
                            disabled={isSharing}
                          >
                            <div className="flex items-center justify-between">
                              <span>Chart + Leaderboard</span>
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
                              Copies image + text to clipboard, opens Twitter
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Accent Color Picker Dot */}
                    <div className={`relative ${screenshotMode ? 'hidden' : ''}`}>
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
                    {shareMessage && (
                      <div className={`text-sm font-medium transition-all duration-300 truncate max-w-32 ${
                        shareMessageType === 'success' 
                          ? 'bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent' 
                          : 'bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-transparent'
                      }`}>
                        {shareMessage}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Content Section */}
              <div className="flex-1 px-8 pb-8 min-h-0">
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
                <div className="grid grid-cols-5 gap-8 h-full">
                  {/* Left Column - Metrics Bar and Chart */}
                  <div className="col-span-3 flex flex-col space-y-3 h-full min-h-0">
                      {/* Metrics Bar */}
                    <div className={`grid grid-cols-3 gap-2 py-3 px-4 rounded-lg items-center flex-shrink-0 ${
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
                              <div className="text-white font-bold text-lg">{metrics.totalActiveRepos}</div>
                        <div className="text-gray-400 text-xs">Active Repos</div>
                      </div>
                      <div className="text-center">
                              <div className="text-white font-bold text-lg">{metrics.avgCommitsPerRepo}</div>
                        <div className="text-gray-400 text-xs">
                                {isDaily ? 'Avg Commits/Repo/Day' : 'Avg Commits/Repo/Week'}
                        </div>
                      </div>
                      <div className="text-center">
                              <div className="text-white font-bold text-lg">{metrics.totalCommits}</div>
                        <div className="text-gray-400 text-xs">
                                {isDaily ? 'Total Commits/Day' : 'Total Commits/Week'}
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
                    <div ref={chartRef} className="flex-1 overflow-hidden min-h-0">
                      <div className={`rounded-lg pt-6 pb-6 px-6 h-full overflow-hidden ${
                        screenshotMode ? 'border border-gray-700/30' : 'bg-gray-800/50'
                      }`}>
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
                                className="w-full h-full flex items-center justify-center overflow-hidden" 
                                style={{
                                  pointerEvents: 'auto'
                                }} 
                                data-screenshot-mode={screenshotMode}
                              >
                                <AggregatedActivityChart
                                  weeklyData={chartData}
                                  width={700}
                                  height={315}
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

                  {/* Right Column - Leaderboard */}
                  <div 
                    ref={leaderboardRef} 
                    className={`col-span-2 flex flex-col h-full min-h-0 ${screenshotMode ? 'rounded-lg border border-gray-700/30' : ''}`}
                    style={screenshotMode ? { padding: '12px 16px', marginTop: 0 } : { padding: '0 8px', marginTop: '-7px' }}
                    data-screenshot-mode={screenshotMode}
                  >
                      {/* Top 3 Items */}
                    <div className="flex-shrink-0 mb-4 relative" style={{ zIndex: 10 }}>
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
                              boxShadow: `0 0 20px rgba(${currentAccentColor.rgb}, 0.3), 0 0 30px rgba(${currentAccentColor.rgb}, 0.5)`,
                              border: `1px solid rgba(${currentAccentColor.rgb}, 0.5)`,
                              zIndex: 13
                            };
                            isWinner = true;
                          } else if (index === 1) {
                            containerStyle = {
                              boxShadow: `0 0 15px rgba(${currentAccentColor.rgb}, 0.25), 0 0 25px rgba(${currentAccentColor.rgb}, 0.4)`,
                              border: `1px solid rgba(${currentAccentColor.rgb}, 0.4)`,
                              zIndex: 12
                            };
                          } else if (index === 2) {
                            containerStyle = {
                              boxShadow: `0 0 10px rgba(${currentAccentColor.rgb}, 0.2), 0 0 20px rgba(${currentAccentColor.rgb}, 0.3)`,
                              border: `1px solid rgba(${currentAccentColor.rgb}, 0.3)`,
                              zIndex: 11
                            };
                          }

                          return (
                            <div 
                              key={`top-${item.resource.id}`} 
                              className={`flex items-center space-x-4 p-3 rounded-lg transition-colors cursor-pointer ${
                                screenshotMode 
                                  ? 'text-[14px] leading-[20px] bg-gray-800/30' 
                                  : 'bg-gray-800/30 hover:bg-gray-800/50'
                              }`}
                              style={{ 
                                margin: '8px 0', 
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
                                <div className={`${isWinner ? 'font-bold' : 'font-medium'} ${screenshotMode ? 'text-[16px] leading-[22px]' : 'text-sm'} text-white truncate`}>
                                  {item.resource.name}
                                </div>
                                <div className={`${screenshotMode ? 'text-[12px] leading-[18px]' : 'text-xs'} text-gray-400 truncate`}>
                                    {item.resource.category}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <div className={`font-bold ${screenshotMode ? 'text-[14px] leading-[20px]' : 'text-sm'} text-white`}>
                                    {item.totalCommits}
                                </div>
                                <div className={`${screenshotMode ? 'text-[12px] leading-[18px]' : 'text-xs'} text-gray-400 truncate`}>
                                    {getActivityLevel(item.totalCommits)}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                      {/* Scrollable List */}
                    <div 
                      className="overflow-y-auto space-y-3 pr-2 relative scrollbar-hide" 
                      style={{ 
                          height: '280px',
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
                          leaderboard.slice(3).map((item, index) => {
                          const adjustedIndex = index + 3;

                          return (
                            <div 
                              key={item.resource.id} 
                              className={`flex items-center space-x-4 p-3 rounded-lg transition-colors cursor-pointer ${
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
                                <div className={`font-medium ${screenshotMode ? 'text-[16px] leading-[22px]' : 'text-sm'} text-white truncate`}>
                                  {item.resource.name}
                                </div>
                                <div className={`${screenshotMode ? 'text-[12px] leading-[18px]' : 'text-xs'} text-gray-400 truncate`}>
                                    {item.resource.category}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <div className={`font-bold ${screenshotMode ? 'text-[14px] leading-[20px]' : 'text-sm'} text-white`}>
                                    {item.totalCommits}
                                </div>
                                <div className={`${screenshotMode ? 'text-[12px] leading-[18px]' : 'text-xs'} text-gray-400 truncate`}>
                                    {getActivityLevel(item.totalCommits)}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
                )}
                
                {/* Global Performance Indicator */}
                {currentPeriodData && chartData && chartData.length > 0 && (
                  <div className="bg-gray-800/50 rounded-lg p-3 mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex flex-col">
                        <span className="text-gray-400 text-xs">
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
                            vs. best {selectedPeriod === '5weeks' ? '4-week' : 
                                         selectedPeriod === '3months' ? '3-month' : 
                                         selectedPeriod === '52weeks' ? '12-month' : 
                                         selectedPeriod === '3years' ? '3-year' : ''} period
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1">
                        <GitCommit size={12} style={{ color: currentAccentColor.hex }} />
                        <span className="font-bold text-lg" style={{ color: currentAccentColor.hex }}>
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
                                // For 7-day period (1 week), use memoized historical maximum
                                const currentValue = chartData.reduce((total, item) => total + (item.count || 0), 0);
                                const historicalMax = weeklyHistoricalMax || 1;
                                return `${Math.min(100, Math.max(0, (currentValue / historicalMax) * 100))}%`;
                              }
                              
                              const currentTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
                              const historicalMax = metrics?.historicalMax || currentTotal * 1.2;
                              const percentage = (currentTotal / historicalMax) * 100;
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
                              // For 7-day period, use memoized historical maximum
                              return `${weeklyHistoricalMax || 1} (historical peak)`;
                            }
                            const currentTotal = chartData.reduce((total, item) => total + (item.count || 0), 0);
                            return `${metrics?.historicalMax || Math.round(currentTotal * 1.2)} (historical peak)`;
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