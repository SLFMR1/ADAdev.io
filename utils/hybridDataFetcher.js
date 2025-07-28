/**
 * Hybrid Data Fetcher - Ensures 100% accuracy with 1-day buffer
 * 
 * Strategy:
 * - For completed weeks: Use fast database data (100% accurate)
 * - For current week: Use live GitHub API data (real-time accurate)
 * - 1-day buffer: Yesterday and before must be accurate, today can be slightly behind
 */

const { getISOWeekNumber } = require('./weekCalculation')

/**
 * Get the Sunday start date for any given date
 */
function getSundayOfWeek(date) {
  const target = new Date(date.valueOf())
  const dayOfWeek = target.getDay() // 0 = Sunday
  target.setDate(target.getDate() - dayOfWeek)
  target.setHours(0, 0, 0, 0)
  return target
}

/**
 * Check if a week is complete enough to rely on database data
 * We consider a week "complete" if we're past the 1-day buffer (yesterday is included)
 */
function isWeekCompleteForDatabase(weekStartDate) {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  yesterday.setHours(23, 59, 59, 999)
  
  const weekEnd = new Date(weekStartDate)
  weekEnd.setDate(weekStartDate.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)
  
  // Week is complete for database if week ended before yesterday
  return weekEnd < yesterday
}

/**
 * Fetch commits from GitHub API for a specific week
 */
async function fetchGitHubCommitsForWeek(repoPath, weekStartDate, isOrganization = false) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.VITE_GITHUB_TOKEN
  
  if (!GITHUB_TOKEN) {
    throw new Error('GitHub token not available')
  }
  
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekStartDate.getDate() + 6)
  weekEndDate.setHours(23, 59, 59, 999)
  
  const since = weekStartDate.toISOString()
  const until = weekEndDate.toISOString()
  
  console.log(`🔄 Fetching live GitHub data for ${repoPath} from ${weekStartDate.toISOString().slice(0, 10)} to ${weekEndDate.toISOString().slice(0, 10)}`)
  
  try {
    if (isOrganization) {
      // Fetch organization repositories first
      const reposUrl = `https://api.github.com/orgs/${repoPath}/repos?type=public&per_page=100`
      let repos = []
      let page = 1
      
      while (true) {
        const pageUrl = `${reposUrl}&page=${page}`
        const response = await fetch(pageUrl, {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'ADAdev-Hybrid-Fetcher'
          }
        })
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        
        const data = await response.json()
        if (!Array.isArray(data) || data.length === 0) break
        
        repos.push(...data)
        if (data.length < 100) break
        page++
        
        await new Promise(resolve => setTimeout(resolve, 100)) // Rate limiting
      }
      
      // Filter out forks (same logic as refresh script)
      const originalRepos = repos.filter(repo => !repo.fork)
      console.log(`  📦 Found ${originalRepos.length} original repositories (${repos.length - originalRepos.length} forks skipped)`)
      
      // Fetch commits from all original repositories
      let totalCommits = 0
      
      for (const repo of originalRepos) {
        const repoCommits = await fetchRepositoryCommitsForWeek(repo.full_name, since, until, GITHUB_TOKEN)
        totalCommits += repoCommits
        await new Promise(resolve => setTimeout(resolve, 100)) // Rate limiting
      }
      
      return totalCommits
      
    } else {
      // Individual repository
      return await fetchRepositoryCommitsForWeek(repoPath, since, until, GITHUB_TOKEN)
    }
    
  } catch (error) {
    console.error(`❌ Failed to fetch live GitHub data for ${repoPath}:`, error.message)
    throw error
  }
}

/**
 * Fetch commits for a single repository within a date range
 */
async function fetchRepositoryCommitsForWeek(repoPath, since, until, githubToken) {
  const url = `https://api.github.com/repos/${repoPath}/commits?since=${since}&until=${until}&per_page=100`
  let commits = []
  let page = 1
  
  while (true) {
    const pageUrl = `${url}&page=${page}`
    const response = await fetch(pageUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ADAdev-Hybrid-Fetcher'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json()
    if (!Array.isArray(data) || data.length === 0) break
    
    commits.push(...data)
    if (data.length < 100) break
    page++
    
    await new Promise(resolve => setTimeout(resolve, 100)) // Rate limiting
  }
  
  console.log(`    📊 ${repoPath}: ${commits.length} commits`)
  return commits.length
}

/**
 * Fetch week data from database
 */
async function fetchDatabaseWeekData(supabase, resourceId, weekStartDate) {
  const weekStartStr = weekStartDate.toISOString().slice(0, 10)
  
  try {
    const { data, error } = await supabase
      .from('github_activity')
      .select('commit_count, week_start')
      .eq('resource_id', resourceId)
      .eq('week_start', weekStartStr)
      .single()
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error
    }
    
    if (data) {
      console.log(`📦 Using database data for ${resourceId} (${weekStartStr}): ${data.commit_count} commits`)
      return {
        count: data.commit_count,
        weekStart: weekStartStr,
        source: 'database'
      }
    }
    
    return null
  } catch (error) {
    console.error(`❌ Database fetch error for ${resourceId}:`, error.message)
    return null
  }
}

