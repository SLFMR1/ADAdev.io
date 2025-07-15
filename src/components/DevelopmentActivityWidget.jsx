import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity,
  GitCommit,
  TrendingUp,
  Calendar,
  ChevronRight,
  Clock,
  BarChart3,
  Zap,
  Share2,
  Loader2
} from 'lucide-react';
import { fetchGitHubUpdates } from '../services/github';
import { cardanoResources } from '../data/resources';
import logger from '../utils/logger';
import html2canvas from 'html2canvas';
import { getWeeklyActivity } from '../services/supabase';
import AggregatedActivityChart from './AggregatedActivityChart';
import Portal from './Portal';

// Helper to get chart points from weekly data
const getLineChartPoints = (data, width, height, padding) => {
  if (!data || data.length === 0) return '';
  const max = Math.max(...data, 1);
  const stepX = (width - 2 * padding) / (data.length - 1);
  return data.map((count, i) => {
    const x = padding + i * stepX;
    const y = height - padding - (count / max) * (height - 2 * padding);
    return `${x},${y}`;
  }).join(' ');
};

const periodOptions = [
  { key: 'monthly', label: 'Last 4 Weeks', weeks: 4 },
  { key: '3months', label: 'Last 3 Months', weeks: 13 },
  { key: '52weeks', label: 'Last 1 Year', weeks: 52 }
];

// Utility: Convert SVG element to PNG Blob using a canvas
async function svgToPngBlob(svgElement, width, height, background = '#1a1a1a', scale = 2) {
  return new Promise((resolve, reject) => {
    try {
      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(svgElement);
      if (!svgString.includes('<rect')) {
        svgString = svgString.replace('<svg ', `<svg><rect width='100%' height='100%' fill='${background}'/> `);
      }
      const svg64 = btoa(unescape(encodeURIComponent(svgString)));
      const image64 = 'data:image/svg+xml;base64,' + svg64;
      const img = new window.Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create PNG blob from SVG'));
        }, 'image/png', 0.95);
      };
      img.onerror = reject;
      img.src = image64;
    } catch (err) {
      reject(err);
    }
  });
}

