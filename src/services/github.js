import logger from '../utils/logger-frontend'
import cacheManager from './cacheManager'
import { rateLimiter } from './rateLimiter';

// Server API configuration
const SERVER_API_BASE = '/api/github'

// NEW: Client-side service that uses server cache and Supabase
class GitHubService {
  constructor() {
    this.token = process.env.GITHUB_TOKEN;
    this.baseUrl = 'https://api.github.com';
    // Use relative path for proxy in development, or full URL in production
    this.serverBase = import.meta.env.DEV ? '/api/github' : 'http://localhost:3000/api/github';
    this.rateLimiter = rateLimiter;
  }

  async fetchWithPagination(url, maxPages = 10) {
    const allData = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const pageUrl = `${url}${url.includes('?') ? '&' : '?'}page=${page}&per_page=100`;
      
      try {
        const response = await this.rateLimiter.makeRequest(pageUrl, {
          headers: {
            'Authorization': `token ${this.token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });

        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (Array.isArray(data)) {
          allData.push(...data);
          hasMore = data.length === 100; // If we got 100 items, there might be more
        } else {
          allData.push(data);
          hasMore = false;
        }

        page++;
      } catch (error) {
        console.error(`Error fetching page ${page}:`, error);
        break;
      }
    }

    return allData;
  }

  async getRepoData(resource) {
    if (!resource.repo_path) {
      throw new Error(`Resource ${resource.name} missing repo_path`);
    }

    const [owner, repo] = resource.repo_path.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repo_path format: ${resource.repo_path}`);
    }

    try {
      // Get repository info
      const repoInfo = await this.fetchWithPagination(`${this.baseUrl}/repos/${owner}/${repo}`, 1);
      
      // Get commits (last year)
      const since = new Date();
      since.setFullYear(since.getFullYear() - 1);
      const commits = await this.fetchWithPagination(
        `${this.baseUrl}/repos/${owner}/${repo}/commits?since=${since.toISOString()}`
      );

      // Get releases
      const releases = await this.fetchWithPagination(`${this.baseUrl}/repos/${owner}/${repo}/releases`);

      return {
        repoInfo: repoInfo[0],
        commits: commits,
        releases: releases,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Error fetching data for ${resource.repo_path}:`, error);
      throw error;
    }
  }

  async validateRepoPath(repoPath) {
    const [owner, repo] = repoPath.split('/');
    if (!owner || !repo) {
      return false;
    }

    try {
      const response = await this.rateLimiter.makeRequest(`${this.baseUrl}/repos/${owner}/${repo}`, {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fetch recent GitHub updates (commits/releases) for the Updates tab
   * @param {Object} resource - Resource object with social.github URL
   * @returns {Promise<Object>} - Recent commits and releases data
   */
  async fetchRecentGitHubUpdates(resource) {
    const githubUrl = resource.social?.github
    if (!githubUrl) {
      logger.log(`❌ No GitHub URL for ${resource.name}`)
      return { releases: [], commits: [], repoInfo: null, commitsPerWeek: 0 }
    }
    
    logger.log(`🚀 Client requesting FAST cached updates for ${resource.name}`)
    
    try {
      // Use the OPTIMIZED database-cached endpoint for instant loading
      const response = await fetch(`/api/resource-updates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          resourceId: resource.name, // Use resource name as ID for now
          resourceName: resource.name 
        })
      })
      
      if (!response.ok) {
        // Fallback to old endpoint if new one fails
        logger.warn(`⚠️ New endpoint failed, falling back to old /api/github/recent`)
        const fallbackResponse = await fetch(`/api/github/recent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: resource.name, social: resource.social, type: resource.type })
        })
        
        if (!fallbackResponse.ok) {
          throw new Error(`Both endpoints failed: ${response.status}, ${fallbackResponse.status}`)
        }
        
        const fallbackData = await fallbackResponse.json()
        logger.log(`📊 Fallback data for ${resource.name}:`, {
          releases: fallbackData.releases?.length || 0,
          commits: fallbackData.commits?.length || 0
        })
        return fallbackData
      }
      
      const data = await response.json()
      
      // Transform the data to match the expected format
      const transformedData = {
        releases: data.releases.map(release => ({
          id: release.id,
          name: release.name || release.tag_name,
          tagName: release.tag_name,
          publishedAt: release.published_at,
          htmlUrl: release.html_url,
          draft: release.draft,
          prerelease: release.prerelease,
          repositoryName: release.repository?.name
        })),
        commits: data.commits.map(commit => ({
          sha: commit.sha,
          message: commit.commit?.message || '',
          date: commit.commit?.author?.date,
          author: commit.commit?.author?.name,
          htmlUrl: commit.html_url,
          repositoryName: commit.repository?.name
        })),
        repoInfo: {
          name: resource.name,
          htmlUrl: githubUrl,
          stargazersCount: 0,
          forksCount: 0,
          language: null
        },
        commitsPerWeek: 0 // Could calculate from commit dates if needed
      }
      
      logger.log(`⚡ FAST cached updates for ${resource.name}:`, {
        releases: transformedData.releases.length,
        commits: transformedData.commits.length
      })
      
      return transformedData
    } catch (error) {
      logger.error(`Client error fetching fast cached updates for ${resource.name}:`, error)
      return { 
        releases: [], 
        commits: [], 
        repoInfo: null, 
        commitsPerWeek: 0
      }
    }
  }

  /**
   * Fetch GitHub updates for a resource using historical database data like DevelopmentActivityWidget
   * @param {Object} resource - Resource object with social.github URL
   * @param {String} period - Time period for data (4weeks, 3months, 52weeks)
   * @returns {Promise<Object>} - Combined GitHub data with historical weekly data
   */
  async fetchGitHubUpdates(resource, period = '4weeks') {
    const githubUrl = resource.social?.github
    if (!githubUrl) {
      logger.log(`❌ No GitHub URL for ${resource.name}`)
      return { releases: [], commits: [], repoInfo: null, commitsPerWeekDetailed: [] }
    }
    
    logger.log(`🔍 Client requesting historical GitHub data for ${resource.name} (period: ${period})`)
    
    try {
      // Map period to the same values used by DevelopmentActivityWidget
      const periodMap = {
        '4weeks': '5weeks',     // Last 4 weeks (5 weeks of data to get 4 complete weeks)
        '3months': '3months',   // Last 3 months
        '52weeks': '52weeks'    // Last 12 months
      }
      
      const mappedPeriod = periodMap[period] || 'monthly'
      
      // Detect resource type to use correct viewMode (same as DevelopmentActivityWidget)
      const viewMode = resource.type === 'organization' ? 'organization' : 'repository'
      
      // Get historical data from the same endpoint as DevelopmentActivityWidget
      const response = await fetch(`/api/development-activity?viewMode=${viewMode}&period=${mappedPeriod}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })
      
      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }
      
      const data = await response.json()
      
      // Find the specific resource in the historical data
      let resourceData = null
      
      // Check if we have preloaded periods data
      if (data.preloadedPeriods && data.preloadedPeriods[mappedPeriod]) {
        const periodData = data.preloadedPeriods[mappedPeriod]
        const chartData = periodData.weeklyChartData || periodData.dailyChartData || []
        
        // Find matching resource by name or GitHub URL
        resourceData = chartData.find(item => {
          if (!item.resource) return false
          
          const nameMatch = item.resource.name === resource.name
          const githubMatch = item.resource.social?.github === resource.social.github
          const githubUrlMatch = item.resource.social?.github && resource.social?.github && 
            item.resource.social.github.toLowerCase() === resource.social.github.toLowerCase()
          
          return nameMatch || githubMatch || githubUrlMatch
        })
      }
      
      if (!resourceData) {
        logger.log(`⚠️ Resource ${resource.name} not found in historical data`)
        return { 
          releases: [], 
          commits: [], 
          repoInfo: null, 
          commitsPerWeekDetailed: [],
          commitsPerWeek: 0
        }
      }
      
      // Transform historical data to the format expected by ResourceCard
      const commitsPerWeekDetailed = resourceData.weeklyCounts ? 
        resourceData.weeklyCounts.map((count, index) => {
          // Calculate week start date going backwards from today
          const today = new Date()
          const weekStart = new Date(today)
          weekStart.setDate(today.getDate() - (resourceData.weeklyCounts.length - 1 - index) * 7)
          
          // Adjust to Monday of that week
          const dayOfWeek = weekStart.getDay()
          const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
          weekStart.setDate(weekStart.getDate() - daysToMonday)
          
          return {
            weekStart: weekStart.toISOString().slice(0, 10),
            count: count,
            year: weekStart.getFullYear(),
            week: Math.ceil((weekStart.getTime() - new Date(weekStart.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))
          }
        }) : []
      
      // Calculate total commits from weekly data if totalCommits is not available
      let totalCommits = resourceData.totalCommits || 0
      if (totalCommits === 0 && resourceData.weeklyCounts) {
        totalCommits = resourceData.weeklyCounts.reduce((sum, count) => sum + count, 0)
      }
      
      const result = {
        resource: resource.name,
        releases: [], // Historical data doesn't include detailed releases
        commits: [], // Historical data doesn't include detailed commits
        commitsPerWeek: totalCommits,
        commitsPerWeekDetailed: commitsPerWeekDetailed,
        weeklyData: commitsPerWeekDetailed, // Legacy compatibility
        repoInfo: {
          name: resource.name,
          htmlUrl: resource.social?.github,
          isOrganization: resource.type === 'organization',
          stargazersCount: resourceData.resource?.stargazersCount || 0,
          forksCount: resourceData.resource?.forksCount || 0,
          language: resourceData.resource?.language || null
        }
      }
      
      logger.log(`📊 Client received historical data for ${resource.name}:`, {
        period: period,
        mappedPeriod: mappedPeriod,
        weeklyRecords: result.commitsPerWeekDetailed.length,
        totalCommits: result.commitsPerWeek
      })
      
      return result
    } catch (error) {
      logger.error(`Client error fetching historical GitHub data for ${resource.name}:`, error)
      return { 
        releases: [], 
        commits: [], 
        repoInfo: null, 
        commitsPerWeekDetailed: [],
        commitsPerWeek: 0
      }
    }
  }

  /**
   * Fetch global GitHub updates for multiple resources
   * @param {Array} resources - Array of resource objects
   * @returns {Promise<Array>} - Array of GitHub data for resources
   */
  async fetchGlobalGitHubUpdates(resources) {
    console.log('🚀 FETCH DEBUG: fetchGlobalGitHubUpdates called with', resources.length, 'resources')
    const resourcesWithGitHub = resources.filter(resource => resource.social?.github)
    
    if (resourcesWithGitHub.length === 0) {
      logger.log('❌ No resources with GitHub URLs provided')
      return []
    }
    
    console.log('🚀 FETCH DEBUG: Found', resourcesWithGitHub.length, 'resources with GitHub URLs')
    logger.log(`🚀 Client requesting FAST global cached updates for ${resourcesWithGitHub.length} resources`)
    
    try {
      // Use the OPTIMIZED database-cached endpoint for instant loading
      const response = await fetch('/api/global-updates', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache', // Bypass service worker cache
        }
      })
      
      if (!response.ok) {
        // Fallback to old endpoint if new one fails
        logger.warn(`⚠️ New global endpoint failed, falling back to old /api/github/global`)
        const fallbackResponse = await fetch(`${this.serverBase}/global`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ resources: resourcesWithGitHub })
        })
        
        if (!fallbackResponse.ok) {
          throw new Error(`Both endpoints failed: ${response.status}, ${fallbackResponse.status}`)
        }
        
        const fallbackData = await fallbackResponse.json()
        logger.log(`📊 Fallback global data: ${fallbackData.length} resources`)
        return fallbackData
      }
      
      const data = await response.json()
      
      // Transform the global cached data to match expected widget format
      const allCommits = data.commits || []
      const allReleases = data.releases || []
      
      // Create a map to match resource names to the provided resources 
      const resourceLookup = new Map()
      resourcesWithGitHub.forEach(resource => {
        resourceLookup.set(resource.name, resource)
      })
      
      logger.log(`🔍 Widget resources available:`, resourcesWithGitHub.map(r => r.name).sort())
      logger.log(`🏷️ Database resources found:`, [...new Set([...allCommits, ...allReleases].map(item => item.resource?.name))].filter(Boolean).sort())
      
      // Group by resource for the widget's expected format
      const resourceMap = new Map()
      
      // Add commits to resource map
      allCommits.forEach(commit => {
        const resourceName = commit.resource?.name || 'unknown'
        const matchedResource = resourceLookup.get(resourceName)
        
        if (matchedResource) {
          if (!resourceMap.has(resourceName)) {
            resourceMap.set(resourceName, {
              resource: matchedResource, // Use the full resource object from cardanoResources
              commits: [],
              releases: [],
              commitsPerWeek: 0,
              weeklyData: [],
              repoInfo: null
            })
          }
          
          resourceMap.get(resourceName).commits.push({
            sha: commit.sha,
            message: commit.commit?.message || '',
            date: commit.commit?.author?.date,
            author: commit.commit?.author?.name,
            htmlUrl: commit.html_url,
            repositoryName: commit.repository?.name
          })
        }
      })
      
      // Add releases to resource map
      let releasesMatched = 0
      let releasesUnmatched = 0
      console.log('🔍 RESOURCE DEBUG: Starting release matching process...')
      console.log('🔍 RESOURCE DEBUG: Total releases to process:', allReleases.length)
      console.log('🔍 RESOURCE DEBUG: Available widget resources:', Array.from(resourceLookup.keys()).sort())
      
      allReleases.forEach((release, index) => {
        const resourceName = release.resource?.name || 'unknown'
        const matchedResource = resourceLookup.get(resourceName)
        
        if (index < 5) { // Debug first 5 releases
          console.log(`🔍 RESOURCE DEBUG: Release ${index + 1}:`, {
            resourceName,
            hasMatch: !!matchedResource,
            releaseTag: release.tag_name,
            releaseDate: release.published_at
          })
        }
        
        if (matchedResource) {
          releasesMatched++
          if (!resourceMap.has(resourceName)) {
            resourceMap.set(resourceName, {
              resource: matchedResource, // Use the full resource object from cardanoResources
              commits: [],
              releases: [],
              commitsPerWeek: 0,
              weeklyData: [],
              repoInfo: null
            })
          }
          
          resourceMap.get(resourceName).releases.push({
            id: release.id,
            name: release.name || release.tag_name,
            tag_name: release.tag_name,
            published_at: release.published_at,
            html_url: release.html_url,
            draft: release.draft,
            prerelease: release.prerelease,
            repositoryName: release.repository?.name
          })
        } else {
          releasesUnmatched++
          if (releasesUnmatched <= 5) { // Log first 5 unmatched
            logger.log(`❌ Unmatched release resource: "${resourceName}"`)
          }
        }
      })
      
      logger.log(`📊 Release matching: ${releasesMatched} matched, ${releasesUnmatched} unmatched out of ${allReleases.length} total`)
      
      const transformedData = Array.from(resourceMap.values())
      
      // Debug final results
      console.log('🎯 RESOURCE DEBUG: Final transformation results:')
      console.log('🎯 RESOURCE DEBUG: Resources with data:', transformedData.length)
      transformedData.forEach((resource, index) => {
        if (index < 10) { // Debug first 10 resources
          console.log(`🎯 RESOURCE DEBUG: Resource ${index + 1}: ${resource.resource.name}`, {
            commits: resource.commits.length,
            releases: resource.releases.length,
            hasRecentReleases: resource.releases.filter(r => {
              const releaseDate = new Date(r.published_at)
              const thirtyDaysAgo = new Date()
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
              return releaseDate >= thirtyDaysAgo
            }).length
          })
        }
      })
      
      logger.log(`⚡ FAST global cached updates: ${transformedData.length} resources with ${allCommits.length} commits, ${allReleases.length} releases`)
      
      return transformedData
    } catch (error) {
      logger.error('❌ Client error fetching fast global cached updates:', error)
      
      // Provide more specific error handling
      if (error.message.includes('rate limit')) {
        logger.warn('⏳ GitHub rate limit exceeded - returning empty data')
        return []
      } else if (error.message.includes('Failed to fetch') || error.message.includes('Network')) {
        logger.warn('🌐 Network error - returning empty data')
        return []
      }
      
      // For other errors, still return empty array to prevent widget crashes
      return []
    }
  }

  /**
   * Get cache status from server
   * @returns {Promise<Object>} - Cache status information
   */
  async getCacheStatus() {
    try {
      const response = await fetch(`${this.serverBase}/cache/status`)
      
      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }
      
      const status = await response.json()
      logger.log('📊 Server cache status:', status)
      return status
    } catch (error) {
      logger.error('Client error getting cache status:', error)
      return { entries: 0, error: error.message }
    }
  }

  /**
   * Clear server cache
   * @returns {Promise<Object>} - Clear result
   */
  async clearCache() {
    try {
      const response = await fetch(`${this.serverBase}/cache/clear`, {
        method: 'POST'
      })
      
      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }
      
      const result = await response.json()
      logger.log('🗑️ Server cache cleared:', result)
      return result
    } catch (error) {
      logger.error('Client error clearing cache:', error)
      return { error: error.message }
    }
  }
}

// Create singleton instance
const githubService = new GitHubService()

// Export functions that use the server API
export const fetchGitHubUpdates = (resource, period) => githubService.fetchGitHubUpdates(resource, period)
export const fetchRecentGitHubUpdates = (resource) => githubService.fetchRecentGitHubUpdates(resource)
export const fetchGlobalGitHubUpdates = (resources) => githubService.fetchGlobalGitHubUpdates(resources)
export const getCacheStatus = () => githubService.getCacheStatus()
export const clearGitHubCache = () => githubService.clearCache()

/**
 * Trigger manual cache preload on server
 * @returns {Promise<Object>} - Preload result
 */
export const triggerCachePreload = async () => {
  try {
    const response = await fetch(`${githubService.serverBase}/cache/preload`, {
      method: 'POST'
    })
    
    if (!response.ok) {
      throw new Error(`Server API error: ${response.status}`)
    }
    
    const result = await response.json()
    logger.log('🔄 Manual cache preload completed:', result)
    return result
  } catch (error) {
    logger.error('Client error triggering cache preload:', error)
    return { error: error.message }
  }
}

/**
 * Trigger background fetch for remaining resources
 * @returns {Promise<Object>} - Background fetch result
 */
export const triggerBackgroundFetch = async () => {
  try {
    const response = await fetch(`${githubService.serverBase}/cache/background-fetch`, {
      method: 'POST'
    })
    
    if (!response.ok) {
      throw new Error(`Server API error: ${response.status}`)
    }
    
    const result = await response.json()
    logger.log('🔄 Background fetch started:', result)
    return result
  } catch (error) {
    logger.error('Client error triggering background fetch:', error)
    return { error: error.message }
  }
}

// Legacy compatibility functions (now use server)
export const getCachedGitHubData = async (resource) => {
  // For compatibility, we'll return null since the server handles caching
  // The client should always call fetchGitHubUpdates directly
  return null
}

export const getCachedGlobalGitHubData = () => {
  // For compatibility, return empty object since server handles global cache
  return { releases: [], commits: [], timestamp: 0 }
}

export const clearGlobalGitHubCache = async () => {
  return githubService.clearCache()
}

export const fetchAndCacheGlobalGitHubUpdates = async (resources) => {
  const data = await githubService.fetchGlobalGitHubUpdates(resources)
  
  // Transform to legacy format
  const allReleases = []
  const allCommits = []
  
  data.forEach(item => {
    if (item.releases) {
      allReleases.push(...item.releases.map(r => ({ ...r, project: item.resource.name })))
    }
    if (item.commits) {
      allCommits.push(...item.commits.map(c => ({ ...c, project: item.resource.name })))
    }
  })
  
  return {
    releases: allReleases,
    commits: allCommits,
    timestamp: Date.now()
  }
}

// Debug function
export const debugCache = async () => {
  return githubService.getCacheStatus()
}

// Check cache status for a specific resource
export const checkCacheStatus = async (resource) => {
  // Since server handles caching, we'll just return basic info
  logger.log(`🔍 Cache status for ${resource.name}: Server-managed`)
  return null
}

// Rate limit functions (now handled by server)
export const checkRateLimitStatus = async () => {
  // Rate limiting is now handled server-side
  logger.log('📊 Rate limiting handled by server')
  return { limit: 60, remaining: 60, reset: 0, used: 0 }
}

export const initializeRateLimit = async () => {
  logger.log('🚀 Rate limiting initialized on server')
}

// Preload cache (now handled by server)
export const preloadCache = async (resources) => {
  logger.log('🔄 Preloading cache via server...')
  const resourcesWithGitHub = resources.filter(resource => resource.social?.github)
  
  for (const resource of resourcesWithGitHub.slice(0, 3)) {
    try {
      await githubService.fetchGitHubUpdates(resource)
      await new Promise(resolve => setTimeout(resolve, 1000)) // 1s delay
    } catch (error) {
      logger.warn(`Failed to preload cache for ${resource.name}:`, error.message)
    }
  }
}

// Service Worker cache utilities (no longer needed)
export const clearCache = async () => {
  return { success: true, message: 'Cache clearing handled by server' }
}

export const isServiceWorkerAvailable = () => {
  return false // No longer using Service Worker
}

export const reloadCache = async () => {
  logger.log('🔄 Cache reload handled by server')
}

/**
 * Format relative time (e.g., "2 days ago")
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted relative time
 */
export const formatRelativeTime = (dateString) => {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now - date) / 1000)
  
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ]
  
  for (const interval of intervals) {
    const count = Math.floor(diffInSeconds / interval.seconds)
    if (count > 0) {
      return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`
    }
  }
  
  return 'Just now'
} 