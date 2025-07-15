import React, { useState, useEffect } from 'react'
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
import { fetchGitHubUpdates, formatRelativeTime, checkRateLimitStatus } from '../services/github'
import { cardanoResources } from '../data/resources'
import logger from '../utils/logger'
import Portal from './Portal'

const GitHubUpdatesWidget = ({ isExpanded, onExpand, onCollapse, isAnyExpanded }) => {
  const [githubData, setGithubData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('releases')
  const [collapseTimeout, setCollapseTimeout] = useState(null)
  const [rateLimitExhausted, setRateLimitExhausted] = useState(false)
  const [rateLimitResetTime, setRateLimitResetTime] = useState(null)

  // Handle click outside to collapse widget
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isExpanded && !event.target.closest('.github-widget')) {
        if (collapseTimeout) {
          clearTimeout(collapseTimeout)
          setCollapseTimeout(null)
        }
        // setIsExpanded(false) // This line is removed as per the edit hint
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isExpanded, collapseTimeout])

  const loadGitHubData = async () => {
    try {
      // Check rate limit status first
      const rateLimitStatus = await checkRateLimitStatus()
      if (rateLimitStatus && rateLimitStatus.remaining === 0) {
        // Check if rate limit has actually reset
        const now = Date.now()
        const resetTimeMs = rateLimitStatus.reset * 1000
        const hasReset = now >= resetTimeMs
        
        if (hasReset) {
          logger.log(`🔄 Rate limit has reset, proceeding with fresh data fetch`)
          // Continue with normal data fetching
        } else {
          logger.log(`⏳ Rate limit exhausted, showing empty state`)
          setRateLimitExhausted(true)
          setRateLimitResetTime(new Date(resetTimeMs))
          setGithubData([])
          setIsLoading(false)
          return
        }
      }

      const resourcesWithGitHub = Object.entries(cardanoResources).flatMap(([category, resources]) =>
        resources
          .filter(resource => resource.social?.github)
          .map(resource => ({ ...resource, category }))
      )

      const allData = []
      const resourcesToProcess = resourcesWithGitHub.slice(0, 10) // Increased from 3 to 10
      
      logger.log(`🔄 Widget: Loading fresh data for ${resourcesToProcess.length} resources`)
      
      for (let i = 0; i < resourcesToProcess.length; i++) {
        const resource = resourcesToProcess[i]
        
        try {
          logger.log(`📡 Widget: Fetching data for ${resource.name}`)
          const data = await fetchGitHubUpdates(resource)
          
          if (data.releases.length > 0 || data.commits.length > 0) {
            allData.push({
              resource,
              ...data
            })
            logger.log(`✅ Widget: Successfully loaded data for ${resource.name} - ${data.releases.length} releases, ${data.commits.length} commits`)
          } else {
            logger.log(`⚠️ Widget: No recent activity for ${resource.name}`)
          }
          
          if (allData.length >= 8) break // Increased from 2 to 8
        } catch (error) {
          logger.warn(`❌ Widget: Failed to fetch data for ${resource.name}:`, error.message)
          
          // If we hit rate limit during fetching, stop and show empty state
          if (error.message.includes('rate limit')) {
            logger.log(`⏳ Rate limit hit during fetching, showing empty state`)
            setRateLimitExhausted(true)
            setRateLimitResetTime(new Date(Date.now() + 3600000)) // 1 hour from now
            setGithubData([])
            setIsLoading(false)
            return
          }
        }
      }
    
      if (allData.length === 0) {
        logger.log(`📋 Widget: No data available, showing empty state`)
        setGithubData([])
      } else {
        const validData = allData.sort((a, b) => {
          const aReleases = (a.releases || []).map(r => new Date(r.publishedAt || 0).getTime())
          const aCommits = (a.commits || []).map(c => new Date(c.date || 0).getTime())
          const aLatest = aReleases.length > 0 || aCommits.length > 0 ? Math.max(...aReleases, ...aCommits) : 0
          
          const bReleases = (b.releases || []).map(r => new Date(r.publishedAt || 0).getTime())
          const bCommits = (b.commits || []).map(c => new Date(c.date || 0).getTime())
          const bLatest = bReleases.length > 0 || bCommits.length > 0 ? Math.max(...bReleases, ...bCommits) : 0
          
          return bLatest - aLatest
        })

        logger.log(`📊 Widget: Final data loaded for ${validData.length} resources`)
        setGithubData(validData)
      }
    } catch (err) {
      logger.error('Widget: GitHub data loading error:', err)
      setGithubData([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Add a small delay to ensure resource cards have loaded first
    const timer = setTimeout(() => {
      logger.log(`🔄 Widget: Starting data load`)
      loadGitHubData()
    }, 1000)
    
    return () => clearTimeout(timer)
  }, [])

  // Get total update count
  const totalUpdates = githubData.reduce((total, data) => {
    const releasesCount = (data.releases || []).length
    const commitsCount = (data.commits || []).length
    return total + releasesCount + commitsCount
  }, 0)

  // Aggregate all updates from all resources, sort by date, and limit to 100
  const allUpdates = githubData.flatMap(data => {
    const updates = []
    
    if (activeTab === 'releases') {
      data.releases.forEach(release => {
        updates.push({
          type: 'release',
          resource: data.resource,
          data: release,
          timestamp: new Date(release.publishedAt).getTime()
        })
      })
    } else {
      data.commits.forEach(commit => {
        updates.push({
          type: 'commit',
          resource: data.resource,
          data: commit,
          timestamp: new Date(commit.date).getTime()
        })
      })
    }
    
    return updates
  }).sort((a, b) => b.timestamp - a.timestamp).slice(0, 100) // Increased from 50 to 100

    return (
    <>
      {!isExpanded ? (
      <div
          className="relative z-50 w-16 h-16 github-widget"
        onClick={onExpand}
      >
        <div className="flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl">
          <Github size={24} className="text-cyan-400" />
        </div>
      </div>
      ) : (
    <Portal>
          <div className="fixed z-[9999] p-4 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] max-w-[95vw] bg-card-bg/50 border border-gray-800 rounded-xl shadow-lg transition-all duration-500 ease-in-out opacity-100 scale-100">
        <button
          className="absolute top-4 right-4 z-50 text-gray-400 hover:text-white bg-gray-800/70 rounded-full p-2 transition-colors"
          onClick={onCollapse}
          aria-label="Close"
        >
          <span style={{fontSize: 20, fontWeight: 'bold', lineHeight: 1}}>×</span>
        </button>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Github size={20} className="text-cyan-400" />
              <h3 className="text-white font-semibold text-sm">Latest Updates</h3>
            </div>
            <div className="flex items-center space-x-2">
              <ChevronRight size={16} className="text-gray-400" />
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
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-all duration-200 ${
                    activeTab === 'releases' 
                      ? 'btn-primary' 
                      : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/30'
                  }`}
                >
                  <Tag size={12} />
                  <span>Releases</span>
                </button>
                <button
                  onClick={() => setActiveTab('commits')}
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-all duration-200 ${
                    activeTab === 'commits' 
                      ? 'btn-primary' 
                      : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/30'
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
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400 mx-auto mb-2"></div>
                    <p className="text-gray-400 text-xs">Loading updates...</p>
                  </div>
                ) : (
                  <>
                    {allUpdates.map((update, index) => (
                      <div key={`${update.resource.id}-${update.type}-${index}`} 
                           className="bg-gray-800/50 rounded-lg p-2 transition-all duration-200 hover:bg-gray-700/50">
                        <div className="flex items-center gap-2 min-w-0">
                          <a
                            href={update.resource.social.github}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-xs text-cyan-400 hover:text-cyan-300 truncate max-w-[100px] flex-shrink-0 transition-colors"
                            title={`View ${update.resource.name} on GitHub`}
                          >
                            {update.resource.name}
                          </a>
                          {update.type === 'release' ? (
                            <Tag size={12} className="text-cyan-400 flex-shrink-0" />
                          ) : (
                            <GitCommit size={12} className="text-green-400 flex-shrink-0" />
                          )}
                          <a
                            href={update.data.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-300 hover:text-white text-xs truncate flex-1"
                          >
                            {update.type === 'release' ? update.data.name : update.data.message.split('\n')[0]}
                          </a>
                          <span className="text-gray-500 text-xs ml-auto flex-shrink-0">
                            {formatRelativeTime(update.type === 'release' ? update.data.publishedAt : update.data.date)}
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