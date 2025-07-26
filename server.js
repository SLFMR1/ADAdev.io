require('dotenv').config()

const express = require('express')
const path = require('path')
const cors = require('cors')
const compression = require('compression')
const OpenAI = require('openai')
const { createClient } = require('@supabase/supabase-js')

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

// In-memory cache for performance - optimized for GitHub activity patterns
const CACHE = {
  data: new Map(),
  timestamps: new Map(),
  maxSize: 1000, // Increased cache size
  ttl: {
    recent: 2 * 60 * 60 * 1000, // 2 hours for recent data (commits don't change frequently)
    weekly: 4 * 60 * 60 * 1000, // 4 hours for weekly data
    historical: 12 * 60 * 60 * 1000 // 12 hours for historical data
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
      
      console.warn(`⚠️ GitHub rate limit exceeded. Reset at: ${resetDate.toLocaleString()}`)
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(waitTime / 60000)} minutes.`)
    }
    
    // Check if we were rate limited but it's now reset
    if (isRateLimited && rateLimitResetTime && Date.now() > rateLimitResetTime.getTime()) {
      isRateLimited = false
      rateLimitResetTime = null
      console.log('✅ GitHub rate limit has reset')
    }
    
    if (!response.ok) {
      consecutiveFailures++
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    
    // Reset consecutive failures on success
    consecutiveFailures = 0
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
  const timestamp = CACHE.timestamps.get(key)
  if (!timestamp) return null
  
  const now = Date.now()
  const data = CACHE.data.get(key)
  
  // Determine TTL based on data type
  let ttl = CACHE.ttl.recent
  if (key.includes('weekly')) ttl = CACHE.ttl.weekly
  if (key.includes('historical')) ttl = CACHE.ttl.historical
  
  if (now - timestamp > ttl) {
    CACHE.data.delete(key)
    CACHE.timestamps.delete(key)
    return null
  }
  
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

// GitHub API functions
const fetchRepoCommits = async (repoPath, since = null) => {
  const cacheKey = generateCacheKey('commits', repoPath, { since })
  const cached = getCachedData(cacheKey)
  if (cached) return cached
  
  try {
    let url = `${GITHUB_API_BASE}/repos/${repoPath}/commits?per_page=100`
    if (since) {
      url += `&since=${since}`
    }
    
    const response = await rateLimitedFetch(url)
    const commits = await response.json()
    
    // Validate that commits is an array
    if (!Array.isArray(commits)) {
      console.warn(`Invalid commits response for ${repoPath}:`, typeof commits)
      return []
    }
    
    setCachedData(cacheKey, commits)
    return commits
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
    const url = `${GITHUB_API_BASE}/orgs/${orgName}/repos?type=public&per_page=100`
    const response = await rateLimitedFetch(url)
    const repos = await response.json()
    
    setCachedData(cacheKey, repos)
    return repos
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
    
    for (const repo of repos.slice(0, 10)) { // Limit to 10 repos to avoid rate limits
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
    // Weekly activity table
    await supabase.rpc('create_weekly_activity_table')
    
    // Organization activity table
    await supabase.rpc('create_org_activity_table')
    
    console.log('✅ Database tables created/verified')
  } catch (error) {
    console.log('⚠️ Database tables may already exist:', error.message)
  }
}

const storeWeeklyActivity = async (resource, weeklyData) => {
  if (!supabase || !weeklyData || weeklyData.length === 0) return
  
  try {
    // Use resource ID or extract from GitHub URL for both repos and orgs
    const resourceIdentifier = resource.id || 
      resource.social?.github?.replace('https://github.com/', '') ||
      resource.name?.toLowerCase().replace(/\s+/g, '-')
    
    if (!resourceIdentifier) {
      console.error(`No valid identifier for ${resource.name}`)
      return
    }
    
    const now = new Date().toISOString()
    const dataToInsert = weeklyData
      .filter(week => week && typeof week.count === 'number' && week.weekStart)
      .map(week => ({
        resource_id: resourceIdentifier,
        repo_path: resource.social?.github?.replace('https://github.com/', '') || resourceIdentifier,
        week_start: week.weekStart,
        commit_count: week.count,
        year: week.year || new Date(week.weekStart).getFullYear(),
        week_number: week.week || Math.ceil((new Date(week.weekStart).getDate() + new Date(week.weekStart).getDay()) / 7),
        fetched_at: now
      }))
    
    if (dataToInsert.length === 0) {
      console.warn(`No valid data to store for ${resource.name}`)
      return
    }
    
    const { error } = await supabase
      .from('github_activity')
      .upsert(dataToInsert, { 
        onConflict: 'resource_id,repo_path,week_start',
        ignoreDuplicates: false 
      })
    
    if (error) throw error
    console.log(`💾 Stored ${dataToInsert.length} weeks of data for ${resource.name}`)
  } catch (error) {
    console.error(`Error storing weekly activity for ${resource.name}:`, error)
  }
}

const getWeeklyActivity = async (resource, startDate, endDate) => {
  if (!supabase) return []
  
  try {
    // Use resource ID first, fallback to extracted path
    const resourceIdentifier = resource.id || 
      resource.social?.github?.replace('https://github.com/', '') ||
      resource.name?.toLowerCase().replace(/\s+/g, '-')
    
    if (!resourceIdentifier) {
      console.error(`No valid identifier for ${resource.name}`)
      return []
    }
    
    const { data, error } = await supabase
      .from('github_activity')
      .select('*')
      .eq('resource_id', resourceIdentifier)
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
  
  commits.forEach((commit, index) => {
    const commitDate = commit.commit?.author?.date || commit.date
    if (!commitDate) {
      return
    }
    
    const date = new Date(commitDate)
    if (isNaN(date.getTime())) {
      return
    }
    
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - date.getDay())
    weekStart.setHours(0, 0, 0, 0)
    
    const weekKey = weekStart.toISOString().slice(0, 10)
    weeklyData.set(weekKey, (weeklyData.get(weekKey) || 0) + 1)
  })
  
  return Array.from(weeklyData.entries()).map(([weekStart, count]) => {
    // Ensure weekStart is a valid date string
    const weekStartDate = new Date(weekStart)
    if (isNaN(weekStartDate.getTime())) {
      console.warn(`Invalid weekStart date: ${weekStart}`)
      return null
    }
    
    return {
      weekStart: weekStart,
      count: count,
      year: weekStartDate.getFullYear(),
      week: Math.ceil((weekStartDate.getDate() + weekStartDate.getDay()) / 7)
    }
  }).filter(Boolean) // Remove null entries
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
  // Check in-memory cache first - include period in cache key to avoid returning same data for different periods
  const cacheKey = generateCacheKey('recent_activity', resource.id || resource.name, { useDailyProcessing, period })
  const cachedResult = getCachedData(cacheKey)
  if (cachedResult) {
    console.log(`✅ Using cached recent activity for ${resource.name}`);
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
    
    console.log(`⏰ ${resource.name}: Fetching commits since ${since} (${timeWindow} days, period: ${period}, daily: ${useDailyProcessing})`);
    
    // Check if we're currently rate limited
    if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime.getTime()) {
      console.warn(`⚠️ Skipping ${resource.name} - GitHub API rate limited until ${rateLimitResetTime.toLocaleString()}`);
      const emptyResult = {
        commits: [],
        commitsPerWeek: 0,
        weeklyData: [],
        repoInfo: null
      }
      setCachedData(cacheKey, emptyResult)
      return emptyResult
    }
    
    console.log(`🔄 Fetching recent activity for ${resource.name} (${timeWindow} days, period: ${period})...`);
    
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
    } else if (resource.type === 'repository' && resource.social?.github) {
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
      console.warn(`Skipping ${resource.name} - no valid GitHub URL found`)
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
    
    // Transform commits to match frontend expectations
    const transformedCommits = commits.map(commit => ({
      sha: commit.sha,
      message: commit.commit?.message || commit.message || '',
      date: commit.commit?.author?.date || commit.date || new Date().toISOString(),
      htmlUrl: commit.html_url || commit.htmlUrl || '',
      author: commit.commit?.author?.name || commit.author?.name || 'Unknown',
      repo: resource.name
    }))
    
    console.log(`📈 ${resource.name}: Found ${commits.length} raw commits, transformed to ${transformedCommits.length}`);
    
    // Use daily processing for 7-day view, weekly processing for other views
    const processedData = useDailyProcessing 
      ? processCommitsToDaily(transformedCommits)
      : processCommitsToWeekly(transformedCommits)
    
    console.log(`📅 ${resource.name}: Processed ${processedData.length} data points (daily: ${useDailyProcessing})`);
    
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

const getHistoricalActivity = async (resource, startDate, endDate) => {
  // Check database cache first for ALL resources (both repos and orgs)
  let dbData = []
  
  try {
    dbData = await getWeeklyActivity(resource, startDate, endDate)
  } catch (error) {
    console.warn(`Database query failed for ${resource.name}:`, error.message)
  }
  
  if (dbData.length > 0) {
    console.log(`✅ Using cached database data for ${resource.name} (${dbData.length} weeks)`);
    
    const mappedData = dbData.map(row => ({
      weekStart: row.week_start,
      count: row.commit_count,
      year: row.year,
      week: row.week_number
    }))
    
    // Aggregate duplicate weeks by summing commit counts
    const aggregatedWeeks = new Map()
    
    mappedData.forEach(week => {
      const key = week.weekStart
      if (aggregatedWeeks.has(key)) {
        // Sum the commit counts for duplicate weeks
        const existing = aggregatedWeeks.get(key)
        existing.count += week.count
      } else {
        aggregatedWeeks.set(key, { ...week })
      }
    })
    
    const finalData = Array.from(aggregatedWeeks.values()).sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart))
    
    // Smart period-aware staleness checking
    const now = Date.now()
    const endDateTime = new Date(endDate).getTime()
    const startDateTime = new Date(startDate).getTime()
    
    // Calculate how old the OLDEST data in this query is (not the end date)
    const oldestDataAgeInDays = Math.floor((now - startDateTime) / (24 * 60 * 60 * 1000))
    
    // Historical queries (data older than 14 days) are immutable - never refresh
    if (oldestDataAgeInDays > 14) {
      console.log(`✅ Using historical database data for ${resource.name} (oldest data: ${oldestDataAgeInDays} days old - immutable)`);
      return finalData
    }
    
    // For recent data, check fetch timestamp
    const latestEntry = dbData[dbData.length - 1]
    if (latestEntry && latestEntry.fetched_at) {
      const fetchTime = new Date(latestEntry.fetched_at)
      const fetchAgeHours = Math.floor((now - fetchTime.getTime()) / (60 * 60 * 1000))
      
      // Recent data staleness thresholds based on oldest data age
      let maxAgeHours
      if (oldestDataAgeInDays <= 1) {
        maxAgeHours = 2 // Current day: refresh every 2 hours
      } else if (oldestDataAgeInDays <= 7) {
        maxAgeHours = 6 // Last week: refresh every 6 hours  
      } else {
        maxAgeHours = 12 // 1-2 weeks old: refresh every 12 hours
      }
      
      if (fetchAgeHours < maxAgeHours) {
        console.log(`✅ Using recent database data for ${resource.name} (${fetchAgeHours}h old, threshold: ${maxAgeHours}h)`);
        return finalData
      }
      
      console.log(`⚡ Refreshing recent data for ${resource.name} (${fetchAgeHours}h old, oldest data: ${oldestDataAgeInDays} days)`)
    } else {
      // No fetch timestamp - use data but try to refresh
      console.log(`⚡ Using database data for ${resource.name} (no timestamp - will attempt refresh)`)
    }
  }
  
  // Check in-memory cache before hitting GitHub API
  const cacheKey = generateCacheKey('historical_activity', resource.id || resource.name, { startDate, endDate })
  const cachedResult = getCachedData(cacheKey)
  if (cachedResult) {
    console.log(`✅ Using in-memory cache for ${resource.name}`);
    return cachedResult
  }
  
  // Check if we're currently rate limited
  if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime.getTime()) {
    console.warn(`⚠️ GitHub API rate limited until ${rateLimitResetTime.toLocaleString()}`);
    
    // Return database data if available, rather than empty results
    if (dbData.length > 0) {
      console.log(`📊 Using existing database data for ${resource.name} (rate limited fallback)`);
      return finalData
    }
    
    console.warn(`⚠️ No database data available for ${resource.name} - returning empty results`);
    return []
  }
  
  console.log(`🔄 Fetching fresh data from GitHub API for ${resource.name}...`);
  
  // Fallback to GitHub API
  const since = new Date(startDate).toISOString()
  let commits = []
  
  try {
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
        return [];
      }
      
      commits = await fetchOrgCommits(orgName, since);
    } else {
      const repoPath = resource.social.github.replace('https://github.com/', '')
      commits = await fetchRepoCommits(repoPath, since)
    }
  } catch (error) {
    console.error(`Failed to fetch commits for ${resource.name}:`, error.message)
    // Return empty data on API failure
    return []
  }
  
  const weeklyData = processCommitsToWeekly(commits)
  
  // Store in both in-memory cache and database for future use
  setCachedData(cacheKey, weeklyData)
  
  // Store in database for both repositories and organizations
  try {
    await storeWeeklyActivity(resource, weeklyData)
  } catch (error) {
    console.warn(`Failed to store activity data for ${resource.name}:`, error.message)
  }
  
  return weeklyData
}

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
      // Use existing type field if available, otherwise determine from GitHub URL
      let type = resource.type || 'unknown'
      
      if (type === 'unknown' && resource.social?.github) {
        const githubUrl = resource.social.github
        if (githubUrl.includes('/') && !githubUrl.endsWith('/')) {
          type = 'repository'
        } else {
          type = 'organization'
        }
      } else if (type === 'unknown' && resource.organization && resource.repository) {
        type = 'repository'
      } else if (type === 'unknown' && resource.organization && !resource.repository) {
        type = 'organization'
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
app.use(express.static(path.join(__dirname, 'dist')))

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
    
    console.log(`🔍 GitHub updates request for ${resource.name} (period: ${period})`)
    
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
    
    // If we have detailed data, use it; otherwise fall back to the regular method
    let data
    let releases = []
    if (detailedData) {
      data = detailedData
      releases = detailedData.releases
    } else {
      console.log(`🔄 Using fallback data fetch for ${resource.name}`)
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
    
    console.log(`🌍 Global GitHub request for ${resources.length} resources`)
    
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
              releases = await fetchRepoReleases(resource.social.github.replace('https://github.com/', ''), 5)
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
    
    console.log(`✅ Global GitHub request completed: ${results.length}/${resources.length} successful`)
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
    
    console.log(`🔍 Recent GitHub data request for ${name} (type: ${type || 'repository'})`)
    
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
          const releasePromises = repos.slice(0, 10).map(async repo => {
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
    
    console.log(`✅ Recent data for ${name}: ${result.commits.length} commits, ${result.releases.length} releases`)
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
const VIEW_MODE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (GitHub data doesn't change frequently)

// Get development activity for dashboard - preload all periods
app.get('/api/development-activity', async (req, res) => {
  try {
    const { viewMode = 'repository', period = 'current' } = req.query;
    
    // Check server-side cache first
    const cacheKey = `${viewMode}-activity`;
    const cached = VIEW_MODE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < VIEW_MODE_CACHE_TTL)) {
      console.log(`⚡ Using server cache for ${viewMode} view (${Math.round((Date.now() - cached.timestamp) / 1000)}s old)`);
      return res.json(cached.data);
    }
    
    const resources = await loadResources();
    console.log(`🔄 Processing ${resources.length} total resources for ${viewMode} view, preloading all periods...`);
    
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
    
    console.log(`🚀 Preloading ALL periods for ${filteredResources.length} filtered resources (was ${resources.length})`);
    
    // Process resources in smaller batches to avoid overwhelming the API
    const BATCH_SIZE = 5;
    const allPeriodsData = new Map(); // Store data for all periods
    
    // Preload data for ALL periods at once
    for (let i = 0; i < filteredResources.length; i += BATCH_SIZE) {
      const batch = filteredResources.slice(i, i + BATCH_SIZE);
      console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(filteredResources.length / BATCH_SIZE)} (${batch.length} resources)`);
      
      const batchPromises = batch.map(async (resource) => {
        try {
          const resourceData = {
            resource,
            periods: {}
          };
          
          // Fetch data with priority: 7-day first, then other periods
          const prioritizedPeriods = [
            ['current', periods.current], // 7-day first (highest priority)
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
          console.log(`📊 ${resource.name}: ${summaryLog}`);
          
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
      console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} completed: ${batchResults.length} resources with all periods`);
      
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
    
    console.log(`🔍 Extracted ${periodData.length} resources for ${period} period`);
    
    const successfulResults = periodData
      .filter(item => item.data.commitsPerWeek > 0)
      .sort((a, b) => b.data.commitsPerWeek - a.data.commitsPerWeek);

    console.log(`Successfully processed ${successfulResults.length} ${viewMode}s with activity for ${period} period`);

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
    
    // Clean up old cache entries (keep only 4 entries max)
    if (VIEW_MODE_CACHE.size > 4) {
      const oldestKey = VIEW_MODE_CACHE.keys().next().value;
      VIEW_MODE_CACHE.delete(oldestKey);
    }

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

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Preload cache for both view modes on startup for instant first load
const preloadStartupCache = async () => {
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
    
    console.log('🚀 Startup cache preloading completed - both views ready for instant load!')
  } catch (error) {
    console.warn('⚠️ Startup cache preloading failed (not critical):', error.message)
  }
}

// Initialize and start server
const startServer = async () => {
  try {
    await createTables()
    
    app.listen(PORT, async () => {
      console.log(`🚀 Server listening on port ${PORT}`)
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`)
      console.log(`🔐 GitHub Token: ${GITHUB_TOKEN ? '✅ Available' : '❌ Not configured'}`)
      console.log(`💾 Supabase: ${supabase ? '✅ Connected' : '❌ Not configured'}`)
      
      // Preload cache after server starts (in background)
      setTimeout(preloadStartupCache, 2000) // 2 second delay to let server fully start
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer()