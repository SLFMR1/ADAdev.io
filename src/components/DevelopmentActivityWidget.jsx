import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Activity, Share2, Loader2 } from 'lucide-react';
import { cardanoResources } from '../data/resources';
import logger from '../utils/logger-frontend';
import html2canvas from 'html2canvas';
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

const periodOptions = [
  { key: 'current', label: 'Last 7 Days', weeks: 1 },
  { key: 'monthly', label: 'Last 28 Days', weeks: 4 },
  { key: '3months', label: 'Last 3 Months', weeks: 13 },
  { key: '52weeks', label: 'Last 12 Months', weeks: 52 },
  { key: '3years', label: 'Last 3 Years', weeks: 156 }
];

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
  { name: 'Dawn Blue', hex: '#4C6FFF', rgb: '76, 111, 255' }
];

const DevelopmentActivityWidget = ({ isExpanded, isAnyExpanded, onExpand, onCollapse, onNavigateToResource }) => {
  const [activityData, setActivityData] = useState(null);
  const [preloadedData, setPreloadedData] = useState({}); // Store preloaded data by view mode
  const [isLoading, setIsLoading] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [hasDataLoadError, setHasDataLoadError] = useState(false);
  
  // Accent color state - defaults to white (index 0)
  const [accentColorIndex, setAccentColorIndex] = useState(() => {
    try {
      const saved = localStorage.getItem('developmentActivityWidget.accentColor');
      return saved !== null ? parseInt(saved) : 0; // Always default to 0 (white)
    } catch {
      return 0; // Default to white
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
  const [lastFetchTime, setLastFetchTime] = useState({});
  
  const widgetRef = useRef(null);
  const chartRef = useRef(null);
  const leaderboardRef = useRef(null);
  const chartSvgRef = useRef(null);

  // Client-side cache optimized for GitHub activity patterns (data changes infrequently)
  const CACHE_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours

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
      
      // Check if we have preloaded data for instant switching
      const viewModeCache = preloadedData[currentViewMode];
      const lastFetch = lastFetchTime[currentViewMode];
      
      console.log(`🔍 DEBUG: Cache check - viewModeCache exists: ${!!viewModeCache}, lastFetch: ${lastFetch}, cacheValid: ${lastFetch && (Date.now() - lastFetch < CACHE_TIMEOUT)}`);
      
      if (!forceRefresh && viewModeCache && lastFetch && (Date.now() - lastFetch < CACHE_TIMEOUT)) {
        console.log('⚡ INSTANT SWITCH: Using preloaded data!');
        if (viewModeCache.preloadedPeriods && viewModeCache.preloadedPeriods[currentPeriod]) {
          const periodData = { ...viewModeCache.preloadedPeriods[currentPeriod], period: currentPeriod, viewMode: currentViewMode };
          console.log(`🔍 DEBUG: Setting cached data - dailyLeaderboard: ${periodData.dailyLeaderboard?.length || 0}, weeklyLeaderboard: ${periodData.weeklyLeaderboard?.length || 0}`);
          setActivityData(periodData);
          
          // Dispatch event for other components
          const event = new CustomEvent('activityDataUpdated', {
            detail: periodData.metrics?.daily || periodData.metrics?.weekly
          });
          document.dispatchEvent(event);
          
          setIsLoading(false);
          setError(null); // Clear any previous errors
          return;
        } else {
          console.log(`🔍 DEBUG: No preloaded period data for ${currentPeriod}`);
        }
      }

      // Only set loading if we don't have any existing data to prevent flickering
      if (!activityData) {
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
        // Store preloaded data by view mode
        setPreloadedData(prev => ({
          ...prev,
          [currentViewMode]: { ...data, viewMode: currentViewMode }
        }));
        setLastFetchTime(prev => ({
          ...prev,
          [currentViewMode]: Date.now()
        }));
        
        // Set current period data
        let currentData;
        if (data.preloadedPeriods && data.preloadedPeriods[currentPeriod]) {
          currentData = { ...data.preloadedPeriods[currentPeriod], period: currentPeriod, viewMode: currentViewMode };
        } else {
          // Fallback to main response structure
          currentData = { ...data, period: currentPeriod, viewMode: currentViewMode };
        }
        
        console.log(`🔍 DEBUG: Setting API data - currentData dailyLeaderboard: ${currentData.dailyLeaderboard?.length || 0}, weeklyLeaderboard: ${currentData.weeklyLeaderboard?.length || 0}`);
        
        // Use functional update to ensure we don't lose data during rapid switches
        setActivityData(prevData => {
          // If we have existing data for a different view mode, preserve it temporarily
          if (prevData && prevData.viewMode !== currentViewMode) {
            console.log(`🔍 DEBUG: View mode changed from ${prevData.viewMode} to ${currentViewMode}, updating data`);
          }
          return currentData;
        });
        setError(null); // Clear any previous errors
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
  }, [viewMode, selectedPeriod, preloadedData, lastFetchTime, CACHE_TIMEOUT]);

  // Load data on mount or when first expanded - optimized for server cache
  useEffect(() => {
    const lastFetch = lastFetchTime[viewMode];
    const needsData = !activityData || !lastFetch || (Date.now() - lastFetch >= CACHE_TIMEOUT);
    
    if (isExpanded && needsData) {
      // Check if we have any cached data for this view mode first
      const cachedData = preloadedData[viewMode];
      if (cachedData && cachedData.preloadedPeriods && cachedData.preloadedPeriods[selectedPeriod]) {
        console.log('📦 Widget expanded - using existing cached data');
        const periodData = { ...cachedData.preloadedPeriods[selectedPeriod], period: selectedPeriod, viewMode: viewMode };
        setActivityData(periodData);
        setIsLoading(false);
      } else {
        // Server has preloaded all periods data in cache, so this should be very fast
        console.log('📦 Widget expanded - loading from server cache (all periods preloaded)');
        loadActivityData();
      }
    }
  }, [isExpanded, viewMode, selectedPeriod, preloadedData]);

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
    // Only trigger if viewMode actually changed (not on initial mount)
    if (isExpanded && viewMode && viewModeRef.current && viewModeRef.current !== viewMode) {
      console.log(`🔄 View mode changed from ${viewModeRef.current} to ${viewMode}`);
      
      // Check if we have cached data for the new view mode
      const cachedData = preloadedData[viewMode];
      if (cachedData && cachedData.preloadedPeriods && cachedData.preloadedPeriods[selectedPeriod]) {
        console.log('⚡ Using cached data for view mode switch');
        const periodData = { ...cachedData.preloadedPeriods[selectedPeriod], period: selectedPeriod, viewMode: viewMode };
        setActivityData(periodData);
        setIsLoading(false);
      } else {
        console.log('🔄 Loading fresh data for new view mode...');
        loadActivityData(true); // Force refresh
      }
    }
    
    // Update ref
    viewModeRef.current = viewMode;
  }, [viewMode, isExpanded, selectedPeriod, preloadedData]);

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

  // Helper function to transform chart data to the format expected by AggregatedActivityChart
  const transformChartData = useCallback((chartData, isDaily = false) => {
    if (!chartData || chartData.length === 0) return [];
    
    if (isDaily) {
      // For daily data (7-day period), create daily data points
      const aggregatedData = [];
      const maxDays = Math.max(...chartData.map(item => item.dailyCounts?.length || 0));
      const today = new Date();
      
      for (let day = 0; day < maxDays; day++) {
        const totalCount = chartData.reduce((sum, item) => sum + (item.dailyCounts?.[day] || 0), 0);
        // Calculate the correct date for each day (going backwards from today)
        const dayDate = new Date(today);
        dayDate.setDate(today.getDate() - (maxDays - 1 - day));
        
        aggregatedData.push({
          count: totalCount,
          weekStart: dayDate.toISOString().slice(0, 10)
        });
      }
      return aggregatedData;
    } else {
      // For weekly data, create weekly data points
      const aggregatedData = [];
      const maxWeeks = Math.max(...chartData.map(item => item.weeklyCounts?.length || 0));
      const today = new Date();
      
      for (let week = 0; week < maxWeeks; week++) {
        const totalCount = chartData.reduce((sum, item) => sum + (item.weeklyCounts?.[week] || 0), 0);
        
        // Calculate the start of each week (going backwards from current week)
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - (maxWeeks - 1 - week) * 7);
        
        // Adjust to Monday of that week
        const dayOfWeek = weekStart.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - daysToMonday);
        
        aggregatedData.push({
          count: totalCount,
          weekStart: weekStart.toISOString().slice(0, 10)
        });
      }
      return aggregatedData;
    }
  }, []);

  // Get current period data based on selection
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
    
    // Get period configuration
    const getPeriodConfig = (period) => {
      switch (period) {
        case 'current': 
          return { label: 'Last 7 Days', isDaily: true };
        case 'monthly': 
          return { label: 'Last 28 Days', isDaily: false };
        case '3months': 
          return { label: 'Last 3 Months', isDaily: false };
        case '52weeks': 
          return { label: 'Last 12 Months', isDaily: false };
        case '3years': 
          return { label: 'Last 3 Years', isDaily: false };
        default: 
          return { label: 'Last 7 Days', isDaily: true };
      }
    };

    const { label: periodLabel, isDaily } = getPeriodConfig(selectedPeriod);
    
    // Use appropriate data based on period type
    const chartData = isDaily ? dailyChartData : weeklyChartData;
    const leaderboard = isDaily ? dailyLeaderboard : weeklyLeaderboard;
    
    const transformedChartData = transformChartData(chartData, isDaily);
    console.log(`🔍 DEBUG: currentPeriodData result - leaderboard: ${leaderboard.length}, transformedChartData: ${transformedChartData.length}, isDaily: ${isDaily}`);
    
    return {
      leaderboard,
      chartData: transformedChartData,
      metrics: isDaily ? activityData.metrics?.daily : activityData.metrics?.weekly,
      periodLabel,
      isDaily
    };
  }, [activityData, selectedPeriod, transformChartData]);

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

    try {
      let blob = null;
      let captureElement = element;
      const gap = 32;

      if (shareType === 'full') {
        let chartImg, leaderboardImg;
        
        if (chartSvgRef.current) {
          try {
            const svg = chartSvgRef.current;
            const width = svg.width.baseVal.value || svg.clientWidth || 800;
            const height = svg.height.baseVal.value || svg.clientHeight || 400;
            const chartBlob = await svgToPngBlob(svg, width, height, 2);
            chartImg = await new Promise(resolve => {
              const img = new window.Image();
              img.onload = () => resolve(img);
              img.src = URL.createObjectURL(chartBlob);
            });
          } catch (svgError) {
            const chartBlob = await createIsolatedScreenshot(chartRef.current, { scale: 2 });
            chartImg = await new Promise(resolve => {
              const img = new window.Image();
              img.onload = () => resolve(img);
              img.src = URL.createObjectURL(chartBlob);
            });
          }
        }
        
        const leaderboardBlob = await createIsolatedScreenshot(leaderboardRef.current, { scale: 2 });
        leaderboardImg = await new Promise(resolve => {
          const img = new window.Image();
          img.onload = () => resolve(img);
          img.src = URL.createObjectURL(leaderboardBlob);
        });
        
        blob = await mergeImagesWithGap([chartImg, leaderboardImg], gap);
      } else if (shareType === 'chart' && chartSvgRef.current) {
        try {
          const svg = chartSvgRef.current;
          const width = svg.width.baseVal.value || svg.clientWidth || 800;
          const height = svg.height.baseVal.value || svg.clientHeight || 400;
          blob = await svgToPngBlob(svg, width, height, 2);
        } catch (svgError) {
          console.warn('SVG to PNG failed, falling back to html2canvas:', svgError);
        }
      }
      
      if (!blob) {
        if (shareType === 'chart' && chartSvgRef.current) {
          captureElement = chartSvgRef.current.parentElement;
        }
        blob = await createIsolatedScreenshot(captureElement, { 
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: shareType === 'leaderboard' ? 550 : captureElement.scrollWidth,
          height: shareType === 'leaderboard' ? 700 : captureElement.scrollHeight,
          scrollX: 0,
          scrollY: 0,
          windowWidth: shareType === 'leaderboard' ? 550 : undefined,
          windowHeight: shareType === 'leaderboard' ? 700 : undefined
        });
      }

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

  const { leaderboard, chartData, metrics, periodLabel, isDaily } = currentPeriodData || {};

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
            className="dev-activity-widget fixed z-[9999] flex items-center justify-center left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[75vw] max-w-[1600px] max-h-[90vh] min-w-[900px] min-h-[650px] bg-card-bg/40 border border-gray-800 rounded-xl shadow-lg overflow-hidden transition-all duration-500 ease-in-out opacity-100 scale-100"
            style={{ borderRadius: '32px' }}
            data-widget="development-activity"
          >
            <button
              className="absolute top-6 right-6 z-50 text-gray-400 hover:text-white transition-all duration-200"
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
                    {!screenshotMode && (
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
                            
                            // Check if we have preloaded data for instant switching
                            const viewModeCache = preloadedData[viewMode];
                            if (viewModeCache && viewModeCache.preloadedPeriods && viewModeCache.preloadedPeriods[newPeriod]) {
                              console.log('✅ Using preloaded data for instant period switch!');
                              
                              // Update activity data with preloaded data
                              const periodData = { ...viewModeCache.preloadedPeriods[newPeriod], period: newPeriod, viewMode: viewMode };
                              
                              // Use functional update to prevent race conditions
                              setActivityData(prevData => {
                                console.log(`🔍 DEBUG: Period switch - updating from ${prevData?.period || 'none'} to ${newPeriod}`);
                                return periodData;
                              });
                              
                              // Dispatch event for other components
                              const event = new CustomEvent('activityDataUpdated', {
                                detail: periodData.metrics?.daily || periodData.metrics?.weekly
                              });
                              document.dispatchEvent(event);
                              
                              console.log(`⚡ INSTANT SWITCH COMPLETE: Now showing ${newPeriod} with ${periodData.dailyLeaderboard?.length || periodData.weeklyLeaderboard?.length || 0} resources`);
                            } else {
                              console.log('⏳ No preloaded data available, will load from cache or API...');
                              // Don't force reload here, let the effect handle it
                            }
                          }}
                          options={periodOptions}
                          placeholder="Select period..."
                          className="w-48 flex-shrink-0"
                        />
                        <PeriodDropdown
                          value={viewMode}
                          onChange={(newViewMode) => {
                            console.log(`🔄 View mode changing from ${viewMode} to ${newViewMode}`);
                            setViewMode(newViewMode);
                            try {
                              localStorage.setItem('developmentActivityWidget.viewMode', newViewMode);
                            } catch {}
                          }}
                          options={viewModeOptions}
                          placeholder="Select view mode..."
                          className="w-52 flex-shrink-0"
                        />
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
                          {shareMenuOpen && (
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
                        {shareMessage && (
                          <div className={`text-sm font-medium transition-all duration-300 truncate max-w-32 ${
                            shareMessageType === 'success' 
                              ? 'bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent' 
                              : 'bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-transparent'
                          }`}>
                            {shareMessage}
                          </div>
                        )}
                      </>
                    )}
                    {screenshotMode && (
                      <span
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-700 text-white flex-shrink-0"
                        style={{ display: 'inline-block', cursor: 'default' }}
                      >
                        {periodLabel || 'Period'}
                      </span>
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
                                className={`w-full h-full flex items-center justify-center overflow-hidden${screenshotMode ? ' pl-4 pr-4' : ''}`} 
                                style={{
                                  ...(screenshotMode ? { marginLeft: '24px', paddingLeft: '16px', paddingRight: '16px' } : {}),
                                  pointerEvents: 'auto'
                                }} 
                                data-screenshot-mode={screenshotMode}
                              >
                                <AggregatedActivityChart
                                  weeklyData={chartData}
                                  width={700}
                                  height={380}
                                  padding={40}
                                  period={selectedPeriod}
                                  screenshotMode={screenshotMode}
                                  accentColor={currentAccentColor}
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
                    className="col-span-2 flex flex-col h-full min-h-0"
                    style={screenshotMode 
                      ? { padding: '0 8px', height: '100%', marginTop: '-5px' } 
                      : { padding: '0 8px', marginTop: '-7px' }}
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
                                  ? 'text-[14px] leading-[20px] border border-gray-700/30' 
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
                                  ? 'text-[14px] leading-[20px] border border-gray-700/30' 
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
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
};

export default DevelopmentActivityWidget;