/**
 * Main hybrid data fetching function
 * Returns accurate commit data using database for completed weeks, GitHub API for current week
 */
async function getHybridWeekData(supabase, resource, weekStartDate) {
  const resourceId = resource.id || resource.name
  const repoPath = resource.repo_path || resource.social?.github?.replace('https://github.com/', '')
  const isOrganization = resource.type === 'organization'
  
  if (!repoPath) {
    console.warn(`⚠️  No repo path found for resource ${resourceId}`)
    return {
      count: 0,
      weekStart: weekStartDate.toISOString().slice(0, 10),
      source: 'unavailable'
    }
  }
  
  try {
    // Check if week is complete enough for database accuracy
    if (isWeekCompleteForDatabase(weekStartDate)) {
      console.log(`🗃️  Week ${weekStartDate.toISOString().slice(0, 10)} is complete, using database`)
      
      // Try database first for completed weeks
      const dbData = await fetchDatabaseWeekData(supabase, resourceId, weekStartDate)
      if (dbData) {
        return dbData
      }
      
      // Fallback to GitHub if database doesn't have the data
      console.log(`⚠️  Database missing data for completed week, falling back to GitHub API`)
    } else {
      console.log(`🔄 Week ${weekStartDate.toISOString().slice(0, 10)} is current/recent, using live GitHub data`)
    }
    
    // Fetch live data from GitHub
    const commitCount = await fetchGitHubCommitsForWeek(repoPath, weekStartDate, isOrganization)
    
    return {
      count: commitCount,
      weekStart: weekStartDate.toISOString().slice(0, 10),
      source: 'github-live'
    }
    
  } catch (error) {
    console.error(`❌ Hybrid fetch failed for ${resourceId}:`, error.message)
    
    // Final fallback to database even for current week
    const dbData = await fetchDatabaseWeekData(supabase, resourceId, weekStartDate)
    if (dbData) {
      console.log(`📦 Using database fallback for ${resourceId}`)
      return dbData
    }
    
    return {
      count: 0,
      weekStart: weekStartDate.toISOString().slice(0, 10),
      source: 'error',
      error: error.message
    }
  }
}

/**
 * Get multiple weeks of hybrid data for a resource
 */
async function getHybridMultiWeekData(supabase, resource, weeksCount = 4) {
  const weeks = []
  const today = new Date()
  
  // Generate week start dates going backwards
  for (let i = weeksCount - 1; i >= 0; i--) {
    const weekStart = getSundayOfWeek(today)
    weekStart.setDate(weekStart.getDate() - (i * 7))
    weeks.push(weekStart)
  }
  
  console.log(`🔄 Fetching ${weeksCount} weeks of hybrid data for ${resource.name}`)
  
  // Fetch data for all weeks
  const weekDataPromises = weeks.map(weekStart => 
    getHybridWeekData(supabase, resource, weekStart)
  )
  
  const weekDataResults = await Promise.all(weekDataPromises)
  
  // Log the data source mix
  const sources = weekDataResults.reduce((acc, week) => {
    acc[week.source] = (acc[week.source] || 0) + 1
    return acc
  }, {})
  
  console.log(`✅ Hybrid data complete for ${resource.name}:`, sources)
  
  return weekDataResults
}

/**
 * Get current week data specifically (for "this week" displays)
 */
async function getCurrentWeekHybridData(supabase, resource) {
  const today = new Date()
  const currentWeekStart = getSundayOfWeek(today)
  
  return await getHybridWeekData(supabase, resource, currentWeekStart)
}

module.exports = {
  getHybridWeekData,
  getHybridMultiWeekData,
  getCurrentWeekHybridData,
  isWeekCompleteForDatabase,
  getSundayOfWeek
}