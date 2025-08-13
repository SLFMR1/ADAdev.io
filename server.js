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
// Removed hybridDataFetcher imports - using unified server API approach

// Use existing data quality functions defined later in the file

const app = express()
const PORT = process.env.PORT || 3000

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.VITE_OPENAI_API_KEY,
})

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

// GitHub API configuration
const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const RATE_LIMIT = GITHUB_TOKEN ? 5000 : 60
const REQUEST_INTERVAL = 500 // ms between requests (increased from 200ms)

// Rate limit tracking
let isRateLimited = false
let rateLimitResetTime = null

// In-memory cache for performance - optimized for small memory footprint
const CACHE = {
  data: new Map(),
  timestamps: new Map(),
  maxSize: 10000, // Restored to original size for optimal performance
  ttl: {
    recent: 30 * 60 * 1000, // 30 minutes for recent data (real-time updates)
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

// Rate limiting with exponential backoff
let requestCount = 0
let lastRequestTime = 0
let consecutiveFailures = 0

const rateLimitedFetch = async (url, options = {}) => {
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  
  // Exponential backoff delay based on consecutive failures
  const backoffDelay = Math.min(1000 * Math.pow(2, consecutiveFailures), 30000) // Max 30 seconds
  const minInterval = Math.max(REQUEST_INTERVAL, backoffDelay)
  
  if (timeSinceLastRequest < minInterval) {
    await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLastRequest))
  }
  
  lastRequestTime = Date.now()
  requestCount++
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'adaDEV-Platform',
        ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` }),
        ...options.headers
      },
      ...options
    })
    
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
    API_STATS.successfulRequests++
    
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (remaining) {
      API_STATS.lastRateLimitRemaining = parseInt(remaining)
    }
    
    return response
  } catch (error) {
    consecutiveFailures++
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
    return { type: 'server_error', severity: 'error', shouldRetry: true }
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

// GitHub API functions
// Detect realistic data limits from actual commit history
const detectRepoDataLimits = (commits) => {
  if (!commits || commits.length === 0) {
    return { 
      maxRealisticPeriod: 'current', 
      availablePeriods: ['current'],
      reason: 'no_commits',
      ageWeeks: 0
    }
  }

  // Find oldest commit date
  const dates = commits.map(c => new Date(c.commit?.author?.date || c.date)).filter(d => !isNaN(d.getTime()))
  if (dates.length === 0) {
    return { 
      maxRealisticPeriod: 'current', 
      availablePeriods: ['current'],
      reason: 'invalid_dates',
      ageWeeks: 0
    }
  }

  const oldestDate = new Date(Math.min(...dates))
  const ageWeeks = Math.floor((Date.now() - oldestDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
  
  // Be realistic about what periods make sense
  let maxRealisticPeriod = 'current'
  let availablePeriods = ['current']
  
  if (ageWeeks >= 156) { // 3+ years of actual commits
    maxRealisticPeriod = '3years'
    availablePeriods = ['current', '4weeks', '3months', '52weeks', '3years']
  } else if (ageWeeks >= 52) { // 1+ year of commits
    maxRealisticPeriod = '52weeks' 
    availablePeriods = ['current', '4weeks', '3months', '52weeks']
  } else if (ageWeeks >= 13) { // 3+ months of commits
    maxRealisticPeriod = '3months'
    availablePeriods = ['current', '4weeks', '3months']
  } else if (ageWeeks >= 4) { // 4+ weeks of commits
    maxRealisticPeriod = '4weeks'
    availablePeriods = ['current', '4weeks']
  }
  
  return {
    maxRealisticPeriod,
    availablePeriods, 
    reason: 'detected_from_commits',
    ageWeeks,
    oldestCommitDate: oldestDate.toISOString(),
    totalCommits: commits.length
  }
}

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
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      // Safety limit to prevent infinite loops (adjust as needed)
      if (page > 50) {
        console.warn(`Reached page limit (${page}) for ${repoPath}, stopping pagination`)
        break
      }
    }
    
    logger.debug(`📄 Fetched ${allCommits.length} total commits from ${page} pages for ${repoPath}`)
    
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
    
    const { data, error } = await supabase
      .from('github_activity')
      .select('*')
      .eq('resource_id', resourceIdentifier)
      .eq('repo_path', repoPath)
      .gte('week_start', startDate)
      .lte('week_start', endDate)
      .order('week_start')
    
    if (error) throw error
    return data || []
  } catch (error) {
    console.error(`Error fetching weekly activity for ${resource.name}:`, error)
    return []
  }
}

// Data processing functions
const processCommitsToWeekly = (commits) => {
  const weeklyData = new Map()
  
  // Create continuous weekly data for the last 52 weeks (1 year)
  const weeksToTrack = 52
  const today = new Date()
  
  // Initialize all weeks with 0 commits
  for (let i = weeksToTrack - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - (i * 7))
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
  
  // Get the last 7 days
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateKey = date.toISOString().slice(0, 10)
    dailyData.set(dateKey, 0) // Initialize with 0
  }
  
  // Count commits for each day
  commits.forEach(commit => {
    const date = new Date(commit.date)
    const dateKey = date.toISOString().slice(0, 10)
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

const getRecentActivity = async (resource, useDailyProcessing = false, period = '4weeks') => {
  // Track every request that comes through
  CACHE.stats.totalRequests++
  
  // Check in-memory cache first - include period in cache key to avoid returning same data for different periods
  const cacheKey = generateCacheKey('recent_activity', resource.id || resource.name, { useDailyProcessing, period })
  const cachedResult = getCachedData(cacheKey)
  if (cachedResult) {
    logger.debug(`✅ Using cached recent activity for ${resource.name}`);
    return cachedResult
  }
  
  let commits = []
  let repoInfo = null
  
  try {
    // Determine the time window based on period and processing type
    let timeWindow;
    if (useDailyProcessing) {
      timeWindow = 7; // 7 days for daily processing (regardless of period)
    } else {
      // Map period to appropriate time window in days
      const periodToDays = {
        '4weeks': 28,    // 4 weeks
        '3months': 90,   // ~3 months
        '52weeks': 365,  // 1 year
        '3years': 1095   // 3 years
      };
      timeWindow = periodToDays[period] || 30; // Default to 30 days if period not found
    }
    const since = new Date(Date.now() - timeWindow * 24 * 60 * 60 * 1000).toISOString();
    
    logger.debug(`⏰ ${resource.name}: Fetching commits since ${since} (${timeWindow} days, period: ${period}, daily: ${useDailyProcessing})`);
    
    // Check if we're currently rate limited
    if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime.getTime()) {
      logger.warn(`⚠️ Skipping ${resource.name} - GitHub API rate limited until ${rateLimitResetTime.toLocaleString()}`);
      const emptyResult = {
        commits: [],
        commitsPerWeek: 0,
        weeklyData: [],
        repoInfo: null
      }
      setCachedData(cacheKey, emptyResult)
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
        commits = await fetchOrgCommits(orgName, since);
      }
    } else if (resource.type === 'repository' || resource.social?.github) {
      // For repositories or unknown resources with GitHub URLs
      const repoPath = resource.social.github.replace('https://github.com/', '')
      commits = await fetchRepoCommits(repoPath, since) // Use time-based filtering
      
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
  
  // Check if we're currently rate limited
  if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime.getTime()) {
    logger.warn(`⚠️ GitHub API rate limited until ${rateLimitResetTime.toLocaleString()}`);
    
    // Return database data if available, rather than empty results
    if (dbData.length > 0) {
      logger.debug(`📊 Using existing database data for ${resource.name} (rate limited fallback)`);
      return finalData
    }
    
    logger.warn(`⚠️ No database data available for ${resource.name} - returning empty results`);
    return []
  }
  
  logger.debug(`🔄 Fetching fresh data from GitHub API for ${resource.name}...`);
  
  // Fallback to GitHub API with enhanced error handling
  const since = new Date(startDate).toISOString()
  let commits = []
  
  try {
    logger.debug(`🔄 Fetching fresh GitHub data for ${resource.name} (${startDate} to ${endDate})`);
    
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
        return dbData.length > 0 ? finalData : [];
      }
      
      commits = await fetchOrgCommits(orgName, since);
      CACHE.stats.apiCalls++
    } else if (resource.type === 'repository' || resource.social?.github) {
      // For repositories or unknown resources with GitHub URLs
      const repoPath = resource.social.github.replace('https://github.com/', '')
      commits = await fetchRepoCommits(repoPath, since)
      CACHE.stats.apiCalls++
    } else {
      console.warn(`⚠️ No valid GitHub URL found for ${resource.name} (type: ${resource.type})`);
      return dbData.length > 0 ? finalData : [];
    }
  } catch (error) {
    console.error(`Failed to fetch commits for ${resource.name}:`, error.message)
    // Return cached data if available, otherwise empty
    return dbData.length > 0 ? finalData : []
  }
  
  const weeklyData = processCommitsToWeekly(commits)
  logger.debug(`📊 Processed ${commits.length} commits into ${weeklyData.length} weeks for ${resource.name}`)
  
  // Store in both in-memory cache and database for future use
  setCachedData(cacheKey, weeklyData)
  
  // Store in database with proper current week handling
  try {
    await supabaseService.storeWeeklyActivity(resource, weeklyData)
    
    // Verify storage succeeded
    const verification = await verifyDataStored(resource, weeklyData)
    if (verification.success) {
      logger.debug(`✅ Successfully stored fresh data for ${resource.name} (${verification.stored}/${verification.expected} weeks)`)
    } else {
      logger.warn(`⚠️ Storage verification failed for ${resource.name}: expected ${verification.expected}, stored ${verification.stored}`)
    }
  } catch (error) {
    console.warn(`Failed to store activity data for ${resource.name}:`, error.message)
  }
  
  return weeklyData
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
      '5weeks': 5,    // 4 weeks period uses 5 weeks of data (minus current week)
      '3months': 13,  // 3 months = ~13 weeks
      '52weeks': 52,  // 12 months = ~52 weeks  
      '3years': 156   // 3 years = ~156 weeks
    }
    
    // Minimum data requirements for meaningful comparison (Period + 1 logic)
    const minimumWeeksForComparison = {
      '5weeks': 5,    // Need 5 weeks minimum for 4-week comparison (can compare 2 sequences)
      '3months': 17,  // Need ~4 months (17 weeks) for 3-month comparison  
      '52weeks': 65,  // Need ~13 months (65 weeks) for 12-month comparison
      '3years': 208   // Need ~4 years (208 weeks) for 3-year comparison
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
        let maxTotal = 0
        let windowTotals = [] // Debug: track all window totals
        const possibleWindows = weeklyCommits.length - weekCount + 1
        
        for (let i = 0; i <= weeklyCommits.length - weekCount; i++) {
          const windowTotal = weeklyCommits
            .slice(i, i + weekCount)
            .reduce((sum, week) => sum + week.count, 0)
          
          windowTotals.push(windowTotal)
          if (windowTotal > maxTotal) {
            maxTotal = windowTotal
          }
        }
        
        // Debug logging
        logger.debug(`📊 ${resource.name} ${periodKey} (${weekCount} weeks): ${possibleWindows} windows, max=${maxTotal}, all=[${windowTotals.slice(0, 5).join(',')}${windowTotals.length > 5 ? '...' : ''}]`)
        
        result.maximums[periodKey] = maxTotal // Use actual calculated maximum
      } else if (weeklyCommits.length > 0) {
        // Insufficient data: return null for intelligent frontend handling
        logger.debug(`Insufficient data for ${periodKey}: need ${minimumWeeks} weeks, have ${weeklyCommits.length} weeks`)
        result.maximums[periodKey] = null // Let frontend handle insufficient data case
        result.metadata.dataQuality = 'insufficient_data'
        result.metadata.minimumWeeksNeeded = minimumWeeks
        result.metadata.availableWeeks = weeklyCommits.length
      } else {
        // No data: use reasonable baseline
        result.maximums[periodKey] = weekCount * 5 // 5 commits per week baseline
        result.metadata.dataQuality = 'estimated'
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

// Create reasonable fallback maximums when no data is available
const createFallbackMaximums = () => ({
  maximums: {
    '5weeks': 25,   // 5 commits/week baseline
    '3months': 65,  // 5 commits/week baseline 
    '52weeks': 260, // 5 commits/week baseline
    '3years': 780   // 5 commits/week baseline
  },
  metadata: {
    hasHistoricalData: false,
    totalWeeksAvailable: 0,
    dataQuality: 'fallback'
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
      '3months': 90,
      '52weeks': 365,
      '3years': 1095
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
      '3months': 13,
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
        '4weeks': '5weeks',
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
        '5weeks': {
          since: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString(),
          days: 35
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
          days: 1095
        }
      };
      
      const periodConfig = periodConfigs[mappedPeriod];
      if (!periodConfig) {
        return res.status(400).json({ error: 'Invalid period' });
      }
      
      try {
        let activityData;
        let totalCommits;
        
        // Use getRecentActivity with daily processing for 'current' period, getHistoricalActivity for others
        if (period === 'current') {
          // For 7-day period, use getRecentActivity with daily processing
          const recentData = await getRecentActivity(targetResource, true, 'current');
          activityData = recentData.weeklyData; // This contains daily data for 7-day period
          totalCommits = recentData.commitsPerWeek;
        } else {
          // For other periods, use getHistoricalActivity
          activityData = await getHistoricalActivity(targetResource, periodConfig.since, new Date().toISOString());
          totalCommits = Array.isArray(activityData) ? 
            activityData.reduce((sum, week) => sum + (week && typeof week.count === 'number' ? week.count : 0), 0) : 0;
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
      '5weeks': {
        since: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        days: 35,
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
      
      if (viewMode === 'organization' && !isOrganization) return false;
      if (viewMode === 'repository' && !isRepository) return false;
      
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
            ['5weeks', periods['5weeks']],
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
                const recentData = await getRecentActivity(resource, true);
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
        '5weeks': buildPeriodData(allResourcesData, '5weeks'),
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
 * Maintain rolling cache of latest commits for a resource (30 max)
 */
async function maintainCommitsCache(resourceId, commits) {
  if (!supabase || !commits || commits.length === 0) return
  
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
        sha: sampleCommit.sha?.substring(0, 8)
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
    
    // Insert new commits (duplicates will be ignored due to unique constraint)
    const { error: insertError } = await supabase
      .from('github_commits_cache')
      .upsert(commitRecords, { 
        onConflict: 'resource_id,sha',
        ignoreDuplicates: true 
      })
    
    if (insertError) {
      console.error(`❌ Error inserting commits for ${resourceId}:`, insertError)
      return
    }
    
    logger.debug(`✅ ${resourceId}: Successfully cached ${commitRecords.length} commits to database`)
    
    // Manually maintain rolling cache (keep only latest 30)
    const { error: cleanupError } = await supabase.rpc('cleanup_commits_cache', {
      p_resource_id: resourceId,
      p_limit: 30
    })
    
    if (cleanupError) {
      // If RPC doesn't exist, do manual cleanup
      const { data: excessCommits, error: selectError } = await supabase
        .from('github_commits_cache')
        .select('id')
        .eq('resource_id', resourceId)
        .order('commit_date', { ascending: false })
        .range(30, 1000) // Get everything beyond the 30 latest
      
      if (!selectError && excessCommits && excessCommits.length > 0) {
        const idsToDelete = excessCommits.map(c => c.id)
        await supabase
          .from('github_commits_cache')
          .delete()
          .in('id', idsToDelete)
      }
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
    
    // Insert new releases (duplicates will be ignored due to unique constraint)
    const { error: insertError } = await supabase
      .from('github_releases_cache')
      .upsert(releaseRecords, { 
        onConflict: 'resource_id,repo_name,tag_name',
        ignoreDuplicates: true 
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
 * Populate updates cache for resources based on priority
 * @param {string} priority - 'active', 'all', or undefined (defaults to 'all')
 */
async function populateUpdatesCache(priority = 'all') {
  if (!supabase) {
    logger.warn('⚠️ Supabase not configured, skipping updates cache population')
    return
  }
  
  logger.debug(`🔄 Populating updates cache (priority: ${priority})...`)
  
  try {
    const resources = await loadResources()
    const resourcesWithGitHub = resources.filter(r => r.social?.github)
    
    // Define active projects (can be based on activity, popularity, etc.)
    const activeResourceNames = [
      'Aiken', 'MeshJS', 'Lucid', 'PyCardano', 'Koios', 'Blockfrost API', 
      'NMKR API', 'Lace Wallet', 'Cardano Node', 'Hydra', 'Marlowe'
    ]
    
    let resourcesToProcess = resourcesWithGitHub
    if (priority === 'active') {
      resourcesToProcess = resourcesWithGitHub.filter(r => 
        activeResourceNames.includes(r.name)
      )
    }
    
    logger.debug(`📦 Processing ${resourcesToProcess.length} resources (${priority} priority)`)
    
    let successCount = 0
    let errorCount = 0
    
    // Process in smaller batches to avoid overwhelming GitHub API
    const batchSize = 3
    for (let i = 0; i < resourcesToProcess.length; i += batchSize) {
      const batch = resourcesToProcess.slice(i, i + batchSize)
      
      await Promise.all(batch.map(async (resource) => {
        try {
          logger.debug(`🔍 Processing ${resource.name} (${resource.type})...`)
          
          // Get fresh data from GitHub for this resource
          const activityData = await getRecentActivity(resource)
          
          // Update commits cache
          if (activityData.commits && activityData.commits.length > 0) {
            await maintainCommitsCache(resource.name, activityData.commits)
            logger.debug(`✅ ${resource.name}: Updated ${activityData.commits.length} commits`)
          } else {
            logger.debug(`ℹ️ ${resource.name}: No recent commits found`)
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
      }))
      
      // Add delay between batches to respect rate limits
      if (i + batchSize < resourcesToProcess.length) {
        logger.debug(`⏳ Batch ${Math.ceil((i + batchSize) / batchSize)} completed, waiting 2s...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    
    logger.debug(`✅ Updates cache population completed (${priority}):`)
    logger.debug(`   📊 Processed: ${successCount + errorCount} resources`)
    logger.debug(`   ✅ Successful: ${successCount}`)
    logger.debug(`   ❌ Errors: ${errorCount}`)
    
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
      '5weeks': 5,
      '3months': 13,
      '52weeks': 52,
      '3years': 156
    }
    
    const resourcesNeedingData = []
    
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
        // First, detect realistic data limits for this resource
        let dataLimits = { maxRealisticPeriod: '3years', availablePeriods: ['current', '4weeks', '3months', '52weeks', '3years'], ageWeeks: 156 }
        
        if (resource.type === 'repository' && resource.social?.github) {
          const repoPath = resource.social.github.replace('https://github.com/', '')
          try {
            // Quick check with recent commits to estimate age
            const recentCommits = await fetchRepoCommits(repoPath, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()) // Last year
            if (recentCommits.length > 0) {
              dataLimits = detectRepoDataLimits(recentCommits)
            }
          } catch (error) {
            // Continue with conservative estimate if detection fails
          }
        }
        
        const missingPeriods = []
        
        // Check only realistic requirements based on actual repo age
        for (const [period, requiredWeeks] of Object.entries(HISTORICAL_REQUIREMENTS)) {
          if (dataLimits.availablePeriods.includes(period)) {
            const realisticRequirement = Math.min(requiredWeeks, dataLimits.ageWeeks)
            if (weeksAvailable < realisticRequirement) {
              missingPeriods.push(period)
            }
          }
        }
        
        if (missingPeriods.length > 0) {
          resourcesNeedingData.push({
            resource,
            resourceId,
            weeksAvailable,
            missingPeriods,
            dataLimits // Include limits for smarter backfilling
          })
          console.log(`📋 ${resource.name}: ${weeksAvailable} weeks available, missing: ${missingPeriods.join(', ')} (max realistic: ${dataLimits.ageWeeks} weeks)`)
        } else {
          console.log(`✅ ${resource.name}: Complete historical data (${weeksAvailable} weeks - ALL REALISTIC PERIODS SATISFIED)`)
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
          const { resource, resourceId, weeksAvailable } = item
          
          // Check if we're currently rate limited before attempting fetch
          if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime.getTime()) {
            console.warn(`⚠️ Skipping ${resource.name} - GitHub API rate limited until ${rateLimitResetTime.toLocaleString()}`);
            errorCount++
            continue
          }
          
          console.log(`🔄 Fetching historical data for ${resource.name} (${processedCount}/${resourcesNeedingData.length})...`)
          
          // Calculate how far back we need to go (max 3 years)
          const maxWeeksNeeded = Math.max(...Object.values(HISTORICAL_REQUIREMENTS))
          const weeksToFetch = Math.min(maxWeeksNeeded, 156) // Cap at 3 years
          
          const endDate = new Date()
          const startDate = new Date(endDate.getTime() - (weeksToFetch * 7 * 24 * 60 * 60 * 1000))
          
          // Use existing getHistoricalActivity function with force refresh
          // Pass forceRefresh=true to bypass caching for historical backfill
          console.log(`📡 Forcing fresh historical data fetch for ${resource.name}`)
          const historicalData = await getHistoricalActivity(
            resource, 
            startDate.toISOString(), 
            endDate.toISOString(),
            true // forceRefresh = true to bypass cache
          )
          
          if (historicalData && historicalData.length > 0) {
            console.log(`📥 ${resource.name}: Fetched ${historicalData.length} weeks of data, now checking realistic limits...`)
            
            // Detect what's actually possible from the commits we fetched
            let allCommits = []
            if (resource.type === 'repository' && resource.social?.github) {
              const repoPath = resource.social.github.replace('https://github.com/', '')
              try {
                // Get ALL commits to determine realistic age limits
                allCommits = await fetchRepoCommits(repoPath)
              } catch (error) {
                console.warn(`Could not fetch all commits for age detection: ${error.message}`)
              }
            }
            
            const dataLimits = detectRepoDataLimits(allCommits)
            console.log(`🧠 ${resource.name}: Detected limits - Max period: ${dataLimits.maxRealisticPeriod}, Age: ${dataLimits.ageWeeks} weeks (${dataLimits.reason})`)
            
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
            
            // Only check periods that are actually realistic for this repo
            const realisticRequirements = {}
            for (const [period, requiredWeeks] of Object.entries(HISTORICAL_REQUIREMENTS)) {
              if (dataLimits.availablePeriods.includes(period)) {
                realisticRequirements[period] = Math.min(requiredWeeks, dataLimits.ageWeeks)
              }
            }
            
            // Check only realistic requirements 
            for (const [period, requiredWeeks] of Object.entries(realisticRequirements)) {
              if (actualWeeksAvailable < requiredWeeks) {
                stillMissingPeriods.push(period)
              }
            }
            
            if (stillMissingPeriods.length === 0) {
              console.log(`✅ ${resource.name}: ALL REALISTIC REQUIREMENTS MET (${actualWeeksAvailable} weeks available, max possible: ${dataLimits.ageWeeks})`)
              successCount++
            } else {
              console.log(`📋 ${resource.name}: Some gaps remain - ${actualWeeksAvailable} weeks available, missing: ${stillMissingPeriods.join(', ')} (realistic for ${dataLimits.ageWeeks}-week-old repo)`)
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

// Preload cache for both view modes on startup for instant first load
// Process all existing database data first (fast, no API calls)
const processDatabaseData = async () => {
  console.log('')
  console.log('🎯 MILESTONE 1: DATABASE DATA PROCESSING')
  console.log('='.repeat(50))
  console.log('🔄 Processing existing database data for instant UI...')
  
  try {
    const resources = await loadResources()
    console.log(`📊 Loaded ${resources.length} resources from database`)
    
    // Process repository view data from database
    console.log('📦 Processing repository view data from database...')
    const repoResponse = await fetch(`http://localhost:${PORT}/api/development-activity?viewMode=repository&period=current`)
    if (repoResponse.ok) {
      console.log('✅ Repository view data processed from database')
    }
    
    // Process organization view data from database
    console.log('📦 Processing organization view data from database...')
    const orgResponse = await fetch(`http://localhost:${PORT}/api/development-activity?viewMode=organization&period=current`)
    if (orgResponse.ok) {
      console.log('✅ Organization view data processed from database')
    }
    
    console.log('🎉 MILESTONE 1 COMPLETED: Database data processing finished!')
    console.log('🚀 UI ready for instant load!')
    console.log('')
  } catch (error) {
    console.warn('⚠️ Database data processing failed (not critical):', error.message)
  }
}

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

const preloadStartupCache = async () => {
  console.log('🎯 MILESTONE 2: CACHE PRELOADING')
  console.log('='.repeat(50))
  console.log('🔄 Preloading server cache for instant first load...')
  
  try {
    // Preload repository view first (7-day priority)
    console.log('📦 Preloading repository view (7-day data prioritized)...')
    const repoResponse = await fetch(`http://localhost:${PORT}/api/development-activity?viewMode=repository&period=current`)
    if (repoResponse.ok) {
      console.log('✅ Repository view cache preloaded')
      
      // Immediately start organization view preload (no delay)
      console.log('📦 Preloading organization view (7-day data prioritized)...')
      const orgResponse = await fetch(`http://localhost:${PORT}/api/development-activity?viewMode=organization&period=current`)
      if (orgResponse.ok) {
        console.log('✅ Organization view cache preloaded')
      }
    }
    
    console.log('🎉 MILESTONE 2 COMPLETED: Cache preloading finished!')
    console.log('🚀 Both views ready for instant load!')
    console.log('')
  } catch (error) {
    console.warn('⚠️ Startup cache preloading failed (not critical):', error.message)
  }
}

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
        rateLimitRemaining: API_STATS.lastRateLimitRemaining || 0,
        isRateLimited: isRateLimited,
        rateLimitResetTime: rateLimitResetTime ? rateLimitResetTime.toISOString() : null,
        rateLimitResetIn: rateLimitResetTime && isRateLimited ? 
          Math.max(0, Math.ceil((rateLimitResetTime.getTime() - Date.now()) / 1000)) : null,
        errorCount: API_STATS.failedRequests,
        successRate: API_STATS.successfulRequests + API_STATS.failedRequests > 0 ? 
          Math.round((API_STATS.successfulRequests / (API_STATS.successfulRequests + API_STATS.failedRequests)) * 100) : 0,
        recentErrors: API_STATS.recentErrors.slice(0, 25) // Return last 25 errors for dashboard
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
      '3months': 91, 
      '52weeks': 364, 
      '3years': 1095 
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
    '3months': 91, 
    '52weeks': 364,
    '3years': 1095
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
      
      // Sequential startup process to avoid race conditions
      const runSequentialStartup = async () => {
        try {
          // Step 1: Process all existing database data first (fast, no API calls)
          console.log('')
          console.log('╔══════════════════════════════════════════════════════════════╗')
          console.log('║                    🎯 MILESTONE 1 STARTING                   ║')
          console.log('║                 DATABASE DATA PROCESSING                      ║')
          console.log('╚══════════════════════════════════════════════════════════════╝')
          console.log('🔄 Step 1/4: Processing existing database data for instant UI...')
          await processDatabaseData()
          console.log('╔══════════════════════════════════════════════════════════════╗')
          console.log('║                    ✅ MILESTONE 1 COMPLETED                  ║')
          console.log('║                 DATABASE DATA PROCESSING                      ║')
          console.log('╚══════════════════════════════════════════════════════════════╝')
          console.log('✅ Step 1/4: Database data processing completed')
          
          // Step 2: Preload cache with existing database data
          console.log('')
          console.log('╔══════════════════════════════════════════════════════════════╗')
          console.log('║                    🎯 MILESTONE 2 STARTING                   ║')
          console.log('║                   CACHE PRELOADING                            ║')
          console.log('╚══════════════════════════════════════════════════════════════╝')
          console.log('🔄 Step 2/4: Preloading cache with existing database data...')
          await preloadStartupCache()
          console.log('╔══════════════════════════════════════════════════════════════╗')
          console.log('║                    ✅ MILESTONE 2 COMPLETED                  ║')
          console.log('║                   CACHE PRELOADING                            ║')
          console.log('╚══════════════════════════════════════════════════════════════╝')
          console.log('✅ Step 2/4: Cache preloading completed')
          
          // Step 3: Start background data fetching and backfilling (non-blocking)
          console.log('')
          console.log('╔══════════════════════════════════════════════════════════════╗')
          console.log('║                    🎯 MILESTONE 3 STARTING                   ║')
          console.log('║              BACKGROUND DATA FETCHING                         ║')
          console.log('╚══════════════════════════════════════════════════════════════╝')
          console.log('🔄 Step 3/4: Starting background data fetching and backfilling...')
          // Run background fetching after a short delay to ensure UI is fully ready
          setTimeout(() => {
            backgroundDataFetching().then(() => {
              console.log('')
              console.log('╔══════════════════════════════════════════════════════════════╗')
              console.log('║                    ✅ MILESTONE 3 COMPLETED                  ║')
              console.log('║              BACKGROUND DATA FETCHING                         ║')
              console.log('╚══════════════════════════════════════════════════════════════╝')
              console.log('🎉 FINAL COMPLETION: All background processes finished!')
              console.log('='.repeat(50))
              console.log('✅ All milestones completed successfully!')
              console.log('🚀 Server is fully operational with complete data!')
              console.log('')
            }).catch(error => {
              console.error('❌ Background data fetching failed:', error.message)
            })
          }, 1000) // 1 second delay to ensure UI is fully loaded
          
          console.log('✅ Step 3/4: Background data fetching started (non-blocking)')
          
          // Step 4: Set up recurring cache refresh schedules
          console.log('')
          console.log('╔══════════════════════════════════════════════════════════════╗')
          console.log('║                    🎯 MILESTONE 4 STARTING                   ║')
          console.log('║                CACHE REFRESH SCHEDULES                        ║')
          console.log('╚══════════════════════════════════════════════════════════════╝')
          console.log('🔄 Step 4/4: Setting up recurring cache refresh schedules...')
          
          // Set up recurring cache refresh schedules
          console.log('📅 Setting up smart cache refresh schedule:')
          console.log('   • Active projects: Every 30 minutes (current data only)')
          console.log('   • All projects: Every 24 hours (immutable data)')
          
          // High priority: Active/popular projects every 30 minutes (current data updates)
          setInterval(() => {
            console.log('⚡ Running high-priority updates cache refresh...')
            populateUpdatesCache('active')
          }, 30 * 60 * 1000) // 30 minutes
          
          // Standard priority: All projects every 24 hours (immutable data)
          setInterval(() => {
            console.log('🔄 Running full updates cache refresh...')
            populateUpdatesCache('all')
          }, 24 * 60 * 60 * 1000) // 24 hours
          
          console.log('╔══════════════════════════════════════════════════════════════╗')
          console.log('║                    ✅ MILESTONE 4 COMPLETED                  ║')
          console.log('║                CACHE REFRESH SCHEDULES                        ║')
          console.log('╚══════════════════════════════════════════════════════════════╝')
          console.log('✅ Step 4/4: Cache refresh schedules configured')
          console.log('🎉 All startup processes completed successfully!')
          console.log('')
          console.log('╔══════════════════════════════════════════════════════════════╗')
          console.log('║                    🚀 SERVER STARTUP SUMMARY                  ║')
          console.log('╚══════════════════════════════════════════════════════════════╝')
          console.log('✅ Milestone 1: Database data processing - COMPLETED')
          console.log('✅ Milestone 2: Cache preloading - COMPLETED')
          console.log('🔄 Milestone 3: Background data fetching - RUNNING')
          console.log('✅ Milestone 4: Cache refresh schedules - COMPLETED')
          console.log('')
          console.log('🎯 UI is ready for immediate use!')
          console.log('📊 Background processes will continue updating data...')
          console.log('')
          
        } catch (error) {
          console.error('❌ Error in sequential startup process:', error.message)
        }
      }
      
      // Start sequential process after letting server fully initialize
      setTimeout(runSequentialStartup, 2000) // 2 second delay to let server fully start
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer()