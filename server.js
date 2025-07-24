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
const REQUEST_INTERVAL = 200 // ms between requests

// In-memory cache for performance
const CACHE = {
  data: new Map(),
  timestamps: new Map(),
  maxSize: 500,
  ttl: {
    recent: 5 * 60 * 1000, // 5 minutes for recent data
    weekly: 30 * 60 * 1000, // 30 minutes for weekly data
    historical: 24 * 60 * 60 * 1000 // 24 hours for historical data
  }
}

// Rate limiting
let requestCount = 0
let lastRequestTime = 0

const rateLimitedFetch = async (url, options = {}) => {
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  
  if (timeSinceLastRequest < REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL - timeSinceLastRequest))
  }
  
  lastRequestTime = Date.now()
  requestCount++
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'adaDEV-Platform',
      ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` }),
      ...options.headers
    },
    ...options
  })
  
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }
  
  return response
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
    
    for (const repo of repos.slice(0, 20)) { // Limit to 20 repos to avoid rate limits
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
  if (!supabase) return
  
  try {
    // Extract repo path from GitHub URL
    const repoPath = resource.social?.github?.replace('https://github.com/', '')
    if (!repoPath) {
      console.error(`No valid GitHub URL for ${resource.name}`)
      return
    }
    
    const { error } = await supabase
      .from('github_activity')
      .upsert(weeklyData.map(week => ({
        resource_id: repoPath, // Use repoPath as resource_id
        repo_path: repoPath,
        week_start: week.weekStart,
        commit_count: week.count,
        year: week.year,
        week_number: week.week,
        fetched_at: new Date().toISOString()
      })), { onConflict: 'resource_id,repo_path,week_start' })
    
    if (error) throw error
  } catch (error) {
    console.error('Error storing weekly activity:', error)
  }
}

const getWeeklyActivity = async (resource, startDate, endDate) => {
  if (!supabase) return []
  
  try {
    // Extract repo path from GitHub URL
    const repoPath = resource.social?.github?.replace('https://github.com/', '')
    if (!repoPath) {
      console.error(`No valid GitHub URL for ${resource.name}`)
      return []
    }
    
    const { data, error } = await supabase
      .from('github_activity')
      .select('*')
      .eq('repo_path', repoPath)
      .gte('week_start', startDate)
      .lte('week_start', endDate)
      .order('week_start')
    
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching weekly activity:', error)
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

const getRecentActivity = async (resource, useDailyProcessing = false) => {
  let commits = []
  let repoInfo = null
  
  try {
    // Determine the time window based on processing type
    const timeWindow = useDailyProcessing ? 7 : 30; // 7 days for daily, 30 days for weekly
    const since = new Date(Date.now() - timeWindow * 24 * 60 * 60 * 1000).toISOString();
    
    if (resource.type === 'organization') {
      // Use the organization field or extract from GitHub URL
      const orgName = resource.organization || resource.social.github.replace('https://github.com/', '')
      commits = await fetchOrgCommits(orgName, since)
    } else if (resource.type === 'repository' && resource.social?.github) {
      const repoPath = resource.social.github.replace('https://github.com/', '')
      commits = await fetchRepoCommits(repoPath, since) // Use time-based filtering
      
      // Also fetch repository info
      try {
        const url = `${GITHUB_API_BASE}/repos/${repoPath}`
        const response = await rateLimitedFetch(url)
        repoInfo = await response.json()
      } catch (error) {
        console.error(`Error fetching repo info for ${repoPath}:`, error.message)
      }
    } else {
      // Handle resources without proper GitHub URL
      console.warn(`Skipping ${resource.name} - no valid GitHub URL found`)
      return {
        commits: [],
        commitsPerWeek: 0,
        weeklyData: [],
        repoInfo: null
      }
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
    
    // Use daily processing for 7-day view, weekly processing for other views
    const processedData = useDailyProcessing 
      ? processCommitsToDaily(transformedCommits)
      : processCommitsToWeekly(transformedCommits)
    
    return {
      commits: transformedCommits.slice(0, 20), // Latest 20 commits
      commitsPerWeek: transformedCommits.length,
      weeklyData: processedData,
      repoInfo
    }
  } catch (error) {
    console.error(`Error in getRecentActivity for ${resource.name}:`, error.message)
    return {
      commits: [],
      commitsPerWeek: 0,
      weeklyData: [],
      repoInfo: null
    }
  }
}

const getHistoricalActivity = async (resource, startDate, endDate) => {
  // Organizations always use GitHub API since they aggregate multiple repos
  // Individual repositories can use database cache
  let dbData = []
  
  if (resource.type !== 'organization') {
    dbData = await getWeeklyActivity(resource, startDate, endDate)
  }
  
  if (dbData.length > 0) {
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
    
    return finalData
  }
  
  // Fallback to GitHub API
  const since = new Date(startDate).toISOString()
  let commits = []
  
  if (resource.type === 'organization') {
    // Use the organization field or extract from GitHub URL
    const orgName = resource.organization || resource.social.github.replace('https://github.com/', '')
    commits = await fetchOrgCommits(orgName, since)
  } else {
    const repoPath = resource.social.github.replace('https://github.com/', '')
    commits = await fetchRepoCommits(repoPath, since)
  }
  
  const weeklyData = processCommitsToWeekly(commits)
  
  // Store in database for future use (only for individual repositories)
  if (resource.type !== 'organization') {
    await storeWeeklyActivity(resource, weeklyData)
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
    const resource = req.body
    if (!resource?.name || !resource?.social?.github) {
      return res.status(400).json({ error: 'Invalid resource data' })
    }
    
    const data = await getRecentActivity(resource)
    let releases = []
    
    try {
      if (resource.type === 'repository') {
        releases = await fetchRepoReleases(resource.social.github.replace('https://github.com/', ''), 10)
      }
    } catch (error) {
      console.error(`Error fetching releases for ${resource.name}:`, error.message)
      releases = []
    }
    
    res.json({
      resource: resource.name,
      commits: data.commits || [],
      releases: releases.slice(0, 10), // Exactly 10 releases
      commitsPerWeek: data.commitsPerWeek || 0,
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

// Get development activity for dashboard
app.get('/api/development-activity', async (req, res) => {
  try {
    const { viewMode = 'repository', period = 'current' } = req.query;
    const resources = await loadResources();
    console.log(`Processing ${resources.length} total resources for ${viewMode} view, ${period} period...`);
    
    // Determine date range based on period
    const getDateRange = (period) => {
      const now = new Date();
      switch (period) {
        case 'current':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return { since: weekAgo.toISOString(), days: 7 };
        case 'monthly':
          const monthAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
          return { since: monthAgo.toISOString(), days: 28 };
        case '3months':
          const threeMonthsAgo = new Date(now.getTime() - 13 * 7 * 24 * 60 * 60 * 1000);
          return { since: threeMonthsAgo.toISOString(), days: 91 };
        case '52weeks':
          const yearAgo = new Date(now.getTime() - 52 * 7 * 24 * 60 * 60 * 1000);
          return { since: yearAgo.toISOString(), days: 364 };
        case '3years':
          const threeYearsAgo = new Date(now.getTime() - 156 * 7 * 24 * 60 * 60 * 1000);
          return { since: threeYearsAgo.toISOString(), days: 1092 };
        default:
          const defaultWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return { since: defaultWeekAgo.toISOString(), days: 7 };
      }
    };

    const { since, days } = getDateRange(period);
    
    const activityPromises = resources.map(async (resource) => {
      try {
        // Use the type field from the resource data to determine if it's an organization or repository
        const isOrganization = resource.type === 'organization';
        const isRepository = resource.type === 'repository';
        
        // For organization view, only process organizations
        if (viewMode === 'organization' && !isOrganization) {
          return null;
        }
        
        // For repository view, only process repositories
        if (viewMode === 'repository' && !isRepository) {
          return null;
        }
        
        let activityData;
        
        if (period === 'current') {
          // For 7-day period, use getRecentActivity to get recent commits and process them into daily data
          const recentData = await getRecentActivity(resource, true); // Use daily processing
          activityData = recentData.weeklyData; // This contains daily data processed from recent commits
        } else {
          // For other periods, use getHistoricalActivity to get weekly data
          if (isOrganization && resource.social?.github) {
            activityData = await getHistoricalActivity(resource, since, new Date().toISOString());
          } else if (isRepository && resource.social?.github) {
            activityData = await getHistoricalActivity(resource, since, new Date().toISOString());
          } else {
            console.warn(`Skipping ${resource.name} - no valid GitHub URL or type`);
            return null;
          }
        }
        
        // Calculate total commits for the period
        const totalCommits = activityData.reduce((sum, week) => sum + week.count, 0);
        
        return {
          resource,
          data: {
            commitsPerWeek: totalCommits,
            weeklyData: activityData
          },
          releases: [],
          commits: []
        };
      } catch (error) {
        console.error(`Error fetching data for ${resource.name}:`, error);
        return {
          resource,
          data: { commitsPerWeek: 0, weeklyData: [] },
          releases: [],
          commits: []
        };
      }
    });

    const results = await Promise.allSettled(activityPromises);
    const successfulResults = results
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value)
      .filter(item => item.data.commitsPerWeek > 0)
      .sort((a, b) => b.data.commitsPerWeek - a.data.commitsPerWeek);

    console.log(`Successfully processed ${successfulResults.length} ${viewMode}s with activity for ${period} period`);

    // Calculate metrics based on the selected period
    const totalActiveRepos = successfulResults.length;
    const totalCommits = successfulResults.reduce((sum, item) => sum + item.data.commitsPerWeek, 0);
    const avgCommitsPerRepo = totalActiveRepos > 0 ? Math.round(totalCommits / totalActiveRepos) : 0;

    const response = {
      dailyLeaderboard: successfulResults.map(item => ({
        resource: item.resource,
        totalCommits: item.data.commitsPerWeek
      })),
      weeklyLeaderboard: successfulResults.map(item => ({
        resource: item.resource,
        totalCommits: item.data.commitsPerWeek
      })),
      dailyChartData: successfulResults.map(item => {
        // For daily chart data, always use consistent structure
        const chartData = item.data.weeklyData || [];
        return {
          resource: item.resource,
          dailyCounts: chartData.map(d => d.count),
          weeklyData: chartData // Include full data for consistency
        };
      }),
      weeklyChartData: successfulResults.map(item => {
        // For weekly chart data, always use consistent structure
        const chartData = item.data.weeklyData || [];
        return {
          resource: item.resource,
          weeklyCounts: chartData.map(w => w.count),
          weeklyData: chartData // Include full data for consistency
        };
      }),
      // Add detailed data for GitHub Updates widget
      githubUpdates: successfulResults.map(item => ({
        resource: item.resource,
        commits: item.commits || [],
        releases: item.releases || [],
        commitsPerWeek: item.data.commitsPerWeek || 0,
        weeklyData: item.data.weeklyData || [],
        repoInfo: item.data.repoInfo
      })),
      metrics: {
        daily: {
          totalActiveRepos,
          avgCommitsPerRepo,
          totalCommits
        },
        weekly: {
          totalActiveRepos,
          avgCommitsPerRepo,
          totalCommits
        }
      },
      // Add period information for debugging
      period,
      viewMode,
      dateRange: { since, days }
    };

    res.json(response);
  } catch (error) {
    console.error('API error (development-activity):', error);
    res.status(500).json({ error: 'Failed to fetch development activity' });
  }
});

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

// Initialize and start server
const startServer = async () => {
  try {
    await createTables()
    
    app.listen(PORT, () => {
      console.log(`🚀 Server listening on port ${PORT}`)
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`)
      console.log(`🔐 GitHub Token: ${GITHUB_TOKEN ? '✅ Available' : '❌ Not configured'}`)
      console.log(`💾 Supabase: ${supabase ? '✅ Connected' : '❌ Not configured'}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer()