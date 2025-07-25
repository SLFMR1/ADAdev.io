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
        '4weeks': 'monthly',    // Last 28 days / 4 weeks
        '3months': '3months',   // Last 3 months
        '52weeks': '52weeks'    // Last 12 months
      }
      
      const mappedPeriod = periodMap[period] || 'monthly'
      
      // Get historical data from the same endpoint as DevelopmentActivityWidget
      const response = await fetch(`/api/development-activity?viewMode=repository&period=${mappedPeriod}`, {
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
      
      const result = {
        resource: resource.name,
        releases: [], // Historical data doesn't include detailed releases
        commits: [], // Historical data doesn't include detailed commits
        commitsPerWeek: resourceData.totalCommits || 0,
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
    const resourcesWithGitHub = resources.filter(resource => resource.social?.github)
    
    if (resourcesWithGitHub.length === 0) {
      logger.log('❌ No resources with GitHub URLs provided')
      return []
    }
    
    logger.log(`🔍 Client requesting global GitHub data for ${resourcesWithGitHub.length} resources`)
    
    try {
      const response = await fetch(`${this.serverBase}/global`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resources: resourcesWithGitHub })
      })
      
      if (!response.ok) {
        // Handle different error types
        if (response.status === 429) {
          throw new Error('GitHub API rate limit exceeded. Please try again later.')
        } else if (response.status >= 500) {
          throw new Error(`Server error (${response.status}). Please try again later.`)
        } else {
          throw new Error(`API error: ${response.status} ${response.statusText}`)
        }
      }
      
      const data = await response.json()
      
      // Validate response data
      if (!Array.isArray(data)) {
        logger.warn('⚠️ Expected array response, got:', typeof data)
        return []
      }
      
      logger.log(`📊 Client received global data for ${data.length} resources`)
      
      // Filter out any invalid entries and ensure proper structure
      const validData = data.filter(item => {
        if (!item || !item.resource) {
          logger.warn('⚠️ Skipping invalid data item:', item)
          return false
        }
        return true
      }).map(item => ({
        resource: item.resource,
        commits: Array.isArray(item.commits) ? item.commits : [],
        releases: Array.isArray(item.releases) ? item.releases : [],
        commitsPerWeek: item.commitsPerWeek || 0,
        weeklyData: Array.isArray(item.weeklyData) ? item.weeklyData : [],
        repoInfo: item.repoInfo || null
      }))
      
      logger.log(`✅ Processed ${validData.length} valid resources`)
      return validData
    } catch (error) {
      logger.error('❌ Client error fetching global GitHub updates:', error)
      
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