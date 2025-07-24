import React, { useState, useEffect } from 'react'
import { 
  GitCommit, 
  Tag, 
  Star, 
  GitFork, 
  Calendar,
  ExternalLink,
  AlertCircle,
  Github
} from 'lucide-react'
import { fetchGitHubUpdates, formatRelativeTime } from '../services/github'
import { cardanoResources } from '../data/resources'
import logger from '../utils/logger-frontend'

const GitHubUpdatesSection = () => {
  const [githubData, setGithubData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState('releases') // Default to releases

  const loadAllGitHubData = async (forceRefresh = false) => {
    try {
      // Get all resources with GitHub URLs
      const resourcesWithGitHub = Object.entries(cardanoResources).flatMap(([category, resources]) =>
        resources
          .filter(resource => resource.social?.github)
          .map(resource => ({ ...resource, category }))
      )

      // Process up to 5 resources for better coverage
      const allData = []
      const maxResourcesToProcess = 5 // Increased from 1 to 5 for better coverage
      const resourcesToProcess = resourcesWithGitHub.slice(0, maxResourcesToProcess)
      
      logger.log(`Found ${resourcesWithGitHub.length} resources, processing ${resourcesToProcess.length} with optimized rate limiting`)
      
      for (let i = 0; i < resourcesToProcess.length; i++) {
        const resource = resourcesToProcess[i]
        logger.log(`Processing ${i + 1}/${resourcesToProcess.length}: ${resource.name}`)
        
        try {
          const data = await fetchGitHubUpdates(resource)
          
          if (data.releases.length > 0 || data.commits.length > 0) {
            allData.push({
              resource,
              ...data
            })
            logger.log(`✅ Successfully loaded data for ${resource.name}`)
          } else {
            logger.log(`⚠️ No recent activity for ${resource.name}`)
          }
          
          // Stop if we have enough data
          if (allData.length >= 3) {
            logger.log(`Reached target of 3 projects, stopping`)
            break
          }
        } catch (error) {
          logger.warn(`❌ Failed to fetch data for ${resource.name}:`, error.message)
          // Continue with other resources even if one fails
        }
      }
    
      // If no data was loaded, show a fallback message
      if (allData.length === 0) {
        logger.log(`📋 No GitHub data available, showing fallback message`)
        setGithubData([])
      } else {
        // Sort by latest activity
        const validData = allData.sort((a, b) => {
          const aReleases = (a.releases || []).map(r => new Date(r.publishedAt || 0).getTime())
          const aCommits = (a.commits || []).map(c => new Date(c.date || 0).getTime())
          const aLatest = aReleases.length > 0 || aCommits.length > 0 ? Math.max(...aReleases, ...aCommits) : 0
          
          const bReleases = (b.releases || []).map(r => new Date(r.publishedAt || 0).getTime())
          const bCommits = (b.commits || []).map(c => new Date(c.date || 0).getTime())
          const bLatest = bReleases.length > 0 || bCommits.length > 0 ? Math.max(...bReleases, ...bCommits) : 0
          
          return bLatest - aLatest
        })

        setGithubData(validData)
      }
    } catch (err) {
      logger.error('GitHub data loading error:', err)
      // Set empty data to show the "No updates available" message
      setGithubData([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!hasLoaded) {
      setHasLoaded(true)
      loadAllGitHubData()
    }
  }, [hasLoaded])

  const UpdateItem = ({ data }) => {
    const { resource, releases, commits, repoInfo } = data
    const [activeTab, setActiveTab] = useState('releases')

    const TabButton = ({ tabName, count, children, icon: Icon }) => (
      <button
        onClick={() => setActiveTab(tabName)}
        className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-all duration-200 ${
          activeTab === tabName 
            ? 'bg-gray-700/50 text-white' 
            : 'text-gray-400 hover:bg-gray-800/30 hover:text-gray-300'
        }`}
      >
        <Icon size={12} />
        <span>{children}</span>
        {count > 0 && (
          <span className="bg-gray-600 text-gray-200 px-1 rounded-full text-xs">
            {count}
          </span>
        )}
      </button>
    )

    return (
      <div className="bg-card-bg/50 backdrop-blur-md border border-gray-800 rounded-lg p-2 transition-all duration-300 ease-in-out hover:shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <Github size={16} className="text-cyan-400" />
            <div>
              <h3 className="text-white font-medium text-xs">{resource.name}</h3>
              <p className="text-gray-400 text-xs">{resource.category}</p>
            </div>
          </div>
          {repoInfo && (
            <div className="flex items-center space-x-2 text-xs text-gray-400">
              <div className="flex items-center space-x-1">
                <Star size={10} />
                <span>{repoInfo.stargazersCount}</span>
              </div>
              <div className="flex items-center space-x-1">
                <GitFork size={10} />
                <span>{repoInfo.forksCount}</span>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mb-2">
          <TabButton 
            tabName="releases" 
            count={releases.length} 
            icon={Tag}
          >
            Releases
          </TabButton>
          <TabButton 
            tabName="commits" 
            count={commits.length} 
            icon={GitCommit}
          >
            Commits
          </TabButton>
        </div>

        {/* Content */}
        <div className="space-y-1 max-h-16 overflow-y-auto">
          {activeTab === 'releases' && (
            <>
              {releases.length === 0 ? (
                <p className="text-gray-500 text-xs">No recent releases</p>
              ) : (
                releases.slice(0, 2).map((release) => (
                  <div key={release.id} className="flex items-center justify-between">
                    <a
                      href={release.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 text-xs font-medium truncate flex-1"
                    >
                      {release.name}
                    </a>
                    <span className="text-gray-500 text-xs flex items-center ml-2">
                      <Calendar size={8} className="mr-1" />
                      {formatRelativeTime(release.publishedAt)}
                    </span>
                  </div>
                ))
              )}
            </>
          )}

          {activeTab === 'commits' && (
            <>
              {commits.length === 0 ? (
                <p className="text-gray-500 text-xs">No recent commits</p>
              ) : (
                commits.slice(0, 2).map((commit) => (
                  <div key={commit.sha} className="flex items-center justify-between">
                    <a
                      href={commit.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-300 hover:text-white text-xs line-clamp-1 flex-1"
                    >
                      {commit.message.split('\n')[0]}
                    </a>
                    <span className="text-gray-500 text-xs font-mono ml-2">
                      {commit.shortSha}
                    </span>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // Filter updates based on active tab
  const allUpdates = githubData.flatMap(data => {
    const updates = []
    
    if (activeTab === 'releases') {
      // Add releases only
      data.releases.slice(0, 6).forEach(release => {
        updates.push({
          type: 'release',
          resource: data.resource,
          data: release,
          timestamp: new Date(release.publishedAt).getTime()
        })
      })
    } else {
      // Add commits only
      data.commits.slice(0, 6).forEach(commit => {
        updates.push({
          type: 'commit',
          resource: data.resource,
          data: commit,
          timestamp: new Date(commit.date).getTime()
        })
      })
    }
    
    return updates
  }).sort((a, b) => b.timestamp - a.timestamp).slice(0, 12)

  return (
    <section className="py-8 bg-custom-bg">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-4">
          <h2 className="text-lg md:text-xl font-bold text-white mb-2">
            Latest Updates
          </h2>
        </div>
        
        {/* Small Tab Switch */}
        <div className="flex justify-start mb-6">
          <div className="flex bg-gray-800/30 rounded-md p-0.5 border border-gray-700/50">
            <button
              onClick={() => setActiveTab('releases')}
              className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-all duration-200 ${
                activeTab === 'releases' 
                  ? 'bg-cyan-500/20 text-cyan-400' 
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
                  ? 'bg-green-500/20 text-green-400' 
                  : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/30'
              }`}
            >
              <GitCommit size={12} />
              <span>Commits</span>
            </button>
          </div>
        </div>
        
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-2"></div>
              <p className="text-gray-400/30">Loading GitHub updates...</p>
            </div>
          ) : (
            <>
              {allUpdates.map((update, index) => (
                <div key={`${update.resource.id}-${update.type}-${index}`} className="bg-card-bg/50 backdrop-blur-md border border-gray-800 rounded-lg p-2 transition-all duration-300 ease-in-out hover:shadow-lg">
                  <div className="flex items-center gap-2 min-w-0 w-full">
                    <span className="font-semibold text-xs text-white truncate max-w-[110px] flex-shrink-0">{update.resource.name}</span>
                    {update.type === 'release' ? (
                      <Tag size={14} className="text-cyan-400 flex-shrink-0" />
                    ) : (
                      <GitCommit size={14} className="text-green-400 flex-shrink-0" />
                    )}
                    <a
                      href={update.data.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-300 hover:text-white text-xs truncate max-w-[220px]"
                    >
                      {update.type === 'release' ? update.data.name : update.data.message.split('\n')[0]}
                    </a>
                    {update.type === 'release' && update.data.body && (
                      <span className="text-gray-500 text-xs truncate max-w-[180px] hidden sm:inline">{update.data.body.split('\n')[0]}</span>
                    )}
                    {update.type === 'commit' && (
                      <span className="text-gray-500 text-xs font-mono truncate max-w-[80px]">{update.data.shortSha}</span>
                    )}
                    <span className="text-gray-500 text-xs ml-auto flex-shrink-0">{formatRelativeTime(update.type === 'release' ? update.data.publishedAt : update.data.date)}</span>
                  </div>
                </div>
              ))}
              
              {allUpdates.length === 0 && (
                <div className="text-center py-8">
                  <AlertCircle size={24} className="text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-400 mb-2">No updates available</p>
                  <p className="text-gray-500 text-xs">
                    GitHub API rate limits prevent real-time updates. 
                    <br />
                    Check the projects directly for latest activity.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

export default GitHubUpdatesSection 