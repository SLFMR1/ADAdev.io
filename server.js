require('dotenv').config()

const express = require('express')
const path = require('path')
const cors = require('cors')
const OpenAI = require('openai')
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')

const app = express()
const PORT = process.env.PORT || 3000

// Initialize OpenAI client (server-side only)
const openai = new OpenAI({
  apiKey: process.env.VITE_OPENAI_API_KEY,
})

// Initialize Supabase client (server-side)
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

if (supabase) {
  console.log('✅ Supabase client initialized')
} else {
  console.log('❌ Supabase not configured - activity data will not be persisted')
}

// Security: Configure CORS with specific origins
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://adadev.io', 'https://www.adadev.io'] // Production domain
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200
}
app.use(cors(corsOptions))

// Security: Add basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// Add JSON body parsing middleware with size limit
app.use(express.json({ limit: '1mb' }))

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')))

// Persistent cache storage
const CACHE_DIR = path.join(__dirname, '.cache')
const CACHE_FILE = path.join(CACHE_DIR, 'github-cache.json')
const CACHE_TIMESTAMPS_FILE = path.join(CACHE_DIR, 'github-cache-timestamps.json')

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

// Load cache from disk
const loadCacheFromDisk = () => {
  try {
    if (fs.existsSync(CACHE_FILE) && fs.existsSync(CACHE_TIMESTAMPS_FILE)) {
      const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
      const timestampsData = JSON.parse(fs.readFileSync(CACHE_TIMESTAMPS_FILE, 'utf8'))
      
      GITHUB_CACHE.data = new Map(Object.entries(cacheData))
      GITHUB_CACHE.timestamps = new Map(Object.entries(timestampsData))
      
      console.log(`📂 Loaded ${GITHUB_CACHE.data.size} cache entries from disk`)
    }
  } catch (error) {
    console.log('📂 No existing cache found, starting fresh')
  }
}

// Save cache to disk
const saveCacheToDisk = () => {
  try {
    const cacheData = Object.fromEntries(GITHUB_CACHE.data)
    const timestampsData = Object.fromEntries(GITHUB_CACHE.timestamps)
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2))
    fs.writeFileSync(CACHE_TIMESTAMPS_FILE, JSON.stringify(timestampsData, null, 2))
    
    console.log(`💾 Saved ${GITHUB_CACHE.data.size} cache entries to disk`)
  } catch (error) {
    console.error('❌ Failed to save cache to disk:', error)
  }
}

// Initialize cache with persistent storage
const GITHUB_CACHE = {
  data: new Map(),
  timestamps: new Map(),
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours
  lastCleanup: Date.now(),
  lastSave: Date.now()
}

// Load existing cache on startup
loadCacheFromDisk()

// Cache cleanup function
const cleanupExpiredCache = () => {
  const now = Date.now()
  const expiredKeys = []
  
  for (const [key, timestamp] of GITHUB_CACHE.timestamps.entries()) {
    if (now - timestamp > GITHUB_CACHE.CACHE_DURATION) {
      expiredKeys.push(key)
    }
  }
  
  expiredKeys.forEach(key => {
    GITHUB_CACHE.data.delete(key)
    GITHUB_CACHE.timestamps.delete(key)
  })
  
  if (expiredKeys.length > 0) {
    console.log(`🧹 Cleaned up ${expiredKeys.length} expired cache entries`)
    saveCacheToDisk() // Save after cleanup
  }
  
  GITHUB_CACHE.lastCleanup = now
}

// Clean up expired cache every hour
setInterval(cleanupExpiredCache, 60 * 60 * 1000)

// GitHub API utilities
const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null // Use token if available

// Log token status (without exposing sensitive information)
console.log(`🔐 GitHub Token Status: ${GITHUB_TOKEN ? '✅ Token available' : '❌ No token found'}`)

// Check current rate limit status
const checkRateLimitStatus = async () => {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/rate_limit`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'adaDEV-Platform',
        ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
      }
    })
    
    if (response.ok) {
      const data = await response.json()
      const core = data.resources.core
      console.log(`📊 Rate limit status: ${core.remaining}/${core.limit} requests remaining, resets at ${new Date(core.reset * 1000).toISOString()}`)
      return core
    }
  } catch (error) {
    console.error('❌ Failed to check rate limit status:', error.message)
  }
  return null
}

// Rate limiting for server-side requests
let requestCount = 0
const MAX_REQUESTS_PER_HOUR = 5000 // GitHub allows 5000/hour for authenticated requests
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 200 // 200ms between requests to stay well under limits

const rateLimitedFetch = async (url, options = {}) => {
  const now = Date.now()
  
  // Rate limiting
  const timeSinceLastRequest = now - lastRequestTime
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
  
  requestCount++
  lastRequestTime = Date.now()
  
  console.log(`📡 Server making GitHub API request (${requestCount}/${MAX_REQUESTS_PER_HOUR}): ${url}`)
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'adaDEV-Platform',
        ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` }),
        ...options.headers
      }
    })
    
    // Check rate limit headers
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = response.headers.get('x-ratelimit-reset')
    
    if (remaining !== null) {
      console.log(`📊 Rate limit: ${remaining} requests remaining, resets at ${new Date(reset * 1000).toISOString()}`)
    }
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      console.error(`❌ Rate limit exceeded for ${url}. Retry after: ${retryAfter}s`)
      throw new Error(`GitHub API rate limit exceeded. Retry after ${retryAfter || 60} seconds`)
    }
    
    if (!response.ok) {
      console.error(`❌ GitHub API error ${response.status} for ${url}`)
      throw new Error(`GitHub API error: ${response.status}`)
    }
    
    return response
  } catch (error) {
    console.error(`❌ GitHub API request failed: ${error.message}`)
    throw error
  }
}

// Extract repo path from GitHub URL
const extractRepoPath = (githubUrl) => {
  if (!githubUrl) return null
  
  // Handle organization URLs (e.g., https://github.com/masumi-network)
  const orgMatch = githubUrl.match(/github\.com\/([^\/]+)$/)
  if (orgMatch) {
    return orgMatch[1]
  }
  
  // Handle repository URLs (e.g., https://github.com/owner/repo)
  const repoMatch = githubUrl.match(/github\.com\/([^\/]+\/[^\/]+)/)
  return repoMatch ? repoMatch[1] : null
}

// Supabase activity storage functions
const storeActivityData = async (resource, weeklyData) => {
  console.log(`🔍 storeActivityData called for ${resource.name} with ${weeklyData.length} records`)
  if (!supabase) {
    console.log('❌ Supabase not available, skipping activity storage')
    return { error: 'Supabase not configured' }
  }

  try {
          const resourceId = String(resource.id || resource.name)
    const repoPath = extractRepoPath(resource.social?.github)
    
    if (!repoPath) {
      console.log(`❌ Invalid GitHub URL for ${resource.name}`)
      return { error: 'Invalid GitHub URL' }
    }

    // Helper function to get ISO week number
    const getISOWeekNumber = (date) => {
      const d = new Date(date)
      d.setHours(0, 0, 0, 0)
      // Thursday in current week decides the year
      d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
      // January 4 is always in week 1
      const week1 = new Date(d.getFullYear(), 0, 4)
      // Adjust to Thursday in week 1 and count number of weeks from date to week1
      return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7)
    }

    // Helper function to get week start date (Monday)
    const getWeekStart = (date) => {
      const d = new Date(date)
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
      const monday = new Date(d.setDate(diff))
      return monday.toISOString().split('T')[0]
    }

    // STRICT VALIDATION: Ensure we only store real GitHub data
    const validateWeeklyData = (week) => {
      if (!week || !week.weekStart || typeof week.count !== 'number') {
        console.warn(`⚠️ Invalid week data:`, week)
        return false
      }
      
      // Ensure commit count is a real integer from GitHub
      if (!Number.isInteger(week.count) || week.count < 0) {
        console.warn(`⚠️ Invalid commit count: ${week.count}`, week)
        return false
      }
      
      // Validate date format
      const date = new Date(week.weekStart)
      if (isNaN(date.getTime())) {
        console.warn(`⚠️ Invalid date: ${week.weekStart}`, week)
        return false
      }
      
      return true
    }
    
    // Validate and prepare data for insertion
    const activityRecords = weeklyData
      .filter(validateWeeklyData)
      .map(week => {
        const weekStartDate = new Date(week.weekStart)
        
        return {
          resource_id: resourceId,
          repo_path: repoPath,
          week_start: getWeekStart(weekStartDate),
          year: weekStartDate.getFullYear(),
          week_number: getISOWeekNumber(weekStartDate),
          commit_count: week.count,
          fetched_at: new Date().toISOString()
        }
      })

    if (activityRecords.length === 0) {
      console.log(`⚠️ No valid weekly data to store for ${resource.name}`)
      console.log(`🔍 Original data sample:`, weeklyData.slice(0, 3))
      return { success: true, count: 0 }
    }

    console.log(`💾 Storing ${activityRecords.length} weekly records for ${resource.name}`)
    console.log(`📋 Sample record:`, activityRecords[0])
    console.log(`📊 Data summary: ${activityRecords.filter(r => r.commit_count > 0).length} weeks with commits`)
    console.log(`📅 Date range: ${activityRecords[0]?.week_start} to ${activityRecords[activityRecords.length - 1]?.week_start}`)
    // Detailed logging of actual records
    console.log('🟢 About to upsert to Supabase (first 5):', JSON.stringify(activityRecords.slice(0, 5), null, 2))
    if (activityRecords.length > 10) {
      console.log('🟢 About to upsert to Supabase (last 5):', JSON.stringify(activityRecords.slice(-5), null, 2))
    }

    // Check if records already exist for this resource
    const { data: existingRecords, error: checkError } = await supabase
      .from('github_activity')
      .select('week_start, commit_count')
      .eq('resource_id', resourceId)
      .eq('repo_path', repoPath)
      .order('week_start', { ascending: true })

    if (checkError) {
      console.error(`❌ Failed to check existing records for ${resource.name}:`, checkError)
      return { error: checkError.message }
    }

    // Compare existing data with new data
    let needsUpdate = false
    if (existingRecords && existingRecords.length > 0) {
      console.log(`📊 Found ${existingRecords.length} existing records for ${resource.name}`)
      
      // Check if data is different (simplified comparison)
      const existingWeeks = existingRecords.length
      const newWeeks = activityRecords.length
      
      if (existingWeeks !== newWeeks) {
        needsUpdate = true
        console.log(`🔄 Data length changed: ${existingWeeks} → ${newWeeks} weeks`)
      } else {
        // Check if any commit counts are different
        for (let i = 0; i < Math.min(existingRecords.length, activityRecords.length); i++) {
          if (existingRecords[i].commit_count !== activityRecords[i].commit_count) {
            needsUpdate = true
            console.log(`🔄 Data changed at week ${existingRecords[i].week_start}: ${existingRecords[i].commit_count} → ${activityRecords[i].commit_count}`)
            break
          }
        }
      }
    } else {
      needsUpdate = true
      console.log(`🆕 No existing records found for ${resource.name}, will insert new data`)
    }

    // Always use upsert to update data - no need to delete first
    console.log(`🔄 Upserting ${activityRecords.length} records for ${resource.name}`)

    // Use upsert to handle duplicates properly
    const { data, error } = await supabase
      .from('github_activity')
      .upsert(activityRecords, {
        onConflict: 'resource_id,repo_path,week_start'
      })

    if (error) {
      console.error(`❌ Failed to store activity data for ${resource.name}:`, error)
      console.error(`🔍 Error details:`, { code: error.code, message: error.message, details: error.details })
      return { error: error.message }
    }

    console.log(`✅ Stored ${data?.length || 0} activity records for ${resource.name}`)
    console.log(`📊 Upsert result:`, { data: data?.length, error: error?.message })
    return { success: true, count: data?.length || 0 }
  } catch (error) {
    console.error(`❌ Error storing activity data for ${resource.name}:`, error)
    return { error: error.message }
  }
}

// Merge existing database data with new GitHub data
const mergeHistoricalData = async (resource, newWeeklyData) => {
  if (!supabase) {
    return newWeeklyData
  }

  try {
    const resourceId = String(resource.id || resource.name)
    const repoPath = extractRepoPath(resource.social?.github)
    
    if (!repoPath) {
      return newWeeklyData
    }

    // Get existing data from database (up to 3 years worth)
    const threeYearsAgo = new Date()
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)
    
    const { data: existingData, error } = await supabase
      .from('github_activity')
      .select('week_start, commit_count')
      .eq('resource_id', resourceId)
      .eq('repo_path', repoPath)
      .gte('week_start', threeYearsAgo.toISOString().slice(0, 10))
      .order('week_start', { ascending: true })

    if (error) {
      console.log(`⚠️ Error fetching existing data for ${resource.name}:`, error.message)
      return newWeeklyData
    }

    if (!existingData || existingData.length === 0) {
      console.log(`📊 No existing data found for ${resource.name}, using new data only`)
      return newWeeklyData
    }

    // Create a map of existing data by week_start
    const existingDataMap = new Map()
    existingData.forEach(record => {
      existingDataMap.set(record.week_start, record.commit_count)
    })

    // Merge new data with existing data
    const mergedData = newWeeklyData.map(week => {
      const existingCount = existingDataMap.get(week.weekStart)
      
      // If we have existing data for this week, use the higher count
      // (this handles cases where GitHub data might be incomplete)
      if (existingCount !== undefined) {
        return {
          weekStart: week.weekStart,
          count: Math.max(week.count, existingCount)
        }
      }
      
      return week
    })

    // Add any existing weeks that aren't in the new data
    existingData.forEach(record => {
      const weekExists = mergedData.some(week => week.weekStart === record.week_start)
      if (!weekExists) {
        mergedData.push({
          weekStart: record.week_start,
          count: record.commit_count
        })
      }
    })

    // Sort by date
    mergedData.sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart))

    console.log(`📊 Merged data for ${resource.name}: ${existingData.length} existing + ${newWeeklyData.length} new = ${mergedData.length} total weeks`)
    
    return mergedData
  } catch (error) {
    console.error(`❌ Error merging historical data for ${resource.name}:`, error)
    return newWeeklyData
  }
}

