import React, { useState, useEffect, useCallback } from 'react'
import { 
  GitCommit, 
  Tag, 
  Star, 
  GitFork, 
  Calendar,
  ExternalLink,
  AlertCircle,
  Github,
  ChevronRight,
  Clock
} from 'lucide-react'
import { formatRelativeTime, checkRateLimitStatus, fetchGlobalGitHubUpdates } from '../services/github'
import { cardanoResources } from '../data/resources'
import logger from '../utils/logger-frontend'
import Portal from './Portal'

const GitHubUpdatesWidget = ({ isExpanded, onExpand, onCollapse, isAnyExpanded }) => {
  const [githubData, setGithubData] = useState([])
  const [isLoading, setIsLoading] = useState(false) // Start with false - will be set to true only when actually loading
  const [activeTab, setActiveTab] = useState('releases')
  const [collapseTimeout, setCollapseTimeout] = useState(null)
  const [rateLimitExhausted, setRateLimitExhausted] = useState(false)
  const [rateLimitResetTime, setRateLimitResetTime] = useState(null)
  const [lastFetchTime, setLastFetchTime] = useState(null)
  
  // Content-aware cache settings - much more efficient for GitHub data patterns
  const CONTENT_CACHE_KEY = 'github_content_cache_v2'
  const ACTIVE_HOURS_REFRESH = 4 * 60 * 60 * 1000 // 4 hours during active hours (9-18 UTC)
  const PASSIVE_HOURS_REFRESH = 12 * 60 * 60 * 1000 // 12 hours during passive hours
  const MAX_CACHE_AGE = 48 * 60 * 60 * 1000 // 48 hours max
  
  // Helper to determine if we're in active development hours (9-18 UTC)
  const isActiveHours = () => {
    const utcHour = new Date().getUTCHours()
    return utcHour >= 9 && utcHour <= 18
  }
  

  // Load cached data from localStorage with content-aware logic
  useEffect(() => {
    const loadContentCache = () => {
      try {
        const cached = localStorage.getItem(CONTENT_CACHE_KEY)
        if (cached) {
          const contentCache = JSON.parse(cached)
          const now = Date.now()
          
          // Build current view from cache
          const threeDaysAgo = new Date()
          threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
          
          const cachedResults = []
          let needsRefresh = false
          
          Object.entries(contentCache).forEach(([repoPath, repoData]) => {
            // Check if cache is too old
            const cacheAge = now - repoData.lastFetched
            const refreshThreshold = isActiveHours() ? ACTIVE_HOURS_REFRESH : PASSIVE_HOURS_REFRESH
            
            if (cacheAge > MAX_CACHE_AGE) {
              logger.log(`🗑️ Cache expired for ${repoPath} (${Math.round(cacheAge / 1000 / 60 / 60)}h old)`)
              needsRefresh = true
              return
            }
            
            if (cacheAge > refreshThreshold) {
              logger.log(`⏰ Cache refresh needed for ${repoPath} (${Math.round(cacheAge / 1000 / 60)}min old)`)
              needsRefresh = true
            }
            
            // Filter to recent activity (different windows for commits vs releases)
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
            const thirtyDaysAgo = new Date()
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
            
            const recentCommits = (repoData.commits || []).filter(commit => {
              if (!commit.date) return false
              const commitDate = new Date(commit.date)
              return commitDate >= sevenDaysAgo
            })
            
            const recentReleases = (repoData.releases || []).filter(release => {
              if (!release.published_at) return false
              const releaseDate = new Date(release.published_at)
              return releaseDate >= thirtyDaysAgo
            })
            
            // Only include if has recent activity
            if (recentCommits.length > 0 || recentReleases.length > 0) {
              cachedResults.push({
                resource: repoData.resource,
                commits: recentCommits,
                releases: recentReleases,
                commitsPerWeek: repoData.commitsPerWeek || 0,
                weeklyData: repoData.weeklyData || [],
                repoInfo: repoData.repoInfo,
                repoPath: repoPath
              })
            }
          })
          
          if (cachedResults.length > 0) {
            // Sort by most recent activity
            cachedResults.sort((a, b) => {
              const aLatestCommit = a.commits.length > 0 ? new Date(a.commits[0].date).getTime() : 0
              const aLatestRelease = a.releases.length > 0 ? new Date(a.releases[0].published_at).getTime() : 0
              const aLatest = Math.max(aLatestCommit, aLatestRelease)
              
              const bLatestCommit = b.commits.length > 0 ? new Date(b.commits[0].date).getTime() : 0
              const bLatestRelease = b.releases.length > 0 ? new Date(b.releases[0].published_at).getTime() : 0
              const bLatest = Math.max(bLatestCommit, bLatestRelease)
              
              return bLatest - aLatest
            })
            
            logger.log(`📦 Loaded ${cachedResults.length} repositories from content cache`)
            logger.log(`🔄 Refresh needed: ${needsRefresh ? 'Yes' : 'No'}`)
            setGithubData(cachedResults)
            setLastFetchTime(now)
            
            // If refresh needed, trigger background update
            if (needsRefresh && isExpanded) {
              logger.log('🔄 Triggering background refresh...')
              setTimeout(() => loadGitHubData(true), 1000)
            }
            
            return true
          }
        }
      } catch (error) {
        logger.error('❌ Error loading content cache:', error)
        localStorage.removeItem(CONTENT_CACHE_KEY)
      }
      return false
    }
    
    // Load cached data immediately if available
    loadContentCache()
  }, [])
  


  // Handle click outside to collapse widget
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isExpanded && !event.target.closest('[data-widget="github-updates"]')) {
        if (collapseTimeout) {
          clearTimeout(collapseTimeout)
          setCollapseTimeout(null)
        }
        onCollapse()
      }
    }

    // Only add the event listener when the widget is expanded
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isExpanded, collapseTimeout, onCollapse])

  const loadGitHubData = useCallback(async (forceRefresh = false) => {
    try {
      console.log('🚀 WIDGET DEBUG: Starting loadGitHubData function')
      logger.log('🚀 Widget: Starting loadGitHubData function')
      
      // Check if we have recent data and don't need to refresh
      console.log('🔍 WIDGET DEBUG: Checking cache...', {
        forceRefresh,
        lastFetchTime,
        githubDataLength: githubData.length
      })
      
      if (!forceRefresh && lastFetchTime && githubData.length > 0) {
        const timeSinceLastFetch = Date.now() - lastFetchTime
        const refreshThreshold = isActiveHours() ? ACTIVE_HOURS_REFRESH : PASSIVE_HOURS_REFRESH
        console.log('🔍 WIDGET DEBUG: Cache check details:', {
          timeSinceLastFetch,
          refreshThreshold,
          shouldUseCache: timeSinceLastFetch < refreshThreshold
        })
        if (timeSinceLastFetch < refreshThreshold) {
          console.log('⚡ WIDGET DEBUG: Using cached data, returning early')
          console.log('📊 WIDGET DEBUG: Current cached data:', githubData.map(d => ({
            resource: d.resource?.name,
            releases: d.releases?.length || 0,
            commits: d.commits?.length || 0
          })))
          logger.log(`⚡ Using cached data (${Math.round(timeSinceLastFetch / 1000)}s old, refresh threshold: ${Math.round(refreshThreshold / 1000)}s)`)
          setIsLoading(false)
          return
        }
        console.log('🔄 WIDGET DEBUG: Cache expired, continuing to fetch')
        logger.log(`🔄 Cache expired (${Math.round(timeSinceLastFetch / 1000)}s old), fetching fresh data`)
      } else {
        console.log('🆕 WIDGET DEBUG: No cache or forcing refresh, continuing to fetch')
      }
      
      setIsLoading(true) // Show loading state when fetching fresh data
      setRateLimitExhausted(false)
      setRateLimitResetTime(null)
      
      // Flatten cardanoResources object into an array
      logger.log('🔍 Widget: cardanoResources structure:', typeof cardanoResources, Object.keys(cardanoResources))
      const allResources = Object.values(cardanoResources).flat()
      logger.log(`📊 Widget: Flattened ${allResources.length} resources from cardanoResources`)
      
      // Filter to only resources with GitHub URLs and valid format
      const resourcesWithGitHub = allResources.filter(r => 
        r.social?.github && 
        r.social.github !== 'n/a' && 
        r.social.github.includes('github.com')
      )
      logger.log(`🔍 Found ${resourcesWithGitHub.length} resources with GitHub URLs`)
      logger.log('📋 All GitHub resources:', resourcesWithGitHub.map(r => r.name).join(', '))
      
      // Process ALL resources - no arbitrary limits
      logger.log(`🔄 Widget: Processing ALL ${resourcesWithGitHub.length} resources for comprehensive coverage`)
      
      // Create a timeout promise (extended for more resources)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout after 45 seconds')), 45000)
      })
      
      // Race between the actual request and timeout
      console.log(`🌐 WIDGET DEBUG: Fetching GitHub data for ${resourcesWithGitHub.length} resources...`)
      logger.log(`🌐 Widget: Fetching GitHub data for ${resourcesWithGitHub.length} resources...`)
      let allData
      try {
        allData = await Promise.race([
          fetchGlobalGitHubUpdates(resourcesWithGitHub),
          timeoutPromise
        ])
        
        console.log('✅ WIDGET DEBUG: fetchGlobalGitHubUpdates completed, received:', typeof allData, Array.isArray(allData) ? `array with ${allData.length} items` : allData)
        logger.log('✅ Widget: fetchGlobalGitHubUpdates completed, received:', typeof allData, Array.isArray(allData) ? `array with ${allData.length} items` : allData)
      } catch (fetchError) {
        console.error('❌ WIDGET DEBUG: fetchGlobalGitHubUpdates failed:', fetchError)
        throw fetchError
      }
      
      // Validate that we received an array
      if (!Array.isArray(allData)) {
        logger.error('❌ Expected array from fetchGlobalGitHubUpdates, got:', typeof allData, allData)
        setGithubData([])
        return
      }
      
      logger.log(`📦 Received ${allData.length} resources from GitHub API`)
      
      // Filter and prepare data for showing latest activity from last 3 days
      logger.log('🔍 Widget: Processing data for recent activity...')
      
      // Calculate cutoff dates - different windows for releases vs commits
      const thirtyDaysAgo = new Date() // For releases - show more history
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      
      const sevenDaysAgo = new Date() // For commits - show recent activity
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      
      logger.log(`📅 Looking for releases since: ${thirtyDaysAgo.toISOString()}, commits since: ${sevenDaysAgo.toISOString()}`)
      
      // Create a map to track unique repositories and avoid duplicates
      const repoUrlMap = new Map()
      
      // Process each resource to extract recent commits and releases with duplicate detection
      const processedData = allData
        .map(data => {
          if (!data || !data.resource) return null
          
          // Extract repository URL for duplicate detection
          const githubUrl = data.resource.social?.github
          if (!githubUrl) return null
          
          // Normalize GitHub URL to detect duplicates (org vs repo)
          const normalizedUrl = githubUrl.toLowerCase().replace(/\/$/, '')
          const repoPath = normalizedUrl.split('github.com/')[1]
          
          if (!repoPath) return null
          
          // Filter commits from last 7 days
          const recentCommits = (data.commits || []).filter(commit => {
            if (!commit.date) return false
            const commitDate = new Date(commit.date)
            return commitDate >= sevenDaysAgo
          })
          
          // Filter releases from last 30 days (longer window for releases)
          const recentReleases = (data.releases || []).filter(release => {
            if (!release.published_at) return false
            const releaseDate = new Date(release.published_at)
            return releaseDate >= thirtyDaysAgo
          })
          
          // Only include resources with recent activity
          if (recentCommits.length === 0 && recentReleases.length === 0) {
            return null
          }
          
          logger.log(`📈 ${data.resource.name}: ${recentCommits.length} recent commits, ${recentReleases.length} recent releases`)
          
          const processedItem = {
            resource: data.resource,
            commits: recentCommits,
            releases: recentReleases,
            commitsPerWeek: data.commitsPerWeek || 0,
            weeklyData: data.weeklyData || [],
            repoInfo: data.repoInfo,
            repoPath: repoPath
          }
          
          // Check for duplicates and merge if necessary
          if (repoUrlMap.has(repoPath)) {
            const existing = repoUrlMap.get(repoPath)
            // Merge commits and releases, removing duplicates by date/id
            const mergedCommits = [...existing.commits, ...recentCommits]
              .filter((commit, index, arr) => 
                arr.findIndex(c => c.date === commit.date && c.message === commit.message) === index
              )
            const mergedReleases = [...existing.releases, ...recentReleases]
              .filter((release, index, arr) => 
                arr.findIndex(r => r.published_at === release.published_at && r.name === release.name) === index
              )
            
            existing.commits = mergedCommits
            existing.releases = mergedReleases
            logger.log(`🔗 Merged duplicate: ${data.resource.name} with ${existing.resource.name}`)
            return null
          } else {
            repoUrlMap.set(repoPath, processedItem)
            return processedItem
          }
        })
        .filter(data => data !== null)
        
      // Convert map back to array and sort by most recent activity
      const recentActivityData = Array.from(repoUrlMap.values())
        .sort((a, b) => {
          // Sort by most recent activity (commits or releases)
          const aLatestCommit = a.commits.length > 0 ? new Date(a.commits[0].date).getTime() : 0
          const aLatestRelease = a.releases.length > 0 ? new Date(a.releases[0].published_at).getTime() : 0
          const aLatest = Math.max(aLatestCommit, aLatestRelease)
          
          const bLatestCommit = b.commits.length > 0 ? new Date(b.commits[0].date).getTime() : 0
          const bLatestRelease = b.releases.length > 0 ? new Date(b.releases[0].published_at).getTime() : 0
          const bLatest = Math.max(bLatestCommit, bLatestRelease)
          
          return bLatest - aLatest
        })

      logger.log(`📊 Widget: Found ${recentActivityData.length} unique repositories with recent activity (commits: 7 days, releases: 30 days)`)
      
      // Debug: Show which resources have releases
      const resourcesWithReleases = recentActivityData.filter(d => d.releases && d.releases.length > 0)
      const resourcesWithCommits = recentActivityData.filter(d => d.commits && d.commits.length > 0)
      logger.log(`🏷️ Resources with releases (${resourcesWithReleases.length}):`, resourcesWithReleases.map(d => `${d.resource.name}(${d.releases.length})`).join(', '))
      logger.log(`💻 Resources with commits (${resourcesWithCommits.length}):`, resourcesWithCommits.map(d => `${d.resource.name}(${d.commits.length})`).join(', '))
      logger.log('📋 Recent activity:', recentActivityData.map(d => ({ 
        name: d.resource?.name, 
        commits: d.commits?.length, 
        releases: d.releases?.length,
        latestCommit: d.commits?.[0]?.date,
        latestRelease: d.releases?.[0]?.published_at
      })))
      
      // Save to localStorage cache in the expected format
      try {
        const contentCache = {}
        const now = Date.now()
        
        recentActivityData.forEach(data => {
          if (data.repoPath) {
            contentCache[data.repoPath] = {
              resource: data.resource,
              commits: data.commits,
              releases: data.releases,
              commitsPerWeek: data.commitsPerWeek,
              weeklyData: data.weeklyData,
              repoInfo: data.repoInfo,
              lastFetched: now
            }
          }
        })
        
        localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(contentCache))
        logger.log(`💾 Cached ${Object.keys(contentCache).length} repositories to content cache`)
      } catch (error) {
        logger.warn('⚠️ Failed to cache data to localStorage:', error)
      }
      
      setGithubData(recentActivityData)
      setLastFetchTime(Date.now()) // Update cache timestamp
    } catch (err) {
      logger.error('❌ Widget: GitHub data loading error:', err)
      logger.error('❌ Widget: Error stack:', err.stack)
      
      // Check if it's a rate limit error or timeout
      if (err.message && err.message.includes('rate limit')) {
        setRateLimitExhausted(true)
        // Try to extract reset time from error or set a default
        const resetTime = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now as fallback
        setRateLimitResetTime(resetTime)
      } else if (err.message && err.message.includes('timeout')) {
        logger.warn('⏱️ Request timeout - server may be overloaded')
      }
      
      setGithubData([])
    } finally {
      logger.log('🏁 Widget: Setting isLoading to false')
      setIsLoading(false)
    }
  }, [githubData.length, lastFetchTime, ACTIVE_HOURS_REFRESH, PASSIVE_HOURS_REFRESH])

  useEffect(() => {
    // Add a small delay to ensure resource cards have loaded first
    console.log('🎯 WIDGET DEBUG: useEffect triggered, isExpanded:', isExpanded)
    const timer = setTimeout(() => {
      if (isExpanded) {
        console.log('🔄 WIDGET DEBUG: Starting data load')
        logger.log(`🔄 Widget: Starting data load`)
        loadGitHubData() // Will use cache if available
      }
    }, 1000)
    
    return () => clearTimeout(timer)
  }, [isExpanded, loadGitHubData])
  
  // Auto-refresh every 5 minutes when widget is expanded
  useEffect(() => {
    if (!isExpanded) return
    
    const refreshInterval = setInterval(() => {
      logger.log('🔄 Auto-refreshing widget data (content-aware)')
      loadGitHubData(true) // Force refresh
    }, ACTIVE_HOURS_REFRESH) // Use content-aware refresh timing
    
    return () => clearInterval(refreshInterval)
  }, [isExpanded])

  // Get total update count
  const totalUpdates = githubData.reduce((total, data) => {
    const releasesCount = (data.releases || []).length
    const commitsCount = (data.commits || []).length
    return total + releasesCount + commitsCount
  }, 0)

  // Aggregate all recent updates from all resources, sort by date, and apply appropriate limits
  const allUpdates = githubData.flatMap(data => {
    const updates = []
    
    // Safety check: ensure data has the expected structure
    if (!data || !data.resource) {
      logger.warn('⚠️ Widget: Skipping invalid data item:', data)
      return []
    }
    
    if (activeTab === 'releases') {
      // Safety check: ensure releases is an array before calling forEach
      const releases = Array.isArray(data.releases) ? data.releases : []
      releases.forEach(release => {
        // Additional safety check for release object
        if (release && release.published_at) {
          updates.push({
            type: 'release',
            resource: data.resource,
            data: release,
            timestamp: new Date(release.published_at).getTime()
          })
        }
      })
    } else {
      // Safety check: ensure commits is an array before calling forEach
      const commits = Array.isArray(data.commits) ? data.commits : []
      commits.forEach(commit => {
        // Additional safety check for commit object
        if (commit && commit.date) {
          updates.push({
            type: 'commit',
            resource: data.resource,
            data: commit,
            timestamp: new Date(commit.date).getTime()
          })
        }
      })
    }
    
    return updates
  }).sort((a, b) => b.timestamp - a.timestamp).slice(0, activeTab === 'releases' ? 30 : 90) // Show 30 releases or 90 commits

    return (
    <>
      {!isExpanded ? (
      <div
          className="relative z-50 w-16 h-16 github-widget"
        onClick={onExpand}
      >
        <div className="flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl">
          <Github size={24} className="text-purple-400" />
        </div>
      </div>
      ) : (
    <Portal>
          <div className="fixed z-[9999] p-4 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] max-w-[95vw] bg-card-bg/50 border border-gray-800 rounded-xl shadow-lg transition-all duration-700 ease-out opacity-100 scale-100" data-widget="github-updates">
        <button
          className="absolute top-4 right-4 z-50 text-gray-400 hover:text-white transition-all duration-200"
          onClick={onCollapse}
          aria-label="Close"
        >
          <span style={{fontSize: 20, fontWeight: 'bold', lineHeight: 1}}>×</span>
        </button>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Github size={20} className="text-purple-400" />
              <h3 className="text-white font-semibold text-sm">Latest Updates</h3>
            </div>
          </div>
              
              {/* Rate Limit Warning */}
              {rateLimitExhausted && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 mb-3">
                  <div className="flex items-center space-x-2">
                    <Clock size={12} className="text-yellow-400" />
                    <span className="text-yellow-400 text-xs">
                      Rate limit exhausted
                      {rateLimitResetTime && (
                        <span className="text-gray-400 ml-1">
                          (resets in {formatRelativeTime(rateLimitResetTime.toISOString())})
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}
              
              {/* Tabs */}
              <div className="flex bg-gray-800/30 rounded-md p-0.5 border border-gray-700/50 mb-3">
                <button
                  onClick={() => setActiveTab('releases')}
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-all duration-200 border ${
                    activeTab === 'releases' 
                      ? 'border-white/50 text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]' 
                      : 'border-gray-600/50 text-gray-400 hover:border-white hover:text-gray-300 hover:bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                  }`}
                >
                  <Tag size={12} />
                  <span>Releases</span>
                </button>
                <button
                  onClick={() => setActiveTab('commits')}
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-all duration-200 border ${
                    activeTab === 'commits' 
                      ? 'border-white/50 text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]' 
                      : 'border-gray-600/50 text-gray-400 hover:border-white hover:text-gray-300 hover:bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                  }`}
                >
                  <GitCommit size={12} />
                  <span>Commits</span>
                </button>
              </div>
              {/* Content */}
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {isLoading ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto mb-2"></div>
                    <p className="text-gray-400/30 text-xs">Loading updates...</p>
                  </div>
                ) : (
                  <>
                    {allUpdates.map((update, index) => (
                      <div key={`${update.resource.id || update.resource.name || index}-${update.type}-${index}`} 
                           className="bg-gray-800/50 rounded-lg p-2 transition-all duration-200 hover:bg-gray-700/50">
                        <div className="flex items-center gap-2 min-w-0">
                          <a
                            href={update.resource.social?.github || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-xs text-white hover:text-gray-300 truncate max-w-[100px] flex-shrink-0 transition-colors"
                            title={`View ${update.resource.name} on GitHub`}
                          >
                            {update.resource.name}
                          </a>
                          {update.type === 'release' ? (
                            <Tag size={12} className="text-purple-400 flex-shrink-0" />
                          ) : (
                            <GitCommit size={12} className="text-purple-400 flex-shrink-0" />
                          )}
                          <a
                            href={update.type === 'release' ? update.data.html_url : update.data.htmlUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-300 hover:text-white text-xs truncate flex-1"
                          >
                            {update.type === 'release' ? update.data.name : update.data.message?.split('\n')[0] || 'No message'}
                          </a>
                          <span className="text-gray-500 text-xs ml-auto flex-shrink-0">
                            {formatRelativeTime(update.type === 'release' ? update.data.published_at : update.data.date)}
                          </span>
                        </div>
                      </div>
                    ))}
                    {allUpdates.length === 0 && (
                      <div className="text-center py-4">
                        <AlertCircle size={16} className="text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-400 text-xs">No updates available</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
    </Portal>
      )}
    </>
  )
}

export default GitHubUpdatesWidget 