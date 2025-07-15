import { createClient } from '@supabase/supabase-js'
import logger from '../utils/logger'

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  logger.error('❌ Supabase environment variables not configured')
}

const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * GitHub Activity Service for Supabase
 */
class GitHubActivityService {
  /**
   * Store weekly commit data for a resource
   * @param {Object} resource - Resource object
   * @param {Array} weeklyData - Array of weekly commit data
   * @returns {Promise<Object>} - Insert result
   */
  async storeWeeklyActivity(resource, weeklyData) {
    if (!supabaseUrl || !supabaseKey) {
      logger.error('❌ Supabase not configured, skipping storage')
      return { error: 'Supabase not configured' }
    }

    try {
      const resourceId = String(resource.id || resource.name)
      const repoPath = this.extractRepoPath(resource.social?.github)
      
      console.log(`🔍 [Supabase] storeWeeklyActivity for ${resource.name}:`)
      console.log(`🔍 [Supabase] Resource ID: ${resourceId}`)
      console.log(`🔍 [Supabase] Repo path: ${repoPath}`)
      
      if (!repoPath) {
        logger.error(`❌ Invalid GitHub URL for ${resource.name}`)
        return { error: 'Invalid GitHub URL' }
      }

      // STRICT VALIDATION: Ensure all data is real before storage
      const validateRecord = (week) => {
        if (!week || !week.weekStart || typeof week.count !== 'number') {
          console.warn(`⚠️ Invalid week data:`, week)
          return false
        }
        
        // Ensure commit count is a real integer
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
      
      // Prepare data for insertion with strict validation
      const activityRecords = weeklyData
        .filter(validateRecord)
        .map(week => ({
          resource_id: resourceId,
          repo_path: repoPath,
          week_start: week.weekStart,
          year: new Date(week.weekStart).getFullYear(),
          week_number: this.getISOWeekNumber(new Date(week.weekStart)),
          commit_count: week.count,
          fetched_at: new Date().toISOString()
        }))

      logger.log(`💾 Storing ${activityRecords.length} weekly records for ${resource.name}`)
      console.log(`🔍 [Supabase] Storing ${activityRecords.length} records`)
      console.log(`📅 Date range: ${activityRecords[0]?.week_start} to ${activityRecords[activityRecords.length - 1]?.week_start}`)

      // First, check if records already exist
      const existingRecords = await supabase
        .from('github_activity')
        .select('week_start')
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .in('week_start', activityRecords.map(r => r.week_start))

      console.log(`🔍 [Supabase] Found ${existingRecords.data?.length || 0} existing records`)

      // Use upsert to handle duplicates
      const { data, error } = await supabase
        .from('github_activity')
        .upsert(activityRecords, {
          onConflict: 'resource_id,repo_path,week_start',
          ignoreDuplicates: false
        })

      if (error) {
        logger.error(`❌ Failed to store activity data for ${resource.name}:`, error)
        console.error(`❌ [Supabase] Storage error:`, error)
        return { error: error.message }
      }

      // If upsert doesn't return data, count the records we tried to insert
      const storedCount = data?.length || activityRecords.length
      logger.log(`✅ Stored ${storedCount} activity records for ${resource.name}`)
      console.log(`✅ [Supabase] Successfully stored ${storedCount} records`)
      return { success: true, count: storedCount }
    } catch (error) {
      logger.error(`❌ Error storing activity data for ${resource.name}:`, error)
      console.error(`❌ [Supabase] Exception in storeWeeklyActivity:`, error)
      return { error: error.message }
    }
  }

  /**
   * Retrieve weekly activity data for a resource
   * @param {Object} resource - Resource object
   * @param {number} weeks - Number of weeks to retrieve (default: 156 for 3 years)
   * @returns {Promise<Array>} - Weekly activity data
   */
  async getWeeklyActivity(resource, weeks = 156) {
    if (!supabaseUrl || !supabaseKey) {
      logger.error('❌ Supabase not configured, returning empty data')
      console.log('❌ [Supabase] Environment variables not configured for getWeeklyActivity')
      return []
    }

    try {
      const resourceId = String(resource.id || resource.name)
      const repoPath = this.extractRepoPath(resource.social?.github)
      
      console.log(`🔍 [Supabase] getWeeklyActivity for ${resource.name}:`)
      console.log(`🔍 [Supabase] Resource ID: ${resourceId}`)
      console.log(`🔍 [Supabase] Repo path: ${repoPath}`)
      console.log(`🔍 [Supabase] Requesting ${weeks} weeks of data`)
      
      if (!repoPath) {
        logger.error(`❌ Invalid GitHub URL for ${resource.name}`)
        console.log(`❌ [Supabase] Invalid GitHub URL for ${resource.name}`)
        return []
      }

      // Calculate the date for N weeks ago
      const weeksAgo = new Date()
      weeksAgo.setDate(weeksAgo.getDate() - (weeks * 7))
      console.log(`🔍 [Supabase] Querying data from: ${weeksAgo.toISOString().split('T')[0]}`)

      const { data, error } = await supabase
        .from('github_activity')
        .select('*')
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .gte('week_start', weeksAgo.toISOString().split('T')[0])
        .order('week_start', { ascending: true })

      if (error) {
        logger.error(`❌ Failed to retrieve activity data for ${resource.name}:`, error)
        console.error(`❌ [Supabase] Database error in getWeeklyActivity:`, error)
        return []
      }

      console.log(`🔍 [Supabase] Retrieved ${data?.length || 0} records for ${resource.name}`)
      if (data && data.length > 0) {
        console.log(`🔍 [Supabase] Sample records:`, data.slice(0, 3))
        console.log(`🔍 [Supabase] Date range: ${data[0]?.week_start} to ${data[data.length - 1]?.week_start}`)
        console.log(`🔍 [Supabase] Historical data available: ${data.length} weeks (${Math.round(data.length / 52 * 100)}% of 3 years)`)
      }
      
      logger.log(`📊 Retrieved ${data?.length || 0} activity records for ${resource.name} (${weeks} weeks requested)`)
      return data || []
    } catch (error) {
      logger.error(`❌ Error retrieving activity data for ${resource.name}:`, error)
      console.error(`❌ [Supabase] Exception in getWeeklyActivity:`, error)
      return []
    }
  }

  /**
   * Get the latest activity data for a resource
   * @param {Object} resource - Resource object
   * @returns {Promise<Object>} - Latest activity data
   */
  async getLatestActivity(resource) {
    if (!supabaseUrl || !supabaseKey) {
      return null
    }

    try {
      const resourceId = String(resource.id || resource.name)
      const repoPath = this.extractRepoPath(resource.social?.github)
      
      console.log(`🔍 [Supabase] getLatestActivity for ${resource.name}:`)
      console.log(`🔍 [Supabase] Resource ID: ${resourceId}`)
      console.log(`🔍 [Supabase] Repo path: ${repoPath}`)
      
      if (!repoPath) {
        console.log(`❌ [Supabase] Invalid GitHub URL for ${resource.name}`)
        return null
      }

      const { data, error } = await supabase
        .from('github_activity')
        .select('*')
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .order('week_start', { ascending: false })
        .limit(1)
        .single()

      if (error) {
        logger.error(`❌ Failed to retrieve latest activity for ${resource.name}:`, error)
        console.error(`❌ [Supabase] Database error in getLatestActivity:`, error)
        return null
      }

      console.log(`🔍 [Supabase] Latest activity for ${resource.name}:`, data)
      return data
    } catch (error) {
      logger.error(`❌ Error retrieving latest activity for ${resource.name}:`, error)
      console.error(`❌ [Supabase] Exception in getLatestActivity:`, error)
      return null
    }
  }

  /**
   * Check if we have recent data for a resource
   * @param {Object} resource - Resource object
   * @param {number} hours - Hours threshold for "recent" (default: 24)
   * @returns {Promise<boolean>} - Whether recent data exists
   */
  async hasRecentData(resource, hours = 24) {
    if (!supabaseUrl || !supabaseKey) {
      console.log('❌ [Supabase] Environment variables not configured')
      return false
    }

    try {
      const resourceId = String(resource.id || resource.name)
      const repoPath = this.extractRepoPath(resource.social?.github)
      
      console.log(`🔍 [Supabase] hasRecentData for ${resource.name}:`)
      console.log(`🔍 [Supabase] Resource ID: ${resourceId}`)
      console.log(`🔍 [Supabase] Repo path: ${repoPath}`)
      
      if (!repoPath) {
        console.log(`❌ [Supabase] Invalid GitHub URL for ${resource.name}`)
        return false
      }

      const threshold = new Date()
      threshold.setHours(threshold.getHours() - hours)
      console.log(`🔍 [Supabase] Checking for data after: ${threshold.toISOString()}`)

      const { data, error } = await supabase
        .from('github_activity')
        .select('fetched_at')
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .gte('fetched_at', threshold.toISOString())
        .limit(1)

      if (error) {
        logger.error(`❌ Failed to check recent data for ${resource.name}:`, error)
        console.error(`❌ [Supabase] Database error:`, error)
        return false
      }

      const hasData = data && data.length > 0
      console.log(`🔍 [Supabase] Has recent data: ${hasData} (${data?.length || 0} records)`)
      return hasData
    } catch (error) {
      logger.error(`❌ Error checking recent data for ${resource.name}:`, error)
      console.error(`❌ [Supabase] Exception:`, error)
      return false
    }
  }

  /**
   * Get activity summary for multiple resources
   * @param {Array} resources - Array of resource objects
   * @returns {Promise<Array>} - Activity summaries
   */
  async getActivitySummaries(resources) {
    if (!supabaseUrl || !supabaseKey) {
      return []
    }

    try {
      const summaries = []
      
      for (const resource of resources) {
        const resourceId = resource.id || resource.name
        const repoPath = this.extractRepoPath(resource.social?.github)
        
        if (!repoPath) continue

        // Get current week's data
        const currentWeek = new Date()
        currentWeek.setDate(currentWeek.getDate() - 7) // Last week

        const { data, error } = await supabase
          .from('github_activity')
          .select('commit_count')
          .eq('resource_id', resourceId)
          .eq('repo_path', repoPath)
          .gte('week_start', currentWeek.toISOString().split('T')[0])
          .order('week_start', { ascending: false })
          .limit(1)
          .single()

        if (!error && data) {
          summaries.push({
            resource: resource,
            currentWeek: data.commit_count,
            hasData: true
          })
        } else {
          summaries.push({
            resource: resource,
            currentWeek: 0,
            hasData: false
          })
        }
      }

      return summaries
    } catch (error) {
      logger.error('❌ Error getting activity summaries:', error)
      return []
    }
  }

  /**
   * Extract repository path from GitHub URL
   * @param {string} githubUrl - GitHub URL
   * @returns {string|null} - Repository path
   */
  extractRepoPath(githubUrl) {
    if (!githubUrl) {
      console.log('❌ [Supabase] extractRepoPath: No GitHub URL provided')
      return null
    }
    
    console.log(`🔍 [Supabase] extractRepoPath: Processing URL: ${githubUrl}`)
    
    // Handle organization URLs (e.g., https://github.com/masumi-network)
    const orgMatch = githubUrl.match(/github\.com\/([^\/]+)$/)
    if (orgMatch) {
      const orgPath = orgMatch[1]
      console.log(`🔍 [Supabase] extractRepoPath: Detected organization: ${orgPath}`)
      return orgPath
    }
    
    // Handle repository URLs (e.g., https://github.com/owner/repo)
    const repoMatch = githubUrl.match(/github\.com\/([^\/]+\/[^\/]+)/)
    if (repoMatch) {
      const repoPath = repoMatch[1]
      console.log(`🔍 [Supabase] extractRepoPath: Detected repository: ${repoPath}`)
      return repoPath
    }
    
    console.log(`❌ [Supabase] extractRepoPath: Could not parse GitHub URL: ${githubUrl}`)
    return null
  }

  /**
   * Get ISO week number for a date
   * @param {Date} date - Date object
   * @returns {number} - ISO week number (1-53)
   */
  getISOWeekNumber(date) {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    // Thursday in current week decides the year
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
    // January 4 is always in week 1
    const week1 = new Date(d.getFullYear(), 0, 4)
    // Adjust to Thursday in week 1 and count number of weeks from date to week1
    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7)
  }

  /**
   * Get week start date for a given date
   * @param {Date} date - Date object
   * @returns {string} - ISO date string for week start (Monday)
   */
  getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
    const monday = new Date(d.setDate(diff))
    return monday.toISOString().split('T')[0]
  }

  /**
   * Transform weekly commit data to Supabase format
   * @param {Array} weeklyData - Weekly commit data from GitHub API
   * @returns {Array} - Transformed data for Supabase
   */
  transformWeeklyData(weeklyData) {
    return weeklyData.map(week => ({
      weekStart: this.getWeekStart(new Date(week.weekStart)),
      count: week.count
    }))
  }
}

// Create singleton instance
const githubActivityService = new GitHubActivityService()

// Export functions
export const storeWeeklyActivity = (resource, weeklyData) => 
  githubActivityService.storeWeeklyActivity(resource, weeklyData)

export const getWeeklyActivity = (resource, weeks) => 
  githubActivityService.getWeeklyActivity(resource, weeks)

export const getLatestActivity = (resource) => 
  githubActivityService.getLatestActivity(resource)

export const hasRecentData = (resource, hours) => 
  githubActivityService.hasRecentData(resource, hours)

export const getActivitySummaries = (resources) => 
  githubActivityService.getActivitySummaries(resources)

export const transformWeeklyData = (weeklyData) => 
  githubActivityService.transformWeeklyData(weeklyData)

export default githubActivityService 