const DevelopmentActivityWidget = ({ isExpanded, onExpand, onCollapse, isAnyExpanded }) => {
  const [activityData, setActivityData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPeriodDataLoading, setIsPeriodDataLoading] = useState(false);
  const [collapseTimeout, setCollapseTimeout] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const heatmapRef = useRef(null);
  const [weeklyActivity, setWeeklyActivity] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('3months');
  const [multiPeriodData, setMultiPeriodData] = useState({
    'monthly': { weeks: [], periodLabel: 'Last 4 Weeks', totalCommits: 0 },
    '3months': { weeks: [], periodLabel: 'Last 3 Months', totalCommits: 0 },
    '52weeks': { weeks: [], periodLabel: 'Last 1 Year', totalCommits: 0 }
  });
  const [leaderboardMode, setLeaderboardMode] = useState('period');
  const [resourcePeriodData, setResourcePeriodData] = useState({});
  const widgetRef = useRef(null);
  const chartRef = useRef(null);
  const leaderboardRef = useRef(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const chartSvgRef = useRef(null);

  // Enhanced leaderboard data with real period data
  const leaderboardData = useMemo(() => {
    if (leaderboardMode === 'current') {
      return activityData
        .map(item => ({ ...item, commits: item.commitsPerWeek }))
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 12);
    } else {
      const period = periodOptions.find(p => p.key === selectedPeriod);
      if (!period) return [];
      
      return activityData
        .map(item => {
          const resourceKey = item.resource.id || item.resource.name;
          const periodData = resourcePeriodData[resourceKey]?.[selectedPeriod];
          const totalCommits = periodData ? periodData.reduce((sum, week) => sum + (week.commit_count || 0), 0) : 0;
          
          return {
            ...item,
            commits: totalCommits
          };
        })
        .filter(item => item.commits > 0)
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 12);
    }
  }, [leaderboardMode, activityData, selectedPeriod, resourcePeriodData]);

  // Sidebar hover/collapse logic
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isExpanded && !event.target.closest('.dev-activity-widget')) {
        if (collapseTimeout) {
          clearTimeout(collapseTimeout);
          setCollapseTimeout(null);
        }
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isExpanded, collapseTimeout]);

  // Share menu click outside
  useEffect(() => {
    const handleShareMenuClickOutside = (event) => {
      if (shareMenuOpen && !event.target.closest('.share-menu-container') && !event.target.closest('.share-button')) {
        console.log('Closing share menu due to click outside');
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

  const loadActivityData = async () => {
    try {
      console.log('🔄 Loading current week activity data...');
      const startTime = Date.now();
      
      const resourcesWithGitHub = Object.entries(cardanoResources).flatMap(([category, resources]) =>
        resources
          .filter(resource => resource.social?.github)
          .map(resource => ({ ...resource, category }))
      );

      const activityArray = [];
      
      for (const resource of resourcesWithGitHub) {
        try {
          const cachedData = await fetchGitHubUpdates(resource);
          console.log('[DevActivityWidget] Resource:', resource.name, 'CachedData:', cachedData);
          if (cachedData && cachedData.commitsPerWeek !== undefined) {
            activityArray.push({
              resource,
              commitsPerWeek: cachedData.commitsPerWeek,
              category: resource.category
            });
          }
        } catch (error) {
          logger.warn(`Failed to get activity data for ${resource.name}:`, error.message);
        }
      }

      const sortedData = activityArray
        .filter(item => item.commitsPerWeek > 0)
        .sort((a, b) => b.commitsPerWeek - a.commitsPerWeek)
        .slice(0, 20);

      setActivityData(sortedData);
      
      const totalActiveRepos = sortedData.length;
      const totalCommits = sortedData.reduce((sum, item) => sum + item.commitsPerWeek, 0);
      const avgCommitsPerRepo = totalActiveRepos > 0 ? Math.round(totalCommits / totalActiveRepos) : 0;
      
      const event = new CustomEvent('activityDataUpdated', {
        detail: {
          totalActiveRepos,
          avgCommitsPerRepo,
          totalCommits
        }
      });
      document.dispatchEvent(event);
      
      const endTime = Date.now();
      console.log(`✅ Current week activity loaded in ${endTime - startTime}ms`);
      
    } catch (error) {
      logger.error('Activity widget loading error:', error);
      setActivityData([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadActivityData();
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const fetchMultiPeriodActivity = async () => {
      try {
        setIsPeriodDataLoading(true);
        console.log('🔄 Loading period activity data...');
        const startTime = Date.now();
        
        const resourcesWithGitHub = Object.entries(cardanoResources).flatMap(([category, resources]) =>
          resources
            .filter(resource => resource.social?.github)
            .map(resource => ({ ...resource, category }))
        );
        
        const periods = [
          { key: 'monthly', weeks: 4, label: 'Last 4 Weeks' },
          { key: '3months', weeks: 13, label: 'Last 3 Months' },
          { key: '52weeks', weeks: 52, label: 'Last 1 Year' }
        ];
        const results = {};
        const resourceData = {};
        
        await Promise.all(periods.map(async (period) => {
          console.log(`📊 Loading ${period.label} data...`);
          let combinedWeeks = Array(period.weeks).fill(0);
          let totalCommits = 0;
          
          const batchSize = 10;
          for (let i = 0; i < resourcesWithGitHub.length; i += batchSize) {
            const batch = resourcesWithGitHub.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (resource) => {
              try {
                const weeklyData = await getWeeklyActivity(resource, period.weeks);
                if (weeklyData && weeklyData.length > 0) {
                  const resourceKey = resource.id || resource.name;
                  if (!resourceData[resourceKey]) {
                    resourceData[resourceKey] = {};
                  }
                  resourceData[resourceKey][period.key] = weeklyData;
                  
                  weeklyData.forEach((weekData, index) => {
                    if (index < period.weeks) {
                      combinedWeeks[index] += weekData.commit_count || 0;
                      totalCommits += weekData.commit_count || 0;
                    }
                  });
                }
              } catch (error) {
                logger.warn(`Failed to get ${period.label} data for ${resource.name}:`, error.message);
              }
            }));
            
            if (i + batchSize < resourcesWithGitHub.length) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          
          results[period.key] = {
            weeks: combinedWeeks,
            periodLabel: period.label,
            totalCommits: totalCommits,
            activeWeeks: combinedWeeks.filter(w => w > 0).length
          };
        }));
        
        setMultiPeriodData(results);
        setResourcePeriodData(resourceData);
        
        const endTime = Date.now();
        console.log('📊 Multi-period activity data loaded:', results);
        console.log('📊 Resource period data loaded:', resourceData);
        console.log(`✅ Period data loaded in ${endTime - startTime}ms`);
      } catch (error) {
        logger.error('Failed to fetch multi-period activity data:', error);
      } finally {
        setIsPeriodDataLoading(false);
      }
    };
    fetchMultiPeriodActivity();
  }, []);

  const getActivityColor = (commitsPerWeek) => {
    if (commitsPerWeek >= 20) return 'bg-red-500';
    if (commitsPerWeek >= 10) return 'bg-orange-500';
    if (commitsPerWeek >= 5) return 'bg-yellow-500';
    if (commitsPerWeek >= 2) return 'bg-green-500';
    return 'bg-gray-500';
  };

  const getActivityLevel = (commitsPerWeek) => {
    if (commitsPerWeek >= 20) return 'Very High';
    if (commitsPerWeek >= 10) return 'High';
    if (commitsPerWeek >= 5) return 'Medium';
    if (commitsPerWeek >= 2) return 'Low';
    return 'Minimal';
  };

  const totalActiveRepos = activityData.length;
  const totalCommits = activityData.reduce((sum, item) => sum + item.commitsPerWeek, 0);
  const avgCommitsPerRepo = totalActiveRepos > 0 ? Math.round(totalCommits / totalActiveRepos) : 0;

  const createHeatmapData = () => {
    const heatmap = Array(4).fill().map(() => Array(7).fill(0));
    
    activityData.forEach((item, index) => {
      const row = Math.floor(index / 7) % 4;
      const col = index % 7;
      heatmap[row][col] = item.commitsPerWeek;
    });
    
    return heatmap;
  };

  const heatmapData = createHeatmapData();

  const chartWidth = 700;
  const chartHeight = 400;
  const chartPadding = 48;
  const rightPadding = 40;

  const periodData = multiPeriodData[selectedPeriod];
  const chartData = (periodData?.weeks || []).map((count, i) => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((periodData?.weeks?.length || 0) - 1 - i) * 7);
    return { weekStart: weekStart.toISOString().slice(0, 10), count };
  });
  const chartWidthToUse = chartWidth;

  const getTop5HandlesOrNames = () => {
    return activityData.slice(0, 5).map(item => {
      const social = item.resource.social || {};
      if (social.x) {
        const match = social.x.match(/x.com\/(\w+)/i);
        if (match && match[1]) return '@' + match[1];
      }
      if (social.github) {
        const match = social.github.match(/github.com\/(?:orgs\/)?([\w-]+)/i);
        if (match && match[1]) return '@' + match[1];
      }
      return item.resource.name.replace(/\s+/g, '');
    });
  };

  const shareToX = async (element, shareType = 'chart') => {
    console.log('shareToX called with element:', element, 'shareType:', shareType);
    if (!element) {
      console.error('No element provided to shareToX');
      return;
    }

    setIsSharing(true);

    try {
      let blob = null;
      let captureElement = element;
      const gap = 32; // px between chart and leaderboard

      if (shareType === 'leaderboard' && isPeriodDataLoading) {
        console.warn('Leaderboard data still loading, delaying screenshot');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setScreenshotMode(true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      captureElement.style.display = 'none';
      captureElement.offsetHeight;
      captureElement.style.display = shareType === 'leaderboard' ? 'flex' : 'block';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      if (shareType === 'full') {
        // Merge chart and leaderboard images
        // 1. Capture chart
        let chartImg, leaderboardImg;
        // Chart
        if (chartSvgRef.current) {
          try {
            const svg = chartSvgRef.current;
            const width = svg.width.baseVal.value || svg.clientWidth || 800;
            const height = svg.height.baseVal.value || svg.clientHeight || 400;
            const chartBlob = await svgToPngBlob(svg, width, height, '#1a1a1a', 2);
            chartImg = await new Promise(resolve => {
              const img = new window.Image();
              img.onload = () => resolve(img);
              img.src = URL.createObjectURL(chartBlob);
            });
          } catch (svgError) {
            // fallback to html2canvas
            const chartCanvas = await html2canvas(chartRef.current, { backgroundColor: '#1a1a1a', scale: 2 });
            chartImg = await new Promise(resolve => {
              const img = new window.Image();
              chartCanvas.toBlob(blob => {
                img.onload = () => resolve(img);
                img.src = URL.createObjectURL(blob);
              }, 'image/png', 0.95);
            });
          }
        }
        // Leaderboard
        const leaderboardCanvas = await html2canvas(leaderboardRef.current, { backgroundColor: '#1a1a1a', scale: 2 });
        leaderboardImg = await new Promise(resolve => {
          const img = new window.Image();
          leaderboardCanvas.toBlob(blob => {
            img.onload = () => resolve(img);
            img.src = URL.createObjectURL(blob);
          }, 'image/png', 0.95);
        });
        // 2. Create merged canvas
        const mergedWidth = chartImg.width + gap + leaderboardImg.width;
        const mergedHeight = Math.max(chartImg.height, leaderboardImg.height);
        const mergedCanvas = document.createElement('canvas');
        mergedCanvas.width = mergedWidth;
        mergedCanvas.height = mergedHeight;
        const ctx = mergedCanvas.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, mergedWidth, mergedHeight);
        // Center chart and leaderboard vertically
        const chartY = (mergedHeight - chartImg.height) / 2;
        const leaderboardY = (mergedHeight - leaderboardImg.height) / 2;
        ctx.drawImage(chartImg, 0, chartY);
        ctx.drawImage(leaderboardImg, chartImg.width + gap, leaderboardY);
        blob = await new Promise(resolve => {
          mergedCanvas.toBlob(resolve, 'image/png', 0.95);
        });
      } else if (shareType === 'chart' && chartSvgRef.current) {
        try {
          const svg = chartSvgRef.current;
          const width = svg.width.baseVal.value || svg.clientWidth || 800;
          const height = svg.height.baseVal.value || svg.clientHeight || 400;
          blob = await svgToPngBlob(svg, width, height, '#1a1a1a', 2);
        } catch (svgError) {
          console.warn('SVG to PNG failed, falling back to html2canvas:', svgError);
        }
      }
      if (!blob) {
        if (shareType === 'chart' && chartSvgRef.current) {
          captureElement = chartSvgRef.current.parentElement;
        }
        const canvas = await html2canvas(captureElement, { 
          backgroundColor: '#1a1a1a',
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
        blob = await new Promise(resolve => {
          canvas.toBlob(resolve, 'image/png', 0.95);
        });
      }

      const handles = getTop5HandlesOrNames().join(' ');
      const tweetText = `Cardano Development Activity\n\nTop projects: ${handles}\n#Cardano #Development #OpenSource\n\nSee more at: https://adadev.io`;

      try {
        if (navigator.clipboard && navigator.clipboard.write) {
          const clipboardItems = [
            new ClipboardItem({
              'image/png': blob,
              'text/plain': new Blob([tweetText], { type: 'text/plain' })
            })
          ];
          await navigator.clipboard.write(clipboardItems);
          showShareSuccess('Tweet prepared! Opening X... Just paste!');
          setTimeout(() => {
            window.open('https://x.com/intent/tweet', '_blank');
          }, 3000);
        } else {
          await navigator.clipboard.writeText(tweetText);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `cardano-dev-activity-${shareType}-${new Date().toISOString().slice(0, 10)}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          showShareSuccess('Text copied + image downloaded! Opening X... Press Cmd+V for text, then upload image.');
          setTimeout(() => {
            window.open('https://x.com/intent/tweet', '_blank');
          }, 2000);
        }
      } catch (clipboardError) {
        console.warn('Clipboard copy failed:', clipboardError);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `cardano-dev-activity-${shareType}-${new Date().toISOString().slice(0, 10)}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        try {
          await navigator.clipboard.writeText(tweetText);
          showShareSuccess('Text copied + image downloaded! Opening X... Press Cmd+V for text, then upload image.');
        } catch (textError) {
          showShareSuccess('Image downloaded! Copy this text to X: ' + tweetText);
        }
        setTimeout(() => {
          window.open('https://x.com/intent/tweet', '_blank');
        }, 2000);
      }
    } catch (error) {
      console.error('Share error:', error);
      showShareError('Failed to generate image. Please try again.');
    } finally {
      setScreenshotMode(false);
      setIsSharing(false);
    }
  };

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

  const handleShareChart = () => {
    console.log('handleShareChart called');
    setShareMenuOpen(false);
    shareToX(chartRef.current, 'chart');
  };

  const handleShareChartLeaderboard = () => {
    console.log('handleShareChartLeaderboard called');
    setShareMenuOpen(false);
    shareToX(widgetRef.current, 'full');
  };

  const handleShareLeaderboard = () => {
    console.log('handleShareLeaderboard called');
    setShareMenuOpen(false);
    shareToX(leaderboardRef.current, 'leaderboard');
  };

  return (
    <>
      {!isExpanded ? (
        <div
          className="relative z-50 w-16 h-16"
          onClick={onExpand}
        >
          <div className="flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl">
            <Zap size={24} className="text-yellow-400" />
          </div>
        </div>
      ) : (
        <Portal>
          <div
            ref={widgetRef}
            className="fixed z-[9999] flex items-center justify-center left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[1600px] max-h-[90vh] min-w-[900px] min-h-[600px] border-radius-[32px] bg-card-bg/40 border border-gray-800 rounded-xl shadow-lg overflow-hidden p-0 transition-all duration-500 ease-in-out opacity-100 scale-100"
            style={{ borderRadius: '32px' }}
          >
            <button
              className="absolute top-6 right-6 z-50 text-gray-400 hover:text-white bg-gray-800/70 rounded-full p-2 transition-colors"
              onClick={onCollapse}
              aria-label="Close"
            >
              <span style={{fontSize: 24, fontWeight: 'bold', lineHeight: 1}}>×</span>
            </button>
            <div
              className="w-full h-full p-8 overflow-auto"
              style={{ maxHeight: '90vh', minHeight: '600px' }}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h1 className="text-white text-2xl font-bold">Development Activity</h1>
                  <div className="relative flex items-center gap-3">
                    <button
                      className={`share-button text-cyan-400 hover:text-white bg-gray-800/70 rounded-full p-2 transition-colors ${
                        isSharing ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                      onClick={() => {
                        console.log('Share button clicked, isSharing:', isSharing);
                        if (!isSharing) {
                          setShareMenuOpen(v => {
                            console.log('Setting share menu to:', !v);
                            return !v;
                          });
                        }
                      }}
                      title="Share Development Activity"
                      disabled={isSharing}
                    >
                      {isSharing ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Share2 className="w-5 h-5" />
                      )}
                    </button>
                    {shareMessage && (
                      <div className={`text-sm font-medium transition-all duration-300 ${
                        shareMessageType === 'success' 
                          ? 'bg-gradient-to-r from-cyan-500 to-blue-500 bg-clip-text text-transparent' 
                          : 'bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-transparent'
                      }`}>
                        {shareMessage}
                      </div>
                    )}
                    {shareMenuOpen && (
                      <div className="share-menu-container absolute left-0 top-full mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-lg z-50">
                        <div className="px-3 py-2 border-b border-gray-700">
                          <div className="text-xs text-gray-400 font-medium">Share Options</div>
                        </div>
                        <button 
                          className="block w-full text-left px-4 py-3 hover:bg-cyan-700 text-white transition-colors"
                          onClick={handleShareChart}
                          disabled={isSharing}
                        >
                          <div className="flex items-center justify-between">
                            <span>Chart Only</span>
                            <span className="text-xs text-gray-400">Copy & Tweet</span>
                          </div>
                        </button>
                        <button 
                          className="block w-full text-left px-4 py-3 hover:bg-cyan-700 text-white transition-colors"
                          onClick={handleShareChartLeaderboard}
                          disabled={isSharing}
                        >
                          <div className="flex items-center justify-between">
                            <span>Chart + Leaderboard</span>
                            <span className="text-xs text-gray-400">Copy & Tweet</span>
                          </div>
                        </button>
                        <button 
                          className="block w-full text-left px-4 py-3 hover:bg-cyan-700 text-white transition-colors"
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
                </div>
              </div>
              <div className="mb-2">
                <h2 className="text-white text-lg font-semibold">Current Week</h2>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4 py-2 px-3 bg-gray-800/50 rounded-lg items-center">
                <div className="text-center">
                  <div className="text-white font-bold text-lg">{totalActiveRepos}</div>
                  <div className="text-gray-400 text-xs">Active Repos</div>
                </div>
                <div className="text-center">
                  <div className="text-white font-bold text-lg">{avgCommitsPerRepo}</div>
                  <div className="text-gray-400 text-xs">Avg Commits/Repo/Week</div>
                </div>
                <div className="text-center">
                  <div className="text-white font-bold text-lg">{totalCommits}</div>
                  <div className="text-gray-400 text-xs">Total Commits/Week</div>
                </div>
              </div>
              <div className="flex flex-row gap-8 items-start">
                <div ref={chartRef} className="flex-1 min-w-0">
                  <div className="mb-8">
                    {!screenshotMode ? (
                      <div className="flex space-x-3 mb-6">
                        {periodOptions.map(opt => (
                          <button
                            key={opt.key}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                              selectedPeriod === opt.key 
                                ? 'btn-primary' 
                                : 'bg-gray-700 text-cyan-300 hover:bg-cyan-800 hover:text-white'
                            }`}
                            onClick={() => setSelectedPeriod(opt.key)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mb-6">
                        <span
                          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-700 text-cyan-300"
                          style={{ display: 'inline-block', cursor: 'default' }}
                        >
                          {periodOptions.find(p => p.key === selectedPeriod)?.label || 'Period'}
                        </span>
                      </div>
                    )}
                    <div className="bg-gray-800/50 rounded-lg p-6 overflow-hidden">
                      {isPeriodDataLoading ? (
                        <div className="flex items-center justify-center h-64">
                          <div className="flex items-center space-x-3 text-cyan-400">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span className="text-sm font-medium">Loading period data...</span>
                          </div>
                        </div>
                      ) : (
                        (() => {
                          const periodData = multiPeriodData[selectedPeriod];
                          if (!periodData) return null;
                          const chartData = (periodData.weeks || []).map((count, i) => {
                            const now = new Date();
                            const weekStart = new Date(now);
                            weekStart.setDate(now.getDate() - (periodData.weeks.length - 1 - i) * 7);
                            return { weekStart: weekStart.toISOString().slice(0, 10), count };
                          });
                          return (
                            <div className={`w-full overflow-x-auto${screenshotMode ? ' pl-4 pr-4' : ''}`} style={screenshotMode ? { marginLeft: '24px', paddingLeft: '16px', paddingRight: '16px' } : {}} data-screenshot-mode={screenshotMode}>
                              <AggregatedActivityChart 
                                ref={chartSvgRef}
                                weeklyData={chartData} 
                                width={chartWidthToUse} 
                                height={chartHeight} 
                                padding={chartPadding} 
                                rightPadding={rightPadding}
                                period={selectedPeriod} 
                                screenshotMode={screenshotMode}
                              />
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>
                </div>
                <div 
                  ref={leaderboardRef} 
                  className="w-[550px] flex flex-col"
                  style={screenshotMode ? { padding: '16px 32px 32px 32px', height: '700px', overflow: 'visible' } : { maxHeight: '700px' }}
                  data-screenshot-mode={screenshotMode}
                >
                  <div className={`flex items-center justify-between ${screenshotMode ? 'mb-4' : 'mb-6'}`}>
                    <h3 className="text-white text-lg font-bold">Leaderboard</h3>
                    {!screenshotMode ? (
                      <div className="flex space-x-2 items-center">
                        <button
                          className={`rounded-lg text-sm font-semibold transition-colors flex items-center justify-center ${
                            leaderboardMode === 'current' 
                              ? 'btn-primary' 
                              : 'bg-gray-700 text-cyan-300 hover:bg-cyan-800 hover:text-white'
                          } ${screenshotMode ? '!px-3 !py-1.5' : '!px-3 !py-2'}`}
                          onClick={() => setLeaderboardMode('current')}
                          aria-label="Show current week leaderboard"
                        >
                          Current Week
                        </button>
                        <button
                          className={`rounded-lg text-sm font-semibold transition-colors flex items-center justify-center ${
                            leaderboardMode === 'period' 
                              ? 'btn-primary' 
                              : 'bg-gray-700 text-cyan-300 hover:bg-cyan-800 hover:text-white'
                          } ${screenshotMode ? '!px-3 !py-1.5' : '!px-3 !py-2'}`}
                          onClick={() => setLeaderboardMode('period')}
                          aria-label="Show leaderboard for selected period"
                        >
                          {periodOptions.find(p => p.key === selectedPeriod)?.label || 'Period'}
                        </button>
                      </div>
                    ) : (
                      <div className="flex space-x-2 items-center">
                        <span
                          className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-700 text-cyan-300"
                          style={{ display: leaderboardMode === 'current' ? 'inline-block' : 'none', cursor: 'default' }}
                        >
                          Current Week
                        </span>
                        <span
                          className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-700 text-cyan-300"
                          style={{ display: leaderboardMode === 'period' ? 'inline-block' : 'none', cursor: 'default' }}
                        >
                          {periodOptions.find(p => p.key === selectedPeriod)?.label || 'Period'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 max-h-[700px]">
                    {isPeriodDataLoading && leaderboardMode === 'period' ? (
                      <div className="flex items-center justify-center h-32">
                        <div className="flex items-center space-x-2 text-cyan-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-xs">Loading leaderboard...</span>
                        </div>
                      </div>
                    ) : (
                      leaderboardData.map((item, index) => (
                        <div 
                          key={item.resource.id} 
                          className={`flex items-center space-x-4 p-3 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors ${screenshotMode ? 'text-[14px] leading-[20px]' : ''}`}
                        >
                          <div className="text-cyan-400 text-sm font-bold flex-shrink-0 w-6 text-center">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-white font-medium ${screenshotMode ? 'text-[16px] leading-[22px] break-words' : 'text-sm truncate'}`}>
                              {item.resource.name}
                            </div>
                            <div className={`text-gray-400 ${screenshotMode ? 'text-[12px] leading-[18px] break-words' : 'text-xs truncate'}`}>
                              {item.category}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-white font-bold ${screenshotMode ? 'text-[14px] leading-[20px]' : 'text-sm'}`}>
                              {item.commits}
                            </div>
                            <div className={`text-gray-400 ${screenshotMode ? 'text-[12px] leading-[18px]' : 'text-xs'}`}>
                              {getActivityLevel(item.commits)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-gray-700">
                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>Activity levels:</span>
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-1">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span className="text-xs">Very High</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                      <span className="text-xs">High</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                      <span className="text-xs">Medium</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <span className="text-xs">Low</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-3 h-3 rounded-full bg-gray-500"></div>
                      <span className="text-xs">Minimal</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
};

export default DevelopmentActivityWidget;