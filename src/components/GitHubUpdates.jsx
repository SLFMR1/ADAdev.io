import React, { useState, useEffect } from 'react'
import { 
  GitCommit, 
  Tag, 
  Star, 
  GitFork, 
  Calendar,
  ExternalLink,
  AlertCircle,
  Loader2
} from 'lucide-react'
import { fetchGitHubUpdates, formatRelativeTime } from '../services/github'

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
        
        console.log(`🔍 [GitHubUpdates] Fetching data for ${resource.name}`)
        
        // Fetch fresh data from server
        const data = await fetchGitHubUpdates(resource)
        
        console.log(`🔍 [GitHubUpdates] Received data for ${resource.name}:`, {
          releases: data?.releases?.length || 0,
          commits: data?.commits?.length || 0,
          commitsPerWeek: data?.commitsPerWeek || 0,
          hasRepoInfo: !!data?.repoInfo
        })
        
        // Check if we got valid data
        if (data && (data.releases?.length > 0 || data.commits?.length > 0)) {
          setGithubData(data)
          
          // Default to commits tab if no releases
          if (data.releases.length === 0 && data.commits.length > 0) {
            setActiveTab('commits')
          }
          
          console.log(`✅ [GitHubUpdates] Successfully loaded data for ${resource.name}`)
        } else {
          // No data available
          console.log(`⚠️ [GitHubUpdates] No data available for ${resource.name}`)
          setGithubData({ releases: [], commits: [], commitsPerWeek: 0, repoInfo: null })
          setError('No recent activity available')
        }
      } catch (err) {
        console.error(`❌ [GitHubUpdates] Error loading data for ${resource.name}:`, err)
        setError('Failed to load GitHub data')
        // Set empty data structure so UI can still render
        setGithubData({ releases: [], commits: [], commitsPerWeek: 0, repoInfo: null })
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
        <span className="ml-2 text-gray-400">Loading updates...</span>
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
    <div className="space-y-2">
      {/* Repository Stats */}
      {repoInfo && (
        <div className="flex items-center justify-between pb-1 border-b border-gray-700/50">
          <div className="flex items-center space-x-2 text-xs text-gray-400">
            <div className="flex items-center space-x-1">
              <Star size={10} />
              <span>{repoInfo.stargazersCount}</span>
            </div>
            <div className="flex items-center space-x-1">
              <GitFork size={10} />
              <span>{repoInfo.forksCount}</span>
            </div>
            {commitsPerWeek > 0 && (
              <div className="flex items-center space-x-1">
                <GitCommit size={10} />
                <span>{commitsPerWeek}/week</span>
              </div>
            )}
            {repoInfo.language && (
              <span className="bg-gray-700 px-1 py-0.5 rounded-full text-xs">
                {repoInfo.language}
              </span>
            )}
          </div>
          <a 
            href={repoInfo.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <ExternalLink size={10} />
          </a>
        </div>
      )}

      {/* Tabs */}
      <div className="flex space-x-1">
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
      <div className="space-y-1">
        {activeTab === 'releases' && (
          <>
            {releases.length === 0 ? (
              <p className="text-gray-500 text-xs">No recent releases</p>
            ) : (
              releases.slice(0, 5).map((release) => (
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
              commits.slice(0, 8).map((commit) => (
                <div key={commit.sha} className="flex items-center justify-between">
                  <a
                    href={commit.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-300 hover:text-white text-xs line-clamp-1 flex-1"
                  >
                    {commit.message.split('\n')[0]}
                  </a>
                  <span className="text-gray-500 text-xs flex items-center ml-2">
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