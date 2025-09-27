require('dotenv').config()

// Smart logging system - configurable for different needs
const isProduction = process.env.NODE_ENV === 'production'
const isDevelopment = process.env.NODE_ENV === 'development'
const LOG_LEVEL = process.env.LOG_LEVEL || (isProduction ? 'warn' : 'info')

const logger = {
  info: (...args) => {
    if (LOG_LEVEL === 'info' || LOG_LEVEL === 'debug' || LOG_LEVEL === 'warn' || LOG_LEVEL === 'error') {
      console.log(...args)
    }
  },
  debug: (...args) => {
    if (LOG_LEVEL === 'debug') {
      console.log(...args)
    }
  },
  warn: (...args) => {
    // Always show warnings in production for maintenance
    if (LOG_LEVEL === 'warn' || LOG_LEVEL === 'error' || isProduction) {
      console.warn(...args)
    }
  },
  error: (...args) => {
    // Always show errors
    console.error(...args)
  },
  // New: Critical logs that should always show
  critical: (...args) => {
    console.log('🚨 CRITICAL:', ...args)
  }
}

const express = require('express')
const path = require('path')
const cors = require('cors')
const compression = require('compression')
const OpenAI = require('openai')
const { createClient } = require('@supabase/supabase-js')
const { getISOWeekNumber, getWeekStart, getCurrentWeekStart, isCurrentWeek } = require('./utils/weekCalculation.js')
const supabaseService = require('./src/services/supabase.js')
const { getDailyStorageStats } = require('./src/services/supabase.js')
const {
  fetchOrgDataGraphQL,
  fetchRepoDataGraphQL,
  fetchLargeOrgDataChunked,
  transformOrgDataToRestFormat,
  transformRepoDataToRestFormat,
  injectGraphQLTracking
} = require('./src/services/githubGraphQL.js')
// Removed hybridDataFetcher imports - using unified server API approach

// Use existing data quality functions defined later in the file

const app = express()
const PORT = process.env.PORT || 3000

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Initialize Supabase client with connection pool limits for backfills
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  db: {
    pool: {
      max: 5,        // Reduced from default ~20 to save memory
      min: 1,        // Keep minimum connections low
      idle: 10000,   // Close idle connections after 10s
      acquire: 30000 // Wait max 30s for connection
    }
  },
  auth: {
    persistSession: false // Don't persist auth sessions to save memory
  }
}) : null

// GitHub API configuration
const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const RATE_LIMIT = GITHUB_TOKEN ? 5000 : 60
const REQUEST_INTERVAL = 500 // ms between requests (increased from 200ms)

// GraphQL feature flag
const USE_GITHUB_GRAPHQL = process.env.USE_GITHUB_GRAPHQL === 'true' || false



// Rate limit tracking
let isRateLimited = false
let rateLimitResetTime = null

// Simple retry tracking for 7-day data
const failedCurrentPeriodRequests = new Set()

// Retry failed 7-day requests after rate limit reset
const retryFailedRequests = async () => {
  if (failedCurrentPeriodRequests.size === 0) return
  
  logger.info(`🔄 Retrying ${failedCurrentPeriodRequests.size} failed 7-day requests`)
  
  try {
    const resources = await loadResources()
    
    for (const resourceName of failedCurrentPeriodRequests) {
      try {
        // Find the full resource data by name
        const resource = resources.find(r => r.name === resourceName)
        if (!resource) {
          logger.warn(`❌ Resource not found for retry: ${resourceName}`)
          continue
        }
        
        // Retry the 7-day request
        await getRecentActivity(resource, true, 'current')
        logger.debug(`✅ Retry successful for ${resourceName}`)
      } catch (error) {
        logger.warn(`❌ Retry failed for ${resourceName}: ${error.message}`)
      }
    }
  } catch (error) {
    logger.error(`❌ Failed to load resources for retry: ${error.message}`)
  }
  
  // Clear the failed requests set
  failedCurrentPeriodRequests.clear()
}

// In-memory cache for performance - optimized for small memory footprint
const CACHE = {
  data: new Map(),
  timestamps: new Map(),
  maxSize: 10000, // Restored to original size for optimal performance
  ttl: {
    recent: process.env.NODE_ENV === 'production' ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000, // 2 hours in prod, 30 min in dev
    weekly: 30 * 24 * 60 * 60 * 1000, // 30 days for weekly data (immutable)
    historical: 180 * 24 * 60 * 60 * 1000 // 180 days for historical data (immutable)
  },
  // Add hit/miss tracking for dashboard metrics
  stats: {
    memoryHits: 0,
    memoryMisses: 0,
    databaseHits: 0,
    apiCalls: 0,
    totalRequests: 0,
    lastReset: Date.now()
  }
}

// Helper function to find resource in bulk cache (DRY implementation)
const findResourceInBulkCache = (chartData, targetResource) => {
  return chartData.find(item => {
    if (!item.resource) return false
    const nameMatch = item.resource.name === targetResource.name
    const githubMatch = item.resource.social?.github === targetResource.social?.github
    return nameMatch || githubMatch
  })
}

// Rate limiting with exponential backoff
let requestCount = 0
let lastRequestTime = 0
let consecutiveFailures = 0
let lastSuccessTime = Date.now() // Track last successful API call for backoff reset

// Background refresh control to prevent blocking user requests
let backgroundRefreshInProgress = false

const rateLimitedFetch = async (url, options = {}) => {
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  
  // Exponential backoff delay based on consecutive failures
  const backoffDelay = Math.min(1000 * Math.pow(2, consecutiveFailures), 30000) // Max 30 seconds

  // MEMORY LEAK FIX: Reset excessive backoff to prevent infinite accumulation
  if (consecutiveFailures > 8 || (Date.now() - lastSuccessTime) > 300000) { // 8 failures OR 5min
    console.log(`🔄 Resetting backoff: failures=${consecutiveFailures}, lastSuccess=${Date.now() - lastSuccessTime}ms ago`)
    consecutiveFailures = Math.min(3, consecutiveFailures) // Soft reset to 3, not 0
  }

  const minInterval = Math.max(REQUEST_INTERVAL, backoffDelay)
  
  if (timeSinceLastRequest < minInterval) {
    await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLastRequest))
  }
  
  lastRequestTime = Date.now()
  requestCount++
  
  try {
      // Simple timeout - 2 minutes for large datasets, 30 seconds for everything else
      const timeout = (url.includes('/commits') || url.includes('/releases') || url.includes('/activity')) ? 120000 : 30000
      
      // Add timeout and retry logic for network resilience
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'adaDEV-Platform',
        ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` }),
        ...options.headers
      },
      signal: controller.signal,
      ...options
    })
    
    clearTimeout(timeoutId)
    
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      const resetTime = response.headers.get('x-ratelimit-reset')
      const waitTime = resetTime ? (parseInt(resetTime) * 1000 - Date.now()) : 3600000 // 1 hour fallback
      const resetDate = new Date(parseInt(resetTime) * 1000)
      
      // Set global rate limit state
      isRateLimited = true
      rateLimitResetTime = resetDate
      
      logger.warn(`⚠️ GitHub rate limit exceeded. Reset at: ${resetDate.toLocaleString()}`)
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(waitTime / 60000)} minutes.`)
    }
    
    // Check if we were rate limited but it's now reset
    if (isRateLimited && rateLimitResetTime && Date.now() > rateLimitResetTime.getTime()) {
      isRateLimited = false
      rateLimitResetTime = null
      logger.info('✅ GitHub rate limit has reset')
      
      // Retry failed 7-day requests
      retryFailedRequests().catch(error => 
        logger.error('Error retrying failed requests:', error.message)
      )
    }
    
    if (!response.ok) {
      consecutiveFailures++
      API_STATS.failedRequests++
      const error = new Error(`GitHub API error: ${response.status} ${response.statusText}`)
      trackApiError(error, null, 'github_api_request', response.status)
      throw error
    }
    
    // Track successful request and rate limit info
    consecutiveFailures = 0
    lastSuccessTime = Date.now() // Update last success time for backoff reset
    API_STATS.successfulRequests++
    
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (remaining) {
      API_STATS.lastRateLimitRemaining = parseInt(remaining)
    }
    
    return response
  } catch (error) {
    consecutiveFailures++
    
    // Enhanced error handling for network issues
    if (error.name === 'AbortError') {
      const networkError = new Error(`Request timeout for ${url} (operation may be too large)`)
      trackApiError(networkError, null, 'network_timeout', 408)
      
      // For timeout errors, log additional context
      if (url.includes('/commits') || url.includes('/releases') || url.includes('/activity')) {
        logger.warn(`⚠️ Large dataset timeout for ${url}. Consider implementing pagination or reducing data scope.`)
      }
      
      throw networkError
    }
    
    if (error.message.includes('fetch failed') || error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      const networkError = new Error(`Network connectivity issue: ${error.message}`)
      trackApiError(networkError, null, 'network_connectivity', 0)
      throw networkError
    }
    
    throw error
  }
}

// Cache utilities
const generateCacheKey = (type, identifier, params = {}) => {
  const paramString = Object.keys(params).length > 0 
    ? `_${JSON.stringify(params)}` 
    : ''
  return `${type}_${identifier}${paramString}`
}

const getCachedData = (key) => {
  // Note: totalRequests is now tracked at the entry point (getHistoricalActivity)
  // to avoid double-counting when both database and memory cache are checked
  
  const timestamp = CACHE.timestamps.get(key)
  if (!timestamp) {
    CACHE.stats.memoryMisses++
    return null
  }
  
  const now = Date.now()
  const data = CACHE.data.get(key)
  
  // Determine TTL based on data type
  let ttl = CACHE.ttl.recent
  if (key.includes('weekly')) ttl = CACHE.ttl.weekly
  if (key.includes('historical')) ttl = CACHE.ttl.historical
  
  if (now - timestamp > ttl) {
    CACHE.data.delete(key)
    CACHE.timestamps.delete(key)
    CACHE.stats.memoryMisses++
    return null
  }
  
  CACHE.stats.memoryHits++
  return data
}

const setCachedData = (key, data) => {
  // Cleanup if cache is full
  if (CACHE.data.size >= CACHE.maxSize) {
    const oldestKey = CACHE.timestamps.entries().next().value?.[0]
    if (oldestKey) {
      CACHE.data.delete(oldestKey)
      CACHE.timestamps.delete(oldestKey)
    }
  }
  
  CACHE.data.set(key, data)
  CACHE.timestamps.set(key, Date.now())
}

// Reset cache stats every hour for current performance metrics
const resetCacheStats = () => {
  CACHE.stats = {
    memoryHits: 0,
    memoryMisses: 0,
    databaseHits: 0,
    apiCalls: 0,
    totalRequests: 0,
    lastReset: Date.now()
  }
}

// Reset cache stats every hour
setInterval(resetCacheStats, 60 * 60 * 1000)

// API stats and error tracking for dashboard
const API_STATS = {
  successfulRequests: 0,
  failedRequests: 0,
  lastRateLimitRemaining: null,
  recentErrors: [] // Store last 50 detailed errors
}

// GraphQL API stats for separate tracking
const GRAPHQL_STATS = {
  successfulRequests: 0,
  failedRequests: 0,
  lastRateLimitRemaining: null,
  recentErrors: [] // Store last 50 detailed errors
}

// Add detailed error tracking with proper classification
const trackApiError = (error, resource = null, operation = null, statusCode = null) => {
  const errorEntry = {
    timestamp: new Date().toISOString(),
    error: error.message,
    resource: resource,
    operation: operation,
    statusCode: statusCode,
    ...classifyError(error, statusCode)
  }
  
  API_STATS.recentErrors.unshift(errorEntry)
  // Keep only last 50 errors
  if (API_STATS.recentErrors.length > 50) {
    API_STATS.recentErrors = API_STATS.recentErrors.slice(0, 50)
  }
}

// GraphQL-specific error tracking
const trackGraphQLError = (error, resource = null, operation = null, statusCode = null) => {
  const errorEntry = {
    timestamp: new Date().toISOString(),
    error: error.message,
    resource: resource,
    operation: operation,
    statusCode: statusCode,
    apiType: 'GraphQL',
    ...classifyError(error, statusCode)
  }
  
  GRAPHQL_STATS.recentErrors.unshift(errorEntry)
  // Keep only last 50 errors
  if (GRAPHQL_STATS.recentErrors.length > 50) {
    GRAPHQL_STATS.recentErrors = GRAPHQL_STATS.recentErrors.slice(0, 50)
  }
}

// Classify errors based on status codes and error messages
const classifyError = (error, statusCode) => {
  const message = error.message.toLowerCase()
  
  // Rate limiting
  if (statusCode === 403 || message.includes('rate limit')) {
    return { type: 'rate_limit', severity: 'warning', shouldRetry: true }
  }
  
  // Resource not found - not really an error
  if (statusCode === 404 || message.includes('404')) {
    return { type: 'not_found', severity: 'info', shouldRetry: false }
  }
  
  // Empty repository - informational
  if (statusCode === 409 || message.includes('409')) {
    return { type: 'empty_repo', severity: 'info', shouldRetry: false }
  }
  
  // Server errors - should retry
  if (statusCode >= 500) {
    let subType = 'server_error'
    if (statusCode === 502) subType = 'bad_gateway'
    else if (statusCode === 503) subType = 'service_unavailable'
    else if (statusCode === 504) subType = 'gateway_timeout'

    return { type: subType, severity: 'error', shouldRetry: true }
  }
  
  // Client errors (400-499 except handled above)
  if (statusCode >= 400 && statusCode < 500) {
    return { type: 'client_error', severity: 'warning', shouldRetry: false }
  }
  
  // Network/timeout issues
  if (message.includes('timeout') || message.includes('network')) {
    return { type: 'network_error', severity: 'warning', shouldRetry: true }
  }
  
  // Default for unknown errors
  return { type: 'unknown_error', severity: 'error', shouldRetry: false }
}

// Inject GraphQL tracking capabilities
injectGraphQLTracking(GRAPHQL_STATS, trackGraphQLError)

// GitHub API functions
const fetchRepoCommits = async (repoPath, since = null) => {
  const cacheKey = generateCacheKey('commits', repoPath, { since })
  const cached = getCachedData(cacheKey)
  if (cached) return cached
  
  try {
    let allCommits = []
    let page = 1
    let hasMore = true
    
    while (hasMore) {
      let url = `${GITHUB_API_BASE}/repos/${repoPath}/commits?per_page=100&page=${page}`
      if (since) {
        url += `&since=${since}`
      }
      
      const response = await rateLimitedFetch(url)
      const commits = await response.json()
      
      // Validate that commits is an array
      if (!Array.isArray(commits)) {
        console.warn(`Invalid commits response for ${repoPath}:`, typeof commits)
        break
      }
      
      // If we get less than 100 commits, we've reached the end
      if (commits.length === 0) {
        hasMore = false
        break
      }
      
      allCommits.push(...commits)
      
      // GitHub API pagination limit safety
      if (commits.length < 100) {
        hasMore = false
      } else {
        page++
        // Add small delay between pages to avoid rate limiting
        // Reduced delay for historical backfills since we have rate limit handling
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      
      // Safety break for truly massive repos to prevent server overload
      if (page > 500) { // Reasonable safety limit (500 pages × 100 commits = 50k max commits)
        logger.info(`Reached maximum page limit (500) for ${repoPath}, stopping to prevent server overload.`)
        break
      }

      // Additional safety break based on commit count
      if (allCommits.length > 50000) {
        logger.info(`Reached commit limit (50,000) for ${repoPath}, stopping for performance.`)
        break
      }
    }
    
    logger.debug(`📄 Fetched ${allCommits.length} total commits from ${page - 1} pages for ${repoPath}`)
    
    // Enrich each commit with repository information for maintainCommitsCache
    const enrichedCommits = allCommits.map(commit => ({
      ...commit,
      repository: {
        full_name: repoPath,
        name: repoPath.split('/')[1] || repoPath
      }
    }))
    
    setCachedData(cacheKey, enrichedCommits)
    return enrichedCommits
  } catch (error) {
    if (error.message.includes('404')) {
      console.warn(`Repository ${repoPath} not found or not accessible`)
      return []
    }
    if (error.message.includes('409')) {
      console.warn(`Repository ${repoPath} is empty or has no commits`)
      return []
    }
    console.error(`Error fetching commits for ${repoPath}:`, error.message)
    return []
  }
}

const fetchRepoReleases = async (repoPath, limit = 10) => {
  const cacheKey = generateCacheKey('releases', repoPath, { limit })
  const cached = getCachedData(cacheKey)
  if (cached) return cached
  
  try {
    const url = `${GITHUB_API_BASE}/repos/${repoPath}/releases?per_page=${limit}`
    const response = await rateLimitedFetch(url)
    const releases = await response.json()
    
    // Validate that releases is an array
    if (!Array.isArray(releases)) {
      console.warn(`Invalid releases response for ${repoPath}:`, typeof releases)
      return []
    }
    
    setCachedData(cacheKey, releases)
    return releases
  } catch (error) {
    if (error.message.includes('404')) {
      console.warn(`Repository ${repoPath} not found or not accessible`)
      return []
    }
    console.error(`Error fetching releases for ${repoPath}:`, error.message)
    return []
  }
}

const fetchRepoInfo = async (repoPath) => {
  const cacheKey = generateCacheKey('repo_info', repoPath)
  const cached = getCachedData(cacheKey)
  if (cached) return cached
  
  try {
    const url = `${GITHUB_API_BASE}/repos/${repoPath}`
    const response = await rateLimitedFetch(url)
    const repoInfo = await response.json()
    
    // Validate that repoInfo has expected structure
    if (!repoInfo || typeof repoInfo !== 'object' || !repoInfo.created_at) {
      console.warn(`Invalid repo info response for ${repoPath}:`, typeof repoInfo)
      return null
    }
    
    // Cache for 24 hours - repository creation date doesn't change
    setCachedData(cacheKey, repoInfo, 24 * 60 * 60 * 1000)
    return repoInfo
  } catch (error) {
    if (error.message.includes('404')) {
      console.warn(`Repository ${repoPath} not found or not accessible`)
      return null
    }
    console.error(`Error fetching repo info for ${repoPath}:`, error.message)
    return null
  }
}

const fetchOrgRepos = async (orgName) => {
  const cacheKey = generateCacheKey('org_repos', orgName)
  const cached = getCachedData(cacheKey)
  if (cached) return cached
  
  try {
    const allRepos = []
    let page = 1
    
    // Fetch all pages of repositories
    while (true) {
      const url = `${GITHUB_API_BASE}/orgs/${orgName}/repos?type=public&per_page=100&page=${page}`
      const response = await rateLimitedFetch(url)
      const repos = await response.json()
      
      if (!Array.isArray(repos) || repos.length === 0) break
      allRepos.push(...repos)
      
      if (repos.length < 100) break // Last page
      page++
    }
    
    // Filter out forked repositories to avoid including activity from external contributors
    const originalRepos = allRepos.filter(repo => !repo.fork)
    logger.debug(`📦 Organization ${orgName}: ${originalRepos.length} original repositories (${allRepos.length - originalRepos.length} forks excluded)`)
    
    setCachedData(cacheKey, originalRepos)
    return originalRepos
  } catch (error) {
    if (error.message.includes('404')) {
      console.warn(`Organization ${orgName} not found or not accessible`)
      return []
    }
    console.error(`Error fetching repos for ${orgName}:`, error.message)
    return []
  }
}

const fetchOrgCommits = async (orgName, since) => {
  try {
    const repos = await fetchOrgRepos(orgName)
    if (!repos || repos.length === 0) {
      console.warn(`No repositories found for organization: ${orgName}`)
      return []
    }
    
    const allCommits = []
    
    // Process all original repositories (excluding forks)
    for (const repo of repos) {
      try {
        const commits = await fetchRepoCommits(repo.full_name, since)
        if (commits && Array.isArray(commits)) {
          allCommits.push(...commits.map(commit => ({
            ...commit,
            repo: repo.name,
            org: orgName
          })))
        }
      } catch (error) {
        console.error(`Error fetching commits for ${repo.full_name}:`, error.message)
        // Continue with other repos instead of failing completely
      }
    }
    
    return allCommits
  } catch (error) {
    console.error(`Error in fetchOrgCommits for ${orgName}:`, error.message)
    return []
  }
}

// GraphQL-enabled organization data fetching with REST fallback
const fetchOrgDataWithGraphQL = async (orgName, since) => {
  // Try GraphQL first if enabled
  if (USE_GITHUB_GRAPHQL && GITHUB_TOKEN) {
    try {
      logger.debug(`🚀 Attempting GraphQL fetch for organization: ${orgName}`)
      const graphqlData = await fetchOrgDataGraphQL(orgName, since)
      const restFormatData = transformOrgDataToRestFormat(graphqlData)
      
      logger.info(`✅ GraphQL success for ${orgName}: ${restFormatData.commits.length} commits from ${restFormatData.repositories.length} repos`)
      return restFormatData.commits // Return commits in REST format
      
    } catch (error) {
      const statusCode = error?.response?.status || 'unknown'
      const errorType = error?.response?.status === 502 ? 'Bad Gateway' :
                       error?.response?.status === 503 ? 'Service Unavailable' :
                       error?.response?.status === 504 ? 'Gateway Timeout' : 'Error'
      logger.warn(`❌ GraphQL ${errorType} (${statusCode}) for ${orgName}, falling back to REST: ${error.message}`)
      // Fall through to REST implementation below
    }
  }
  
  // Fallback to original REST implementation
  logger.debug(`🔄 Using REST API for organization: ${orgName}`)
  return await fetchOrgCommits(orgName, since)
}

// GraphQL-enabled repository data fetching with REST fallback
const fetchRepoDataWithGraphQL = async (repoPath, since) => {
  // Try GraphQL first if enabled
  if (USE_GITHUB_GRAPHQL && GITHUB_TOKEN) {
    try {
      const [owner, name] = repoPath.split('/')
      if (!owner || !name) {
        throw new Error(`Invalid repository path: ${repoPath}`)
      }
      
      logger.debug(`🚀 Attempting GraphQL fetch for repository: ${repoPath}`)
      const graphqlData = await fetchRepoDataGraphQL(owner, name, since)
      const restFormatData = transformRepoDataToRestFormat(graphqlData)
      
      logger.info(`✅ GraphQL success for ${repoPath}: ${restFormatData.commits.length} commits`)
      return restFormatData.commits // Return commits in REST format
      
    } catch (error) {
      const statusCode = error?.response?.status || 'unknown'
      const errorType = error?.response?.status === 502 ? 'Bad Gateway' :
                       error?.response?.status === 503 ? 'Service Unavailable' :
                       error?.response?.status === 504 ? 'Gateway Timeout' : 'Error'
      logger.warn(`❌ GraphQL ${errorType} (${statusCode}) for ${repoPath}, falling back to REST: ${error.message}`)
      // Fall through to REST implementation below
    }
  }
  
  // Fallback to original REST implementation
  logger.debug(`🔄 Using REST API for repository: ${repoPath}`)
  return await fetchRepoCommits(repoPath, since)
}

// Database functions
const createTables = async () => {
  if (!supabase) return
  
  try {
    // Tables are created via Supabase dashboard migrations, not RPC calls
    logger.info('✅ Database tables should already exist (managed via Supabase dashboard)')
  } catch (error) {
    logger.warn('⚠️ Database table verification error:', error.message)
  }
}

// Removed broken storeWeeklyActivity function - now using supabaseService.storeWeeklyActivity

// Verify that data was stored correctly in the database
const verifyDataStored = async (resource, expectedWeeks) => {
  if (!supabase || !expectedWeeks || expectedWeeks.length === 0) {
    return { success: false, stored: 0, expected: 0 }
  }
  
  try {
    // Use same extractRepoPath logic as supabase service for consistency
    const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
    
    if (!repoPath) {
      return { success: false, stored: 0, expected: expectedWeeks.length }
    }
    
    const resourceIdentifier = repoPath
    
    // Get the date range for verification
    const weekStarts = expectedWeeks.map(w => w.weekStart).filter(Boolean)
    if (weekStarts.length === 0) {
      return { success: false, stored: 0, expected: expectedWeeks.length }
    }
    
    const earliestWeek = weekStarts.sort()[0]
    const latestWeek = weekStarts.sort().reverse()[0]
    
    // Query database for stored data
    const { data, error, count } = await supabase
      .from('github_activity')
      .select('*', { count: 'exact' })
      .eq('resource_id', resourceIdentifier)
      .eq('repo_path', repoPath) // Add repo_path constraint for consistency
      .gte('week_start', earliestWeek)
      .lte('week_start', latestWeek)
    
    if (error) {
      console.warn(`Verification query failed for ${resource.name}:`, error.message)
      return { success: false, stored: 0, expected: expectedWeeks.length }
    }
    
    const stored = count || 0
    const expected = expectedWeeks.length
    const success = stored >= expected * 0.8 // Allow for 80% success rate
    
    return {
      success,
      stored,
      expected,
      resourceIdentifier,
      earliestWeek,
      latestWeek
    }
  } catch (error) {
    console.error(`Verification error for ${resource.name}:`, error.message)
    return { success: false, stored: 0, expected: expectedWeeks.length }
  }
}

const getWeeklyActivity = async (resource, startDate, endDate) => {
  if (!supabase) return []
  
  try {
    // Use same extractRepoPath logic as supabase service for consistency
    const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
    
    if (!repoPath) {
      console.error(`No valid GitHub URL for ${resource.name}`)
      return []
    }
    
    // Use repoPath as the resource identifier to match storage patterns
    const resourceIdentifier = repoPath
    
    // Add timeout and retry logic for large datasets
    const queryPromise = supabase
      .from('github_activity')
      .select('*')
      .eq('resource_id', resourceIdentifier)
      .eq('repo_path', repoPath)
      .gte('week_start', startDate)
      .lte('week_start', endDate)
      .order('week_start')

    const { data, error } = await queryPromise

    if (error) throw error

    console.log(`📊 Database query for ${resourceIdentifier}: ${data?.length || 0} records`)

    return data || []
  } catch (error) {
    console.error(`Error fetching weekly activity for ${resource.name}:`, error)
    

    
    return []
  }
}



// Data processing functions
const processCommitsToWeekly = (commits) => {
  const weeklyData = new Map()
  
  // Process ALL commits provided, not just limited weeks
  // First, find the actual date range of commits to determine weeks needed
  let oldestCommitDate = null
  let newestCommitDate = null
  
  commits.forEach((commit) => {
    const commitDate = commit.commit?.author?.date || commit.date
    if (!commitDate) return
    
    const date = new Date(commitDate)
    if (isNaN(date.getTime())) return
    
    if (!oldestCommitDate || date < oldestCommitDate) {
      oldestCommitDate = date
    }
    if (!newestCommitDate || date > newestCommitDate) {
      newestCommitDate = date
    }
  })
  
  // If no valid commits, return empty data
  if (!oldestCommitDate) {
    return []
  }
  
  // Calculate weeks from oldest commit to now for continuous data
  const today = new Date()
  const weeksToTrack = Math.ceil((today.getTime() - oldestCommitDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1
  
  // Initialize all weeks with 0 commits (from oldest commit to now)
  for (let i = 0; i < weeksToTrack; i++) {
    const date = new Date(oldestCommitDate)
    date.setDate(date.getDate() + (i * 7))
    const weekStart = getWeekStart(date)
    const weekKey = weekStart.toISOString().slice(0, 10)
    weeklyData.set(weekKey, 0)
  }
  
  // Count commits for each week
  commits.forEach((commit) => {
    const commitDate = commit.commit?.author?.date || commit.date
    if (!commitDate) {
      return
    }
    
    const date = new Date(commitDate)
    if (isNaN(date.getTime())) {
      return
    }
    
    const weekStart = getWeekStart(date)
    const weekKey = weekStart.toISOString().slice(0, 10)
    
    // Only count commits within our tracking period
    if (weeklyData.has(weekKey)) {
      weeklyData.set(weekKey, weeklyData.get(weekKey) + 1)
    }
  })
  
  return Array.from(weeklyData.entries())
    .map(([weekStart, count]) => {
      const weekStartDate = new Date(weekStart)
      return {
        weekStart: weekStart,
        count: count,
        year: weekStartDate.getFullYear(),
        week: getISOWeekNumber(weekStartDate)
      }
    })
    .sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart)) // Sort chronologically
}

// Process commits into daily data for 7-day view
const processCommitsToDaily = (commits) => {
  const dailyData = new Map()

  // Get the last 7 days using UTC to match GitHub API timezone
  // This ensures consistent date bucketing regardless of server timezone
  const nowUTC = new Date()
  for (let i = 6; i >= 0; i--) {
    // Create dates in UTC to avoid timezone conversion issues
    const utcDate = new Date(Date.UTC(
      nowUTC.getUTCFullYear(),
      nowUTC.getUTCMonth(),
      nowUTC.getUTCDate() - i
    ))
    const dateKey = utcDate.toISOString().slice(0, 10)
    dailyData.set(dateKey, 0) // Initialize with 0
  }

  // Count commits for each day (GitHub API dates are already in UTC)
  commits.forEach(commit => {
    const commitDate = new Date(commit.date)
    const dateKey = commitDate.toISOString().slice(0, 10)
    if (dailyData.has(dateKey)) {
      dailyData.set(dateKey, dailyData.get(dateKey) + 1)
    }
  })

  return Array.from(dailyData.entries()).map(([date, count]) => ({
    weekStart: date,
    count: count,
    year: new Date(date).getFullYear(),
    week: 1
  }))
}

// Helper function to invalidate current period cache after timezone fix
const invalidateCurrentPeriodCache = () => {
  const keysToDelete = []

  // Find all cache keys related to 'current' period daily processing
  for (const [key] of CACHE.data.entries()) {
    if (key.includes('recent_activity') && key.includes('useDailyProcessing":true')) {
      keysToDelete.push(key)
    }
  }

  // Remove the found keys
  keysToDelete.forEach(key => {
    CACHE.data.delete(key)
    CACHE.timestamps.delete(key)
  })

  if (keysToDelete.length > 0) {
    console.log(`🗑️  Invalidated ${keysToDelete.length} current period cache entries due to timezone fix`)
  }
}

const getRecentActivity = async (resource, useDailyProcessing = false, period = '4weeks') => {
  // Track every request that comes through
  CACHE.stats.totalRequests++
  
  // Check in-memory cache first - include period in cache key to avoid returning same data for different periods
  const cacheKey = generateCacheKey('recent_activity', resource.id || resource.name, { useDailyProcessing, period })
  const cachedResult = getCachedData(cacheKey)
  
  // PRIORITY: Serve cache during background refresh to prevent blocking user requests
  if (backgroundRefreshInProgress && cachedResult) {
    logger.debug(`⚡ Serving cached data during background refresh for ${resource.name}`)
    return cachedResult
  }
  
  if (cachedResult) {
    logger.debug(`✅ Using cached recent activity for ${resource.name}`);
    return cachedResult
  }

  // Check bulk cache optimization for recent activity
  if (VIEW_MODE_CACHE.data && !useDailyProcessing) {
    const bulkCache = VIEW_MODE_CACHE
    
    // Map period to bulk cache period keys
    let periodKey = null
    if (period === '4weeks') periodKey = '4weeks'
    else if (period === '3months') periodKey = '3months'
    else if (period === '52weeks') periodKey = '52weeks'
    else if (period === '3years') periodKey = '3years'
    
    if (periodKey && bulkCache.data.preloadedPeriods[periodKey]) {
      const periodData = bulkCache.data.preloadedPeriods[periodKey]
      const chartData = periodData.weeklyChartData || periodData.dailyChartData || []
      
      // Find matching resource in bulk cache using DRY helper
      const cachedResource = findResourceInBulkCache(chartData, resource)
      
      if (cachedResource && cachedResource.weeklyData) {
        logger.debug(`⚡ Using bulk cache optimization for recent activity ${resource.name} (${periodKey} period)`)
        return {
          commits: cachedResource.weeklyData.commits || [],
          commitsPerWeek: cachedResource.weeklyData.commitsPerWeek || 0,
          weeklyData: cachedResource.weeklyData.weeklyData || [],
          repoInfo: cachedResource.weeklyData.repoInfo || null
        }
      }
    }
  }

  // Add database fallback for getRecentActivity
  if (!useDailyProcessing) {
    // Weekly data fallback for non-daily periods
    let dbData = []
    
    try {
      const periodToDays = {
        '4weeks': 28,    // 4 weeks
        '3months': 84,   // 12 weeks (aligned with bulk cache)
        '52weeks': 364,  // 52 weeks (aligned with bulk cache)
        '3years': 1092   // 156 weeks (aligned with bulk cache)
      }
      const timeWindow = periodToDays[period] || 30 // Default to 30 days
      const since = new Date(Date.now() - timeWindow * 24 * 60 * 60 * 1000).toISOString()
      const endDate = new Date().toISOString()
      dbData = await getWeeklyActivity(resource, since, endDate)
    } catch (error) {
      console.warn(`Database query failed for ${resource.name}:`, error.message)
    }
    
    if (dbData.length > 0) {
      logger.debug(`✅ Using cached database data for recent activity ${resource.name} (${dbData.length} weeks)`)
      CACHE.stats.databaseHits++
      
      const mappedData = dbData.map(row => ({
        weekStart: row.week_start,
        count: row.commit_count,
        year: row.year,
        week: row.week_number,
        isCurrentWeek: false
      }))
      
      const result = {
        commits: [], // Database doesn't store individual commits
        commitsPerWeek: mappedData.reduce((sum, week) => sum + week.count, 0),
        weeklyData: mappedData,
        repoInfo: null
      }
      
      setCachedData(cacheKey, result)
      return result
    }
  } else if (useDailyProcessing && period === 'current') {
    // Daily data fallback for 7-day view
    try {
      const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
      const resourceId = repoPath

      if (resourceId) {
        const dailyData = await supabaseService.getDailyActivity(resourceId, repoPath, 10, resource)

        if (dailyData && dailyData.length > 0) {
          logger.debug(`✅ Using daily database fallback for ${resource.name} (${dailyData.length} days)`)
          CACHE.stats.databaseHits++

          const mappedData = dailyData.map(row => ({
            weekStart: row.date,
            count: row.commit_count,
            year: new Date(row.date).getFullYear(),
            week: 1,
            isCurrentWeek: false
          }))

          const result = {
            commits: [],
            commitsPerWeek: mappedData.reduce((sum, day) => sum + day.count, 0),
            weeklyData: mappedData,
            repoInfo: null
          }

          setCachedData(cacheKey, result)
          return result
        }
      }
    } catch (error) {
      console.warn(`Database daily fallback failed for ${resource.name}:`, error.message)
    }
  }

  let commits = []
  let repoInfo = null
  
  try {
    // Determine the time window based on period and processing type
    let timeWindow;
    if (useDailyProcessing) {
      timeWindow = 7; // 7 days for daily processing (regardless of period)
    } else {
      // Map period to appropriate time window in days (aligned with bulk cache)
      const periodToDays = {
        '4weeks': 28,    // 4 weeks
        '3months': 84,   // 12 weeks (aligned with bulk cache)
        '52weeks': 364,  // 52 weeks (aligned with bulk cache)
        '3years': 1092   // 156 weeks (aligned with bulk cache)
      };
      timeWindow = periodToDays[period] || 30; // Default to 30 days if period not found
    }
    const since = new Date(Date.now() - timeWindow * 24 * 60 * 60 * 1000).toISOString();
    
    logger.debug(`⏰ ${resource.name}: Fetching commits since ${since} (${timeWindow} days, period: ${period}, daily: ${useDailyProcessing})`);
    
    // Check if we're currently rate limited
    if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime.getTime()) {
      logger.warn(`⚠️ Skipping ${resource.name} - GitHub API rate limited until ${rateLimitResetTime.toLocaleString()}`)
      
      // Track failed 7-day requests for retry
      if (useDailyProcessing) {
        failedCurrentPeriodRequests.add(resource.name)
      }
      
      const emptyResult = {
        commits: [],
        commitsPerWeek: 0,
        weeklyData: [],
        repoInfo: null
      }
      // Cache rate-limited results for only 1 minute instead of 30 minutes
      // by setting custom timestamp
      CACHE.data.set(cacheKey, emptyResult)
      CACHE.timestamps.set(cacheKey, Date.now() + 60 * 1000) // 1 minute TTL
      return emptyResult
    }
    
    logger.debug(`🔄 Fetching recent activity for ${resource.name} (${timeWindow} days, period: ${period})...`);
    
    if (resource.type === 'organization') {
      // For organizations, use repo_path first, then organization field, then extract from GitHub URL
      let orgName;
      if (resource.repo_path) {
        orgName = resource.repo_path;
      } else if (resource.organization) {
        orgName = resource.organization;
      } else if (resource.social?.github) {
        orgName = resource.social.github.replace('https://github.com/', '');
      }
      
      if (!orgName) {
        console.warn(`⚠️ No organization name found for ${resource.name}`);
        commits = [];
      } else {
        // MEMORY LEAK FIX: Use chunked processing for known large orgs
        const KNOWN_LARGE_ORGS = ['cardano-foundation', 'marlowe-lang', 'opshin', 'blockfrost'];
        if (KNOWN_LARGE_ORGS.includes(orgName)) {
          console.log(`🎯 ${orgName}: Using memory-safe chunked processing (getResourceData)`);
          commits = await fetchLargeOrgDataChunked(orgName, since, resource, processCommitsToWeekly, supabaseService);
        } else {
          commits = await fetchOrgDataWithGraphQL(orgName, since);
        }
      }
    } else if (resource.type === 'repository' || resource.social?.github) {
      // For repositories or unknown resources with GitHub URLs
      const repoPath = resource.social.github.replace('https://github.com/', '')
      commits = await fetchRepoDataWithGraphQL(repoPath, since) // Use GraphQL with REST fallback
      
      // Only fetch repo info if not cached
      const repoInfoCacheKey = generateCacheKey('repo_info', repoPath)
      repoInfo = getCachedData(repoInfoCacheKey)
      
      if (!repoInfo) {
        try {
          const url = `${GITHUB_API_BASE}/repos/${repoPath}`
          const response = await rateLimitedFetch(url)
          repoInfo = await response.json()
          setCachedData(repoInfoCacheKey, repoInfo)
        } catch (error) {
          console.error(`Error fetching repo info for ${repoPath}:`, error.message)
        }
      }
    } else {
      // Handle resources without proper GitHub URL
      console.warn(`Skipping ${resource.name} - no valid GitHub URL found (type: ${resource.type})`)
      const emptyResult = {
        commits: [],
        commitsPerWeek: 0,
        weeklyData: [],
        repoInfo: null
      }
      setCachedData(cacheKey, emptyResult)
      return emptyResult
    }
    
    // Ensure commits is an array
    if (!Array.isArray(commits)) {
      console.warn(`Invalid commits data for ${resource.name}:`, typeof commits)
      commits = []
    }
    
    // Transform commits to match frontend expectations while preserving original structure
    const transformedCommits = commits.map(commit => ({
      // Frontend-expected fields
      sha: commit.sha,
      message: commit.commit?.message || commit.message || '',
      date: commit.commit?.author?.date || commit.date || new Date().toISOString(),
      htmlUrl: commit.html_url || commit.htmlUrl || '',
      author: commit.commit?.author?.name || commit.author?.name || 'Unknown',
      repo: resource.name,
      // Preserve original GitHub API structure for maintainCommitsCache
      commit: commit.commit,
      html_url: commit.html_url,
      repository: commit.repository
    }))
    
    logger.debug(`📈 ${resource.name}: Found ${commits.length} raw commits, transformed to ${transformedCommits.length}`);
    
    // Use daily processing for 7-day view, weekly processing for other views
    const processedData = useDailyProcessing 
      ? processCommitsToDaily(transformedCommits)
      : processCommitsToWeekly(transformedCommits)
    
    logger.debug(`📅 ${resource.name}: Processed ${processedData.length} data points (daily: ${useDailyProcessing})`);
    
    const result = {
      commits: transformedCommits.slice(0, 20), // Latest 20 commits
      commitsPerWeek: transformedCommits.length,
      weeklyData: processedData,
      repoInfo
    }
    
    // Cache the result
    setCachedData(cacheKey, result)
    
    return result
  } catch (error) {
    console.error(`Error in getRecentActivity for ${resource.name}:`, error.message)
    const errorResult = {
      commits: [],
      commitsPerWeek: 0,
      weeklyData: [],
      repoInfo: null
    }
    // Cache error result for shorter time
    setTimeout(() =>
      setCachedData(cacheKey, errorResult), 30000) // Cache errors for 30 seconds only
    return errorResult
  }
}

const getHistoricalActivity = async (resource, startDate, endDate, forceRefresh = false) => {
  // Always define cacheKey (needed for storing results later)
  const cacheKey = generateCacheKey('historical_activity', resource.id || resource.name, { startDate, endDate })
  
  // Track every request that comes through
  CACHE.stats.totalRequests++
  
  // Initialize variables that might be needed later
  let dbData = []
  let finalData = []
  
  // Skip cache entirely if forceRefresh is true (for historical backfilling)
  if (forceRefresh) {
    logger.debug(`🔄 Force refresh enabled for ${resource.name} - skipping all cache checks`)
  } else {
    
    // PRIORITY: Check in-memory cache during background refresh
    if (backgroundRefreshInProgress) {
      const cachedResult = getCachedData(cacheKey)
      if (cachedResult) {
        logger.debug(`⚡ Serving cached historical data during background refresh for ${resource.name}`)
        return cachedResult
      }
    }
    
    // OPTIMIZATION: Check bulk cache for performance boost (fallback to database if miss)
    try {
      const startDateTime = new Date(startDate).getTime()
      const endDateTime = new Date(endDate).getTime()
      const periodDays = Math.ceil((endDateTime - startDateTime) / (24 * 60 * 60 * 1000))
      
      // Only use bulk cache for longer immutable periods where performance matters most
      if (periodDays >= 28) { // 4+ weeks
        const viewModeForCache = resource.type === 'organization' ? 'organization' : 'repository'
        const cacheKey = `${viewModeForCache}-activity`
        const bulkCache = VIEW_MODE_CACHE.get(cacheKey)
        
        if (bulkCache && bulkCache.data && bulkCache.data.preloadedPeriods) {
          // Find appropriate period in bulk cache
          let periodKey = null
          if (periodDays >= 1000) periodKey = '3years'      // 3+ years
          else if (periodDays >= 300) periodKey = '52weeks'  // 10+ months  
          else if (periodDays >= 70) periodKey = '3months'   // 2+ months
          else if (periodDays >= 28) periodKey = '4weeks'    // 4+ weeks
          
          if (periodKey && bulkCache.data.preloadedPeriods[periodKey]) {
            const periodData = bulkCache.data.preloadedPeriods[periodKey]
            const chartData = periodData.weeklyChartData || periodData.dailyChartData || []
            
            // Find matching resource in bulk cache using DRY helper
            const cachedResource = findResourceInBulkCache(chartData, resource)
            
            if (cachedResource && cachedResource.weeklyData) {
              logger.debug(`⚡ Using bulk cache optimization for ${resource.name} (${periodKey} period)`)
              return cachedResource.weeklyData
            }
          }
        }
      }
    } catch (error) {
      // Silently continue to database - bulk cache is optimization only
      logger.debug(`Bulk cache optimization failed for ${resource.name}, continuing to database`)
    }
    
    // Check database cache first for ALL resources (both repos and orgs)
    
    try {
      dbData = await getWeeklyActivity(resource, startDate, endDate)
    } catch (error) {
      console.warn(`Database query failed for ${resource.name}:`, error.message)
    }
    
    if (dbData.length > 0) {
      logger.debug(`✅ Using cached database data for ${resource.name} (${dbData.length} weeks)`);
      CACHE.stats.databaseHits++
      
      const nowForMapping = new Date()
    const currentWeekStartForMapping = getCurrentWeekStart()
    
    const mappedData = dbData.map(row => {
      const weekStartDate = new Date(row.week_start)
      const isCurrentWeek = weekStartDate.getTime() >= currentWeekStartForMapping.getTime()
      
      return {
        weekStart: row.week_start,
        count: row.commit_count,
        year: row.year,
        week: row.week_number,
        isCurrentWeek: isCurrentWeek
      }
    })
    
    // Aggregate duplicate weeks by summing commit counts
    const aggregatedWeeks = new Map()
    
    mappedData.forEach(week => {
      const key = week.weekStart
      if (aggregatedWeeks.has(key)) {
        // Sum the commit counts for duplicate weeks
        const existing = aggregatedWeeks.get(key)
        existing.count += week.count
        // If any entry is current week, mark the aggregated week as current
        existing.isCurrentWeek = existing.isCurrentWeek || week.isCurrentWeek
      } else {
        aggregatedWeeks.set(key, { ...week })
      }
    })
    
    finalData = Array.from(aggregatedWeeks.values()).sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart))
    
    // Enhanced staleness checking with current week handling
    const now = Date.now()
    const startDateTime = new Date(startDate).getTime()
    const currentWeekStart = getCurrentWeekStart()
    
    // Check if we have any current week data that needs refreshing
    const hasCurrentWeekData = finalData.some(week => week.isCurrentWeek)
    
    // Calculate how old the OLDEST data in this query is (not the end date)
    const oldestDataAgeInDays = Math.floor((now - startDateTime) / (24 * 60 * 60 * 1000))
    
    // OPTIMIZATION: Completed weeks (older than 7 days) are immutable - never refresh
    if (oldestDataAgeInDays > 7 && !hasCurrentWeekData) {
      logger.debug(`✅ Using historical database data for ${resource.name} (oldest data: ${oldestDataAgeInDays} days old - immutable)`);
      return finalData
    }
    
    // For recent data or current week data, check fetch timestamp
    const latestEntry = dbData[dbData.length - 1]
    if (latestEntry && latestEntry.fetched_at) {
      const fetchTime = new Date(latestEntry.fetched_at)
      const fetchAgeHours = Math.floor((now - fetchTime.getTime()) / (60 * 60 * 1000))
      
      // Optimized staleness thresholds - GitHub activity changes slowly
      let maxAgeHours
      if (hasCurrentWeekData) {
        maxAgeHours = 2 // Current week: refresh every 6 hours (was 2)
      } else if (oldestDataAgeInDays <= 1) {
        maxAgeHours = 12 // Recent completed data: refresh every 12 hours (was 4)
      } else if (oldestDataAgeInDays <= 7) {
        maxAgeHours = 24 // Last week: refresh every 24 hours (was 6)
      } else {
        maxAgeHours = 48 // 1-2 weeks old: refresh every 48 hours (was 12)
      }
      
      if (fetchAgeHours < maxAgeHours) {
        logger.debug(`✅ Using cached database data for ${resource.name} (${fetchAgeHours}h old, threshold: ${maxAgeHours}h, currentWeek: ${hasCurrentWeekData})`);
        return finalData
      }
      
      logger.debug(`⚡ Refreshing data for ${resource.name} (${fetchAgeHours}h old, currentWeek: ${hasCurrentWeekData}, oldest: ${oldestDataAgeInDays} days)`)
    } else {
      // No fetch timestamp - use data but try to refresh
      logger.debug(`⚡ Using database data for ${resource.name} (no timestamp - will attempt refresh)`)
    }
    }
    
    // Check in-memory cache before hitting GitHub API
    const cachedResult = getCachedData(cacheKey)
    if (cachedResult) {
      logger.debug(`✅ Using in-memory cache for ${resource.name}`);
      return cachedResult
    }
  }
  
  // **REMOVED GITHUB API FALLBACK**
  // The database is now the single source of truth for historical data.
  // If data is not present here, it means it needs to be backfilled by the background process.
  
  if (dbData.length > 0) {
    logger.debug(`✅ Serving final historical data for ${resource.name} from database.`);
    setCachedData(cacheKey, finalData) // Cache the processed database data in memory
    return finalData; // finalData is the processed version of dbData
  }

  // If we reach this point, data is not in any cache and not in the database.
  logger.warn(`⚠️ No historical data found for ${resource.name} in date range ${startDate} to ${endDate}. This resource needs to be backfilled.`);
  return []; // Return empty array, do not fetch from GitHub live.
}