// Fetch latest releases
const fetchLatestReleases = async (repoPath, limit = 3) => {
  try {
    const response = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repoPath}/releases?per_page=${limit}`)
    const releases = await response.json()
    
    return releases.map(release => ({
      id: release.id,
      name: release.name || release.tag_name,
      tagName: release.tag_name,
      publishedAt: release.published_at,
      body: release.body,
      htmlUrl: release.html_url,
      prerelease: release.prerelease,
      draft: release.draft
    }))
  } catch (error) {
    if (error.message.includes('404')) {
      console.log(`⚠️ No releases found for ${repoPath} (repository might be private or moved)`)
    } else {
      console.error(`Error fetching releases for ${repoPath}:`, error)
    }
    return []
  }
}

// Fetch weekly commit statistics using GitHub API
// Uses /stats/participation endpoint which returns weekly commit counts for the last 52 weeks
// Falls back to manual calculation for repos with >10,000 commits (422 error)
const fetchWeeklyCommitStats = async (repoPath) => {
  try {
    // Get the last 52 weeks of commit activity
    const response = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repoPath}/stats/participation`)
    
    // Handle different response statuses
    if (response.status === 202) {
      console.log(`⏳ Weekly stats for ${repoPath} are being computed, will retry later`)
      return 0
    }
    
    if (response.status === 204) {
      console.log(`📭 No weekly stats available for ${repoPath}`)
      return 0
    }
    
    const stats = await response.json()
    
    if (!stats.all || stats.all.length === 0) {
      return 0
    }
    
    // STRICT VALIDATION: Ensure this is real GitHub data
    if (!validateGitHubData(stats.all, `GitHub API for ${repoPath}`)) {
      console.error(`❌ Invalid data from GitHub API for ${repoPath}, returning 0`)
      return 0
    }
    
    // Get the most recent week's commit count
    const lastWeekCommits = stats.all[stats.all.length - 1]
    return lastWeekCommits || 0
  } catch (error) {
    if (error.message.includes('422')) {
      console.log(`⚠️ Repository ${repoPath} has more than 10,000 commits, using fallback method`)
      // Fallback: calculate from recent commits
      return await calculateCommitsFromRecent(repoPath)
    }
    console.log(`⚠️ Could not fetch weekly stats for ${repoPath}:`, error.message)
    return 0
  }
}

// Validate that data comes from real GitHub API
const validateGitHubData = (data, source) => {
  if (!data || !Array.isArray(data)) {
    console.warn(`⚠️ Invalid data structure from ${source}`)
    return false
  }
  
  // Check that all values are real numbers
  for (let i = 0; i < data.length; i++) {
    const value = data[i]
    if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
      console.warn(`⚠️ Invalid commit count at index ${i}: ${value} (from ${source})`)
      return false
    }
  }
  
  // Check that we have exactly 52 values (GitHub API standard)
  if (data.length !== 52) {
    console.warn(`⚠️ Expected 52 weeks, got ${data.length} from ${source}`)
    return false
  }
  
  console.log(`✅ Validated ${data.length} weeks of real GitHub data from ${source}`)
  return true
}

// Fallback method for repositories with >10,000 commits
const calculateCommitsFromRecent = async (repoPath) => {
  try {
    const response = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repoPath}/commits?per_page=100`)
    const commits = await response.json()
    
    const now = new Date()
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    
    const commitsInLastWeek = commits.filter(commit => {
      const commitDate = new Date(commit.commit.author.date)
      return commitDate >= oneWeekAgo
    })
    
    return commitsInLastWeek.length
  } catch (error) {
    console.log(`⚠️ Fallback calculation failed for ${repoPath}:`, error.message)
    return 0
  }
}

// Fetch recent commits and weekly stats
const fetchRecentCommits = async (repoPath, limit = 5) => {
  try {
    const [commitsResponse, weeklyStats] = await Promise.all([
      rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repoPath}/commits?per_page=${limit}`),
      fetchWeeklyCommitStats(repoPath)
    ])
    
    const commits = await commitsResponse.json()
    
    const commitData = commits.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author,
      date: commit.commit.author.date,
      htmlUrl: commit.html_url,
      shortSha: commit.sha.substring(0, 7)
    }))
    
    return {
      commits: commitData,
      commitsPerWeek: weeklyStats
    }
  } catch (error) {
    if (error.message.includes('404')) {
      console.log(`⚠️ No commits found for ${repoPath} (repository might be private or moved)`)
    } else {
      console.error(`Error fetching commits for ${repoPath}:`, error)
    }
    return { commits: [], commitsPerWeek: 0 }
  }
}

// Fetch repository information
const fetchRepositoryInfo = async (repoPath) => {
  try {
    const response = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repoPath}`)
    const repo = await response.json()
    
    return {
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      stargazersCount: repo.stargazers_count,
      forksCount: repo.forks_count,
      language: repo.language,
      pushedAt: repo.pushed_at,
      htmlUrl: repo.html_url
    }
  } catch (error) {
    if (error.message.includes('404')) {
      console.log(`⚠️ Repository info not found for ${repoPath} (repository might be private or moved)`)
    } else {
      console.error(`Error fetching repository info for ${repoPath}:`, error)
    }
    return null
  }
}

// Fetch organization repositories
const fetchOrganizationRepos = async (orgName, limit = 5) => {
  try {
    const response = await rateLimitedFetch(`${GITHUB_API_BASE}/orgs/${orgName}/repos?sort=updated&per_page=${limit}`)
    const repos = await response.json()
    
    return repos.map(repo => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      stargazersCount: repo.stargazers_count,
      forksCount: repo.forks_count,
      language: repo.language,
      pushedAt: repo.pushed_at,
      htmlUrl: repo.html_url,
      updatedAt: repo.updated_at
    }))
  } catch (error) {
    console.error(`Error fetching organization repos for ${orgName}:`, error)
    return []
  }
}

// Fetch organization-wide commit statistics
const fetchOrganizationCommitStats = async (orgName, maxRepos = 10) => {
  try {
    console.log(`🏢 Fetching organization-wide stats for ${orgName}`)
    
    // Get all repositories for the organization
    const response = await rateLimitedFetch(`${GITHUB_API_BASE}/orgs/${orgName}/repos?sort=updated&per_page=${maxRepos}`)
    const repos = await response.json()
    
    if (repos.length === 0) {
      console.log(`⚠️ No repositories found for organization ${orgName}`)
      return { totalCommitsPerWeek: 0, totalRepos: 0 }
    }
    
    console.log(`📦 Found ${repos.length} repositories for ${orgName}`)
    
    // Fetch weekly commit stats for each repository
    const weeklyStatsPromises = repos.map(async (repo) => {
      try {
        // Get the full 52-week participation data for each repository
        const statsResponse = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repo.full_name}/stats/participation`)
        
        if (statsResponse.status === 202) {
          console.log(`⏳ Weekly stats for ${repo.full_name} are being computed`)
          return {
            repoName: repo.name,
            fullName: repo.full_name,
            commitsPerWeek: 0,
            all: Array(52).fill(0)
          }
        }
        
        if (statsResponse.status === 204) {
          console.log(`📭 No weekly stats available for ${repo.full_name}`)
          return {
            repoName: repo.name,
            fullName: repo.full_name,
            commitsPerWeek: 0,
            all: Array(52).fill(0)
          }
        }
        
        const stats = await statsResponse.json()
        
        if (!stats.all || stats.all.length === 0) {
          return {
            repoName: repo.name,
            fullName: repo.full_name,
            commitsPerWeek: 0,
            all: Array(52).fill(0)
          }
        }
        
        // Get the most recent week's commit count
        const lastWeekCommits = stats.all[stats.all.length - 1] || 0
        
        return {
          repoName: repo.name,
          fullName: repo.full_name,
          commitsPerWeek: lastWeekCommits,
          all: stats.all
        }
      } catch (error) {
        console.log(`⚠️ Failed to get stats for ${repo.full_name}: ${error.message}`)
        return {
          repoName: repo.name,
          fullName: repo.full_name,
          commitsPerWeek: 0,
          all: Array(52).fill(0)
        }
      }
    })
    
    const weeklyStats = await Promise.all(weeklyStatsPromises)
    
    // Calculate total commits per week across all repositories
    const totalCommitsPerWeek = weeklyStats.reduce((total, repo) => total + repo.commitsPerWeek, 0)
    
    console.log(`📊 Organization ${orgName} stats:`, {
      totalRepos: repos.length,
      totalCommitsPerWeek,
      reposWithCommits: weeklyStats.filter(repo => repo.commitsPerWeek > 0).length
    })
    
    return {
      totalCommitsPerWeek,
      totalRepos: repos.length,
      repoStats: weeklyStats
    }
  } catch (error) {
    console.error(`Error fetching organization commit stats for ${orgName}:`, error)
    return { totalCommitsPerWeek: 0, totalRepos: 0 }
  }
}

// Generate cache key for a resource
const generateCacheKey = (resource) => {
  const githubUrl = resource.social?.github
  if (!githubUrl) return null
  
  const repoPath = extractRepoPath(githubUrl)
  if (!repoPath) return null
  
  const normalizedName = resource.name.toLowerCase().replace(/[^a-z0-9]/g, '_')
  return `github_${normalizedName}_${repoPath.replace('/', '_')}`
}

// Get cached data for a resource
const getCachedData = (resource) => {
  const cacheKey = generateCacheKey(resource)
  if (!cacheKey) {
    console.log(`❌ No cache key generated for ${resource.name}`)
    return null
  }
  
  const cached = GITHUB_CACHE.data.get(cacheKey)
  const timestamp = GITHUB_CACHE.timestamps.get(cacheKey)
  
  if (cached && timestamp && (Date.now() - timestamp) < GITHUB_CACHE.CACHE_DURATION) {
    console.log(`📋 Server cache hit for ${resource.name} (${cached.releases?.length || 0} releases, ${cached.commits?.length || 0} commits)`)
    return cached
  }
  
  console.log(`❌ Server cache miss for ${resource.name} (cache key: ${cacheKey})`)
  return null
}

// Set cached data for a resource
const setCachedData = (resource, data) => {
  const cacheKey = generateCacheKey(resource)
  if (!cacheKey) return false
  
  GITHUB_CACHE.data.set(cacheKey, data)
  GITHUB_CACHE.timestamps.set(cacheKey, Date.now())
  
  // Save to disk periodically (every 10 cache operations)
  const now = Date.now()
  if (now - GITHUB_CACHE.lastSave > 30000) { // Save every 30 seconds
    saveCacheToDisk()
    GITHUB_CACHE.lastSave = now
  }
  
  console.log(`💾 Server cached data for ${resource.name}`)
  return true
}

