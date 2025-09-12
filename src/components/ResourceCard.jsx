import React, { useState, useRef, useEffect, useCallback } from 'react'
import { 
  ExternalLink, Github, MessageCircle,
  TerminalSquare, Database, Wallet, Image as ImageIcon, Users,
  ShieldCheck, Zap, BarChart2, Bot, Moon, HardDrive, Building2,
  BookOpen, UserCheck, Eye, Cpu, Heart, Server, GitBranch, Share2, Loader2, TrendingUp, ClipboardCheck
} from 'lucide-react'
import GitHubUpdates from './GitHubUpdates'
import WeeklyCommitCount from './WeeklyCommitCount'
import WeeklyActivityChart from './WeeklyActivityChart'
import PeriodDropdown from './PeriodDropdown'
import * as htmlToImage from 'html-to-image'
import { createGlobalGradientBackground } from '../utils/logger-frontend.js'
import { createIsolatedScreenshot, shareToX, generateTweetText } from '../utils/screenshotUtils'
import { fetchGitHubUpdates } from '../services/github'
import logger from '../utils/logger-frontend'
import brandingLogo from '/adadev_io.svg'
import { 
  RESOURCE_CARD_PERIOD_OPTIONS,
  RESOURCE_CARD_PERIOD_MAPPING,
  getPeriodConfig,
  validateNodeCount,
  getCacheTTL,
  getServerPeriod
} from '../utils/chartDataUtils'
import { ChartDataCache } from '../utils/cacheUtils'
import Portal from './Portal'

// No direct Supabase client - using server APIs for single source of truth

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

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"/>
  </svg>
)

const DiscordIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.317 4.369A19.791 19.791 0 0016.885 3.2a.077.077 0 00-.082.038c-.357.63-.755 1.453-1.037 2.104a18.524 18.524 0 00-5.532 0 12.683 12.683 0 00-1.05-2.104.077.077 0 00-.082-.038A19.736 19.736 0 003.684 4.369a.07.07 0 00-.032.027C.533 9.09-.32 13.578.099 18.021a.082.082 0 00.031.056c2.128 1.563 4.195 2.507 6.222 3.13a.077.077 0 00.084-.027c.48-.66.908-1.356 1.273-2.084a.076.076 0 00-.041-.104c-.676-.256-1.32-.568-1.94-.936a.077.077 0 01-.008-.127c.13-.098.26-.2.384-.304a.074.074 0 01.077-.01c4.07 1.86 8.47 1.86 12.51 0a.075.075 0 01.078.009c.124.104.254.206.384.304a.077.077 0 01-.006.127 12.298 12.298 0 01-1.941.936.076.076 0 00-.04.105c.366.728.794 1.423 1.273 2.083a.076.076 0 00.084.028c2.028-.623 4.095-1.567 6.223-3.13a.077.077 0 00.03-.055c.5-5.177-.838-9.637-3.548-13.625a.062.062 0 00-.03-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.175 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419zm7.96 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.175 1.094 2.157 2.418 0 1.334-.947 2.419-2.157 2.419z" fill="currentColor"/>
  </svg>
)

const categoryIconComponents = {
  "Development Tools": TerminalSquare,
  "Infrastructure & APIs": Database,
  "Wallets & User Tools": Wallet,
  "Security & Auditing": ShieldCheck,
  "Minting and NFTs": ImageIcon,
  "Analytics & Data": BarChart2,
  "Education & Documentation": BookOpen,
  "Identity & Authentication": UserCheck,
  "Oracles & External Data": Zap,
  "Privacy & Zero-Knowledge": Moon,
  "AI & Machine Learning": Bot,
  "Development Platforms": HardDrive,
  "Community & Engagement": Heart,
  "Core Infrastructure": Server,
  default: TerminalSquare
};

const getSocialIcon = (platform) => {
  switch (platform) {
    case 'twitter':
    case 'x': return <XIcon />
    case 'github': return <Github size={14} />
    case 'discord': return <DiscordIcon />
    default: return <ExternalLink size={14} />
  }
}

// Helper function to convert YouTube URL to embeddable format
const getYouTubeEmbedUrl = (url) => {
  if (!url) return null
  
  const regex = /(?:youtu\.be\/|youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
  const match = url.match(regex)
  
  if (match && match[1]) {
    // Return embed URL with 720p quality parameter
    return `https://www.youtube.com/embed/${match[1]}?hd=1&vq=hd720&rel=0`
  }
  
  return null
}

const ResourceCard = ({ resource, onViewResource }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('about')
  const [isScrolling, setIsScrolling] = useState(false)
  const scrollTimeoutRef = useRef(null)
  const cardRef = useRef(null)
  const chartContainerRef = useRef(null)
  const [isSharing, setIsSharing] = useState(false)
  const [screenshotMode, setScreenshotMode] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState('3months')
  const [shareMessage, setShareMessage] = useState('')
  const [shareMessageType, setShareMessageType] = useState('success')
  
  // Accent color state - defaults to white (index 0)
  const [accentColorIndex, setAccentColorIndex] = useState(() => {
    try {
      const saved = localStorage.getItem('resourceCard.accentColor');
      return saved !== null ? parseInt(saved) : 0; // Always default to 0 (white)
    } catch {
      return 0; // Default to white
    }
  });
  
  // Activity chart data preloading (separate from GitHubUpdates)
  const [activityChartData, setActivityChartData] = useState({})
  // Smart loading state - only show loading when no cached data exists and we need to fetch
  const [isLoadingActivityChart, setIsLoadingActivityChart] = useState(false)
  const [activityChartError, setActivityChartError] = useState(null)
  const [lastActivityFetch, setLastActivityFetch] = useState(null)
  
  // Use centralized period options and caching
  const periodOptions = RESOURCE_CARD_PERIOD_OPTIONS
  
  // Preload activity chart data for all periods using fast server API
  const preloadActivityChartData = useCallback(async () => {
    if (!resource.social?.github || isLoadingActivityChart) {
      return
    }
    
    // Check centralized cache first
    const hasValidCache = periodOptions.every(period => 
      ChartDataCache.has('repository', period.key, resource.id)
    )
    
    if (hasValidCache) {
      logger.log(`⚡ All periods cached for ${resource.name}`)
      return
    }
    
    // Only show loading if we don't have any cached data at all
    const hasAnyCachedData = Object.keys(activityChartData).length > 0
    if (!hasAnyCachedData) {
      setIsLoadingActivityChart(true)
    }
    setActivityChartError(null)
    
    try {
      logger.log(`🚀 Preloading activity chart data for ${resource.name} (server API approach)...`)
      
      // Use the same fast server API as DevelopmentActivityWidget
      const periods = ['current', '4weeks', '3months', '52weeks', '3years']
      const preloadedData = {}
      let hasValidData = false
      
      // Fetch data for each period using the server API
      for (const period of periods) {
        try {
          // Map ResourceCard periods to server periods
          const serverPeriod = RESOURCE_CARD_PERIOD_MAPPING[period] || period
          
          // Build query parameters for specific resource
          const params = new URLSearchParams({
            resourceId: resource.id?.toString() || resource.name,
            resourceName: resource.name,
            period: serverPeriod
          })
          
          const response = await fetch(`/api/development-activity?${params}`)
          
          if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`)
          }
          
          const data = await response.json()
          
          if (data && data.weeklyData && Array.isArray(data.weeklyData)) {
            const periodData = {
              commitsPerWeekDetailed: data.weeklyData,
              commitsPerWeek: data.weeklyData[data.weeklyData.length - 1]?.count || 0,
              commitsPerMonth: [], // Not used in charts, keeping for compatibility
              repoInfo: data.repoInfo || null,
              dataSources: { database: true, github: false }, // Server API uses database-only
              historicalMaximums: data.historicalMaximums || {},
              historicalMetadata: data.historicalMetadata || {}
            }
            
            // Store in centralized cache
            ChartDataCache.set('repository', period, periodData, resource.id)
            preloadedData[period] = periodData
            hasValidData = true
            
            // Validate node count
            validateNodeCount(data.weeklyData, period, `ResourceCard-${resource.name}`)
            logger.debug(`📊 ${period} server API data for ${resource.name}:`, {
              weeklyDataLength: data.weeklyData?.length || 0,
              sampleWeeks: data.weeklyData?.slice(0, 3),
              dataSources: { database: true, github: false },
              actualPeriodRequested: period,
              historicalMaximums: data.historicalMaximums || 'none',
              dataQuality: data.historicalMetadata?.dataQuality || 'unknown'
            })
            logger.log(`✅ Loaded ${period} server API chart data: ${data.weeklyData?.length || 0} weeks`)
          } else {
            logger.warn(`Invalid server API response for ${period} data for ${resource.name}`)
            preloadedData[period] = { error: 'Invalid server response' }
          }
        } catch (error) {
          logger.warn(`Failed to load ${period} server API data for ${resource.name}:`, error)
          preloadedData[period] = { error: error.message || 'Failed to fetch data' }
        }
      }
      
      if (hasValidData) {
        setActivityChartData(preloadedData)
        setLastActivityFetch(Date.now())
        logger.debug('📦 Preloaded server API data structure:', preloadedData)
        logger.log(`📦 Activity chart data preloaded for ${resource.name} with ${Object.keys(preloadedData).length} periods`)
      } else {
        throw new Error('No valid chart data received for any period')
      }
      
    } catch (error) {
      logger.error(`❌ Failed to preload server API activity chart data for ${resource.name}:`, error)
      setActivityChartError(error.message)
    } finally {
      setIsLoadingActivityChart(false)
    }
  }, [resource, isLoadingActivityChart, lastActivityFetch, activityChartData])

  const IconComponent = categoryIconComponents[resource.category] || categoryIconComponents.default;

  // Placeholder logo component
  const PlaceholderLogo = ({ className = "" }) => (
    <div className={`flex items-center justify-center bg-gray-700 rounded-md ${className}`}>
      <Building2 size={16} className="text-gray-400" />
    </div>
  );

  const TabButton = ({ tabName, children, ...props }) => (
    <button
      onClick={(e) => {
        e.stopPropagation()
        setActiveTab(tabName)
        
        // Scroll to card when switching tabs to ensure it stays visible
        if (isExpanded) {
                  if (tabName === 'activity') {
          logger.debug(`🎯 Activity tab clicked for ${resource.name}, checking data...`)
          // Only preload if we don't have cached data
          const hasAnyCachedData = Object.keys(activityChartData).length > 0
          if (!hasAnyCachedData) {
            logger.debug(`Loading activity chart data for ${resource.name}...`)
            preloadActivityChartData()
          } else {
            logger.debug(`Using existing cached data for ${resource.name}`)
          }
            // Single scroll after complete expansion
            setTimeout(() => scrollToCard(), 600);
          } else {
            // For other tabs, scroll after a shorter delay since no data loading
            setTimeout(() => scrollToCard(), 300);
          }
        }
      }}
      className={`px-3 py-1 text-sm rounded-md transition-all duration-200  ${
        activeTab === tabName 
          ? 'bg-gray-700/50 border-gray-600 text-white shadow-inner' 
          : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-800/50 '
      }`}
      {...props}
    >
      {children}
    </button>
  );

  // Handle scroll detection
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolling(true)
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      
      // Set scrolling to false after scroll stops
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false)
      }, 150) // 150ms delay after scroll stops
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Handle clicks outside the card
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isExpanded && cardRef.current && !cardRef.current.contains(event.target)) {
        // Check if the click target is another resource card
        const clickedCard = event.target.closest('[data-resource-id]')
        if (clickedCard && clickedCard !== cardRef.current) {
          // Don't collapse if clicking on another card - let the new card handle its own expansion
          return
        }
        
        // Add small delay to prevent immediate collapse when opening new cards
        setTimeout(() => {
          setIsExpanded(false)
          // Ensure scroll freedom is restored when card is closed
          document.body.style.overflow = ''
          logger.debug('🔓 Resource card closed - scroll freedom restored')
          // Scroll back to the collapsed card position to maintain user orientation
          setTimeout(() => scrollToCard(), 200);
        }, 100)
      }
    }

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isExpanded])

  // Ensure scroll freedom when card is expanded or collapsed
  useEffect(() => {
    // Always ensure scroll is free for resource cards
    document.body.style.overflow = ''
  }, [isExpanded])

  // Handle external tab selection requests
  useEffect(() => {
    const handleTabRequest = (event) => {
      const { resourceId, resourceName, tabName } = event.detail;
      
      // Check if this event is for this specific resource card
      if ((resourceId && resource.id === resourceId) || 
          (resourceName && resource.name === resourceName)) {
        
        logger.debug(`🎯 External tab request for ${resource.name}: ${tabName}`);
        
        // Expand the card if not already expanded
        if (!isExpanded) {
          setIsExpanded(true);
        }
        
                  // Set the active tab after a brief delay to ensure expansion is complete
          setTimeout(() => {
            setActiveTab(tabName);
            logger.debug(`✅ Tab set to ${tabName} for ${resource.name}`);
            
            // Smooth scroll to the card when any tab is selected externally
            if (tabName === 'activity') {
              // Only preload if we don't have cached data
              const hasAnyCachedData = Object.keys(activityChartData).length > 0
              if (!hasAnyCachedData) {
                logger.debug(`Loading activity chart data for ${resource.name} (external request)...`)
                preloadActivityChartData()
              }
            // Single scroll after complete expansion
            setTimeout(() => scrollToCard(), 800);
          } else {
            // For other tabs, scroll after expansion is complete
            setTimeout(() => scrollToCard(), 500);
          }
        }, 200);
      }
    };

    document.addEventListener('resourceCardTabRequest', handleTabRequest);
    
    return () => {
      document.removeEventListener('resourceCardTabRequest', handleTabRequest);
    };
  }, [isExpanded, resource.id, resource.name]);

  // Listen for accent color changes from other components
  useEffect(() => {
    const handleAccentColorChange = (event) => {
      const { colorIndex } = event.detail;
      setAccentColorIndex(colorIndex);
    };
    
    document.addEventListener('accentColorChanged', handleAccentColorChange);
    return () => document.removeEventListener('accentColorChanged', handleAccentColorChange);
  }, []);

  const handleCardClick = () => {
    // Don't trigger expand if currently scrolling
    if (isScrolling) return
    // Only expand if not already expanded
    if (!isExpanded) {
      setIsExpanded(true)
      // Scroll to center the expanded card, especially important for activity tab
      if (activeTab === 'activity') {
        setTimeout(() => scrollToCard(), 400);
      }
    }
    // Do nothing if already expanded (let outside click handler handle collapse)
  }

  // Enhanced scroll function with better timing
  const scrollToCard = () => {
    if (cardRef.current) {
      // Use requestAnimationFrame to ensure DOM updates are complete
      requestAnimationFrame(() => {
        // Get the card's position and size
        const rect = cardRef.current.getBoundingClientRect()
        const cardHeight = rect.height
        const cardTop = rect.top
        const viewportHeight = window.innerHeight
        
        // Calculate the scroll position to center the card
        // Add offset for fixed headers/navigation (adjust as needed)
        const headerOffset = 0 
        
        // Center the card at 50% of the viewport
        const targetScrollTop = window.pageYOffset + cardTop - (viewportHeight / 2) + (cardHeight / 2) - headerOffset
        
        // Smooth scroll to the calculated position
        window.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        })
      })
    }
  }

  const showShareSuccess = (message) => {
    setShareMessage(message);
    setShareMessageType('success');
    setTimeout(() => {
      setShareMessage('');
      setScreenshotMode(false);
      setIsSharing(false);
    }, 10000);
  };

  const showShareError = (message) => {
    setShareMessage(message);
    setShareMessageType('error');
    setTimeout(() => {
      setShareMessage('');
      setScreenshotMode(false);
      setIsSharing(false);
    }, 4000);
  };

  // Share logic for activity chart
  const handleShareActivityChart = async () => {
    if (!cardRef.current) return;
    setIsSharing(true);
    setScreenshotMode(true);
    
    try {
      // Wait for screenshot mode to apply
      await new Promise(resolve => setTimeout(resolve, 200));

      // Capture the card with html-to-image
      const dataUrl = await htmlToImage.toPng(cardRef.current, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: 'transparent',
        skipFonts: false
      });

      // Load to get dimensions
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });

      // Prepare branding logo
      const logoImg = new Image();
      logoImg.src = brandingLogo;
      await new Promise((resolve, reject) => {
        logoImg.onload = resolve;
        logoImg.onerror = reject;
      });

      // Create final canvas with padding and branding space
      const paddingX = 35;
      const paddingTop = 10;
      const paddingBottom = 10;
      const finalWidth = img.width + (paddingX * 2);
      
      // Calculate logo dimensions
      const logoAspectRatio = logoImg.width / logoImg.height;
      const logoTargetWidth = Math.min(420, finalWidth * 0.28);
      const computedLogoHeight = Math.max(28, Math.round(logoTargetWidth / logoAspectRatio));
      const brandingPadding = computedLogoHeight + 20;
      const finalHeight = img.height + paddingTop + paddingBottom + brandingPadding;
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = finalWidth;
      canvas.height = finalHeight;

      // Recreate a darker page background (matching DevelopmentActivityWidget)
      // Base gradient - darker
      const gradient = ctx.createLinearGradient(0, 0, finalWidth, finalHeight);
      gradient.addColorStop(0, '#1E1E1E');
      gradient.addColorStop(0.5, '#0F0F0F');
      gradient.addColorStop(1, '#1A1A1A');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
      
      // Add subtle color overlays for richer blacks
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

      // Draw captured image
      ctx.drawImage(img, paddingX, paddingTop);

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
      
      // Generate tweet text
      const tweetText = `Cardano Project Activity\n\n${resource.name} - ${resource.category}\n#Cardano #Development #OpenSource\n\nSee more at: https://adadev.io`;
      
      // Use the enhanced share function
      const result = await shareToX(blob, tweetText);
      
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
      setIsSharing(false);
    }
  }

  // Current accent color
  const currentAccentColor = accentColors[accentColorIndex];

  // Handle accent color change
  const handleAccentColorChange = () => {
    const newIndex = (accentColorIndex + 1) % accentColors.length;
    setAccentColorIndex(newIndex);
    try {
      localStorage.setItem('resourceCard.accentColor', newIndex.toString());
      localStorage.setItem('developmentActivityWidget.accentColor', newIndex.toString());
    } catch {}
    
    // Dispatch global event to sync other components
    const event = new CustomEvent('accentColorChanged', {
      detail: { colorIndex: newIndex, source: 'resourceCard' }
    });
    document.dispatchEvent(event);
  };

  return (
    <>
      {isSharing && (
        <Portal>
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[10000] flex flex-col items-center justify-center text-white">
            <ClipboardCheck size={48} className="text-[#C8F560]" />
            <p className="mt-4 text-lg font-medium text-[#C8F560]">Copied to clipboard</p>
          </div>
        </Portal>
      )}
      <div 
        ref={cardRef}
        onClick={handleCardClick}
        data-resource-id={resource.id}
        data-resource-name={resource.name}
        className={`relative bg-card-bg/50 backdrop-blur-md border border-gray-800 rounded-xl p-4 transition-all duration-300 ease-out transform-gpu shadow-lg hover:shadow-2xl cursor-pointer ${
        isExpanded && (activeTab === 'activity' || activeTab === 'video') ? (screenshotMode ? '' : 'col-span-2') : ''
      }`}
      style={{
        height: isExpanded ? 'auto' : '6rem',
        minHeight: isExpanded && activeTab === 'activity' ? (window.innerWidth < 1024 ? (screenshotMode ? '31rem' : '35rem') : (screenshotMode ? '47rem' : '51rem')) : 
                   isExpanded && activeTab === 'video' ? '35rem' : 
                   isExpanded ? (window.innerWidth < 1024 ? (screenshotMode ? '15.5rem' : '18rem') : (screenshotMode ? '19.5rem' : '22rem')) : undefined,
        transform: isExpanded ? (screenshotMode ? 'scale(1)' : (window.innerWidth < 1024 ? 'scale(1)' : 'scale(1.03)')) : 'scale(1)',
        marginBottom: isExpanded && (activeTab === 'activity' || activeTab === 'video') ? '2rem' : undefined,
        marginTop: isExpanded && (activeTab === 'activity' || activeTab === 'video') ? '2rem' : undefined,
        ...(screenshotMode && isExpanded && (activeTab === 'activity' || activeTab === 'video') ? {
          width: '800px',
          position: 'relative',
          zIndex: 'auto'
        } : {})
      }}
    >
      {/* Collapsed View */}
      <div className={`transition-opacity duration-200 ${isExpanded ? 'opacity-0' : 'opacity-100'}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-4">
            <IconComponent size={28} className="text-gray-400" />
            <div className="flex-1">
              <h3 className="text-white font-medium text-base mb-1">{resource.name}</h3>
              <p className="text-gray-400 text-sm line-clamp-2">{resource.description}</p>
            </div>
          </div>
          {resource.social?.github && (
            <WeeklyCommitCount resource={resource} />
          )}
        </div>
      </div>

      {/* Expanded View */}
      <div className={`absolute top-0 left-0 w-full p-4 transition-all duration-300 ease-out ${
        isExpanded ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
      }`} style={{ 
        minHeight: activeTab === 'activity' ? (window.innerWidth < 1024 ? (screenshotMode ? '30rem' : '34rem') : (screenshotMode ? '46rem' : '50rem')) : 
                   activeTab === 'video' ? '34rem' : 
                   (window.innerWidth < 1024 ? (screenshotMode ? '15.5rem' : '18rem') : (screenshotMode ? '19.5rem' : '22rem')),
        overflow: 'visible'
      }}>
        <div className="flex flex-col min-h-full">
          {/* Header */}
          <div className={`flex items-center justify-between ${screenshotMode ? 'mb-6' : 'mb-3'}`}>
            <div className="flex items-baseline space-x-3">
              <IconComponent size={20} className={`text-red-400 ${screenshotMode ? 'hidden' : ''}`} />
              <h3 className={`text-white font-medium whitespace-nowrap ${screenshotMode ? 'text-2xl' : 'text-base'}`}>{resource.name}</h3>
              {screenshotMode && activeTab === 'activity' && (
                <span className="text-lg text-gray-400 ml-4 whitespace-nowrap">Weekly Activity</span>
              )}
            </div>
            {/* Logo in expanded view */}
            {resource.website ? (
              <a 
                href={resource.website} 
                target="_blank" 
                rel="noopener noreferrer"
                className="hover:opacity-80 transition-opacity duration-200"
                aria-label={`Visit ${resource.name} website`}
                onClick={(e) => e.stopPropagation()}
              >
                {resource.logo ? (
                  <img 
                    src={resource.logo} 
                    alt={`${resource.name} logo`} 
                    className={`h-10 object-contain ${screenshotMode ? 'w-auto max-w-none' : 'w-28'}`} 
                  />
                ) : (
                  <PlaceholderLogo className={`h-10 ${screenshotMode ? 'w-auto max-w-none' : 'w-24'}`} />
                )}
              </a>
            ) : (
              resource.logo ? (
                <img 
                  src={resource.logo} 
                  alt={`${resource.name} logo`} 
                  className={`h-10 object-contain ${screenshotMode ? 'w-auto max-w-none' : 'w-24'}`} 
                />
              ) : (
                <PlaceholderLogo className={`h-10 ${screenshotMode ? 'w-auto max-w-none' : 'w-24'}`} />
              )
            )}
          </div>

          {/* Tabs */}
          <div className={`flex space-x-1 mb-3 border-b border-gray-700/50 overflow-x-auto ${screenshotMode ? 'hidden' : ''}`}>
            <TabButton tabName="about">About</TabButton>
            <TabButton tabName="solutions">Solutions</TabButton>
            <TabButton tabName="links">Links</TabButton>
            {resource.video && (
              <TabButton tabName="video">Video</TabButton>
            )}
            {resource.social?.github && (
              <TabButton tabName="updates">Updates</TabButton>
            )}
            {resource.social?.github && (
              <TabButton tabName="activity" data-tab="activity">Activity</TabButton>
            )}
          </div>

          {/* Tab Content */}
          <div className={`flex-grow overflow-hidden text-sm text-gray-300 pr-2 ${activeTab === 'updates' || activeTab === 'activity' ? 'overflow-y-auto' : ''}`}>
            {activeTab === 'about' && <p>{resource.fullDescription || resource.description}</p>}
            {activeTab === 'solutions' && (
              <div className="flex flex-wrap gap-2">
                {resource.keySolutions.map((solution) => (
                  <span key={solution} className="border border-gray-400/25 bg-gray-400/10 backdrop-blur-sm text-gray-300 px-3 py-1.5 rounded-full text-sm font-medium hover:border-gray-500 transition-all duration-200">
                    {solution}
                  </span>
                ))}
              </div>
            )}
            {activeTab === 'links' && (
              <div className="flex flex-col space-y-2" onClick={(e) => e.stopPropagation()}>
                {resource.website && (
                   <a href={resource.website} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-2 hover:text-gray-300">
                     <ExternalLink size={14} /> <span>Website</span>
                   </a>
                )}
                {resource.docs && (
                   <a href={resource.docs} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-2 hover:text-gray-300">
                     <BookOpen size={14} /> <span>Documentation</span>
                   </a>
                )}
                {resource.social && Object.entries(resource.social).map(([platform, url]) => (
                  <a key={platform} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-2 hover:text-gray-300 capitalize">
                    {getSocialIcon(platform)} <span>{platform}</span>
                  </a>
                ))}
              </div>
            )}
                        {activeTab === 'video' && resource.video && (
              <div className="pb-8">
                <div className="relative mx-auto" style={{ width: '720px', height: '405px' /* 720p 16:9 ratio */ }}>
                  <iframe
                    src={getYouTubeEmbedUrl(resource.video)}
                    title={`${resource.name} video`}
                    className="absolute top-0 left-0 w-full h-full rounded border border-gray-700"
                    style={{ border: 0 }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              </div>
            )}
            {activeTab === 'updates' && resource.social?.github && (
              <GitHubUpdates resource={resource} />
            )}
            {activeTab === 'activity' && resource.social?.github && (
              <div className={`mb-4 flex items-center justify-between ${screenshotMode ? 'hidden' : ''}`}>
                <div className="flex items-center space-x-2">
                  <TrendingUp size={16} className="text-white" />
                  <h4 className="text-white font-medium text-sm">
                    Weekly Activity
                  </h4>
                </div>
                <div className="flex items-center space-x-3">
                  <PeriodDropdown
                    value={selectedPeriod}
                    onChange={(newPeriod) => {
                      logger.log(`⚡ Chart period change for ${resource.name}: ${selectedPeriod} → ${newPeriod}`)
                      console.log('Available preloaded data:', Object.keys(activityChartData))
                      console.log('Preloaded data for new period:', activityChartData[newPeriod])
                      console.log('Detailed comparison:', {
                        '4weeks': activityChartData['4weeks']?.commitsPerWeekDetailed?.length,
                        '3months': activityChartData['3months']?.commitsPerWeekDetailed?.length,
                        '52weeks': activityChartData['52weeks']?.commitsPerWeekDetailed?.length
                      })
                      setSelectedPeriod(newPeriod)
                      
                      // Check centralized cache for missing period data
                      if (!ChartDataCache.has('resource', newPeriod, resource.id) && resource.social?.github) {
                        logger.log(`🔄 Loading missing chart period data: ${newPeriod}`)
                        // Only show loading if we have no data for any period
                        const hasAnyData = Object.keys(activityChartData).length > 0
                        if (!hasAnyData) {
                          setIsLoadingActivityChart(true)
                        }
                        preloadActivityChartData()
                      }
                    }}
                    options={periodOptions}
                    placeholder="Select period..."
                    className={`w-44 ${screenshotMode ? 'opacity-0 pointer-events-none' : ''}`}
                    screenshotMode={screenshotMode}
                  />
                  {!screenshotMode && (
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={handleShareActivityChart}
                        className={`share-button text-white hover:text-gray-300 bg-gray-800/30 backdrop-blur-sm border border-gray-600/50 rounded-md px-3 py-1.5 transition-all duration-200 text-sm touch-target hover:border-gray-500 hover:bg-white/10 ${isSharing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Share Activity Chart"
                        disabled={isSharing}
                      >
                        {isSharing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Share2 className="w-4 h-4" />
                        )}
                      </button>
                      {/* Accent Color Picker Dot */}
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
                      {shareMessage && (
                        <div className={`text-sm font-medium transition-all duration-300 max-w-64 ${
                          shareMessageType === 'success' 
                            ? 'bg-gradient-to-r from-[#C8F560] to-[#C8F560] bg-clip-text text-transparent' 
                            : 'bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-transparent'
                        }`} dangerouslySetInnerHTML={{ __html: shareMessage }}>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeTab === 'activity' && resource.social?.github && (
              <div ref={chartContainerRef} style={{ minHeight: '400px' }}>
                {isLoadingActivityChart ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                    <span className="ml-2 text-gray-400/30 text-sm">Loading chart data...</span>
                  </div>
                ) : activityChartError ? (
                  <div className="text-center py-8">
                    <div className="text-red-400 text-sm mb-2">Failed to load chart data</div>
                    <div className="text-gray-400 text-xs mb-4">{activityChartError}</div>
                    <button 
                      onClick={preloadActivityChartData}
                      className="px-3 py-1 bg-white hover:bg-gray-200 text-black rounded text-xs transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <WeeklyActivityChart 
                    resource={resource} 
                    showThreeYearOption={false} 
                    hidePeriodSwitches={true} 
                    hideActivityLevelInfo={true}
                    selectedPeriod={selectedPeriod}
                    onPeriodChange={setSelectedPeriod}
                    preloadedData={activityChartData[selectedPeriod]}
                    accentColor={currentAccentColor}
                    screenshotMode={screenshotMode}
                  />
                )}
              </div>
            )}
          </div>
          
          {/* adadev.io branding for screenshots */}
          {/* Branding overlay removed to avoid duplication; branding is added to final canvas */}
        </div>
      </div>
    </div>
    </>
  )
}

export default ResourceCard 