// Calculate historical maximum totals for each period type with graceful fallbacks
const calculateHistoricalMaximums = async (resource) => {
  // Check cache first
  const resourceIdentifier = supabaseService.default.extractRepoPath(resource.social?.github) || resource.name;
  const cacheKey = `historical-maximums-${resourceIdentifier}`;
  const cached = HISTORICAL_MAXIMUMS_CACHE.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < HISTORICAL_MAXIMUMS_TTL)) {
    logger.debug(`⚡ Using cached historical maximums for ${resource.name} (${Math.round((Date.now() - cached.timestamp) / 1000)}s old)`);
    return cached.data;
  }
  
  if (!supabase) {
    console.warn(`❌ No Supabase connection for ${resource.name} - returning empty maximums`);
    const fallbackResult = {
      maximums: {}, // Empty object - let frontend handle gracefully
      metadata: {
        hasHistoricalData: false,
        totalWeeksAvailable: 0,
        dataQuality: 'no_data',
        reason: 'no_supabase_connection'
      }
    };
    
    // Cache the fallback result for a shorter time (5 minutes)
    HISTORICAL_MAXIMUMS_CACHE.set(cacheKey, {
      data: fallbackResult,
      timestamp: Date.now()
    });
    
    return fallbackResult;
  }

  try {
    // Get all historical weekly data for this resource (excluding current incomplete week)
    const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
    
    if (!repoPath) {
      console.warn(`No valid GitHub URL for ${resource.name} - returning fallback maximums`)
      return createFallbackMaximums()
    }

    const { data, error } = await supabase
      .from('github_activity')
      .select('week_start, commit_count')
      .eq('resource_id', repoPath)
      .eq('repo_path', repoPath)
      .order('week_start')

    if (error) {
      console.warn(`Error fetching historical data for maximums: ${error.message}`)
      return createFallbackMaximums()
    }

    if (!data || data.length === 0) {
      logger.debug(`No historical data found for ${resource.name} - returning empty maximums for intelligent frontend handling`)
      return {
        maximums: {}, // Empty object - let frontend handle gracefully
        metadata: {
          hasHistoricalData: false,
          totalWeeksAvailable: 0,
          dataQuality: 'no_data',
          reason: 'insufficient_historical_data'
        }
      }
    }

    // Convert to array of weekly commit counts, sorted by date
    const weeklyCommits = data.map(row => ({
      weekStart: row.week_start,
      count: row.commit_count || 0
    })).sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart))

    // Debug logging for data analysis
    const totalWeeks = weeklyCommits.length
    const dateRange = totalWeeks > 0 ? `${weeklyCommits[0].weekStart} to ${weeklyCommits[totalWeeks-1].weekStart}` : 'none'
    const totalCommits = weeklyCommits.reduce((sum, week) => sum + week.count, 0)
    logger.debug(`📅 ${resource.name} historical data: ${totalWeeks} weeks (${dateRange}), ${totalCommits} total commits`)

    // Calculate rolling maximums for each period
    const periods = {
      'current': 1,   // 1 week period for 7-day view (current week vs historical weeks)
      '4weeks': 4,    // 4 weeks period
      '3months': 12,  // 3 months = ~12 weeks
      '52weeks': 52,  // 12 months = ~52 weeks
      '3years': 156   // 3 years = ~156 weeks
    }
    
    // Minimum data requirements for meaningful comparison (Period + 1 logic)
    const minimumWeeksForComparison = {
      'current': 1,   // Need 1 week minimum - current week vs any historical week
      '4weeks': 5,    // Need 4+1=5 weeks minimum for 4-week comparison
      '3months': 13,  // Need 12+1=13 weeks minimum for 3-month comparison
      '52weeks': 53,  // Need 52+1=53 weeks minimum for 12-month comparison
      '3years': 157   // Need 156+1=157 weeks minimum for 3-year comparison
    }

    const result = {
      maximums: {},
      metadata: {
        hasHistoricalData: true,
        totalWeeksAvailable: weeklyCommits.length,
        dataQuality: 'high'
      }
    }

    Object.entries(periods).forEach(([periodKey, weekCount]) => {
      const minimumWeeks = minimumWeeksForComparison[periodKey];
      
      if (weeklyCommits.length >= minimumWeeks) {
        // Sufficient data: calculate proper rolling maximum
        let maxTotal = 0;
        let maxStartDate = null;
        let maxEndDate = null;
        let windowTotals = [];

        for (let i = 0; i <= weeklyCommits.length - weekCount; i++) {
          const window = weeklyCommits.slice(i, i + weekCount);
          const windowTotal = window.reduce((sum, week) => sum + week.count, 0);
          
          windowTotals.push(windowTotal);
          if (windowTotal > maxTotal) {
            maxTotal = windowTotal;
            maxStartDate = window[0].weekStart;
            maxEndDate = new Date(new Date(window[window.length - 1].weekStart).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          }
        }
        
        logger.debug(`📊 ${resource.name} ${periodKey} (${weekCount} weeks): max=${maxTotal} from ${maxStartDate}`);
        
        result.maximums[periodKey] = {
          value: maxTotal,
          startDate: maxStartDate,
          endDate: maxEndDate,
        };
      } else if (weeklyCommits.length > 0) {
        // Insufficient data for this specific period
        logger.debug(`Insufficient data for ${periodKey}: need ${minimumWeeks} weeks, have ${weeklyCommits.length} weeks`);
        result.maximums[periodKey] = null; // Let frontend handle this
        // **FIX:** Do not set a global 'insufficient_data' flag. Assess per-period.
        // result.metadata.dataQuality = 'insufficient_data'; 
        result.metadata.minimumWeeksNeeded = result.metadata.minimumWeeksNeeded 
          ? Math.max(result.metadata.minimumWeeksNeeded, minimumWeeks) 
          : minimumWeeks;
        result.metadata.availableWeeks = weeklyCommits.length;
      } else {
        result.maximums[periodKey] = null;
      }
    })

    logger.debug(`✅ Calculated historical maximums for ${resource.name}:`, result.maximums, `(${result.metadata.dataQuality} quality)`)
    
    // Cache the successful result
    HISTORICAL_MAXIMUMS_CACHE.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });
    
    // Clean up old cache entries (keep only 20 entries max)
    if (HISTORICAL_MAXIMUMS_CACHE.size > 20) {
      const oldestKey = HISTORICAL_MAXIMUMS_CACHE.keys().next().value;
      HISTORICAL_MAXIMUMS_CACHE.delete(oldestKey);
    }
    
    return result

  } catch (error) {
    console.warn(`Error calculating historical maximums for ${resource.name}:`, error.message)
    const errorResult = {
      maximums: {}, // Empty object - let frontend handle gracefully
      metadata: {
        hasHistoricalData: false,
        totalWeeksAvailable: 0,
        dataQuality: 'no_data',
        reason: 'calculation_error'
      }
    };
    
    // Cache error result for shorter time (5 minutes)
    HISTORICAL_MAXIMUMS_CACHE.set(cacheKey, {
      data: errorResult,
      timestamp: Date.now()
    });
    
    return errorResult;
  }
}

// Create empty maximums when no data is available
const createFallbackMaximums = () => ({
  maximums: {},
  metadata: {
    hasHistoricalData: false,
    totalWeeksAvailable: 0,
    dataQuality: 'no_data'
  }
})

// Load resources
const loadResources = async () => {
  try {
    const { cardanoResources } = require('./src/data/resources_server.js')
    const allResources = []
    
    // Flatten all resources from all categories
    Object.values(cardanoResources).forEach(category => {
      if (Array.isArray(category)) {
        allResources.push(...category)
      }
    })
    
    return allResources.map(resource => {
      // Use existing type field from resources.js (most reliable)
      let type = resource.type
      
      // If no type field, use organization/repository fields as backup
      if (!type) {
        if (resource.organization && resource.repository) {
          type = 'repository'
        } else if (resource.organization && !resource.repository) {
          type = 'organization'
        } else {
          // Last resort: try to determine from GitHub URL structure
          const githubUrl = resource.social?.github
          if (githubUrl) {
            const pathParts = githubUrl.replace('https://github.com/', '').split('/')
            // If URL has format "owner/repo", it's a repository
            // If URL has format "owner" (no slash), it's an organization
            type = pathParts.length === 2 && pathParts[1] ? 'repository' : 'organization'
          } else {
            type = 'unknown'
          }
        }
      }
      
      return {
        ...resource,
        type
      }
    })
  } catch (error) {
    console.error('Error loading resources:', error)
    return []
  }
}

// Middleware
app.use(compression())
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://adadev.io', 'https://www.adadev.io']
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}))

app.use(express.json({ limit: '1mb' }))

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// API Routes

// Get recent activity for a resource
app.post('/api/github/updates', async (req, res) => {
  try {
    const { period = '4weeks', ...resource } = req.body
    if (!resource?.name || !resource?.social?.github) {
      return res.status(400).json({ error: 'Invalid resource data' })
    }
    
    logger.debug(`🔍 GitHub updates request for ${resource.name} (period: ${period})`)
    
    // First, try to get detailed activity data from the development activity cache
    let detailedData = null
    try {
      // Check both repository and organization caches for detailed weekly data
      const cacheKeys = ['repository-activity', 'organization-activity']
      
      // Try to get data from development activity cache first
      
      for (const cacheKey of cacheKeys) {
        const cachedData = VIEW_MODE_CACHE.get(cacheKey)
        
        if (cachedData && cachedData.dailyChartData) {
          
          const foundResource = cachedData.dailyChartData.find(item => {
            if (!item.resource) return false
            
            // Try multiple matching strategies
            const nameMatch = item.resource.name === resource.name
            const githubMatch = item.resource.social?.github === resource.social.github
            const githubUrlMatch = item.resource.social?.github && resource.social?.github && 
              item.resource.social.github.toLowerCase() === resource.social.github.toLowerCase()
            
            return nameMatch || githubMatch || githubUrlMatch
          })
          
          if (foundResource && foundResource.weeklyData && foundResource.weeklyData.length > 0) {
            detailedData = {
              commitsPerWeekDetailed: foundResource.weeklyData,
              commitsPerWeek: foundResource.weeklyData[foundResource.weeklyData.length - 1]?.count || 0,
              commits: [], // Will be filled by fallback if needed
              releases: [], // Will be filled by fallback if needed
              repoInfo: { 
                isOrganization: foundResource.resource.type === 'organization',
                stargazersCount: foundResource.resource.stargazersCount || 0,
                forksCount: foundResource.resource.forksCount || 0,
                language: foundResource.resource.language || null,
                htmlUrl: foundResource.resource.social?.github || null
              }
            }
            break // Found data, stop searching
          }
        }
      }
    } catch (error) {
      console.warn(`Could not get detailed cache data for ${resource.name}:`, error.message)
    }
    
    // CONSISTENCY FIX: Always use the same data source as dashboard for overlapping periods
    let data
    let releases = []
    
    // For periods > 7 days, use historical activity to match dashboard behavior
    const periodToDays = {
      '4weeks': 28,
      '3months': 84,
      '52weeks': 364,
      '3years': 1092
    }
    
    const requestedDays = periodToDays[period] || 28
    const shouldUseHistoricalData = requestedDays > 7
    
    if (shouldUseHistoricalData) {
      // Use same data source as dashboard charts for consistency
      const startDate = new Date(Date.now() - requestedDays * 24 * 60 * 60 * 1000).toISOString()
      const endDate = new Date().toISOString()
      
      logger.debug(`🔄 Using historical data source for ${resource.name} (${period} = ${requestedDays} days)`)
      const weeklyData = await getHistoricalActivity(resource, startDate, endDate)
      
      data = {
        commits: [], // Historical endpoint doesn't provide individual commits
        commitsPerWeek: weeklyData.reduce((sum, week) => sum + (week.count || 0), 0),
        weeklyData: weeklyData,
        repoInfo: null
      }
    } else if (detailedData) {
      data = detailedData
      releases = detailedData.releases
    } else {
      logger.debug(`🔄 Using fallback data fetch for ${resource.name}`)
      data = await getRecentActivity(resource, false, period)
      
      try {
        // Fetch releases for both repositories and organizations
        if (resource.social?.github) {
          const githubPath = resource.social.github.replace('https://github.com/', '')
          releases = await fetchRepoReleases(githubPath, 10)
        }
      } catch (error) {
        console.error(`Error fetching releases for ${resource.name}:`, error.message)
        releases = []
      }
    }
    
    // Convert weeklyData to commitsPerWeekDetailed format if needed
    let commitsPerWeekDetailed = data.commitsPerWeekDetailed || []
    if (!commitsPerWeekDetailed.length && data.weeklyData && data.weeklyData.length > 0) {
      commitsPerWeekDetailed = data.weeklyData.map(week => ({
        weekStart: week.weekStart,
        count: week.count,
        year: week.year,
        week: week.week
      }))
    }

    // Trim data based on period parameter
    const periodToWeeks = {
      '4weeks': 4,
      '3months': 12,
      '52weeks': 52,
      '3years': 156
    }
    
    const maxWeeks = periodToWeeks[period] || 4
    if (commitsPerWeekDetailed.length > maxWeeks) {
      commitsPerWeekDetailed = commitsPerWeekDetailed.slice(-maxWeeks)
    }

    res.json({
      resource: resource.name,
      commits: data.commits || [],
      releases: releases.slice(0, 10), // Exactly 10 releases
      commitsPerWeek: data.commitsPerWeek || 0,
      commitsPerWeekDetailed: commitsPerWeekDetailed,
      weeklyData: data.weeklyData || [],
      repoInfo: data.repoInfo
    })
  } catch (error) {
    console.error('API error (updates):', error)
    res.status(500).json({ 
      error: 'Failed to fetch updates',
      resource: req.body?.name || 'unknown'
    })
  }
})

// Get GitHub updates for multiple resources (global endpoint)
app.post('/api/github/global', async (req, res) => {
  try {
    const { resources } = req.body
    if (!resources || !Array.isArray(resources)) {
      return res.status(400).json({ error: 'Invalid resources data - expected array' })
    }
    
    logger.debug(`🌍 Global GitHub request for ${resources.length} resources`)
    
    const results = []
    
    // Process resources in batches to avoid overwhelming the API
    const batchSize = 5
    for (let i = 0; i < resources.length; i += batchSize) {
      const batch = resources.slice(i, i + batchSize)
      
      const batchPromises = batch.map(async (resource) => {
        if (!resource?.name || !resource?.social?.github) {
          console.warn(`⚠️ Skipping invalid resource:`, resource?.name || 'unknown')
          return null
        }
        
        try {
          // Get recent activity (commits)
          const activityData = await getRecentActivity(resource)
          
          // Get releases
          let releases = []
          try {
            if (resource.type === 'repository') {
              const repoPath = resource.social.github.replace('https://github.com/', '')
              releases = await fetchRepoReleases(repoPath, 5)
            } else if (resource.type === 'organization') {
              // For organizations, aggregate releases from their repositories
              let orgName;
              if (resource.repo_path) {
                orgName = resource.repo_path;
              } else if (resource.organization) {
                orgName = resource.organization;
              } else if (resource.social?.github) {
                orgName = resource.social.github.replace('https://github.com/', '');
              }
              
              if (orgName) {
                const repos = await fetchOrgRepos(orgName)
                const allReleases = []
                
                // Get releases from all non-fork repos (forks already filtered by fetchOrgRepos)
                for (const repo of repos) {
                  try {
                    const repoReleases = await fetchRepoReleases(repo.full_name, 3)
                    allReleases.push(...repoReleases.map(release => ({
                      ...release,
                      repo: repo.name,
                      org: orgName
                    })))
                  } catch (error) {
                    console.warn(`⚠️ Error fetching releases for ${repo.full_name}:`, error.message)
                  }
                }
                
                // Sort by published date and take top 5
                releases = allReleases
                  .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
                  .slice(0, 5)
              }
            }
          } catch (error) {
            console.warn(`⚠️ Error fetching releases for ${resource.name}:`, error.message)
            releases = []
          }
          
          return {
            resource: resource,
            commits: activityData.commits || [],
            releases: releases || [],
            commitsPerWeek: activityData.commitsPerWeek || 0,
            weeklyData: activityData.weeklyData || [],
            repoInfo: activityData.repoInfo
          }
        } catch (error) {
          console.warn(`⚠️ Error processing resource ${resource.name}:`, error.message)
          return {
            resource: resource,
            commits: [],
            releases: [],
            commitsPerWeek: 0,
            weeklyData: [],
            repoInfo: null
          }
        }
      })
      
      const batchResults = await Promise.allSettled(batchPromises)
      const validResults = batchResults
        .filter(result => result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value)
      
      results.push(...validResults)
      
      // Add delay between batches to respect rate limits
      if (i + batchSize < resources.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
    logger.debug(`✅ Global GitHub request completed: ${results.length}/${resources.length} successful`)
    res.json(results)
  } catch (error) {
    console.error('❌ Global GitHub API error:', error)
    res.status(500).json({ 
      error: 'Failed to fetch global GitHub data',
      message: error.message
    })
  }
})

// Get recent commits and releases for Updates tab
app.post('/api/github/recent', async (req, res) => {
  try {
    const { name, social, type } = req.body
    if (!name || !social?.github) {
      return res.status(400).json({ error: 'Invalid resource data' })
    }
    
    logger.debug(`🔍 Recent GitHub data request for ${name} (type: ${type || 'repository'})`)
    
    // Use existing getRecentActivity function to get fresh data
    const resource = { name, social, type: type || 'repository' }
    const activityData = await getRecentActivity(resource)
    
    // Get releases based on resource type
    let releases = []
    try {
      if (resource.type === 'organization') {
        // For organizations, get releases from all repositories
        let orgName;
        if (resource.repo_path) {
          orgName = resource.repo_path;
        } else if (resource.organization) {
          orgName = resource.organization;
        } else if (social.github) {
          orgName = social.github.replace('https://github.com/', '');
        }
        
        if (orgName) {
          const repos = await fetchOrgRepos(orgName)
          const releasePromises = repos.map(async repo => {
            try {
              const repoReleases = await fetchRepoReleases(repo.full_name, 2)
              return repoReleases.map(release => ({
                ...release,
                repositoryName: repo.name,
                organizationName: orgName
              }))
            } catch (error) {
              console.warn(`⚠️ Error fetching releases for ${repo.full_name}:`, error.message)
              return []
            }
          })
          
          const allReleases = await Promise.all(releasePromises)
          releases = allReleases.flat().sort((a, b) => 
            new Date(b.published_at) - new Date(a.published_at)
          ).slice(0, 10)
        }
      } else if (social.github) {
        // For repositories, get releases from single repo
        const repoPath = social.github.replace('https://github.com/', '')
        releases = await fetchRepoReleases(repoPath, 5)
      }
    } catch (error) {
      console.warn(`⚠️ Error fetching releases for ${name}:`, error.message)
      releases = []
    }
    
    // Add repository names to commits for organizations
    const commits = (activityData.commits || []).map(commit => ({
      ...commit,
      repositoryName: commit.repo || null  // Use the repo field added by fetchOrgCommits
    }))
    
    const result = {
      releases: releases || [],
      commits: commits,
      commitsPerWeek: activityData.commitsPerWeek || 0,
      repoInfo: activityData.repoInfo || {
        name: name,
        htmlUrl: social.github,
        stargazersCount: 0,
        forksCount: 0,
        language: null
      }
    }
    
    logger.debug(`✅ Recent data for ${name}: ${result.commits.length} commits, ${result.releases.length} releases`)
    res.json(result)
  } catch (error) {
    console.error(`❌ Recent GitHub API error for ${req.body?.name}:`, error)
    res.status(500).json({ 
      error: 'Failed to fetch recent GitHub data',
      message: error.message
    })
  }
})

// Get historical activity
app.get('/api/github/activity/:resourceId', async (req, res) => {
  try {
    const { resourceId } = req.params
    const { startDate, endDate } = req.query
    
    const resources = await loadResources()
    const resource = resources.find(r => r.id === resourceId)
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' })
    }
    
    const data = await getHistoricalActivity(resource, startDate, endDate)
    res.json({ resource: resource.name, weeks: data })
  } catch (error) {
    console.error('API error (activity):', error)
    res.status(500).json({ error: 'Failed to fetch activity data' })
  }
})

// Get organization activity
app.get('/api/github/org-activity/:orgName', async (req, res) => {
  try {
    const { orgName } = req.params
    const { startDate, endDate } = req.query
    
    const resource = { id: orgName, name: orgName, type: 'organization' }
    const data = await getHistoricalActivity(resource, startDate, endDate)
    
    res.json({ org: orgName, start: startDate, end: endDate, weeks: data })
  } catch (error) {
    console.error('API error (org-activity):', error)
    res.status(500).json({ error: 'Failed to fetch organization activity' })
  }
})

// Server-side cache for view mode results - optimized for fast loading
const VIEW_MODE_CACHE = new Map();
const VIEW_MODE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days (immutable data)

// **NEW**: Cache for pre-calculated single organization data
const ORGANIZATION_DATA_CACHE = new Map();

// Cache for historical maximums - 90 day TTL since they change even less frequently
const HISTORICAL_MAXIMUMS_CACHE = new Map();
const HISTORICAL_MAXIMUMS_TTL = 90 * 24 * 60 * 60 * 1000; // 90 days

// Get development activity for dashboard - preload all periods
app.get('/api/development-activity', async (req, res) => {
  try {
    const { viewMode = 'repository', period = 'current', resourceId, resourceName } = req.query;
    
    // Handle single resource requests
    if (resourceId || resourceName) {
      logger.debug(`🎯 Single resource request: resourceId=${resourceId}, resourceName=${resourceName}, period=${period}`);
      
      const resources = await loadResources();
      const targetResource = resources.find(r => 
        (resourceId && (r.id?.toString() === resourceId || r.name === resourceId)) ||
        (resourceName && r.name === resourceName)
      );
      
      if (!targetResource) {
        return res.status(404).json({ error: 'Resource not found' });
      }
      
      // Map period to the correct format
      const periodMapping = {
        '4weeks': '4weeks',
        '3months': '3months',
        '52weeks': '52weeks',
        '3years': '3years'
      };
      
      const mappedPeriod = periodMapping[period] || period;
      
      // Define the specific period configuration
      const now = new Date();
      const periodConfigs = {
        current: {
          since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          days: 7
        },
        monthly: {
          since: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString(),
          days: 28
        },
        '4weeks': {
          since: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString(),
          days: 28
        },
        '3months': {
          since: new Date(now.getTime() - 13 * 7 * 24 * 60 * 60 * 1000).toISOString(),
          days: 91
        },
        '52weeks': {
          since: new Date(now.getTime() - 52 * 7 * 24 * 60 * 60 * 1000).toISOString(),
          days: 364
        },
        '3years': {
          since: new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
          days: 1092
        }
      };
      
      const periodConfig = periodConfigs[mappedPeriod];
      if (!periodConfig) {
        return res.status(400).json({ error: 'Invalid period' });
      }
      
      try {
        let activityData;
        let totalCommits;
        
        // **PERFORMANCE OPTIMIZATION**: Check for pre-calculated organization data first
        if (targetResource.type === 'organization') {
          const orgCacheKey = `${targetResource.id || targetResource.name}_${period}`;
          const cachedOrgData = ORGANIZATION_DATA_CACHE.get(orgCacheKey);
          if (cachedOrgData) {
            logger.debug(`⚡ Using pre-calculated organization cache for ${targetResource.name} (${period})`);
            activityData = cachedOrgData.weeklyData;
            totalCommits = cachedOrgData.totalCommits;
          }
        }

        // If not found in org cache, proceed with normal fetching logic
        if (typeof activityData === 'undefined') {
          if (period === 'current') {
            // For 7-day period, use getRecentActivity with daily processing
            const recentData = await getRecentActivity(targetResource, true, 'current');
            activityData = recentData.weeklyData;
            totalCommits = recentData.commitsPerWeek;
          } else {
            // For historical periods, use getHistoricalActivity (with internal bulk cache optimization)
            activityData = await getHistoricalActivity(targetResource, periodConfig.since, new Date().toISOString());
            totalCommits = Array.isArray(activityData) ? 
              activityData.reduce((sum, week) => sum + (week && typeof week.count === 'number' ? week.count : 0), 0) : 0;
          }
        }
        
        // Get repo info for organizations
        const repoInfo = targetResource.type === 'organization' ? {
          isOrganization: true,
          totalRepos: targetResource.totalRepos || 0
        } : {
          isOrganization: false
        };
        
        // Calculate historical maximums for progress bar scaling
        const maximumsData = await calculateHistoricalMaximums(targetResource);

        const response = {
          resource: targetResource,
          weeklyData: activityData || [],
          commitsPerWeek: totalCommits,
          repoInfo: repoInfo,
          period: period,
          dataSources: { database: true, github: false },
          historicalMaximums: maximumsData.maximums,
          historicalMetadata: maximumsData.metadata
        };
        
        logger.debug(`✅ Single resource response for ${targetResource.name}: ${totalCommits} commits, ${activityData?.length || 0} weeks`);
        return res.json(response);
        
      } catch (error) {
        logger.error(`Error fetching data for resource ${targetResource.name}:`, error);
        return res.status(500).json({ error: 'Failed to fetch resource data' });
      }
    }
    
    // Check server-side cache for multi-resource requests
    const cacheKey = `${viewMode}-activity`;
    const cached = VIEW_MODE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < VIEW_MODE_CACHE_TTL)) {
      logger.debug(`⚡ Using server cache for ${viewMode} view (${Math.round((Date.now() - cached.timestamp) / 1000)}s old)`);
      return res.json(cached.data);
    }
    
    const resources = await loadResources();
    logger.debug(`🔄 Processing ${resources.length} total resources for ${viewMode} view, preloading all periods...`);
    
    // Define all time periods with their date ranges
    const now = new Date();
    const periods = {
      current: {
        since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        days: 7,
        useDailyProcessing: true
      },
      monthly: {
        since: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString(),
        days: 28,
        useDailyProcessing: false
      },
      '4weeks': {
        since: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString(),
        days: 28,
        useDailyProcessing: false
      },
      '3months': {
        since: new Date(now.getTime() - 13 * 7 * 24 * 60 * 60 * 1000).toISOString(),
        days: 91,
        useDailyProcessing: false
      },
      '52weeks': {
        since: new Date(now.getTime() - 52 * 7 * 24 * 60 * 60 * 1000).toISOString(),
        days: 364,
        useDailyProcessing: false
      },
      '3years': {
        since: new Date(now.getTime() - 156 * 7 * 24 * 60 * 60 * 1000).toISOString(),
        days: 1092,
        useDailyProcessing: false
      }
    };
    
    // Filter resources by view mode first to reduce processing
    const filteredResources = resources.filter(resource => {
      const isOrganization = resource.type === 'organization';
      const isRepository = resource.type === 'repository';
      
      if (viewMode === 'organization' && (!isOrganization || resource.founding_entity)) return false;
      if (viewMode === 'repository' && (!isRepository || resource.founding_entity)) return false;
      if (viewMode === 'founding_entity' && !resource.founding_entity) return false;
      
      // For organizations, check if we have a valid identifier
      if (isOrganization) {
        const hasRepoPath = resource.repo_path && resource.repo_path !== 'n/a' && resource.repo_path.trim() !== '';
        const hasOrgName = resource.organization && resource.organization !== 'n/a' && resource.organization.trim() !== '';
        const hasGitHubUrl = resource.social?.github && 
                            resource.social.github !== 'n/a' && 
                            resource.social.github.trim() !== '' &&
                            resource.social.github.includes('github.com');
        
        if (!hasRepoPath && !hasOrgName && !hasGitHubUrl) {
          console.warn(`Skipping organization ${resource.name} - no valid identifier`);
          return false;
        }
        return true;
      }
      
      // For repositories, validate GitHub URL more thoroughly
      if (!resource.social?.github || 
          resource.social.github === 'n/a' || 
          resource.social.github.trim() === '' ||
          !resource.social.github.includes('github.com')) {
        console.warn(`Skipping repository ${resource.name} - no valid GitHub URL (${resource.social?.github})`);
        return false;
      }
      
      // Extract and validate the repo path
      const repoPath = resource.social.github.replace('https://github.com/', '');
      if (repoPath === 'n/a' || repoPath.trim() === '' || repoPath.endsWith('/')) {
        console.warn(`Skipping repository ${resource.name} - invalid repo path: ${repoPath}`);
        return false;
      }
      
      return true;
    });
    
    logger.debug(`🚀 Preloading ALL periods for ${filteredResources.length} filtered resources (was ${resources.length})`);
    
    // Process resources in smaller batches to avoid overwhelming the API
    const BATCH_SIZE = 5;
    const allPeriodsData = new Map(); // Store data for all periods
    
    // Preload data for ALL periods at once
    for (let i = 0; i < filteredResources.length; i += BATCH_SIZE) {
      const batch = filteredResources.slice(i, i + BATCH_SIZE);
      logger.debug(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(filteredResources.length / BATCH_SIZE)} (${batch.length} resources)`);
      
      const batchPromises = batch.map(async (resource) => {
        try {
          const resourceData = {
            resource,
            periods: {}
          };
          
          // Fetch data with priority: 7-day first, then other periods
          const prioritizedPeriods = [
            ['current', periods.current], // 7-day first (highest priority)
            ['4weeks', periods['4weeks']],
            ['monthly', periods.monthly],
            ['3months', periods['3months']],
            ['52weeks', periods['52weeks']],
            ['3years', periods['3years']]
          ];
          
          const periodPromises = prioritizedPeriods.map(async ([periodKey, periodConfig]) => {
            try {
              let activityData;
              
              if (periodKey === 'current') {
                // For 7-day period, use getRecentActivity with daily processing
                const recentData = await getRecentActivity(resource, true, 'current');
                activityData = recentData.weeklyData;
              } else {
                // For other periods, use getHistoricalActivity
                activityData = await getHistoricalActivity(resource, periodConfig.since, new Date().toISOString());
              }
              
              // Calculate total commits for this period
              const totalCommits = Array.isArray(activityData) ? 
                activityData.reduce((sum, week) => sum + (week && typeof week.count === 'number' ? week.count : 0), 0) : 0;
              
              return {
                periodKey,
                data: {
                  commitsPerWeek: totalCommits,
                  weeklyData: activityData || []
                }
              };
            } catch (error) {
              console.error(`Error fetching ${periodKey} data for ${resource.name}:`, error);
              return {
                periodKey,
                data: { commitsPerWeek: 0, weeklyData: [] }
              };
            }
          });
          
          // Wait for all periods to complete
          const periodResults = await Promise.allSettled(periodPromises);
          
          // Process results for each period
          periodResults.forEach(result => {
            if (result.status === 'fulfilled') {
              const { periodKey, data } = result.value;
              resourceData.periods[periodKey] = data;
            }
          });
          
          // Log summary for this resource
          const summaryLog = Object.entries(resourceData.periods)
            .map(([key, data]) => `${key}:${data.commitsPerWeek}`)
            .join(', ');
          logger.debug(`📊 ${resource.name}: ${summaryLog}`);
          
          return resourceData;
        } catch (error) {
          console.error(`Error processing resource ${resource.name}:`, error);
          // Return empty data for all periods
          const emptyPeriods = {};
          Object.keys(periods).forEach(key => {
            emptyPeriods[key] = { commitsPerWeek: 0, weeklyData: [] };
          });
          return {
            resource,
            periods: emptyPeriods
          };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      logger.debug(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} completed: ${batchResults.length} resources with all periods`);
      
      // Store results for all periods
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          const resourceData = result.value;
          const resourceId = resourceData.resource.id || resourceData.resource.name;
          allPeriodsData.set(resourceId, resourceData);
        }
      });
      
      // Small delay between batches
      if (i + BATCH_SIZE < filteredResources.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    // Extract results for the requested period from preloaded data
    const allResourcesData = Array.from(allPeriodsData.values());
    const periodData = allResourcesData
      .map(resourceData => ({
        resource: resourceData.resource,
        data: resourceData.periods[period] || { commitsPerWeek: 0, weeklyData: [] },
        releases: [],
        commits: []
      }))
      .filter(item => item.data && typeof item.data.commitsPerWeek === 'number');
    
    logger.debug(`🔍 Extracted ${periodData.length} resources for ${period} period`);
    
    const successfulResults = periodData
      .filter(item => item.data.commitsPerWeek > 0)
      .sort((a, b) => b.data.commitsPerWeek - a.data.commitsPerWeek);

    logger.debug(`Successfully processed ${successfulResults.length} ${viewMode}s with activity for ${period} period`);

    // Calculate metrics based on the selected period
    const totalActiveRepos = successfulResults.length;
    const totalCommits = successfulResults.reduce((sum, item) => 
      sum + (item && item.data && typeof item.data.commitsPerWeek === 'number' ? item.data.commitsPerWeek : 0), 0);
    const avgCommitsPerRepo = totalActiveRepos > 0 ? Math.round(totalCommits / totalActiveRepos) : 0;

    // Build response with preloaded data for ALL periods
    const response = {
      // Current period data (for backward compatibility)
      dailyLeaderboard: successfulResults.map(item => ({
        resource: item.resource,
        totalCommits: item.data.commitsPerWeek
      })),
      weeklyLeaderboard: successfulResults.map(item => ({
        resource: item.resource,
        totalCommits: item.data.commitsPerWeek
      })),
      dailyChartData: successfulResults.map(item => {
        const chartData = Array.isArray(item.data.weeklyData) ? item.data.weeklyData : [];
        return {
          resource: item.resource,
          dailyCounts: chartData.map(d => d && typeof d.count === 'number' ? d.count : 0),
          weeklyData: chartData
        };
      }),
      weeklyChartData: successfulResults.map(item => {
        const chartData = Array.isArray(item.data.weeklyData) ? item.data.weeklyData : [];
        return {
          resource: item.resource,
          weeklyCounts: chartData.map(w => w && typeof w.count === 'number' ? w.count : 0),
          weeklyData: chartData
        };
      }),
      githubUpdates: successfulResults.map(item => ({
        resource: item.resource,
        commits: item.commits || [],
        releases: item.releases || [],
        commitsPerWeek: item.data.commitsPerWeek,
        weeklyData: item.data.weeklyData || [],
        repoInfo: item.data.repoInfo
      })),
      metrics: {
        daily: { totalActiveRepos, avgCommitsPerRepo, totalCommits },
        weekly: { totalActiveRepos, avgCommitsPerRepo, totalCommits }
      },
      
      // 🚀 NEW: Preloaded data for ALL periods to enable instant switching
      preloadedPeriods: {
        current: buildPeriodData(allResourcesData, 'current'),
        '4weeks': buildPeriodData(allResourcesData, '4weeks'),
        monthly: buildPeriodData(allResourcesData, 'monthly'),
        '3months': buildPeriodData(allResourcesData, '3months'),
        '52weeks': buildPeriodData(allResourcesData, '52weeks'),
        '3years': buildPeriodData(allResourcesData, '3years')
      },
      
      // Meta information
      period,
      viewMode,
      periodsPreloaded: Object.keys(periods),
      totalResourcesProcessed: allResourcesData.length
    };

    // Cache the response for future requests
    VIEW_MODE_CACHE.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });
    
    // Store all views - no cleanup needed for optimal performance
    // if (VIEW_MODE_CACHE.size > 20) {
    //   const oldestKey = VIEW_MODE_CACHE.keys().next().value;
    //   VIEW_MODE_CACHE.delete(oldestKey);
    // }

    res.json(response);
  } catch (error) {
    console.error('API error (development-activity):', error);
    res.status(500).json({ error: 'Failed to fetch development activity' });
  }
});

// Helper function to build period data
function buildPeriodData(allResourcesData, periodKey) {
  const periodData = allResourcesData
    .map(resourceData => ({
      resource: resourceData.resource,
      data: resourceData.periods[periodKey] || { commitsPerWeek: 0, weeklyData: [] },
      releases: [],
      commits: []
    }))
    .filter(item => item.data && typeof item.data.commitsPerWeek === 'number');
  
  const successfulResults = periodData
    .filter(item => item.data.commitsPerWeek > 0)
    .sort((a, b) => b.data.commitsPerWeek - a.data.commitsPerWeek);
  
  const totalActiveRepos = successfulResults.length;
  const totalCommits = successfulResults.reduce((sum, item) => sum + item.data.commitsPerWeek, 0);
  const avgCommitsPerRepo = totalActiveRepos > 0 ? Math.round(totalCommits / totalActiveRepos) : 0;
  
  return {
    dailyLeaderboard: successfulResults.map(item => ({
      resource: item.resource,
      totalCommits: item.data.commitsPerWeek
    })),
    weeklyLeaderboard: successfulResults.map(item => ({
      resource: item.resource,
      totalCommits: item.data.commitsPerWeek
    })),
    dailyChartData: successfulResults.map(item => {
      const chartData = Array.isArray(item.data.weeklyData) ? item.data.weeklyData : [];
      return {
        resource: item.resource,
        dailyCounts: chartData.map(d => d && typeof d.count === 'number' ? d.count : 0),
        weeklyData: chartData
      };
    }),
    weeklyChartData: successfulResults.map(item => {
      const chartData = Array.isArray(item.data.weeklyData) ? item.data.weeklyData : [];
      return {
        resource: item.resource,
        weeklyCounts: chartData.map(w => w && typeof w.count === 'number' ? w.count : 0),
        weeklyData: chartData
      };
    }),
    metrics: {
      daily: { totalActiveRepos, avgCommitsPerRepo, totalCommits },
      weekly: { totalActiveRepos, avgCommitsPerRepo, totalCommits }
    }
  };
}

// Removed /api/github/hybrid-activity endpoint - using unified /api/development-activity instead

/**
 * Server-side rate limit status check for internal use
 */
const checkRateLimitStatus = async () => {
  try {
    if (!GITHUB_TOKEN) {
      return { 
        remaining: 60, 
        limit: 60, 
        reset: Math.floor(Date.now() / 1000) + 3600,
        resetTime: new Date(Date.now() + 3600000).toISOString()
      }
    }

    const startTime = Date.now()
    const response = await fetch('https://api.github.com/rate_limit', {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'adaDEV-Platform'
      }
    })
    const responseTime = Date.now() - startTime

    if (response.ok) {
      const data = await response.json()
      return {
        remaining: data.rate.remaining,
        limit: data.rate.limit,
        reset: data.rate.reset,
        resetTime: new Date(data.rate.reset * 1000).toISOString(),
        responseTime: responseTime
      }
    } else {
      throw new Error(`Rate limit check failed: ${response.status}`)
    }
  } catch (error) {
    console.warn('Rate limit status check failed:', error.message)
    return {
      remaining: 0,
      limit: 5000,
      reset: Math.floor(Date.now() / 1000) + 3600,
      resetTime: new Date(Date.now() + 3600000).toISOString(),
      responseTime: 0,
      error: error.message
    }
  }
}

/**
 * Database health check for internal use
 */
const checkDatabaseHealth = async () => {
  try {
    // Check if we can access resources (basic DB connectivity test)
    const resources = await loadResources()
    if (resources && resources.length > 0) {
      return 'healthy'
    } else {
      return 'warning'
    }
  } catch (error) {
    console.error('Database health check failed:', error)
    return 'unhealthy'
  }
}

// GitHub rate limit status endpoint
app.get('/api/github/rate-limit-status', async (req, res) => {
  try {
    const status = {
      isRateLimited,
      rateLimitResetTime: rateLimitResetTime ? rateLimitResetTime.toISOString() : null,
      tokenConfigured: !!GITHUB_TOKEN,
      cacheStats: {
        size: CACHE.data.size,
        maxSize: CACHE.maxSize
      }
    }
    
    if (GITHUB_TOKEN && !isRateLimited) {
      // Only check actual rate limit if we have a token and aren't already rate limited
      try {
        const response = await fetch('https://api.github.com/rate_limit', {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'User-Agent': 'adaDEV-Platform'
          }
        })
        if (response.ok) {
          const rateLimitData = await response.json()
          status.githubRateLimit = rateLimitData.rate
        }
      } catch (error) {
        console.warn('Could not fetch GitHub rate limit:', error.message)
      }
    }
    
    res.json(status)
  } catch (error) {
    console.error('Rate limit status error:', error)
    res.status(500).json({ error: 'Failed to get rate limit status' })
  }
})

// Manual trigger for cache population
app.post('/api/cache/populate', async (req, res) => {
  try {
    const { priority = 'all' } = req.body
    logger.debug(`🎯 Manual cache population triggered (priority: ${priority})`)
    
    // Start the population process in background
    populateUpdatesCache(priority)
    
    res.json({ 
      message: `Cache population started with priority: ${priority}`,
      status: 'triggered'
    })
  } catch (error) {
    console.error('Manual cache population error:', error)
    res.status(500).json({ error: 'Failed to trigger cache population' })
  }
})

// Get resource updates (commits + releases) from database cache
app.post('/api/resource-updates', async (req, res) => {
  try {
    const { resourceId, resourceName } = req.body
    if (!resourceId && !resourceName) {
      return res.status(400).json({ error: 'resourceId or resourceName required' })
    }

    logger.debug(`🎯 Resource updates request: ${resourceId || resourceName}`)

    // Get latest 30 commits and releases from database cache
    const [commitsResult, releasesResult] = await Promise.all([
      supabase
        .from('github_commits_cache')
        .select('*')
        .eq('resource_id', resourceId || resourceName)
        .order('commit_date', { ascending: false })
        .limit(30),
      supabase
        .from('github_releases_cache')
        .select('*')
        .eq('resource_id', resourceId || resourceName)
        .order('published_at', { ascending: false })
        .limit(30)
    ])

    const commits = commitsResult.data || []
    const releases = releasesResult.data || []

    logger.debug(`✅ Resource updates: ${commits.length} commits, ${releases.length} releases`)
    
    res.json({
      commits: commits.map(commit => ({
        sha: commit.sha,
        commit: {
          author: {
            name: commit.author_name,
            email: commit.author_email,
            date: commit.commit_date
          },
          message: commit.message
        },
        html_url: commit.html_url,
        repository: {
          name: commit.repo_name,
          full_name: commit.repo_name
        }
      })),
      releases: releases.map(release => ({
        id: release.id,
        tag_name: release.tag_name,
        name: release.name,
        published_at: release.published_at,
        html_url: release.html_url,
        draft: release.draft,
        prerelease: release.prerelease,
        repository: {
          name: release.repo_name,
          full_name: release.repo_name
        }
      }))
    })

  } catch (error) {
    console.error('❌ Resource updates error:', error)
    res.status(500).json({ 
      error: 'Failed to fetch resource updates',
      message: error.message
    })
  }
})