// Fetch monthly commit counts for the last 12 months
const fetchMonthlyCommitStats = async (repoPath) => {
  const now = new Date()
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      count: 0
    })
  }
  try {
    // Get up to 1000 commits (GitHub API max per page is 100, so we may need to paginate)
    let page = 1
    let keepFetching = true
    while (keepFetching && page <= 10) {
      const response = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repoPath}/commits?per_page=100&page=${page}`)
      const commits = await response.json()
      if (!Array.isArray(commits) || commits.length === 0) break
      commits.forEach(commit => {
        const date = new Date(commit.commit.author.date)
        const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        const monthObj = months.find(m => m.label === label)
        if (monthObj) monthObj.count++
      })
      if (commits.length < 100) keepFetching = false
      page++
    }
    return months
  } catch (error) {
    console.error(`Error fetching monthly commit stats for ${repoPath}:`, error)
    return months
  }
}

// Fetch GitHub updates for a resource (with caching)
const fetchGitHubUpdates = async (resource) => {
  const githubUrl = resource.social?.github
  if (!githubUrl) {
    return { releases: [], commits: [], commitsPerWeek: 0, repoInfo: null, commitsPerMonth: [], commitsPerWeekDetailed: [] }
  }
  
  const repoPath = extractRepoPath(githubUrl)
  if (!repoPath) {
    return { releases: [], commits: [], commitsPerWeek: 0, repoInfo: null, commitsPerMonth: [], commitsPerWeekDetailed: [] }
  }
  
  // Check cache first
  const cachedData = getCachedData(resource)
  if (cachedData) {
    return cachedData
  }
  
  console.log(`🔍 Server fetching fresh GitHub data for ${resource.name} (${repoPath})`)
  
  try {
    let releases = []
    let commits = []
    let repoInfo = null
    let commitsPerWeek = 0
    let commitsPerMonth = []
    let commitsPerWeekDetailed = [];
    
    // Check if this is an organization URL
    if (!repoPath.includes('/')) {
      console.log(`🏢 Server detected organization: ${repoPath}`)
      
      // Get organization-wide commit statistics
      const orgStats = await fetchOrganizationCommitStats(repoPath, 10)
      
      if (orgStats.totalRepos === 0) {
        return { releases: [], commits: [], commitsPerWeek: 0, repoInfo: null, commitsPerMonth: [], commitsPerWeekDetailed: [] }
      }
      
      // Get the most active repository for releases and recent commits display
      const repos = await fetchOrganizationRepos(repoPath, 10)
      // Sum monthly stats across repos
      let orgMonthly = []
      for (let i = 0; i < repos.length; i++) {
        const repoMonthly = await fetchMonthlyCommitStats(repos[i].fullName)
        if (orgMonthly.length === 0) {
          orgMonthly = repoMonthly.map(m => ({ ...m }))
        } else {
          repoMonthly.forEach((m, idx) => { orgMonthly[idx].count += m.count })
        }
      }
      commitsPerMonth = orgMonthly
      const mostActiveRepo = repos[0]
      console.log(`📦 Server using most active repo for display: ${mostActiveRepo.fullName}`)
      
      const [repoReleases, repoCommitsData] = await Promise.all([
        fetchLatestReleases(mostActiveRepo.fullName, 3),
        fetchRecentCommits(mostActiveRepo.fullName, 20) // For display purposes
      ])
      
      releases = repoReleases
      commits = repoCommitsData.commits
      commitsPerWeek = orgStats.totalCommitsPerWeek // Use organization-wide total
      repoInfo = {
        ...mostActiveRepo,
        isOrganization: true,
        totalRepos: orgStats.totalRepos,
        totalCommitsPerWeek: orgStats.totalCommitsPerWeek
      }
      
      // Generate weekly data for organizations by aggregating repo stats
      if (orgStats.repoStats && orgStats.repoStats.length > 0) {
        // Only use the actual 52 weeks from GitHub API, do NOT repeat
        const weeklyData = Array(52).fill(0)
        
        // Sum up weekly commits across all repositories for the actual 52 weeks
        for (const repoStat of orgStats.repoStats) {
          if (repoStat && Array.isArray(repoStat.all) && repoStat.all.length === 52) {
            // STRICT VALIDATION: Ensure this is real GitHub data
            if (!validateGitHubData(repoStat.all, `GitHub API for ${repoStat.fullName}`)) {
              console.error(`❌ Invalid data from GitHub API for ${repoStat.fullName}, skipping`)
              continue
            }
            
            // Add the actual 52 weeks of data from each repo
            for (let i = 0; i < 52; i++) {
              weeklyData[i] += repoStat.all[i] || 0
            }
          }
        }
        
        // Calculate proper week start dates (52 weeks back from current week)
        const now = new Date()
        const currentWeekStart = new Date(now)
        currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay() + 1) // Monday of current week
        
        commitsPerWeekDetailed = weeklyData.map((count, index) => {
          // Calculate week start date (52 weeks back from current week)
          const weekStart = new Date(currentWeekStart)
          weekStart.setDate(weekStart.getDate() - (52 - 1 - index) * 7)
          
          return {
            weekStart: weekStart.toISOString().slice(0, 10),
            count: count || 0
          }
        })
        
        console.log(`📊 Generated ${commitsPerWeekDetailed.length} weeks of data for organization ${repoPath}`)
        console.log(`📅 Date range: ${commitsPerWeekDetailed[0]?.weekStart} to ${commitsPerWeekDetailed[commitsPerWeekDetailed.length - 1]?.weekStart}`)
      }
    } else {
      console.log(`📦 Server detected repository: ${repoPath}`)
      
      const [repoReleases, repoCommitsData, repoInfoData, repoMonthly] = await Promise.all([
        fetchLatestReleases(repoPath, 3),
        fetchRecentCommits(repoPath, 20), // Increased to get more commits for weekly calculation
        fetchRepositoryInfo(repoPath),
        fetchMonthlyCommitStats(repoPath)
      ])
      
      releases = repoReleases
      commits = repoCommitsData.commits
      commitsPerWeek = repoCommitsData.commitsPerWeek
      repoInfo = repoInfoData
      commitsPerMonth = repoMonthly
      
      // Generate weekly data for individual repositories
      try {
        // First try to get the standard 52-week participation data
        const response = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repoPath}/stats/participation`)
        if (response.status === 200) {
          const stats = await response.json()
          if (stats && Array.isArray(stats.all) && stats.all.length === 52) {
            // STRICT VALIDATION: Ensure this is real GitHub data
            if (!validateGitHubData(stats.all, `GitHub API for ${repoPath}`)) {
              console.error(`❌ Invalid data from GitHub API for ${repoPath}, skipping weekly data`)
              return
            }
            
            // Use the actual 52 weeks of data from GitHub
            const weeklyData = stats.all
            
            // Calculate proper week start dates (52 weeks back from current week)
            const now = new Date()
            const currentWeekStart = new Date(now)
            currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay() + 1) // Monday of current week
            
            commitsPerWeekDetailed = weeklyData.map((count, index) => {
              // Calculate week start date (52 weeks back from current week)
              const weekStart = new Date(currentWeekStart)
              weekStart.setDate(weekStart.getDate() - (52 - 1 - index) * 7)
              
              return {
                weekStart: weekStart.toISOString().slice(0, 10),
                count: count || 0
              }
            })
            
            console.log(`📊 Generated ${commitsPerWeekDetailed.length} weeks of data for ${repoPath}`)
            console.log(`📅 Date range: ${commitsPerWeekDetailed[0]?.weekStart} to ${commitsPerWeekDetailed[commitsPerWeekDetailed.length - 1]?.weekStart}`)
          }
        }
      } catch (error) {
        console.log(`⚠️ Could not fetch weekly stats for ${repoPath}:`, error.message)
        // Fallback: create basic weekly data from current week only
        const now = new Date()
        const weekStart = new Date(now)
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1) // Monday of current week
        commitsPerWeekDetailed = [{
          weekStart: weekStart.toISOString().slice(0, 10),
          count: commitsPerWeek
        }]
      }
    }
    
    const result = {
      releases,
      commits,
      commitsPerWeek: commitsPerWeek || 0,
      repoInfo,
      commitsPerMonth,
      commitsPerWeekDetailed, // <-- new field
      lastUpdated: new Date().toISOString()
    }
    
    // Cache the result
    setCachedData(resource, result)
    
    // Store activity data in Supabase
    if (commitsPerWeekDetailed && commitsPerWeekDetailed.length > 0) {
      console.log(`🔍 Attempting to store ${commitsPerWeekDetailed.length} weekly records for ${resource.name} in Supabase`)
      console.log(`📊 Weekly data sample:`, commitsPerWeekDetailed.slice(0, 3))
      console.log(`📊 Data validation: ${commitsPerWeekDetailed.filter(w => w && w.weekStart && typeof w.count === 'number').length}/${commitsPerWeekDetailed.length} valid records`)
      
      try {
        // Merge with existing historical data before storing
        const mergedData = await mergeHistoricalData(resource, commitsPerWeekDetailed)
        
        const storeResult = await storeActivityData(resource, mergedData)
        console.log(`📊 Supabase storage result for ${resource.name}:`, storeResult)
      } catch (error) {
        console.error(`❌ Failed to store activity data in Supabase for ${resource.name}:`, error)
      }
    } else {
      console.log(`⚠️ No weekly data to store for ${resource.name}`)
    }
    
    console.log(`📊 Server ${resource.name} results:`, {
      releases: result.releases.length,
      commits: result.commits.length,
      commitsPerWeek: result.commitsPerWeek,
      repoInfo: repoInfo ? 'available' : 'skipped'
    })
    
    return result
  } catch (error) {
    console.error(`Server error fetching GitHub updates for ${resource.name}:`, error)
    return { releases: [], commits: [], commitsPerWeek: 0, repoInfo: null, commitsPerMonth: [], commitsPerWeekDetailed: [] }
  }
}

