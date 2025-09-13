import React, { useState, useEffect } from 'react'
import { 
  GitCommit, 
  Tag, 
  Calendar,
  AlertCircle,
  Loader2
} from 'lucide-react'
import { fetchRecentGitHubUpdates, formatRelativeTime } from '../services/github'
import logger from '../utils/logger-frontend'

const GitHubUpdates = ({ resource }) => {
  const [githubData, setGithubData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('releases')

  useEffect(() => {
    const loadGitHubData = async () => {
      if (!resource.social?.github) {
        setError('No GitHub repository found')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        
        // Fetch fresh data from server
        const data = await fetchRecentGitHubUpdates(resource)
        
        // Check if we got valid data
        if (data && (data.releases.length > 0 || data.commits.length > 0)) {
          setGithubData(data)
          
          // Default to commits tab if no releases
          if (data.releases.length === 0 && data.commits.length > 0) {
            setActiveTab('commits')
          }
        } else {
          // No data available
          setGithubData({ releases: [], commits: [], commitsPerWeek: 0, repoInfo: null })
          setError('No recent activity available')
        }
      } catch (error) {
        logger.error(`Error fetching GitHub data for ${resource.name}:`, error)
        setError('Failed to load GitHub data')
      } finally {
        setLoading(false)
      }
    }

    loadGitHubData()
  }, [resource])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={16} className="animate-spin text-gray-400" />
        <span className="ml-2 text-gray-400/30">Loading updates...</span>
      </div>
    )
  }

  if (error || !githubData) {
    return (
      <div className="flex items-center py-4 text-gray-500">
        <AlertCircle size={16} className="mr-2" />
        <span>{error || 'No GitHub data available'}</span>
      </div>
    )
  }

  const { releases, commits, commitsPerWeek, repoInfo } = githubData

  const TabButton = ({ tabName, count, children, icon: Icon }) => (
    <button
      onClick={() => setActiveTab(tabName)}
      className={`flex items-center space-x-1 px-2 mobile:px-1 py-1 text-xs mobile:text-[10px] rounded transition-all duration-200 ${
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
    <div className="space-y-2">
      {/* Tabs */}
      <div className="flex space-x-1 mobile:space-x-0.5">
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

      {/* Tab Content */}
      <div className="space-y-1 max-h-44 mobile:max-h-64 overflow-y-auto scrollbar-hide">
        {activeTab === 'releases' && (
          <>
            {releases.length === 0 ? (
              <p className="text-gray-500 text-xs">No recent releases</p>
            ) : (
              releases.map((release) => (
                <div key={release.id} className="flex items-center justify-between mobile:flex-col mobile:items-start mobile:space-y-1">
                  <div className="flex-1 min-w-0 mobile:w-full">
                    <a
                      href={release.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 text-xs mobile:text-[10px] font-medium truncate block min-h-0"
                    >
                      {release.name}
                    </a>
                    {resource.type === 'organization' && release.repositoryName && (
                      <div className="text-gray-500 text-xs mobile:text-[10px] truncate">
                        {release.repositoryName}
                      </div>
                    )}
                  </div>
                  <span className="text-gray-500 text-xs mobile:text-[10px] flex items-center ml-2 mobile:ml-0 flex-shrink-0">
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
              commits.map((commit) => (
                <div key={commit.sha} className="flex items-center justify-between mobile:flex-col mobile:items-start mobile:space-y-1">
                  <div className="flex-1 min-w-0 mobile:w-full">
                    <a
                      href={commit.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-300 hover:text-white text-xs mobile:text-[10px] line-clamp-1 block min-h-0"
                    >
                      {commit.message.split('\n')[0]}
                    </a>
                    {resource.type === 'organization' && commit.repositoryName && (
                      <div className="text-gray-500 text-xs mobile:text-[10px] truncate">
                        {commit.repositoryName}
                      </div>
                    )}
                  </div>
                  <span className="text-gray-500 text-xs mobile:text-[10px] flex items-center ml-2 mobile:ml-0 flex-shrink-0">
                    <Calendar size={8} className="mr-1" />
                    {formatRelativeTime(commit.date)}
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

export default GitHubUpdates 