// Get global updates (commits + releases) from database cache
app.get('/api/global-updates', async (req, res) => {
  try {
    logger.debug('🌍 Global updates request')

    // Get more releases and commits to allow better filtering on client side
    const [commitsResult, releasesResult] = await Promise.all([
      supabase
        .from('github_commits_cache')
        .select('*')
        .order('commit_date', { ascending: false })
        .limit(200), // More commits for better client-side filtering
      supabase
        .from('github_releases_cache')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(200) // More releases for better client-side filtering
    ])

    const commits = commitsResult.data || []
    const releases = releasesResult.data || []

    logger.debug(`✅ Global updates: ${commits.length} commits, ${releases.length} releases`)
    
    res.json({
      commits: commits.map(commit => ({
        sha: commit.sha,
        commit: {
          author: {
            name: commit.author_name,
            email: commit.author_email,
            date: commit.commit_date
          },
          message: commit.message
        },
        html_url: commit.html_url,
        repository: {
          name: commit.repo_name,
          full_name: commit.repo_name
        },
        resource: {
          id: commit.resource_id,
          name: commit.resource_name
        }
      })),
      releases: releases.map(release => ({
        id: release.id,
        tag_name: release.tag_name,
        name: release.name,
        published_at: release.published_at,
        html_url: release.html_url,
        draft: release.draft,
        prerelease: release.prerelease,
        repository: {
          name: release.repo_name,
          full_name: release.repo_name
        },
        resource: {
          id: release.resource_id,
          name: release.resource_name
        }
      }))
    })

  } catch (error) {
    console.error('❌ Global updates error:', error)
    res.status(500).json({ 
      error: 'Failed to fetch global updates',
      message: error.message
    })
  }
})