// Import resources data for initial fetch

// Load resources data for initial fetch
const loadResourcesData = () => {
  try {
    // Read the resources.js file and extract the data
    const resourcesPath = path.join(__dirname, 'src', 'data', 'resources.js')
    const resourcesContent = fs.readFileSync(resourcesPath, 'utf8')
    
    // Extract the cardanoResources object using regex
    const resourcesMatch = resourcesContent.match(/export const cardanoResources = ({[\s\S]*});/)
    if (!resourcesMatch) {
      console.log('❌ Could not parse resources data')
      return []
    }
    
    // Evaluate the resources object (safe since it's our own file)
    const resourcesString = resourcesMatch[1]
    const resources = eval(`(${resourcesString})`)
    
    // Flatten all resources from all categories
    const allResources = []
    Object.values(resources).forEach(category => {
      if (Array.isArray(category)) {
        allResources.push(...category)
      }
    })
    
    // Filter resources with GitHub URLs
    const resourcesWithGitHub = allResources.filter(resource => 
      resource.social?.github
    )
    
    console.log(`📚 Loaded ${resourcesWithGitHub.length} resources with GitHub URLs`)
    return resourcesWithGitHub
  } catch (error) {
    console.error('❌ Error loading resources data:', error)
    return []
  }
}

// Initial data fetch function
const performInitialDataFetch = async () => {
  console.log('🚀 Starting initial GitHub data fetch...')
  
  const resources = loadResourcesData()
  if (resources.length === 0) {
    console.log('❌ No resources found for initial fetch')
    return
  }
  
  // Select top 15 most popular resources for initial fetch (increased from 10)
  const topResources = resources.slice(0, 15)
  console.log(`📊 Pre-loading cache for ${topResources.length} resources`)
  
  let successCount = 0
  let errorCount = 0
  
  for (let i = 0; i < topResources.length; i++) {
    const resource = topResources[i]
    try {
      console.log(`🔄 [${i + 1}/${topResources.length}] Fetching data for ${resource.name}...`)
      
      const data = await fetchGitHubUpdates(resource)
      
      if (data.releases.length > 0 || data.commits.length > 0) {
        console.log(`✅ ${resource.name}: ${data.releases.length} releases, ${data.commits.length} commits, ${data.commitsPerWeek}/week`)
        successCount++
      } else {
        console.log(`⚠️ ${resource.name}: No data available`)
      }
      
      // Add delay between requests to respect rate limits
      if (i < topResources.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000)) // 2 second delay
      }
      
    } catch (error) {
      console.error(`❌ Error fetching data for ${resource.name}:`, error.message)
      errorCount++
    }
  }
  
  console.log(`🎉 Initial fetch complete: ${successCount} successful, ${errorCount} errors`)
  console.log(`📊 Cache now contains ${GITHUB_CACHE.data.size} entries`)
  
  // Start background process to load remaining resources
  setTimeout(() => {
    performBackgroundDataFetch(resources.slice(15))
  }, 5000) // 5 second delay before starting background fetch
}

// Background data fetch for remaining resources
const performBackgroundDataFetch = async (remainingResources) => {
  if (remainingResources.length === 0) {
    console.log('✅ No remaining resources to fetch')
    return
  }
  
  console.log(`🔄 Starting background fetch for ${remainingResources.length} remaining resources...`)
  
  let successCount = 0
  let errorCount = 0
  
  for (let i = 0; i < remainingResources.length; i++) {
    const resource = remainingResources[i]
    try {
      console.log(`🔄 Background [${i + 1}/${remainingResources.length}] Fetching data for ${resource.name}...`)
      
      const data = await fetchGitHubUpdates(resource)
      
      if (data.releases.length > 0 || data.commits.length > 0) {
        console.log(`✅ Background ${resource.name}: ${data.releases.length} releases, ${data.commits.length} commits, ${data.commitsPerWeek}/week`)
        successCount++
      } else {
        console.log(`⚠️ Background ${resource.name}: No data available`)
      }
      
      // Longer delay for background fetch to be less aggressive
      if (i < remainingResources.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000)) // 3 second delay
      }
      
    } catch (error) {
      console.error(`❌ Background error fetching data for ${resource.name}:`, error.message)
      errorCount++
    }
  }
  
  console.log(`🎉 Background fetch complete: ${successCount} successful, ${errorCount} errors`)
  console.log(`📊 Cache now contains ${GITHUB_CACHE.data.size} entries`)
}

// AI Processing Functions
const filterRelevantResources = (allResources, userInput) => {
  const inputLower = userInput.toLowerCase()
  const keywords = inputLower.split(' ').filter(word => word.length > 2)
  
  // Define category priorities based on keywords
  const categoryPriorities = {
    'smart contract': ['Development Tools', 'Libraries & Languages'],
    'defi': ['Development Tools', 'Infrastructure & APIs', 'Wallets & User Tools'],
    'nft': ['Minting and NFTs', 'Development Tools'],
    'wallet': ['Wallets & User Tools', 'Development Tools'],
    'api': ['Infrastructure & APIs', 'Development Tools'],
    'security': ['Security & Auditing', 'Development Tools'],
    'ai': ['AI & Machine Learning', 'Development Tools'],
    'oracle': ['Oracles & External Data', 'Infrastructure & APIs'],
    'privacy': ['Privacy & Zero-Knowledge', 'Security & Auditing'],
    'identity': ['Identity & Authentication', 'Security & Auditing'],
    'analytics': ['Analytics & Data', 'Infrastructure & APIs'],
    'education': ['Education & Documentation'],
    'community': ['Community & Engagement'],
    'infrastructure': ['Core Infrastructure', 'Infrastructure & APIs'],
    'scaling': ['Layer 2 Scaling Solutions', 'Infrastructure & APIs'],
    'governance': ['Governance & DAOs', 'Community & Engagement']
  }
  
  // Score resources based on relevance
  const scoredResources = allResources.map(resource => {
    let score = 0
    
    // Check category priority
    for (const [keyword, priorityCategories] of Object.entries(categoryPriorities)) {
      if (inputLower.includes(keyword) && priorityCategories.includes(resource.category)) {
        score += 10
      }
    }
    
    // Check name and description matches
    if (resource.name.toLowerCase().includes(inputLower)) score += 5
    if (resource.description.toLowerCase().includes(inputLower)) score += 3
    
    // Check key solutions
    resource.keySolutions.forEach(solution => {
      if (solution.toLowerCase().includes(inputLower)) score += 2
    })
    
    return { ...resource, relevanceScore: score }
  })
  
  // Sort by relevance and return top 30
  return scoredResources
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 30)
    .map(({ relevanceScore, ...resource }) => resource)
}

// AI Analysis endpoint
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { userInput } = req.body
    
    // Security: Input validation and sanitization
    if (!userInput || typeof userInput !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid input',
        message: 'userInput must be a non-empty string'
      })
    }
    
    // Sanitize input
    const sanitizedInput = userInput.trim().substring(0, 1000) // Limit length
    if (sanitizedInput.length < 10) {
      return res.status(400).json({
        error: 'Input too short',
        message: 'Please provide a more detailed description (minimum 10 characters)'
      })
    }
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /data:text\/html/gi
    ]
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(sanitizedInput)) {
        return res.status(400).json({
          error: 'Invalid input',
          message: 'Input contains disallowed content'
        })
      }
    }

    // Load resources data
    const resources = loadResourcesData()
    if (resources.length === 0) {
      return res.status(500).json({ 
        error: 'No resources available',
        message: 'Failed to load resources data'
      })
    }

    // Filter to most relevant resources
    const relevantResources = filterRelevantResources(resources, userInput)

    // Create a concise resource summary for the AI
    const resourceSummary = relevantResources.map(resource => ({
      name: resource.name,
      category: resource.category,
      description: resource.description,
      keySolutions: resource.keySolutions
    }))

    const prompt = `
You are a Cardano development expert. A developer wants to build something on Cardano.

User Requirements: "${sanitizedInput}"

Available Cardano Tools (most relevant):
${JSON.stringify(resourceSummary, null, 2)}

Analyze the user's requirements and return a JSON object with this structure:
{
  "analysis": "Brief analysis of what the user wants to build",
  "recommendedTools": [
    {
      "resource": "Resource name from the list",
      "reason": "Why this tool is recommended",
      "priority": "high|medium|low"
    }
  ],
  "developmentPlan": {
    "overview": "Brief overview of the development approach",
    "approaches": [
      {
        "name": "Approach name",
        "description": "Description of this approach",
        "tools": ["List of tools for this approach"],
        "complexity": "beginner|intermediate|advanced"
      }
    ]
  }
}

Keep the response concise and focus on the most relevant tools.`

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a Cardano development expert. Provide accurate, practical advice for building on Cardano. Always return valid JSON. Keep responses concise."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 1500

    }).catch(error => {
      console.error('OpenAI API error:', error)
      if (error.code === 'insufficient_quota') {
        throw new Error('AI service quota exceeded. Please try again later.')
      } else if (error.code === 'rate_limit_exceeded') {
        throw new Error('AI service rate limit exceeded. Please try again later.')
      } else if (error.message.includes('context length')) {
        throw new Error('Request too complex. Please try a more specific description.')
      } else {
        throw new Error('AI service temporarily unavailable. Please try again.')
      }
    })

    const response = completion.choices[0]?.message?.content
    if (!response) {
      throw new Error('No response from AI service')
    }

    let parsedResponse
    try {
      parsedResponse = JSON.parse(response)
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError)
      throw new Error('Invalid response format from AI service')
    }

    // Validate required fields
    if (!parsedResponse.analysis || !parsedResponse.recommendedTools || !parsedResponse.developmentPlan) {
      throw new Error('AI response missing required fields')
    }

    // Map recommended tools back to actual resource objects
    const recommendedResources = (parsedResponse.recommendedTools || [])
      .map(rec => {
        if (!rec || !rec.resource) return null
        const resource = resources.find(r => r.name === rec.resource)
        return resource ? { ...resource, reason: rec.reason || 'Recommended for your use case', priority: rec.priority || 'medium' } : null
      })
      .filter(Boolean)

    const result = {
      analysis: parsedResponse.analysis || 'Analysis not available',
      recommendedResources,
      developmentPlan: parsedResponse.developmentPlan || { overview: 'Development plan not available', approaches: [] }
    }

    res.json(result)

  } catch (error) {
    console.error('AI analysis error:', error)
    
    if (error.message.includes('context length') || error.message.includes('tokens')) {
      return res.status(400).json({ 
        error: 'Request too complex',
        message: 'Please try a more specific description of what you want to build.'
      })
    }
    
    res.status(500).json({ 
      error: 'AI analysis failed',
      message: 'Failed to analyze requirements. Please try again.'
    })
  }
})

// API Routes

// Get GitHub updates for a specific resource
app.get('/api/github/:resourceId', async (req, res) => {
  try {
    const { resourceId } = req.params
    
    // For now, we'll need to get the resource data from the client
    // In a real implementation, you'd have a resources database
    res.json({ 
      error: 'Resource not found',
      message: 'Please provide resource data in request body'
    })
  } catch (error) {
    console.error('API error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get GitHub updates for a resource (POST with resource data)
app.post('/api/github/updates', async (req, res) => {
  try {
    console.log('📥 Received POST /api/github/updates for resource:', req.body?.name || 'unknown')
    
    const resource = req.body
    
    if (!resource || !resource.name || !resource.social?.github) {
      console.log('❌ Invalid resource data:', { 
        hasResource: !!resource, 
        hasName: !!resource?.name, 
        hasGithub: !!resource?.social?.github 
      })
      return res.status(400).json({ 
        error: 'Invalid resource data',
        message: 'Resource must have name and social.github URL',
        received: req.body
      })
    }
    
    const data = await fetchGitHubUpdates(resource)
    res.json(data)
  } catch (error) {
    console.error('API error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// API endpoint: Get global weekly activity (sum of all resources, last 52 weeks)
app.get('/api/github/global-activity', async (req, res) => {
  try {
    const resources = loadResourcesData()
    const resourcesWithGitHub = resources.filter(r => r.social?.github)
    let combinedWeeks = Array(52).fill(0)
    
    // Track processed organizations to avoid double counting
    const processedOrgs = new Set()
    
    for (const resource of resourcesWithGitHub) {
      const repoPath = extractRepoPath(resource.social.github)
      if (!repoPath) continue
      
      // Check if this is an organization
      if (!repoPath.includes('/')) {
        // Organization - only process if not already processed
        if (processedOrgs.has(repoPath)) {
          console.log(`⏭️ Skipping duplicate organization: ${repoPath}`)
          continue
        }
        processedOrgs.add(repoPath)
        
        try {
          // Get organization repos and sum their weekly stats
          const repos = await fetchOrganizationRepos(repoPath, 10)
          console.log(`📊 Processing organization ${repoPath} with ${repos.length} repos`)
          
          for (const repo of repos) {
            try {
              const response = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repo.fullName}/stats/participation`)
              if (response.status === 202 || response.status === 204) continue
              
              const stats = await response.json()
              if (stats && Array.isArray(stats.all) && stats.all.length === 52) {
                for (let i = 0; i < 52; i++) {
                  combinedWeeks[i] += stats.all[i]
                }
              }
            } catch (error) {
              console.log(`⚠️ Failed to get stats for ${repo.fullName}: ${error.message}`)
            }
          }
        } catch (error) {
          console.log(`⚠️ Failed to process organization ${repoPath}: ${error.message}`)
        }
      } else {
        // Individual repository
        try {
          const response = await rateLimitedFetch(`${GITHUB_API_BASE}/repos/${repoPath}/stats/participation`)
          if (response.status === 202 || response.status === 204) continue
          
          const stats = await response.json()
          if (stats && Array.isArray(stats.all) && stats.all.length === 52) {
            for (let i = 0; i < 52; i++) {
              combinedWeeks[i] += stats.all[i]
            }
          }
        } catch (error) {
          console.log(`⚠️ Failed to get stats for ${repoPath}: ${error.message}`)
        }
      }
    }
    
    console.log(`📊 Global activity calculated: ${combinedWeeks.filter(w => w > 0).length}/52 active weeks`)
    res.json({ weeks: combinedWeeks })
  } catch (error) {
    console.error('Error in /api/github/global-activity:', error)
    res.status(500).json({ error: 'Failed to fetch global activity' })
  }
})

// Get global GitHub updates (aggregated from multiple resources)
app.post('/api/github/global', async (req, res) => {
  try {
    const { resources } = req.body
    
    if (!Array.isArray(resources)) {
      return res.status(400).json({ 
        error: 'Invalid resources data',
        message: 'Resources must be an array'
      })
    }
    
    const allData = []
    const maxResources = Math.min(5, resources.length) // Limit to 5 resources
    
    for (let i = 0; i < maxResources; i++) {
      const resource = resources[i]
      if (resource.social?.github) {
        try {
          const data = await fetchGitHubUpdates(resource)
          if (data.releases.length > 0 || data.commits.length > 0) {
            allData.push({
              resource,
              ...data
            })
          }
        } catch (error) {
          console.warn(`Failed to fetch data for ${resource.name}:`, error.message)
        }
      }
    }
    
    // Sort by latest activity
    const sortedData = allData.sort((a, b) => {
      const aReleases = (a.releases || []).map(r => new Date(r.publishedAt || 0).getTime())
      const aCommits = (a.commits || []).map(c => new Date(c.date || 0).getTime())
      const aLatest = aReleases.length > 0 || aCommits.length > 0 ? Math.max(...aReleases, ...aCommits) : 0
      
      const bReleases = (b.releases || []).map(r => new Date(r.publishedAt || 0).getTime())
      const bCommits = (b.commits || []).map(c => new Date(c.date || 0).getTime())
      const bLatest = bReleases.length > 0 || bCommits.length > 0 ? Math.max(...bReleases, ...bCommits) : 0
      
      return bLatest - aLatest
    })
    
    res.json(sortedData)
  } catch (error) {
    console.error('API error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get cache status
app.get('/api/github/cache/status', (req, res) => {
  const status = {
    entries: GITHUB_CACHE.data.size,
    lastCleanup: GITHUB_CACHE.lastCleanup,
    cacheDuration: GITHUB_CACHE.CACHE_DURATION,
    keys: Array.from(GITHUB_CACHE.data.keys())
  }
  res.json(status)
})

// Get rate limit status
app.get('/api/github/rate-limit', async (req, res) => {
  try {
    const rateLimit = await checkRateLimitStatus()
    res.json(rateLimit || { error: 'Failed to check rate limit' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to check rate limit status' })
  }
})

// Clear cache
app.post('/api/github/cache/clear', (req, res) => {
  GITHUB_CACHE.data.clear()
  GITHUB_CACHE.timestamps.clear()
  GITHUB_CACHE.lastCleanup = Date.now()
  console.log('🗑️ Server cache cleared')
  res.json({ message: 'Cache cleared successfully' })
})

// Trigger initial data fetch manually
app.post('/api/github/cache/preload', async (req, res) => {
  try {
    console.log('🔄 Manual cache preload triggered')
    await performInitialDataFetch()
    res.json({ 
      message: 'Cache preload completed',
      cacheEntries: GITHUB_CACHE.data.size
    })
  } catch (error) {
    console.error('Error during manual preload:', error)
    res.status(500).json({ error: 'Preload failed' })
  }
})

// Trigger background fetch for remaining resources
app.post('/api/github/cache/background-fetch', async (req, res) => {
  try {
    console.log('🔄 Manual background fetch triggered')
    const resources = loadResourcesData()
    const remainingResources = resources.slice(15) // Skip first 15 that were loaded initially
    
    // Start background fetch
    performBackgroundDataFetch(remainingResources)
    
    res.json({ 
      message: 'Background fetch started',
      remainingResources: remainingResources.length,
      currentCacheEntries: GITHUB_CACHE.data.size
    })
  } catch (error) {
    console.error('Error during background fetch:', error)
    res.status(500).json({ error: 'Background fetch failed' })
  }
})

// Clean up wrong data from database
app.post('/api/github/cleanup', async (req, res) => {
  try {
    const { repoPath, beforeYear } = req.body
    
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' })
    }
    
    if (!repoPath) {
      return res.status(400).json({ error: 'repoPath is required' })
    }
    
    console.log(`🧹 Cleaning up wrong data for ${repoPath} before year ${beforeYear || 'all'}`)
    
    let query = supabase
      .from('github_activity')
      .delete()
      .eq('repo_path', repoPath)
    
    if (beforeYear) {
      query = query.lt('year', beforeYear)
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error(`❌ Failed to cleanup data for ${repoPath}:`, error)
      return res.status(500).json({ error: error.message })
    }
    
    console.log(`✅ Cleaned up data for ${repoPath}`)
    res.json({ 
      success: true, 
      message: `Cleaned up data for ${repoPath}`,
      deletedCount: data?.length || 0
    })
  } catch (error) {
    console.error('Cleanup error:', error)
    res.status(500).json({ error: 'Cleanup failed' })
  }
})

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 GitHub cache initialized with ${GITHUB_CACHE.CACHE_DURATION / (60 * 60 * 1000)} hour duration`)
  
  // Check rate limit status at startup
  await checkRateLimitStatus()
  
  // Start initial data fetch after server is running
  setTimeout(() => {
    performInitialDataFetch()
  }, 1000) // 1 second delay to ensure server is fully started
})

// Graceful shutdown - save cache before exiting
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...')
  saveCacheToDisk()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...')
  saveCacheToDisk()
  process.exit(0)
}) 