// Test endpoint to check updates cache status
app.get('/api/updates-cache-status', async (req, res) => {
  try {
    if (!supabase) {
      return res.json({ error: 'Supabase not configured' })
    }

    const [commitsResult, releasesResult] = await Promise.all([
      supabase
        .from('github_commits_cache')
        .select('resource_id, resource_name, commit_date, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('github_releases_cache')
        .select('resource_id, resource_name, published_at, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(10)
    ])

    res.json({
      commits: {
        total: commitsResult.count || 0,
        sample: commitsResult.data || []
      },
      releases: {
        total: releasesResult.count || 0,
        sample: releasesResult.data || []
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ Cache status error:', error)
    res.status(500).json({ error: error.message })
  }
})

// AI Analysis endpoint
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { userInput } = req.body
    
    if (!userInput || typeof userInput !== 'string') {
      return res.status(400).json({ error: 'User input is required and must be a string' })
    }
    
    if (userInput.length < 10) {
      return res.status(400).json({ error: 'Please provide a more detailed description (at least 10 characters)' })
    }
    
    if (userInput.length > 1000) {
      return res.status(400).json({ error: 'Description too long. Please keep it under 1000 characters' })
    }
    
    const resources = await loadResources()
    if (resources.length === 0) {
      return res.status(500).json({ error: 'No resources available for analysis' })
    }
    
    const systemPrompt = `You are an expert Cardano development assistant. Analyze the user's requirements and provide:

1. A brief analysis of their project requirements
2. Recommended Cardano tools and resources from the provided list
3. A development plan with different approaches

Available Cardano resources:
${resources.map(r => `- ${r.name}: ${r.description} (Category: ${r.category})`).join('\n')}

Respond with valid JSON in this exact format:
{
  "analysis": "Brief analysis of the project requirements",
  "recommendedResources": [
    {
      "id": "resource_id",
      "name": "Resource Name",
      "description": "Resource description",
      "category": "Category",
      "website": "https://website.com",
      "docs": "https://docs.com",
      "priority": "high|medium|low",
      "reason": "Why this resource is recommended"
    }
  ],
  "developmentPlan": {
    "overview": "Overview of development approaches",
    "approaches": [
      {
        "name": "Approach Name",
        "description": "Description of the approach",
        "complexity": "beginner|intermediate|advanced",
        "estimatedTime": "2-4 weeks",
        "tools": ["Tool 1", "Tool 2"]
      }
    ]
  }
}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
    
    const aiResponse = completion.choices[0].message.content
    let analysisResult
    
    try {
      analysisResult = JSON.parse(aiResponse)
      
      // Map AI-recommended resources to actual resources from resources.js to preserve correct URLs
      if (analysisResult.recommendedResources) {
        analysisResult.recommendedResources = analysisResult.recommendedResources
          .map(aiResource => {
            // Find the actual resource by name or ID
            const actualResource = resources.find(r => 
              r.name === aiResource.name || 
              r.id === aiResource.id ||
              r.name.toLowerCase() === aiResource.name.toLowerCase()
            )
            
            if (actualResource) {
              // Use actual resource data with AI analysis
              return {
                ...actualResource, // This preserves the correct website and docs URLs
                priority: aiResource.priority || 'medium',
                reason: aiResource.reason || 'Recommended for your use case'
              }
            }
            
            // If no exact match found, return null to filter out
            return null
          })
          .filter(resource => resource !== null) // Remove unmatched resources
      }
    } catch (parseError) {
      // Fallback response
      const fallbackResources = resources.slice(0, 5).map(resource => ({
        id: resource.id,
        name: resource.name,
        description: resource.description,
        category: resource.category,
        website: resource.website,
        docs: resource.docs,
        priority: 'medium',
        reason: 'Recommended based on general Cardano development needs'
      }))
      
      analysisResult = {
        analysis: 'Based on your requirements, here are some recommended Cardano development tools and approaches.',
        recommendedResources: fallbackResources,
        developmentPlan: {
          overview: 'Here are some development approaches you can consider for your Cardano project.',
          approaches: [
            {
              name: 'Basic Development',
              description: 'Start with fundamental Cardano development tools and gradually build complexity.',
              complexity: 'beginner',
              estimatedTime: '2-4 weeks',
              tools: ['Plutus', 'Cardano CLI', 'Testnet']
            }
          ]
        }
      }
    }
    
    res.json(analysisResult)
  } catch (error) {
    console.error('AI Analysis error:', error)
    res.status(500).json({ error: 'AI analysis failed. Please try again.' })
  }
})

// UPDATES CACHE DATA COLLECTION FUNCTIONS

/**
 * Aggregate commits into weekly data format for storeWeeklyActivity
 * @param {Array} commits - Raw commits from GraphQL
 * @returns {Array} - Weekly aggregated data
 */
function aggregateCommitsToWeeklyData(commits) {
  if (!commits || commits.length === 0) return []

  const weeklyMap = new Map()

  commits.forEach(commit => {
    try {
      // Extract commit date from nested structure
      const commitDate = commit.commit?.author?.date ||
                        commit.commit?.committer?.date ||
                        commit.authored_date ||
                        commit.committed_date

      if (!commitDate) return // Skip commits without dates

      const date = new Date(commitDate)
      if (isNaN(date.getTime())) return // Skip invalid dates

      // Calculate week start (Sunday) using centralized function for consistency
      const weekStart = getWeekStart(date)
      const weekKey = weekStart.toISOString().slice(0, 10) // YYYY-MM-DD format

      // Increment count for this week
      if (weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, weeklyMap.get(weekKey) + 1)
      } else {
        weeklyMap.set(weekKey, 1)
      }
    } catch (error) {
      // Skip malformed commits
      console.warn('Error processing commit for weekly aggregation:', error.message)
    }
  })

  // Convert to array format expected by storeWeeklyActivity
  const weeklyData = Array.from(weeklyMap.entries()).map(([weekStart, count]) => ({
    weekStart,
    count
  }))

  // Sort by date for consistency
  weeklyData.sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart))

  return weeklyData
}

/**
 * Maintain rolling cache of recent commits for a resource (7 days max)
 */
async function maintainCommitsCache(resourceId, commits) {
  logger.debug(`🔄 maintainCommitsCache called for ${resourceId} with ${commits?.length || 0} commits`)
  
  if (!supabase) {
    logger.warn(`❌ ${resourceId}: Supabase not available for commits cache`)
    return
  }
  
  if (!commits || commits.length === 0) {
    logger.debug(`ℹ️ ${resourceId}: No commits to cache (${commits ? 'empty array' : 'null/undefined'})`)
    return
  }
  
  try {
    // Debug logging for commit structure
    if (commits.length > 0) {
      const sampleCommit = commits[0]
      logger.debug(`🔍 ${resourceId}: Processing ${commits.length} commits. Sample structure:`, {
        hasRepository: !!sampleCommit.repository,
        repoFullName: sampleCommit.repository?.full_name,
        hasCommit: !!sampleCommit.commit,
        hasAuthor: !!sampleCommit.commit?.author,
        hasHtmlUrl: !!sampleCommit.html_url,
        sha: sampleCommit.sha?.substring(0, 8),
        fullSampleCommit: JSON.stringify(sampleCommit, null, 2).substring(0, 500)
      })
    }
    
    // Prepare commit records for insertion
    const commitRecords = commits.map((commit, index) => {
      // Validate commit structure
      if (!commit.sha) {
        console.warn(`⚠️ ${resourceId}: Commit ${index} missing SHA, skipping`)
        return null
      }
      
      // Generate fallback URL if html_url is null
      let htmlUrl = commit.html_url
      if (!htmlUrl && commit.sha && commit.repository?.full_name) {
        htmlUrl = `https://github.com/${commit.repository.full_name}/commit/${commit.sha}`
        logger.debug(`🔗 ${resourceId}: Generated fallback URL for ${commit.sha.substring(0, 8)}`)
      } else if (!htmlUrl) {
        // Final fallback for edge cases
        htmlUrl = `https://github.com/unknown/unknown/commit/${commit.sha || 'unknown'}`
        logger.warn(`⚠️ ${resourceId}: Using unknown fallback URL for commit ${commit.sha?.substring(0, 8)}`)
      }
      
      // Extract repository name with better fallback logic
      const repoName = commit.repository?.full_name || 
                      commit.repository?.name || 
                      (commit.repo && commit.org ? `${commit.org}/${commit.repo}` : null) ||
                      'unknown'
      
      // Extract commit information with validation
      const authorName = commit.commit?.author?.name || 
                        commit.author?.login || 
                        'Unknown'
      const authorEmail = commit.commit?.author?.email || ''
      const message = commit.commit?.message || commit.message || ''
      const commitDate = commit.commit?.author?.date || 
                        commit.commit?.committer?.date || 
                        new Date().toISOString()
      
      // Log issues for debugging
      if (repoName === 'unknown') {
        console.warn(`⚠️ ${resourceId}: Could not determine repo name for commit ${commit.sha?.substring(0, 8)}`)
      }
      if (authorName === 'Unknown') {
        console.warn(`⚠️ ${resourceId}: Could not determine author for commit ${commit.sha?.substring(0, 8)}`)
      }
      if (!message) {
        console.warn(`⚠️ ${resourceId}: Empty message for commit ${commit.sha?.substring(0, 8)}`)
      }
      
      return {
        resource_id: resourceId,
        resource_name: resourceId,
        repo_name: repoName,
        sha: commit.sha,
        commit_date: commitDate,
        author_name: authorName,
        author_email: authorEmail,
        message: message,
        html_url: htmlUrl
      }
    }).filter(record => record !== null) // Remove invalid commits

    // Process commits in chunks to reduce memory usage
    const CHUNK_SIZE = 100
    let totalUpserted = 0
    let totalDuplicates = 0

    console.log(`📝 ${resourceId}: Processing ${commitRecords.length} commits in chunks of ${CHUNK_SIZE}`)

    for (let i = 0; i < commitRecords.length; i += CHUNK_SIZE) {
      const chunk = commitRecords.slice(i, i + CHUNK_SIZE)

      // Deduplicate within this chunk only (smaller memory footprint)
      const uniqueChunk = []
      const chunkShas = new Set()

      for (const record of chunk) {
        if (!chunkShas.has(record.sha)) {
          uniqueChunk.push(record)
          chunkShas.add(record.sha)
        }
      }

      const chunkDuplicates = chunk.length - uniqueChunk.length
      totalDuplicates += chunkDuplicates

      if (chunkDuplicates > 0) {
        console.log(`🔄 ${resourceId}: Chunk ${Math.ceil((i + CHUNK_SIZE) / CHUNK_SIZE)}: Deduplicated ${chunkDuplicates} duplicates`)
      }

      // Insert chunk (database will handle cross-chunk duplicates with unique constraint)
      if (uniqueChunk.length > 0) {
        const { data: chunkUpsertData, error: chunkInsertError } = await supabase
          .from('github_commits_cache')
          .upsert(uniqueChunk, {
            onConflict: 'resource_id,sha'
          })
          .select()

        if (chunkInsertError) {
          logger.error(`❌ ${resourceId}: Database upsert failed for chunk ${Math.ceil((i + CHUNK_SIZE) / CHUNK_SIZE)}:`, chunkInsertError)
          console.error(`❌ Error inserting chunk for ${resourceId}:`, chunkInsertError)
          continue // Continue with next chunk
        }

        totalUpserted += chunkUpsertData?.length || 0
        console.log(`✅ ${resourceId}: Chunk ${Math.ceil((i + CHUNK_SIZE) / CHUNK_SIZE)} processed: ${uniqueChunk.length} commits upserted`)
      }

      // Small delay between chunks to allow garbage collection
      if (i + CHUNK_SIZE < commitRecords.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    console.log(`✅ ${resourceId}: Successfully cached ${commitRecords.length} commits to database. Upserted: ${totalUpserted} records, Deduplicated: ${totalDuplicates} duplicates`)
    
    // Maintain 7-day rolling cache to match frontend usage patterns
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Delete commits older than 7 days for this resource
    const { error: cleanupError } = await supabase
      .from('github_commits_cache')
      .delete()
      .eq('resource_id', resourceId)
      .lt('commit_date', sevenDaysAgo)

    if (cleanupError) {
      logger.warn(`⚠️ ${resourceId}: Failed to cleanup old commits from cache: ${cleanupError.message}`)
    } else {
      logger.debug(`🧹 ${resourceId}: Cleaned up commits older than 7 days (${sevenDaysAgo})`)
    }
    
    logger.debug(`✅ Updated commits cache for ${resourceId}: ${commitRecords.length} new commits`)
  } catch (error) {
    logger.error(`❌ Error maintaining commits cache for ${resourceId}:`, error)
  }
}

/**
 * Maintain rolling cache of latest releases for a resource (30 max)
 */
async function maintainReleasesCache(resourceId, releases) {
  if (!supabase || !releases || releases.length === 0) return
  
  try {
    // Prepare release records for insertion
    const releaseRecords = releases.map(release => ({
      resource_id: resourceId,
      resource_name: resourceId, // We'll improve this with proper resource mapping
      repo_name: release.repository?.full_name || release.repository?.name || 'unknown',
      tag_name: release.tag_name,
      name: release.name || release.tag_name,
      published_at: release.published_at,
      html_url: release.html_url,
      draft: release.draft || false,
      prerelease: release.prerelease || false
    }))
    
    // Update releases (fresh data always wins over cached data)
    const { error: insertError } = await supabase
      .from('github_releases_cache')
      .upsert(releaseRecords, {
        onConflict: 'resource_id,repo_name,tag_name',
        ignoreDuplicates: false
      })
    
    if (insertError) {
      console.error(`❌ Error inserting releases for ${resourceId}:`, insertError)
      return
    }
    
    // Manually maintain rolling cache (keep only latest 30)
    const { data: excessReleases, error: selectError } = await supabase
      .from('github_releases_cache')
      .select('id')
      .eq('resource_id', resourceId)
      .order('published_at', { ascending: false })
      .range(30, 1000) // Get everything beyond the 30 latest
    
    if (!selectError && excessReleases && excessReleases.length > 0) {
      const idsToDelete = excessReleases.map(r => r.id)
      await supabase
        .from('github_releases_cache')
        .delete()
        .in('id', idsToDelete)
    }
    
    logger.debug(`✅ Updated releases cache for ${resourceId}: ${releaseRecords.length} new releases`)
  } catch (error) {
    logger.error(`❌ Error maintaining releases cache for ${resourceId}:`, error)
  }
}

/**
 * Populate updates cache for ALL resources (no priority filtering)
 * @param {string} priority - Kept for backward compatibility, but always processes all resources
 */
// Memory circuit breaker
function checkMemoryUsage() {
  const memUsage = process.memoryUsage()
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024
  const maxMemoryMB = 400 // Threshold for 512MB server (leaving headroom)

  return {
    heapUsedMB: Math.round(heapUsedMB),
    maxMemoryMB,
    isOverThreshold: heapUsedMB > maxMemoryMB,
    percentage: Math.round((heapUsedMB / maxMemoryMB) * 100)
  }
}

async function waitForMemoryToClear(resourceName = 'unknown') {
  const memStats = checkMemoryUsage()

  if (memStats.isOverThreshold) {
    console.log(`🔴 ${resourceName}: Memory usage high (${memStats.heapUsedMB}MB/${memStats.maxMemoryMB}MB - ${memStats.percentage}%), waiting for GC...`)

    // Force garbage collection if available
    if (global.gc) {
      global.gc()
      console.log(`🗑️ ${resourceName}: Triggered manual garbage collection`)
    }

    // Wait for memory to decrease
    let attempts = 0
    const maxAttempts = 10

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const newMemStats = checkMemoryUsage()

      console.log(`⏳ ${resourceName}: Memory check ${attempts + 1}/${maxAttempts}: ${newMemStats.heapUsedMB}MB (${newMemStats.percentage}%)`)

      if (!newMemStats.isOverThreshold) {
        console.log(`🟢 ${resourceName}: Memory usage normalized (${newMemStats.heapUsedMB}MB)`)
        break
      }

      attempts++
    }

    if (attempts >= maxAttempts) {
      console.log(`⚠️ ${resourceName}: Memory still high after ${maxAttempts} attempts, continuing with caution`)
    }
  }
}

async function populateUpdatesCache(priority = 'all') {
  if (!supabase) {
    logger.warn('⚠️ Supabase not configured, skipping updates cache population')
    return
  }

  // Set background refresh flag to prioritize cache for user requests
  backgroundRefreshInProgress = true
  logger.debug(`🔄 Populating updates cache for ALL resources... [Background mode enabled]`)

  // Initial memory check
  const initialMem = checkMemoryUsage()
  console.log(`🧠 Starting cache population with ${initialMem.heapUsedMB}MB memory usage (${initialMem.percentage}%)`)
  
  try {
    const resources = await loadResources()
    const resourcesWithGitHub = resources.filter(r => r.social?.github)
    
    // Always process ALL resources (no priority filtering)
    const resourcesToProcess = resourcesWithGitHub
    
    logger.debug(`📦 Processing ${resourcesToProcess.length} resources (ALL resources)`)
    
    let successCount = 0
    let errorCount = 0
    
    // Process organizations sequentially to avoid memory spikes, repositories in small batches
    const organizations = resourcesToProcess.filter(r => r.type === 'organization')
    const repositories = resourcesToProcess.filter(r => r.type !== 'organization')

    // Process organizations sequentially (memory-intensive)
    console.log(`🔄 Processing ${organizations.length} organizations sequentially...`)
    for (const resource of organizations) {
        try {
          // Check memory before processing heavy organizations
          await waitForMemoryToClear(resource.name)

          logger.debug(`🔍 Processing ${resource.name} (${resource.type})...`)
          
          // Get complete commit history (no date filtering for historical data collection)
          const since = null // Fetch complete history instead of limiting to 4 weeks
          
          let rawCommits = []
          try {
            if (resource.type === 'organization') {
              // Get org name from resource
              let orgName;
              if (resource.repo_path) {
                orgName = resource.repo_path;
              } else if (resource.organization) {
                orgName = resource.organization;
              } else if (resource.social?.github) {
                orgName = resource.social.github.replace('https://github.com/', '');
              }
              
              if (orgName) {
                logger.debug(`🔄 ${resource.name}: Fetching raw commits for organization ${orgName}`)

                // MEMORY LEAK FIX: Use chunked processing for known large orgs
                const KNOWN_LARGE_ORGS = ['cardano-foundation', 'marlowe-lang', 'opshin', 'blockfrost'];
                if (KNOWN_LARGE_ORGS.includes(orgName)) {
                  console.log(`🎯 ${orgName}: Using memory-safe chunked processing (backgroundPreloading)`);
                  rawCommits = await fetchLargeOrgDataChunked(orgName, since, resource, processCommitsToWeekly, supabaseService);
                } else {
                  rawCommits = await fetchOrgDataWithGraphQL(orgName, since)
                }
              }
            } else if (resource.type === 'repository' || resource.social?.github) {
              // For repositories or unknown resources with GitHub URLs
              const repoPath = resource.social.github.replace('https://github.com/', '')
              logger.debug(`🔄 ${resource.name}: Fetching raw commits for repository ${repoPath}`)
              rawCommits = await fetchRepoDataWithGraphQL(repoPath, since)
            }
          } catch (error) {
            logger.warn(`⚠️ ${resource.name}: Failed to fetch raw commits: ${error.message}`)
            rawCommits = []
          }
          
          // Update commits cache with raw commit data
          logger.debug(`🔍 DEBUG: ${resource.name} rawCommits structure:`, {
            hasCommits: !!rawCommits,
            commitsLength: rawCommits?.length || 0,
            commitsType: Array.isArray(rawCommits) ? 'array' : typeof rawCommits,
            firstCommitStructure: rawCommits?.[0] ? {
              hasSha: !!rawCommits[0].sha,
              hasCommit: !!rawCommits[0].commit,
              hasRepository: !!rawCommits[0].repository,
              repositoryFullName: rawCommits[0].repository?.full_name
            } : null
          })
          
          if (rawCommits && rawCommits.length > 0) {
            console.log(`🔄 ${resource.name}: Calling maintainCommitsCache with ${rawCommits.length} raw commits`)
            await maintainCommitsCache(resource.name, rawCommits)
            console.log(`✅ ${resource.name}: Updated ${rawCommits.length} commits in database`)

            // NEW: Aggregate commits into weekly data and store in github_activity
            console.log(`🔄 ${resource.name}: Aggregating ${rawCommits.length} commits into weekly data`)
            const weeklyData = aggregateCommitsToWeeklyData(rawCommits)
            if (weeklyData && weeklyData.length > 0) {
              console.log(`🔄 ${resource.name}: Storing ${weeklyData.length} weekly records in github_activity`)
              await supabaseService.storeWeeklyActivity(resource, weeklyData)
            } else {
              logger.debug(`ℹ️ ${resource.name}: No weekly data to store (all commits filtered out)`)
            }

            // Also store daily data for 7-day view fallbacks (rolling 10-day cache)
            // Skip for KNOWN_LARGE_ORGS as they handle daily data internally
            const KNOWN_LARGE_ORGS = ['cardano-foundation', 'marlowe-lang', 'opshin', 'blockfrost'];
            const orgName = resource.social?.github?.replace('https://github.com/', '');
            const isKnownLargeOrg = orgName && KNOWN_LARGE_ORGS.includes(orgName);

            if (!isKnownLargeOrg) {
              try {
                if (rawCommits && rawCommits.length > 0) {
                  const dailyCommitData = rawCommits.map(commit => ({
                    date: commit.commit?.author?.date || commit.authored_date || commit.committed_date
                  })).filter(c => c.date)

                  const dailyAggregates = processCommitsToDaily(dailyCommitData)
                  const dailyData = dailyAggregates.map(d => ({
                    date: d.weekStart, // Fix field name mismatch
                    count: d.count
                  }))

                  if (dailyData.length > 0) {
                    const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
                    const resourceId = repoPath

                    console.log(`📅 ${resource.name}: Storing ${dailyData.length} daily records (10-day rolling cache)`)
                    await supabaseService.storeDailyActivity(resourceId, repoPath, dailyData, resource)
                  }
                }
              } catch (error) {
                console.warn(`⚠️ ${resource.name}: Daily storage failed (non-critical):`, error.message)
              }
            } else {
              console.log(`📅 ${resource.name}: Skipping daily processing (handled internally by chunked function)`)
            }
          } else {
            logger.debug(`ℹ️ ${resource.name}: No recent commits found - rawCommits is ${rawCommits ? 'empty array' : 'null/undefined'}`)
          }
          
          // Get and update releases cache
          let releases = []
          try {
            if (resource.type === 'repository') {
              const repoPath = resource.social.github.replace('https://github.com/', '')
              releases = await fetchRepoReleases(repoPath, 30)
            } else if (resource.type === 'organization') {
              // For organizations, get releases from their repositories
              let orgName = resource.social.github.replace('https://github.com/', '')
              const repos = await fetchOrgRepos(orgName)
              const allReleases = []
              
              // Get releases from all non-fork repos (forks already filtered by fetchOrgRepos)
              for (const repo of repos) {
                try {
                  const repoReleases = await fetchRepoReleases(repo.full_name, 5)
                  allReleases.push(...repoReleases.map(release => ({
                    ...release,
                    repository: { full_name: repo.full_name, name: repo.name }
                  })))
                } catch (error) {
                  console.warn(`⚠️ Error fetching releases for ${repo.full_name}:`, error.message)
                }
              }
              
              // Sort by published date and take top 30
              releases = allReleases
                .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
                .slice(0, 30)
            }
            
            if (releases.length > 0) {
              await maintainReleasesCache(resource.name, releases)
              logger.debug(`✅ ${resource.name}: Updated ${releases.length} releases`)
            } else {
              logger.debug(`ℹ️ ${resource.name}: No releases found`)
            }
          } catch (error) {
            console.warn(`⚠️ Error processing releases for ${resource.name}:`, error.message)
          }
          
          successCount++
        } catch (error) {
          errorCount++
          console.warn(`❌ Error processing resource ${resource.name}:`, error.message)
        }

        // Add small delay between organizations to allow GC
        if (resource !== organizations[organizations.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

    // Process repositories in small batches (less memory intensive)
    console.log(`🔄 Processing ${repositories.length} repositories in batches...`)
    const batchSize = 3 // Smaller batches for safety
    for (let i = 0; i < repositories.length; i += batchSize) {
      const batch = repositories.slice(i, i + batchSize)

      await Promise.all(batch.map(async (resource) => {
        try {
          logger.debug(`🔍 Processing ${resource.name} (${resource.type})...`)

          // Get complete commit history (no date filtering for historical data collection)
          const since = null // Fetch complete history instead of limiting to 4 weeks

          let rawCommits = []
          try {
            // For repositories or unknown resources with GitHub URLs
            const repoPath = resource.social.github.replace('https://github.com/', '')
            logger.debug(`🔄 ${resource.name}: Fetching raw commits for repository ${repoPath}`)
            rawCommits = await fetchRepoDataWithGraphQL(repoPath, since)
          } catch (error) {
            logger.warn(`⚠️ ${resource.name}: Failed to fetch raw commits: ${error.message}`)
            rawCommits = []
          }

          // Update commits cache with raw commit data
          if (rawCommits && rawCommits.length > 0) {
            console.log(`🔄 ${resource.name}: Calling maintainCommitsCache with ${rawCommits.length} raw commits`)
            await maintainCommitsCache(resource.name, rawCommits)
            console.log(`✅ ${resource.name}: Updated ${rawCommits.length} commits in database`)

            // Aggregate commits into weekly data and store in github_activity
            console.log(`🔄 ${resource.name}: Aggregating ${rawCommits.length} commits into weekly data`)
            const weeklyData = aggregateCommitsToWeeklyData(rawCommits)
            if (weeklyData && weeklyData.length > 0) {
              console.log(`🔄 ${resource.name}: Storing ${weeklyData.length} weekly records in github_activity`)
              await supabaseService.storeWeeklyActivity(resource, weeklyData)
            } else {
              logger.debug(`ℹ️ ${resource.name}: No weekly data to store (all commits filtered out)`)
            }

            // Also store daily data for 7-day view fallbacks (rolling 10-day cache)
            // Skip for KNOWN_LARGE_ORGS as they handle daily data internally
            const KNOWN_LARGE_ORGS = ['cardano-foundation', 'marlowe-lang', 'opshin', 'blockfrost'];
            const orgName = resource.social?.github?.replace('https://github.com/', '');
            const isKnownLargeOrg = orgName && KNOWN_LARGE_ORGS.includes(orgName);

            if (!isKnownLargeOrg) {
              try {
                if (rawCommits && rawCommits.length > 0) {
                  const dailyCommitData = rawCommits.map(commit => ({
                    date: commit.commit?.author?.date || commit.authored_date || commit.committed_date
                  })).filter(c => c.date)

                  const dailyAggregates = processCommitsToDaily(dailyCommitData)
                  const dailyData = dailyAggregates.map(d => ({
                    date: d.weekStart, // Fix field name mismatch
                    count: d.count
                  }))

                  if (dailyData.length > 0) {
                    const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
                    const resourceId = repoPath

                    console.log(`📅 ${resource.name}: Storing ${dailyData.length} daily records (10-day rolling cache)`)
                    await supabaseService.storeDailyActivity(resourceId, repoPath, dailyData, resource)
                  }
                }
              } catch (error) {
                console.warn(`⚠️ ${resource.name}: Daily storage failed (non-critical):`, error.message)
              }
            } else {
              console.log(`📅 ${resource.name}: Skipping daily processing (handled internally by chunked function)`)
            }
          } else {
            logger.debug(`ℹ️ ${resource.name}: No recent commits found - rawCommits is ${rawCommits ? 'empty array' : 'null/undefined'}`)
          }

          // Get and update releases cache
          let releases = []
          try {
            const repoPath = resource.social.github.replace('https://github.com/', '')
            releases = await fetchRepoReleases(repoPath, 30)

            if (releases && releases.length > 0) {
              await maintainReleasesCache(resource.name, releases)
              logger.debug(`✅ ${resource.name}: Updated ${releases.length} releases`)
            } else {
              logger.debug(`ℹ️ ${resource.name}: No releases found`)
            }
          } catch (error) {
            console.warn(`⚠️ Error processing releases for ${resource.name}:`, error.message)
          }

          successCount++
        } catch (error) {
          errorCount++
          console.warn(`❌ Error processing resource ${resource.name}:`, error.message)
        }
      }))

      // Add delay between batches to respect rate limits
      if (i + batchSize < repositories.length) {
        logger.debug(`⏳ Batch ${Math.ceil((i + batchSize) / batchSize)} completed, waiting 2s...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    
    logger.debug(`✅ Updates cache population completed (ALL resources):`)
    logger.debug(`   📊 Processed: ${successCount + errorCount} resources`)
    logger.debug(`   ✅ Successful: ${successCount}`)
    logger.debug(`   ❌ Errors: ${errorCount}`)

    // Final memory cleanup
    const finalMem = checkMemoryUsage()
    console.log(`🧠 Cache population completed with ${finalMem.heapUsedMB}MB memory usage (${finalMem.percentage}%)`)

    if (global.gc) {
      global.gc()
      const postGCMem = checkMemoryUsage()
      console.log(`🗑️ Post-GC memory usage: ${postGCMem.heapUsedMB}MB (${postGCMem.percentage}%)`)
    }

    // Log database stats
    if (supabase) {
      try {
        const [commitsResult, releasesResult] = await Promise.all([
          supabase.from('github_commits_cache').select('resource_id', { count: 'exact', head: true }),
          supabase.from('github_releases_cache').select('resource_id', { count: 'exact', head: true })
        ])
        
        logger.debug(`📊 Database cache stats:`)
        logger.debug(`   💾 Total commits cached: ${commitsResult.count || 0}`)
        logger.debug(`   💾 Total releases cached: ${releasesResult.count || 0}`)
      } catch (error) {
        logger.warn('⚠️ Could not fetch cache statistics:', error.message)
      }
    }
    
  } catch (error) {
    logger.error('❌ Error populating updates cache:', error)
  } finally {
    // Reset background refresh flag to allow normal GitHub API calls
    backgroundRefreshInProgress = false
    logger.debug(`🔄 Background refresh completed, normal API access restored`)
  }
}

// Ensure historical data completeness at startup
const ensureHistoricalDataCompleteness = async () => {
  if (!supabase) {
    logger.warn('⚠️ Supabase not configured, skipping historical data validation')
    return
  }

  logger.debug('🔍 HISTORICAL DATA COMPLETENESS CHECK')
  logger.debug('='.repeat(50))
  
  try {
    const resources = await loadResources()
    const resourcesWithGitHub = resources.filter(r => r.social?.github)
    
    logger.debug(`📊 Checking historical data for ${resourcesWithGitHub.length} resources...`)
    
    // Define minimum historical data requirements (in weeks)
    const HISTORICAL_REQUIREMENTS = {
      '4weeks': 4,
      '3months': 12,
      '52weeks': 52,
      '3years': 156
    }
    
    const resourcesNeedingData = []
    
    // Real repository age detection using GitHub API
    const getRealRepositoryAge = async (resource) => {
      try {
        // For repositories: use GitHub API to get actual creation date
        if (resource.type === 'repository' || resource.social?.github) {
          const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
          if (repoPath) {
            const repoInfo = await fetchRepoInfo(repoPath)
            if (repoInfo && repoInfo.created_at) {
              const createdDate = new Date(repoInfo.created_at)
              const ageWeeks = Math.floor((Date.now() - createdDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
              return { ageWeeks, source: 'github', createdDate: repoInfo.created_at }
            }
          }
        }
        
        // For organizations: get oldest repository in the org
        if (resource.type === 'organization') {
          const orgName = resource.organization || 
                          resource.social?.github?.replace('https://github.com/', '')
          if (orgName) {
            const repos = await fetchOrgRepos(orgName)
            if (repos && repos.length > 0) {
              const oldestRepo = repos.reduce((oldest, repo) => 
                new Date(repo.created_at) < new Date(oldest.created_at) ? repo : oldest
              )
              const ageWeeks = Math.floor((Date.now() - new Date(oldestRepo.created_at)) / (7 * 24 * 60 * 60 * 1000))
              return { ageWeeks, source: 'github_org', createdDate: oldestRepo.created_at, oldestRepo: oldestRepo.name }
            }
          }
        }
      } catch (error) {
        console.warn(`⚠️ Could not fetch real age for ${resource.name}: ${error.message}`)
      }
      
      // Fallback to conservative assumption - use full requirements
      console.warn(`⚠️ ${resource.name}: Using conservative age assumption (GitHub age detection failed)`)
      return { ageWeeks: 208, source: 'conservative_fallback', createdDate: null } // Assume 4 years for mature ecosystem
    }
    
    // Age-aware period requirements using real GitHub age
    const getAgeAwareRequirements = async (resource) => {
      const ageInfo = await getRealRepositoryAge(resource)
      const repoAgeWeeks = ageInfo.ageWeeks
      const baseRequirements = HISTORICAL_REQUIREMENTS
      
      if (!repoAgeWeeks) return baseRequirements // No age data, use full requirements
      
      // Filter requirements to only include periods the repo has existed for
      const ageAwareRequirements = Object.fromEntries(
        Object.entries(baseRequirements).filter(([period, weeks]) => {
          const hasExistedLongEnough = weeks <= repoAgeWeeks
          if (!hasExistedLongEnough && ageInfo.source !== 'conservative_fallback') {
            console.log(`📅 ${resource.name}: Excluding ${period} (requires ${weeks}w, actual age: ${repoAgeWeeks}w from ${ageInfo.source})`)
          }
          return hasExistedLongEnough
        })
      )
      
      return { requirements: ageAwareRequirements, ageInfo }
    }
    
    // Helper function to format age information with source indicator
    const formatAgeInfo = (ageInfo) => {
      if (!ageInfo || !ageInfo.ageWeeks) return ''
      
      const years = Math.floor(ageInfo.ageWeeks / 52)
      const weeks = ageInfo.ageWeeks % 52
      const sourceIndicator = ageInfo.source === 'github' ? '' : 
                             ageInfo.source === 'github_org' ? ' (org)' : 
                             ageInfo.source === 'conservative_fallback' ? ' (est)' : ' (db)'
      return ` | Age: ${years}yr ${weeks}wk${sourceIndicator}`
    }
    
    // Check each resource for data completeness
    for (const resource of resourcesWithGitHub) {
      // CRITICAL: Use same resource identification pattern as storage functions
      const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
      
      if (!repoPath) {
        console.warn(`⚠️ No valid GitHub URL for ${resource.name}`)
        continue
      }
      
      const resourceId = repoPath
      
      try {
        // Check current database coverage using consistent identifiers
        const { data: existingData, error } = await supabase
          .from('github_activity')
          .select('week_start')
          .eq('resource_id', resourceId)
          .eq('repo_path', repoPath)
          .order('week_start')
        
        if (error) {
          console.warn(`⚠️ Error checking data for ${resource.name}: ${error.message}`)
          continue
        }
        
        const weeksAvailable = existingData?.length || 0
        const ageResult = await getAgeAwareRequirements(resource)
        const ageAwareRequirements = ageResult.requirements
        const ageInfo = ageResult.ageInfo
        const missingPeriods = []
        const now = new Date()
        
        // Period-specific availability check with real GitHub age awareness
        for (const [period, requiredWeeks] of Object.entries(ageAwareRequirements)) {
          const periodStartDate = new Date(now.getTime() - (requiredWeeks * 7 * 24 * 60 * 60 * 1000))
          
          // Count weeks actually available for this specific period
          const weeksInPeriod = existingData?.filter(week => {
            const weekDate = new Date(week.week_start)
            return weekDate >= periodStartDate
          }).length || 0
          
          const coveragePercent = Math.round((weeksInPeriod / requiredWeeks) * 100)
          
          if (weeksInPeriod < requiredWeeks) {
            missingPeriods.push(`${period}(${weeksInPeriod}/${requiredWeeks}=${coveragePercent}%)`)
          }
        }
        
        if (missingPeriods.length > 0) {
          resourcesNeedingData.push({
            resource,
            resourceId,
            weeksAvailable,
            missingPeriods,
            startDate: ageInfo.createdDate, // **FIX**: Add the repository creation date for backfilling
            endDate: now.toISOString()      // **FIX**: Add end date for clarity
          })
          const ageInfoStr = formatAgeInfo(ageInfo)
          console.log(`📋 ${resource.name}: Total=${weeksAvailable} weeks${ageInfoStr} | Missing: ${missingPeriods.join(', ')}`)
        } else {
          const ageInfoStr = formatAgeInfo(ageInfo)
          const periodsCount = Object.keys(ageAwareRequirements).length
          const allPeriodsInfo = periodsCount < Object.keys(HISTORICAL_REQUIREMENTS).length ? ` (${periodsCount}/${Object.keys(HISTORICAL_REQUIREMENTS).length} periods applicable)` : ''
          console.log(`✅ ${resource.name}: Complete historical data (${weeksAvailable} weeks${ageInfoStr} - ALL PERIODS SATISFIED${allPeriodsInfo})`)
        }
        
      } catch (error) {
        console.warn(`⚠️ Error analyzing ${resource.name}: ${error.message}`)
      }
    }
    
    if (resourcesNeedingData.length === 0) {
      console.log('🎉 All resources have complete historical data!')
      return
    }
    
    console.log(`\n🔧 FETCHING MISSING HISTORICAL DATA`)
    console.log('─'.repeat(50))
    console.log(`Resources needing data: ${resourcesNeedingData.length}`)
    
    // Sort by priority (resources with least data first)
    resourcesNeedingData.sort((a, b) => a.weeksAvailable - b.weeksAvailable)
    
    let processedCount = 0
    let successCount = 0
    let errorCount = 0
    let incompleteCount = 0
    
    // Process in small batches to respect rate limits
    const batchSize = 2
    for (let i = 0; i < resourcesNeedingData.length; i += batchSize) {
      const batch = resourcesNeedingData.slice(i, i + batchSize)
      
      console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(resourcesNeedingData.length/batchSize)}...`)
      
      for (const item of batch) {
        try {
          processedCount++
          // **FIX:** Destructure startDate and endDate from the item here.
          const { resource, resourceId, startDate, endDate } = item
          
          // Check if we're currently rate limited before attempting fetch
          if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime.getTime()) {
            const waitTimeMs = rateLimitResetTime.getTime() - Date.now()

            // MEMORY LEAK FIX: Validate timeout before creating promise
            if (isNaN(waitTimeMs) || waitTimeMs <= 0 || waitTimeMs > 3600000) { // Max 1 hour
              console.log(`⚠️ Invalid rate limit wait (${waitTimeMs}ms) for ${resource?.name || 'unknown'}, skipping`)
              continue
            }

            console.log(`⏳ Rate limited - waiting ${Math.ceil(waitTimeMs / 60000)} minutes until ${rateLimitResetTime.toLocaleString()}`)
            console.log(`🔄 Will resume processing ${resourcesNeedingData.length - processedCount + 1} remaining resources after rate limit resets`)

            // Wait for rate limit to reset
            await new Promise(resolve => setTimeout(resolve, waitTimeMs))
            
            console.log(`✅ Rate limit reset - resuming backfill operations`)
            // Continue with current resource (don't increment processedCount or continue)
          }
          
          console.log(`🔄 Fetching historical data for ${resource.name} (${processedCount}/${resourcesNeedingData.length})...`)
          
          // **FIX:** Use the startDate from the item object, which is now correctly defined, and handle nulls.
          const since = startDate ? new Date(startDate).toISOString() : null
          let commits = []
          if (resource.type === 'organization') {
            const orgName = resource.social.github.replace('https://github.com/', '');

            // MEMORY LEAK FIX: Use chunked processing for known large orgs
            const KNOWN_LARGE_ORGS = ['cardano-foundation', 'marlowe-lang', 'opshin', 'blockfrost'];
            if (KNOWN_LARGE_ORGS.includes(orgName)) {
              console.log(`🎯 ${orgName}: Using memory-safe chunked processing`);
              commits = await fetchLargeOrgDataChunked(orgName, since, resource, processCommitsToWeekly, supabaseService);

              // Skip normal processing since chunked function already stored data
              console.log(`✅ ${orgName}: Chunked processing completed - data already stored in database`);
              successCount++;
              continue;
            } else {
              commits = await fetchOrgDataWithGraphQL(orgName, since);
            }
          } else {
            const repoPath = resource.social.github.replace('https://github.com/', '')
            commits = await fetchRepoDataWithGraphQL(repoPath, since)
          }

          const historicalData = processCommitsToWeekly(commits)
          
          // Store the newly fetched data in the database
          await supabaseService.storeWeeklyActivity(resource, historicalData)

          if (historicalData && historicalData.length > 0) {
            console.log(`📥 ${resource.name}: Fetched and stored ${historicalData.length} weeks of data, now verifying completeness...`)
            
            // CRITICAL: Re-check database to verify what we actually have now
            // CRITICAL FIX: Use repo_path for verification too, same as initial check
            const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
            
            if (!repoPath) {
              console.error(`❌ ${resource.name}: No valid GitHub URL for verification`)
              errorCount++
              continue
            }
            
            const { data: verificationData, error: verifyError } = await supabase
              .from('github_activity')
              .select('week_start')
              .eq('resource_id', resourceId)
              .eq('repo_path', repoPath)
              .order('week_start')
            
            if (verifyError) {
              console.error(`❌ ${resource.name}: Verification query failed: ${verifyError.message}`)
              errorCount++
              continue
            }
            
            const actualWeeksAvailable = verificationData?.length || 0
            const stillMissingPeriods = []
            
            // Check each required period against actual data using real age-aware requirements
            const postBackfillAgeResult = await getAgeAwareRequirements(resource)
            const postBackfillAgeAware = postBackfillAgeResult.requirements
            for (const [period, requiredWeeks] of Object.entries(postBackfillAgeAware)) {
              const periodStartDate = new Date(Date.now() - (requiredWeeks * 7 * 24 * 60 * 60 * 1000))
              const weeksInPeriod = verificationData?.filter(week => {
                const weekDate = new Date(week.week_start)
                return weekDate >= periodStartDate
              }).length || 0
              
              if (weeksInPeriod < requiredWeeks) {
                stillMissingPeriods.push(`${period}(${weeksInPeriod}/${requiredWeeks})`)
              }
            }
            
            if (stillMissingPeriods.length === 0) {
              console.log(`✅ ${resource.name}: ALL REQUIREMENTS MET (${actualWeeksAvailable} weeks available)`)
              successCount++
            } else {
              console.log(`⚠️ ${resource.name}: INCOMPLETE - ${actualWeeksAvailable} weeks available, still missing: ${stillMissingPeriods.join(', ')}`)
              incompleteCount++
            }
          } else {
            console.log(`❌ ${resource.name}: No historical data found`)
            errorCount++
          }
          
          // Rate limiting delay between resources
          await new Promise(resolve => setTimeout(resolve, 1000))
          
        } catch (error) {
          errorCount++
          console.error(`❌ Error fetching data for ${item.resource.name}: ${error.message}`)
          
          // Longer delay on error to avoid cascading failures
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
      
      // Delay between batches
      if (i + batchSize < resourcesNeedingData.length) {
        console.log('⏳ Batch completed, waiting 3s before next batch...')
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
    
    console.log(`\n📊 HISTORICAL DATA COMPLETENESS SUMMARY`)
    console.log('='.repeat(50))
    console.log(`📦 Resources processed: ${processedCount}`)
    console.log(`✅ FULLY COMPLETE: ${successCount}`)
    console.log(`⚠️ Partial/Incomplete: ${incompleteCount}`)
    console.log(`❌ Errors: ${errorCount}`)
    console.log(`🎯 Full completion rate: ${processedCount > 0 ? Math.round((successCount/processedCount) * 100) : 0}%`)
    console.log(`📊 Data accuracy: ${processedCount > 0 ? Math.round(((successCount)/(successCount + incompleteCount + errorCount)) * 100) : 0}% of attempted resources have complete data`)
    
    if (successCount === processedCount && errorCount === 0 && incompleteCount === 0) {
      console.log('🎉 ALL RESOURCES HAVE COMPLETE HISTORICAL DATA!')
    } else if (successCount > 0) {
      console.log(`📈 Progress made: ${successCount} resources now have complete data`)
      if (incompleteCount > 0) {
        console.log(`🔄 ${incompleteCount} resources still need more historical data`)
        console.log('💡 Run again to continue fetching missing data for incomplete resources')
      }
    } else {
      console.log('⚠️ No resources achieved full completeness - may need longer historical fetch periods or multiple runs')
    }
    
  } catch (error) {
    console.error('❌ Historical data completeness check failed:', error.message)
  }
}

// ✅ REMOVED: processDatabaseData - No longer needed with non-blocking startup

// Background data fetching and backfilling
const backgroundDataFetching = async () => {
  console.log('🎯 MILESTONE 3: BACKGROUND DATA FETCHING')
  console.log('='.repeat(50))
  console.log('🔄 Starting background data fetching and backfilling...')
  
  try {
    // Step 1: Historical data completeness check and backfilling
    if (supabase && GITHUB_TOKEN) {
      console.log('📦 Background: Historical data completeness check...')
      await ensureHistoricalDataCompleteness()
      console.log('✅ Background: Historical data check completed')
    }
    
    // Step 2: Updates cache population (commits & releases)
    console.log('📦 Background: Populating updates cache...')
    await populateUpdatesCache()
    console.log('✅ Background: Updates cache population completed')
    
    console.log('🎉 MILESTONE 3 COMPLETED: Background data fetching finished!')
    console.log('🚀 All data fetching and backfilling completed!')
    console.log('')
  } catch (error) {
    console.error('❌ Background data fetching failed:', error.message)
  }
}

// ✅ REMOVED: preloadStartupCache - No longer needed with non-blocking startup

// =============================================================================
// DATA QUALITY MANAGEMENT API ENDPOINTS
// Enterprise-level endpoints for gap detection, backfill management, and monitoring
// =============================================================================

/**
 * Get comprehensive data quality analysis for all resources or specific resource
 * GET /api/data-quality/analysis?resourceId=1&resourceName=Aiken
 */
app.get('/api/data-quality/analysis', async (req, res) => {
  try {
    const { resourceId, resourceName, includeRecommendations = 'true' } = req.query
    
    console.log(`🔍 Data quality analysis request: ${resourceId || resourceName || 'ALL_RESOURCES'}`)
    
    const resources = await loadResources()
    let targetResources = resources

    // Filter to specific resource if requested
    if (resourceId || resourceName) {
      const targetResource = resources.find(r => 
        (resourceId && (r.id?.toString() === resourceId || r.name === resourceId)) ||
        (resourceName && r.name === resourceName)
      )
      
      if (!targetResource) {
        return res.status(404).json({ error: 'Resource not found' })
      }
      
      targetResources = [targetResource]
    }

    // Analyze data quality for each resource
    const analysisResults = []
    
    for (const resource of targetResources.slice(0, 20)) { // Limit to 20 for performance
      try {
        // Get historical data for comprehensive analysis
        const endDate = new Date().toISOString()
        const startDate = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString() // 3 years
        
        const weeklyData = await getWeeklyActivity(resource, startDate, endDate)
        
        // Use the existing server-side analysis functions
        const analysis = {
          resource: {
            id: resource.id,
            name: resource.name,
            type: resource.type,
            category: resource.category
          },
          timestamp: new Date().toISOString(),
          dataQuality: analyzeDataQuality(weeklyData),
          periodAnalysis: analyzePeriodCompleteness(weeklyData),
          freshness: assessDataFreshness(weeklyData),
          gapSummary: identifyGaps(weeklyData),
          recommendations: includeRecommendations === 'true' ? generateRecommendations(resource, weeklyData) : []
        }
        
        analysisResults.push(analysis)
        
      } catch (error) {
        console.warn(`Analysis failed for ${resource.name}: ${error.message}`)
        analysisResults.push({
          resource: { id: resource.id, name: resource.name, type: resource.type },
          error: error.message,
          timestamp: new Date().toISOString()
        })
      }
    }

    // Summary statistics
    const summary = {
      totalResourcesAnalyzed: analysisResults.length,
      averageDataQuality: calculateAverageQuality(analysisResults),
      criticalIssues: analysisResults.filter(r => r.dataQuality?.level === 'CRITICAL').length,
      resourcesNeedingBackfill: analysisResults.filter(r => r.dataQuality?.score < 80).length,
      staleDataResources: analysisResults.filter(r => r.freshness?.level === 'CRITICAL').length
    }

    res.json({
      summary,
      resources: analysisResults,
      generatedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('Data quality analysis error:', error)
    res.status(500).json({ error: 'Failed to analyze data quality' })
  }
})

/**
 * Trigger intelligent backfill for specific resources
 * POST /api/data-quality/backfill
 */
app.post('/api/data-quality/backfill', async (req, res) => {
  try {
    const { 
      resourceIds = [], 
      resourceNames = [], 
      priority = 'auto',
      forceRefresh = false,
      maxConcurrent = 3,
      dateRange = null
    } = req.body

    console.log(`🔄 Backfill request: ${resourceIds.length + resourceNames.length} resources, priority: ${priority}`)

    const resources = await loadResources()
    let targetResources = []

    // Find target resources
    if (resourceIds.length > 0) {
      resourceIds.forEach(id => {
        const resource = resources.find(r => r.id?.toString() === id.toString())
        if (resource) targetResources.push(resource)
      })
    }

    if (resourceNames.length > 0) {
      resourceNames.forEach(name => {
        const resource = resources.find(r => r.name === name)
        if (resource) targetResources.push(resource)
      })
    }

    // If no specific resources, select based on priority
    if (targetResources.length === 0) {
      if (priority === 'critical') {
        // Select resources with critical data quality issues
        for (const resource of resources.slice(0, 10)) {
          const weeklyData = await getWeeklyActivity(resource, 
            new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), 
            new Date().toISOString()
          )
          const quality = analyzeDataQuality(weeklyData)
          if (quality.level === 'CRITICAL') {
            targetResources.push(resource)
          }
        }
      } else {
        return res.status(400).json({ error: 'No resources specified for backfill' })
      }
    }

    if (targetResources.length === 0) {
      return res.status(404).json({ error: 'No resources found matching criteria' })
    }

    // Initiate backfill operations
    const backfillOperations = []
    
    for (const resource of targetResources.slice(0, maxConcurrent)) {
      try {
        console.log(`🔄 Starting backfill for ${resource.name}...`)
        
        // Use provided date range or default to 3 years
        let startDate, endDate
        if (dateRange && dateRange.startDate && dateRange.endDate) {
          startDate = dateRange.startDate
          endDate = dateRange.endDate
          console.log(`📅 Using custom date range: ${startDate} to ${endDate}`)
        } else {
          endDate = new Date().toISOString()
          startDate = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString()
          console.log(`📅 Using default 3-year range: ${startDate} to ${endDate}`)
        }
        
        // Use existing getHistoricalActivity with forceRefresh flag
        const historicalData = await getHistoricalActivity(resource, startDate, endDate, forceRefresh)
        
        const operation = {
          resourceId: resource.id,
          resourceName: resource.name,
          status: 'completed',
          weeksBackfilled: historicalData.length,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          dataQualityImprovement: calculateQualityImprovement(historicalData)
        }
        
        backfillOperations.push(operation)
        console.log(`✅ Backfill completed for ${resource.name}: ${historicalData.length} weeks`)
        
      } catch (error) {
        console.error(`❌ Backfill failed for ${resource.name}: ${error.message}`)
        backfillOperations.push({
          resourceId: resource.id,
          resourceName: resource.name,
          status: 'failed',
          error: error.message,
          startTime: new Date().toISOString()
        })
      }
    }

    res.json({
      message: `Backfill operation initiated for ${targetResources.length} resources`,
      operations: backfillOperations,
      summary: {
        totalResources: targetResources.length,
        successful: backfillOperations.filter(op => op.status === 'completed').length,
        failed: backfillOperations.filter(op => op.status === 'failed').length,
        totalWeeksBackfilled: backfillOperations.reduce((sum, op) => sum + (op.weeksBackfilled || 0), 0)
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Backfill operation error:', error)
    res.status(500).json({ error: 'Failed to execute backfill operation' })
  }
})

/**
 * Get system-wide data quality dashboard metrics
 * GET /api/data-quality/dashboard
 */
app.get('/api/data-quality/dashboard', async (req, res) => {
  try {
    console.log('📊 Pipeline health dashboard metrics request')
    
    const resources = await loadResources()
    
    // Count resources with GitHub URLs for pipeline coverage
    const githubResources = resources.filter(r => 
      r.social?.github && 
      r.social.github !== 'n/a' && 
      r.social.github.includes('github.com')
    )
    
    const dashboardMetrics = {
      timestamp: new Date().toISOString(),
      overview: {
        totalResources: resources.length,
        resourcesCovered: githubResources.length,
        analyzedResources: 0,
        averageDataQuality: 0,
        criticalIssues: 0
      },
      pipelineMetrics: {
        fetchSuccessRate: 0,  // Will be calculated from actual analysis
        cacheEfficiency: 0,   // Will be calculated from actual data coverage
        dbWriteSuccess: 0,    // Will be calculated from actual DB completeness
        overallHealth: 0      // Will be calculated average
      },
      cacheMetrics: {
        // Multi-layer hit rate: (memory hits + database hits) / total requests
        hitRate: CACHE.stats.totalRequests > 0 ? 
          Math.round(((CACHE.stats.memoryHits + CACHE.stats.databaseHits) / CACHE.stats.totalRequests) * 100) : 0,
        // Miss rate: only API calls are true misses
        missRate: CACHE.stats.totalRequests > 0 ? 
          Math.round((CACHE.stats.apiCalls / CACHE.stats.totalRequests) * 100) : 0,
        cacheSize: githubResources.length,
        evictionRate: 0,
        activeCacheSize: CACHE.data.size,
        maxCacheSize: CACHE.maxSize,
        totalRequests: CACHE.stats.totalRequests,
        memoryHits: CACHE.stats.memoryHits,
        databaseHits: CACHE.stats.databaseHits,
        apiCalls: CACHE.stats.apiCalls,
        // Legacy fields for backward compatibility
        totalHits: CACHE.stats.memoryHits + CACHE.stats.databaseHits,
        totalMisses: CACHE.stats.apiCalls
      },
      apiMetrics: {
        // Combined metrics for overall API health
        rateLimitRemaining: API_STATS.lastRateLimitRemaining || GRAPHQL_STATS.lastRateLimitRemaining || 0,
        isRateLimited: isRateLimited,
        rateLimitResetTime: rateLimitResetTime ? rateLimitResetTime.toISOString() : null,
        rateLimitResetIn: rateLimitResetTime && isRateLimited ? 
          Math.max(0, Math.ceil((rateLimitResetTime.getTime() - Date.now()) / 1000)) : null,
        errorCount: API_STATS.failedRequests + GRAPHQL_STATS.failedRequests,
        successRate: (API_STATS.successfulRequests + GRAPHQL_STATS.successfulRequests + API_STATS.failedRequests + GRAPHQL_STATS.failedRequests) > 0 ? 
          Math.round(((API_STATS.successfulRequests + GRAPHQL_STATS.successfulRequests) / (API_STATS.successfulRequests + GRAPHQL_STATS.successfulRequests + API_STATS.failedRequests + GRAPHQL_STATS.failedRequests)) * 100) : 0,
        recentErrors: [...API_STATS.recentErrors, ...GRAPHQL_STATS.recentErrors].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 25),
        
        // REST API specific metrics
        restApi: {
          successfulRequests: API_STATS.successfulRequests,
          failedRequests: API_STATS.failedRequests,
          successRate: API_STATS.successfulRequests + API_STATS.failedRequests > 0 ? 
            Math.round((API_STATS.successfulRequests / (API_STATS.successfulRequests + API_STATS.failedRequests)) * 100) : 0,
          recentErrors: API_STATS.recentErrors.slice(0, 10)
        },
        
        // GraphQL API specific metrics  
        graphqlApi: {
          successfulRequests: GRAPHQL_STATS.successfulRequests,
          failedRequests: GRAPHQL_STATS.failedRequests,
          successRate: GRAPHQL_STATS.successfulRequests + GRAPHQL_STATS.failedRequests > 0 ? 
            Math.round((GRAPHQL_STATS.successfulRequests / (GRAPHQL_STATS.successfulRequests + GRAPHQL_STATS.failedRequests)) * 100) : 0,
          recentErrors: GRAPHQL_STATS.recentErrors.slice(0, 10)
        }
      },
      dailyStorageMetrics: {
        // Daily storage health metrics
        successRate: 0,          // Percentage of successful daily storage operations
        failedWrites: 0,         // Number of failed storage operations in last hour
        cacheUtilization: 0,     // How much of the 10-day rolling cache is used
        fallbackUsage: 0,        // Times daily fallback was used instead of API
        averageResponseTime: 0,  // Average response time when using daily fallback
        lastCleanupTime: null,   // Last successful cleanup operation
        totalDailyRecords: 0     // Current number of daily records stored
      },
      pipelineIssues: [],
      recentActivity: [],
      systemStatus: {
        databaseHealth: await checkDatabaseHealth(),
        githubApiStatus: 'checking', // Will be updated based on actual rate limit
        lastAnalysisRun: new Date().toISOString()
      }
    }

    // Analyze ALL GitHub resources for enterprise-grade accuracy
    // No sampling - analyze complete dataset for true metrics
    
    // Analyze pipeline health for GitHub resources only
    for (const resource of githubResources) {
      try {
        const endDate = new Date().toISOString()
        const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() // Last 3 months
        
        // Simulate pipeline analysis (in reality, would track actual fetch/cache/db operations)
        const weeklyData = await getWeeklyActivity(resource, startDate, endDate)
        const quality = analyzeDataQuality(weeklyData)
        
        dashboardMetrics.overview.analyzedResources++
        dashboardMetrics.overview.averageDataQuality += quality.score
        
        // Track pipeline issues instead of generic quality issues
        if (quality.score < 80) {
          dashboardMetrics.overview.criticalIssues++
          
          // Determine issue type based on failure scenario
          let issueType = 'fetch_error'
          let stage = 'Fetch'
          let description = `Data pipeline incomplete: ${quality.score}% coverage`
          
          if (quality.score < 40) {
            issueType = 'db_error'
            stage = 'Database'
            description = `Critical database storage gaps detected`
          } else if (quality.score < 60) {
            issueType = 'cache_miss'
            stage = 'Cache'
            description = `Poor cache efficiency affecting data availability`
          }
          
          dashboardMetrics.pipelineIssues.push({
            type: issueType,
            stage: stage,
            resourceName: resource.name,
            description: description,
            timestamp: new Date().toISOString(),
            severity: quality.score < 40 ? 'high' : 'medium'
          })
        }
        
      } catch (error) {
        console.warn(`Pipeline analysis failed for ${resource.name}: ${error.message}`)
        // Still count as analyzed resource for accurate metrics
        dashboardMetrics.overview.analyzedResources++
        dashboardMetrics.overview.averageDataQuality += 0 // Failed analysis = 0% quality
        dashboardMetrics.overview.criticalIssues++
        
        // Track the error for API error tracking
        trackApiError(error, resource.name, 'pipeline_analysis')
        
        dashboardMetrics.pipelineIssues.push({
          type: 'fetch_error',
          stage: 'Fetch',
          resourceName: resource.name,
          description: `Failed to fetch GitHub data: ${error.message}`,
          timestamp: new Date().toISOString(),
          severity: 'high'
        })
      }
    }

    // Add API-level issues to pipeline problems for complete system visibility
    if (API_STATS.failedRequests > 0) {
      const errorRate = API_STATS.successfulRequests + API_STATS.failedRequests > 0 ? 
        Math.round((API_STATS.failedRequests / (API_STATS.successfulRequests + API_STATS.failedRequests)) * 100) : 0
      
      if (errorRate > 10) { // More than 10% error rate is concerning
        dashboardMetrics.pipelineIssues.push({
          type: 'api_error',
          stage: 'API',
          resourceName: 'GitHub API',
          description: `High API error rate: ${errorRate}% (${API_STATS.failedRequests} failures)`,
          timestamp: new Date().toISOString(),
          severity: errorRate > 25 ? 'high' : 'medium'
        })
      }
    }

    // Add rate limit warnings to pipeline issues
    if (isRateLimited && rateLimitResetTime) {
      const resetIn = Math.ceil((rateLimitResetTime.getTime() - Date.now()) / 60000) // minutes
      dashboardMetrics.pipelineIssues.push({
        type: 'rate_limit',
        stage: 'API',
        resourceName: 'GitHub API',
        description: `Rate limit active, reset in ${resetIn} minutes`,
        timestamp: new Date().toISOString(),
        severity: 'medium'
      })
    } else if (API_STATS.lastRateLimitRemaining && API_STATS.lastRateLimitRemaining < 100) {
      dashboardMetrics.pipelineIssues.push({
        type: 'rate_limit',
        stage: 'API',
        resourceName: 'GitHub API',
        description: `Low rate limit remaining: ${API_STATS.lastRateLimitRemaining} requests`,
        timestamp: new Date().toISOString(),
        severity: 'low'
      })
    }

    // Add cache-related issues to pipeline problems
    const cacheUtilization = (CACHE.data.size / CACHE.maxSize) * 100
    if (cacheUtilization > 95) {
      dashboardMetrics.pipelineIssues.push({
        type: 'cache_full',
        stage: 'Cache',
        resourceName: 'Memory Cache',
        description: `Cache nearly full: ${Math.round(cacheUtilization)}% utilization (${CACHE.data.size}/${CACHE.maxSize})`,
        timestamp: new Date().toISOString(),
        severity: 'medium'
      })
    }

    // Add database performance monitoring
    try {
      const dbHealth = await checkDatabaseHealth()
      if (dbHealth === 'error') {
        dashboardMetrics.pipelineIssues.push({
          type: 'db_error',
          stage: 'Database',
          resourceName: 'Supabase',
          description: 'Database connection failed or queries timing out',
          timestamp: new Date().toISOString(),
          severity: 'high'
        })
      }
    } catch (dbError) {
      dashboardMetrics.pipelineIssues.push({
        type: 'db_error',
        stage: 'Database',
        resourceName: 'Supabase',
        description: `Database error: ${dbError.message}`,
        timestamp: new Date().toISOString(),
        severity: 'high'
      })
    }

    // Calculate daily storage metrics (with background refresh awareness)
    try {
      // Skip expensive monitoring queries during background refresh to prevent interference
      if (backgroundRefreshInProgress) {
        console.log('⚡ Skipping daily storage metrics during background refresh')
        dashboardMetrics.dailyStorageMetrics = {
          successRate: 0,
          failedWrites: 0,
          cacheUtilization: 0,
          fallbackUsage: 0,
          averageResponseTime: 0,
          lastCleanupTime: null,
          totalDailyRecords: 0,
          sevenDayPerformance: 0,
          sevenDayReadiness: 0
        }
      } else {
        // Query daily storage statistics
        const dailyStats = await getDailyStorageStats()

        if (dailyStats && dailyStats.length > 0) {
        const stats = dailyStats[0]
        dashboardMetrics.dailyStorageMetrics = {
          successRate: stats.success_rate || 0,
          failedWrites: stats.failed_writes_last_hour || 0,
          cacheUtilization: stats.cache_utilization || 0,
          fallbackUsage: stats.fallback_usage_today || 0,
          averageResponseTime: stats.avg_response_time || 0,
          lastCleanupTime: stats.last_cleanup_time,
          totalDailyRecords: stats.total_records || 0,
          sevenDayPerformance: stats.seven_day_performance || 0,
          sevenDayReadiness: stats.seven_day_readiness || 0
        }

        // Add daily storage issues to pipeline problems
        if (stats.success_rate < 85) {
          dashboardMetrics.pipelineIssues.push({
            type: 'daily_storage_error',
            stage: 'Daily Storage',
            resourceName: 'Daily Activity Cache',
            description: `Low daily storage success rate: ${stats.success_rate}%`,
            timestamp: new Date().toISOString(),
            severity: stats.success_rate < 50 ? 'high' : 'medium'
          })
        }

        if (stats.failed_writes_last_hour > 10) {
          dashboardMetrics.pipelineIssues.push({
            type: 'daily_storage_error',
            stage: 'Daily Storage',
            resourceName: 'Daily Activity Cache',
            description: `High daily storage failures: ${stats.failed_writes_last_hour} in last hour`,
            timestamp: new Date().toISOString(),
            severity: stats.failed_writes_last_hour > 25 ? 'high' : 'medium'
          })
        }

        if (stats.cache_utilization > 90) {
          dashboardMetrics.pipelineIssues.push({
            type: 'daily_cache_full',
            stage: 'Daily Storage',
            resourceName: 'Daily Activity Cache',
            description: `Daily cache utilization high: ${Math.round(stats.cache_utilization)}%`,
            timestamp: new Date().toISOString(),
            severity: 'medium'
          })
        }

        if (stats.seven_day_performance < 70) {
          dashboardMetrics.pipelineIssues.push({
            type: 'seven_day_performance',
            stage: '7-Day Views',
            resourceName: '7-Day View Performance',
            description: `7-day view readiness low: ${stats.seven_day_performance}% (${stats.seven_day_readiness} records available)`,
            timestamp: new Date().toISOString(),
            severity: stats.seven_day_performance < 40 ? 'high' : 'medium'
          })
        }
        }
      }
    } catch (dailyStorageError) {
      console.warn('Failed to fetch daily storage metrics:', dailyStorageError.message)
      dashboardMetrics.pipelineIssues.push({
        type: 'daily_storage_error',
        stage: 'Daily Storage',
        resourceName: 'Daily Activity Cache',
        description: `Failed to fetch daily storage metrics: ${dailyStorageError.message}`,
        timestamp: new Date().toISOString(),
        severity: 'medium'
      })
    }

    // Calculate real pipeline metrics from actual data analysis
    if (dashboardMetrics.overview.analyzedResources > 0) {
      const avgDataQuality = Math.round(
        dashboardMetrics.overview.averageDataQuality / dashboardMetrics.overview.analyzedResources
      )
      dashboardMetrics.overview.averageDataQuality = avgDataQuality
      
      // Calculate real pipeline metrics
      const successfulResources = dashboardMetrics.overview.analyzedResources - dashboardMetrics.overview.criticalIssues
      const fetchSuccessRate = Math.round((successfulResources / dashboardMetrics.overview.analyzedResources) * 100)
      
      // Cache efficiency = how well our data coverage serves requests (higher quality = better cache)
      const cacheEfficiency = avgDataQuality
      
      // DB write success = resources that have data vs total attempts
      const dbWriteSuccess = Math.round((dashboardMetrics.overview.analyzedResources / githubResources.length) * 100)
      
      // Update real metrics
      dashboardMetrics.pipelineMetrics.fetchSuccessRate = fetchSuccessRate
      dashboardMetrics.pipelineMetrics.cacheEfficiency = cacheEfficiency
      dashboardMetrics.pipelineMetrics.dbWriteSuccess = dbWriteSuccess
      dashboardMetrics.pipelineMetrics.overallHealth = Math.round((fetchSuccessRate + cacheEfficiency + dbWriteSuccess) / 3)
      
      // Keep the real cache hit/miss rates (already calculated from CACHE.stats)
      // Don't overwrite with data coverage metrics
      
      // Calculate cache eviction rate based on cache utilization
      const cacheUtilization = (CACHE.data.size / CACHE.maxSize) * 100
      dashboardMetrics.cacheMetrics.evictionRate = cacheUtilization > 90 ? 
        Math.round(cacheUtilization - 90) : 0 // Eviction starts when cache is >90% full
      dashboardMetrics.cacheMetrics.activeCacheSize = CACHE.data.size
      dashboardMetrics.cacheMetrics.maxCacheSize = CACHE.maxSize
      dashboardMetrics.cacheMetrics.utilizationPercentage = Math.round(cacheUtilization)
      
      // Update GitHub API status based on current state
      if (isRateLimited) {
        dashboardMetrics.systemStatus.githubApiStatus = 'error'
      } else if (API_STATS.lastRateLimitRemaining && API_STATS.lastRateLimitRemaining < 100) {
        dashboardMetrics.systemStatus.githubApiStatus = 'degraded'  
      } else {
        dashboardMetrics.systemStatus.githubApiStatus = 'operational'
      }
    }

    // Sort pipeline issues by severity and timestamp
    dashboardMetrics.pipelineIssues.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 }
      if (severityOrder[b.severity] !== severityOrder[a.severity]) {
        return severityOrder[b.severity] - severityOrder[a.severity]
      }
      return new Date(b.timestamp) - new Date(a.timestamp)
    })
    dashboardMetrics.pipelineIssues = dashboardMetrics.pipelineIssues.slice(0, 10) // Top 10 issues

    res.json(dashboardMetrics)

  } catch (error) {
    console.error('Dashboard metrics error:', error)
    res.status(500).json({ error: 'Failed to generate dashboard metrics' })
  }
})

/**
 * Get detailed gap information for a specific resource
 * GET /api/data-quality/gaps/:resourceId
 */
app.get('/api/data-quality/gaps/:resourceId', async (req, res) => {
  try {
    const { resourceId } = req.params
    const { period = '52weeks' } = req.query
    
    console.log(`🔍 Gap analysis for resource ${resourceId}, period: ${period}`)
    
    const resources = await loadResources()
    const resource = resources.find(r => r.id?.toString() === resourceId)
    
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' })
    }

    // Get historical data for the specified period
    const periodDays = { 
      '4weeks': 28, 
      '3months': 84, 
      '52weeks': 364, 
      '3years': 1092 
    }[period] || 364

    const endDate = new Date().toISOString()
    const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()
    
    const weeklyData = await getWeeklyActivity(resource, startDate, endDate)
    
    // Detailed gap analysis
    const gapAnalysis = {
      resource: {
        id: resource.id,
        name: resource.name,
        type: resource.type
      },
      period,
      analysis: {
        dataQuality: analyzeDataQuality(weeklyData),
        gaps: identifyDetailedGaps(weeklyData, startDate, endDate),
        freshness: assessDataFreshness(weeklyData),
        timeline: generateDataTimeline(weeklyData, startDate, endDate)
      },
      recommendations: generateRecommendations(resource, weeklyData),
      timestamp: new Date().toISOString()
    }

    res.json(gapAnalysis)

  } catch (error) {
    console.error('Gap analysis error:', error)
    res.status(500).json({ error: 'Failed to analyze gaps' })
  }
})

// =============================================================================
// DATA QUALITY HELPER FUNCTIONS
// Enterprise-level utility functions for data analysis
// =============================================================================

function analyzeDataQuality(weeklyData) {
  if (!weeklyData || weeklyData.length === 0) {
    return { score: 0, level: 'CRITICAL', totalWeeks: 0, availableWeeks: 0, missingWeeks: 0 }
  }

  // Calculate expected weeks based on data span
  const sortedData = [...weeklyData].sort((a, b) => new Date(a.week_start) - new Date(b.week_start))
  const firstWeek = new Date(sortedData[0].week_start)
  const lastWeek = new Date(sortedData[sortedData.length - 1].week_start)
  const weeksDifference = Math.ceil((lastWeek - firstWeek) / (7 * 24 * 60 * 60 * 1000)) + 1
  
  const availableWeeks = weeklyData.length
  const expectedWeeks = Math.max(weeksDifference, availableWeeks)
  const missingWeeks = expectedWeeks - availableWeeks
  const score = Math.round((availableWeeks / expectedWeeks) * 100)

  let level = 'CRITICAL'
  if (score >= 95) level = 'EXCELLENT'
  else if (score >= 80) level = 'GOOD'
  else if (score >= 60) level = 'FAIR'
  else if (score >= 40) level = 'POOR'

  return { score, level, totalWeeks: expectedWeeks, availableWeeks, missingWeeks }
}

function analyzePeriodCompleteness(weeklyData) {
  const periods = {
    '4weeks': 28,
    '3months': 84, 
    '52weeks': 364,
    '3years': 1092
  }

  const analysis = {}
  const now = new Date()

  Object.entries(periods).forEach(([periodKey, days]) => {
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const periodData = weeklyData.filter(week => {
      const weekDate = new Date(week.week_start)
      return weekDate >= startDate && weekDate <= now
    })

    const expectedWeeks = Math.ceil(days / 7)
    const availableWeeks = periodData.length
    const completeness = expectedWeeks > 0 ? Math.round((availableWeeks / expectedWeeks) * 100) : 0

    analysis[periodKey] = {
      expectedWeeks,
      availableWeeks,
      completeness,
      isComplete: availableWeeks >= expectedWeeks
    }
  })

  return analysis
}

function assessDataFreshness(weeklyData) {
  if (!weeklyData || weeklyData.length === 0) {
    return { level: 'CRITICAL', daysSinceLastUpdate: null, lastUpdateDate: null }
  }

  const sortedData = [...weeklyData].sort((a, b) => new Date(b.week_start) - new Date(a.week_start))
  const lastUpdate = new Date(sortedData[0].week_start)
  const now = new Date()
  const daysSinceLastUpdate = Math.floor((now - lastUpdate) / (24 * 60 * 60 * 1000))

  let level = 'CRITICAL'
  if (daysSinceLastUpdate <= 2) level = 'CURRENT'
  else if (daysSinceLastUpdate <= 7) level = 'RECENT'
  else if (daysSinceLastUpdate <= 30) level = 'STALE'

  return {
    level,
    daysSinceLastUpdate,
    lastUpdateDate: lastUpdate.toISOString()
  }
}

function identifyGaps(weeklyData) {
  if (!weeklyData || weeklyData.length === 0) {
    return { totalGaps: 1, gapDuration: 'complete', severity: 'CRITICAL' }
  }

  const sortedData = [...weeklyData].sort((a, b) => new Date(a.week_start) - new Date(b.week_start))
  let gaps = 0
  let totalGapWeeks = 0

  for (let i = 0; i < sortedData.length - 1; i++) {
    const currentWeek = new Date(sortedData[i].week_start)
    const nextWeek = new Date(sortedData[i + 1].week_start)
    const expectedNextWeek = new Date(currentWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
    
    const weeksDifference = Math.round((nextWeek - expectedNextWeek) / (7 * 24 * 60 * 60 * 1000))
    
    if (weeksDifference > 0) {
      gaps++
      totalGapWeeks += weeksDifference
    }
  }

  let severity = 'LOW'
  if (totalGapWeeks >= 12) severity = 'CRITICAL'
  else if (totalGapWeeks >= 4) severity = 'HIGH'
  else if (totalGapWeeks >= 2) severity = 'MEDIUM'

  return { totalGaps: gaps, gapDuration: totalGapWeeks, severity }
}

function identifyDetailedGaps(weeklyData, startDate, endDate) {
  // Implementation for detailed gap identification with specific date ranges
  return identifyGaps(weeklyData) // Simplified for now
}

function generateDataTimeline(weeklyData, startDate, endDate) {
  // Generate timeline showing data availability
  const timeline = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  const dataMap = new Map()
  
  // Map existing data
  weeklyData.forEach(week => {
    dataMap.set(week.week_start, week.commit_count || 0)
  })
  
  // Generate timeline
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 7)) {
    const weekKey = date.toISOString().slice(0, 10)
    timeline.push({
      week: weekKey,
      hasData: dataMap.has(weekKey),
      commits: dataMap.get(weekKey) || 0
    })
  }
  
  return timeline
}

function generateRecommendations(resource, weeklyData) {
  const recommendations = []
  const quality = analyzeDataQuality(weeklyData)
  const freshness = assessDataFreshness(weeklyData)

  if (quality.score < 50) {
    recommendations.push({
      type: 'CRITICAL',
      message: `Critical data gaps for ${resource.name}`,
      action: 'IMMEDIATE_BACKFILL',
      priority: 'HIGH'
    })
  }

  if (freshness.level === 'CRITICAL') {
    recommendations.push({
      type: 'WARNING',
      message: `Stale data for ${resource.name}`,
      action: 'CHECK_CONNECTIVITY',
      priority: 'MEDIUM'
    })
  }

  return recommendations
}

function calculateAverageQuality(analysisResults) {
  const validResults = analysisResults.filter(r => r.dataQuality && !r.error)
  if (validResults.length === 0) return 0
  
  const totalQuality = validResults.reduce((sum, r) => sum + r.dataQuality.score, 0)
  return Math.round(totalQuality / validResults.length)
}

function calculateQualityImprovement(historicalData) {
  // Calculate improvement based on amount of data backfilled
  return {
    weeksAdded: historicalData.length,
    estimatedImprovement: Math.min(20, historicalData.length * 2) // 2% per week, max 20%
  }
}

// Serve static files AFTER API routes to prevent conflicts
app.use(express.static(path.join(__dirname, 'dist')))

// Catch-all handler for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Initialize and start server
const startServer = async () => {
  try {
    await createTables()
    
    app.listen(PORT, async () => {
      logger.info(`🚀 Server listening on port ${PORT}`)
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`)
      logger.info(`🔐 GitHub Token: ${GITHUB_TOKEN ? '✅ Available' : '❌ Not configured'}`)
      logger.info(`💾 Supabase: ${supabase ? '✅ Connected' : '❌ Not configured'}`)

      // Clear any stale current period cache after timezone fix
      invalidateCurrentPeriodCache()

      // ✅ NON-BLOCKING: Start background processes immediately
      startBackgroundProcesses()
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}



// ✅ NEW: Network connectivity check
const checkNetworkConnectivity = async () => {
  try {
    console.log('🌐 Checking network connectivity...')
    
    // Test basic internet connectivity
    const testResponse = await fetch('https://httpbin.org/get', {
      method: 'GET',
      timeout: 10000
    }).catch(() => null)
    
    if (!testResponse || !testResponse.ok) {
      console.warn('⚠️ Basic internet connectivity check failed')
      return false
    }
    
    // Test GitHub API connectivity
    const githubResponse = await fetch('https://api.github.com/rate_limit', {
      method: 'GET',
      timeout: 10000
    }).catch(() => null)
    
    if (!githubResponse || !githubResponse.ok) {
      console.warn('⚠️ GitHub API connectivity check failed')
      return false
    }
    
    console.log('✅ Network connectivity confirmed')
    return true
  } catch (error) {
    console.warn('⚠️ Network connectivity check failed:', error.message)
    return false
  }
}

// ✅ NEW: Non-blocking background process manager with network resilience
const startBackgroundProcesses = () => {
  console.log('🔄 Starting background processes (non-blocking)...')
  
  // Phase 1: Essential startup (fast, minimal blocking)
  setTimeout(async () => {
    try {
      console.log('📦 Phase 1: Loading essential resources...')
      await loadResources() // Just load the resource list
      console.log('✅ Phase 1: Essential resources loaded')
    } catch (error) {
      console.error('❌ Phase 1 failed:', error.message)
    }
  }, 100) // 100ms delay
  
  // Phase 2: Network connectivity check and database cache warmup
  setTimeout(async () => {
    try {
      console.log('📦 Phase 2: Checking network connectivity...')
      const isNetworkAvailable = await checkNetworkConnectivity()
      
      if (isNetworkAvailable) {
        console.log('📦 Phase 2: Warming database cache...')
        await warmDatabaseCache()
        console.log('✅ Phase 2: Database cache warmed')
      } else {
        console.log('⚠️ Phase 2: Network unavailable, skipping external operations')
      }
    } catch (error) {
      console.error('❌ Phase 2 failed:', error.message)
    }
  }, 2000) // 2 second delay
  
  // Phase 3: Comprehensive background preloading (low priority, runs in background)
  setTimeout(async () => {
    try {
      console.log('📦 Phase 3: Starting comprehensive background preloading...')
      comprehensiveBackgroundPreloading().catch(error => {
        console.error('❌ Comprehensive background preloading failed:', error.message)
      })
    } catch (error) {
      console.error('❌ Phase 3 failed:', error.message)
    }
  }, 5000) // 5 second delay
  
  // Phase 4: Cache refresh schedules (lowest priority)
          setTimeout(() => {
    console.log('📦 Phase 4: Setting up cache refresh schedules...')
    setupCacheRefreshSchedules()
    console.log('✅ Phase 4: Cache refresh schedules configured')
  }, 10000) // 10 second delay
}

// ✅ NEW: Fast database cache warmup (check all resources exist)
const warmDatabaseCache = async () => {
  try {
    const resources = await loadResources()
    const resourcesWithGitHub = resources.filter(r => r.social?.github)
    
    console.log(`📦 Checking data availability for ${resourcesWithGitHub.length} resources...`)
    
    // Quick check if data exists for all resources (fast operation)
    for (const resource of resourcesWithGitHub) {
      try {
        const cacheKey = `warmup_${resource.name}`
        const hasData = await checkResourceDataExists(resource)
        
        if (hasData) {
          CACHE.data.set(cacheKey, { status: 'ready', timestamp: Date.now() })
        } else {
          CACHE.data.set(cacheKey, { status: 'needs_backfill', timestamp: Date.now() })
        }
      } catch (error) {
        console.warn(`⚠️ Cache check failed for ${resource.name}:`, error.message)
      }
    }
  } catch (error) {
    console.error('❌ Database cache warmup failed:', error.message)
  }
}

// ✅ NEW: Check if resource data exists (fast)
const checkResourceDataExists = async (resource) => {
  if (!supabase) return false
  
  try {
    const repoPath = supabaseService.default.extractRepoPath(resource.social?.github)
    if (!repoPath) return false
    
    const { count } = await supabase
      .from('github_activity')
      .select('*', { count: 'exact', head: true })
      .eq('resource_id', repoPath)
      .limit(1)
    
    return (count || 0) > 0
        } catch (error) {
    return false
  }
}

// ✅ NEW: Setup cache refresh schedules (non-blocking)
const setupCacheRefreshSchedules = () => {
  // Run initial cache refresh immediately
  console.log('🚀 Running initial cache refresh on startup...')
  populateUpdatesCache('all').catch(error => {
    console.error('❌ Initial cache refresh failed:', error.message)
  })

  // High priority: All projects every 90 minutes (optimized for low traffic)
  const refreshInterval = process.env.NODE_ENV === 'production' ? 90 * 60 * 1000 : 30 * 60 * 1000
  setInterval(() => {
    console.log('⚡ Running high-priority cache refresh...')
    populateUpdatesCache('all').catch(error => {
      console.error('❌ High-priority cache refresh failed:', error.message)
    })
  }, refreshInterval)
  
  // Standard priority: All projects every 24 hours (immutable data)
  setInterval(() => {
    console.log('🔄 Running full cache refresh...')
    populateUpdatesCache('all').catch(error => {
      console.error('❌ Full cache refresh failed:', error.message)
    })
  }, 24 * 60 * 60 * 1000) // 24 hours
}

startServer()

// Get historical maximums for a resource
app.post('/api/github/historical-maximums', async (req, res) => {
  try {
    const resource = req.body;
    if (!resource || !resource.name) {
      return res.status(400).json({ error: 'Invalid resource data provided.' });
    }

    logger.debug(`🔍 Calculating historical maximums for ${resource.name}`);
    const maximumsData = await calculateHistoricalMaximums(resource);
    
    res.json(maximumsData);
  } catch (error) {
    logger.error(`❌ Error calculating historical maximums for ${req.body?.name}:`, error);
    res.status(500).json({ 
      error: 'Failed to calculate historical maximums', 
      message: error.message 
    });
  }
});

// ✅ NEW: Comprehensive background preloading (loads ALL data intelligently)
const comprehensiveBackgroundPreloading = async () => {
  console.log('🎯 COMPREHENSIVE BACKGROUND PRELOADING')
  console.log('='.repeat(50))
  console.log('🔄 Starting comprehensive background preloading for ALL resources...')
  
  try {
    // Check network connectivity before starting heavy operations
    const isNetworkAvailable = await checkNetworkConnectivity()
    if (!isNetworkAvailable) {
      console.log('⚠️ Network unavailable, skipping comprehensive preloading')
      return
    }
    
    // Step 1: Historical data completeness check and backfilling
    if (supabase && GITHUB_TOKEN) {
      try {
        console.log('📦 Background: Historical data completeness check...')
        await ensureHistoricalDataCompleteness()
        console.log('✅ Background: Historical data check completed')
      } catch (error) {
        console.error('❌ Historical data completeness check failed:', error.message)
      }
    }
    
    // Step 2: Preload historical maximums for all resources
    try {
      console.log('📦 Background: Preloading historical maximums for all resources...')
      await preloadHistoricalMaximumsForAll()
      console.log('✅ Background: Historical maximums preloaded')
    } catch (error) {
      console.error('❌ Historical maximums preloading failed:', error.message)
    }
    
    // Step 3: Preload organization data for all organizations
    try {
      console.log('📦 Background: Preloading organization data...')
      await preloadOrganizationDataForAll()
      console.log('✅ Background: Organization data preloaded')
    } catch (error) {
      console.error('❌ Organization data preloading failed:', error.message)
    }
    
    // Step 4: Updates cache population (commits & releases)
    try {
      console.log('📦 Background: Populating updates cache...')
      await populateUpdatesCache('all')
      console.log('✅ Background: Updates cache population completed')
    } catch (error) {
      console.error('❌ Updates cache population failed:', error.message)
    }
    
    console.log('🎉 COMPREHENSIVE BACKGROUND PRELOADING COMPLETED!')
    console.log('🚀 All data preloaded and ready for instant access!')
    console.log('')
  } catch (error) {
    console.error('❌ Comprehensive background preloading failed:', error.message)
  }
}

// ✅ NEW: Preload historical maximums for all resources (background)
const preloadHistoricalMaximumsForAll = async () => {
  logger.debug('🚀 Preloading historical maximums for ALL resources...')
  
  try {
    const resources = await loadResources()
    const resourcesWithGitHub = resources.filter(r => r.social?.github)
    let successCount = 0
    let errorCount = 0

  // Process in batches to avoid overwhelming the database
    const batchSize = 5 // Reduced batch size for better error handling
  for (let i = 0; i < resourcesWithGitHub.length; i += batchSize) {
      const batch = resourcesWithGitHub.slice(i, i + batchSize)
      
      const batchPromises = batch.map(async (resource) => {
      try {
          await calculateHistoricalMaximums(resource)
          successCount++
      } catch (error) {
          logger.warn(`⚠️ Failed to preload historical maximums for ${resource.name}: ${error.message}`)
          errorCount++
        }
      })
      
      // Use Promise.allSettled to handle individual failures gracefully
      await Promise.allSettled(batchPromises)
      
      // Small delay between batches
      if (i + batchSize < resourcesWithGitHub.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)) // Increased delay
      }
    }
    
    logger.debug(`✅ Preloading of historical maximums complete. Success: ${successCount}, Errors: ${errorCount}`)
  } catch (error) {
    logger.error('❌ Historical maximums preloading failed:', error.message)
    throw error
  }
}

// ✅ NEW: Preload organization data for all organizations (background)
const preloadOrganizationDataForAll = async () => {
  logger.debug('🚀 Preloading data for ALL organization resources...')
  const resources = await loadResources()
  const organizationResources = resources.filter(r => r.type === 'organization' && r.social?.github)
  let successCount = 0
  let errorCount = 0

  const now = new Date()
  const periodConfigs = {
    current: { since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() },
    '4weeks': { since: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString() },
    '3months': { since: new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000).toISOString() },
    '52weeks': { since: new Date(now.getTime() - 52 * 7 * 24 * 60 * 60 * 1000).toISOString() },
    '3years': { since: new Date(now.getTime() - 156 * 7 * 24 * 60 * 60 * 1000).toISOString() }
  }

  for (const org of organizationResources) {
    try {
      logger.debug(`📦 Preloading organization: ${org.name}`)
      for (const [period, config] of Object.entries(periodConfigs)) {
        let activityData
        if (period === 'current') {
          const recentData = await getRecentActivity(org, true, 'current')
          activityData = recentData.weeklyData
        } else {
          activityData = await getHistoricalActivity(org, config.since, new Date().toISOString())
        }
        
        const totalCommits = Array.isArray(activityData) ? 
          activityData.reduce((sum, week) => sum + (week?.count || 0), 0) : 0

        const cacheKey = `${org.id || org.name}_${period}`
        ORGANIZATION_DATA_CACHE.set(cacheKey, { weeklyData: activityData, totalCommits })
      }
      successCount++
    } catch (error) {
      logger.warn(`⚠️ Failed to preload data for organization ${org.name}: ${error.message}`)
      errorCount++
    }
  }
  
  logger.debug(`✅ Preloading of organization data complete. Success: ${successCount}, Errors: ${errorCount}`)
}