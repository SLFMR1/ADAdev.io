const { createClient } = require('@supabase/supabase-js')
const logger = require('../utils/logger')

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let supabase = null

if (!supabaseUrl || !supabaseKey) {
  logger.error('❌ Supabase environment variables not configured')
} else {
  supabase = createClient(supabaseUrl, supabaseKey)
}

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
      logger.error('❌ Supabase not configured, returning error')
      return { error: 'Supabase not configured' }
    }

    try {
      const repoPath = this.extractRepoPath(resource.social?.github)
      
      if (!repoPath) {
        logger.error(`❌ Invalid GitHub URL for ${resource.name}`)
        return { error: 'Invalid GitHub URL' }
      }
      
      // Use repoPath as the unique identifier to avoid conflicts with duplicate resource IDs
      const resourceId = repoPath

      // STRICT VALIDATION: Ensure all data is real before storage
      const validateRecord = (week) => {
        if (!week || !week.weekStart || typeof week.count !== 'number') {
          return false
        }
        
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
        if (!dateRegex.test(week.weekStart)) {
          return false
        }
        
        // Validate count is non-negative
        if (week.count < 0) {
          return false
        }
        
        return true
      }

      // Prepare data for insertion with strict validation
      const activityRecords = weeklyData
        .filter(validateRecord)
        .map(week => {
          const date = new Date(week.weekStart)
          const year = date.getFullYear()
          const weekNumber = this.getWeekNumber(date)
          
          return {
            resource_id: resourceId,
            repo_path: repoPath,
            week_start: week.weekStart,
            year: year,
            week_number: weekNumber,
            commit_count: week.count,
            fetched_at: new Date().toISOString()
          }
        })

      if (activityRecords.length === 0) {
        logger.warn(`⚠️ No valid weekly records for ${resource.name}`)
        return { success: true, message: 'No valid records to store' }
      }

      // CRITICAL FIX: Deduplicate records by week_start to prevent duplicate key errors
      const uniqueRecords = []
      const seenWeeks = new Set()
      
      for (const record of activityRecords) {
        const weekKey = `${record.resource_id}-${record.repo_path}-${record.week_start}`
        if (!seenWeeks.has(weekKey)) {
          seenWeeks.add(weekKey)
          uniqueRecords.push(record)
        }
      }

      logger.info(`📊 Data summary: ${uniqueRecords.filter(r => r.commit_count > 0).length} weeks with commits`)
      logger.info(`📅 Date range: ${uniqueRecords[0]?.week_start} to ${uniqueRecords[uniqueRecords.length - 1]?.week_start}`)
      
      // Log sample records for debugging
      logger.info(`🟢 About to upsert to Supabase (first 5):`, uniqueRecords.slice(0, 5))
      logger.info(`🟢 About to upsert to Supabase (last 5):`, uniqueRecords.slice(-5))

      // Use upsert with ON CONFLICT DO UPDATE
      const { data, error } = await supabase
        .from('github_activity')
        .upsert(uniqueRecords, {
          onConflict: 'resource_id,repo_path,week_start',
          ignoreDuplicates: false
        })

      if (error) {
        logger.error(`❌ Failed to store activity data for ${resource.name}:`, error)
        logger.error(`🔍 Error details:`, {
          code: error.code,
          message: error.message,
          details: error.details
        })
        return { error: error.message }
      }

      logger.info(`✅ Successfully stored ${uniqueRecords.length} weekly records for ${resource.name}`)
      return { success: true, count: uniqueRecords.length }

    } catch (error) {
      logger.error(`❌ Exception in storeWeeklyActivity for ${resource.name}:`, error)
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
      return []
    }

    try {
      const repoPath = this.extractRepoPath(resource.social?.github)
      
      if (!repoPath) {
        logger.error(`❌ Invalid GitHub URL for ${resource.name}`)
        return []
      }
      
      // Use repoPath as the unique identifier to avoid conflicts with duplicate resource IDs
      const resourceId = repoPath

      // Calculate the date for N weeks ago
      const weeksAgo = new Date()
      weeksAgo.setDate(weeksAgo.getDate() - (weeks * 7))

      const { data, error } = await supabase
        .from('github_activity')
        .select('*') // FIXED: Remove limit to support longer periods
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .gte('week_start', weeksAgo.toISOString().split('T')[0])
        .order('week_start', { ascending: true })

      if (error) {
        logger.error(`❌ Failed to retrieve activity data for ${resource.name}:`, error)
        return []
      }
      
      logger.log(`📊 Retrieved ${data?.length || 0} activity records for ${resource.name} (${weeks} weeks requested)`)
      return data || []
    } catch (error) {
      logger.error(`❌ Error retrieving activity data for ${resource.name}:`, error)
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
      const repoPath = this.extractRepoPath(resource.social?.github)
      
      if (!repoPath) {
        return null
      }
      
      // Use repoPath as the unique identifier to avoid conflicts with duplicate resource IDs
      const resourceId = repoPath

      const { data, error } = await supabase
        .from('github_activity')
        .select('*').limit(52)
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .order('week_start', { ascending: false })
        .limit(1)
        .single()

      if (error) {
        logger.error(`❌ Failed to retrieve latest activity for ${resource.name}:`, error)
        return null
      }

      return data
    } catch (error) {
      logger.error(`❌ Error retrieving latest activity for ${resource.name}:`, error)
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
      return false
    }

    try {
      const resourceId = String(resource.id || resource.name)
      const repoPath = this.extractRepoPath(resource.social?.github)
      
      if (!repoPath) {
        return false
      }

      const threshold = new Date()
      threshold.setHours(threshold.getHours() - hours)

      const { data, error } = await supabase
        .from('github_activity')
        .select('fetched_at')
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .gte('fetched_at', threshold.toISOString())
        .limit(1)

      if (error) {
        logger.error(`❌ Failed to check recent data for ${resource.name}:`, error)
        return false
      }

      const hasData = data && data.length > 0
      return hasData
    } catch (error) {
      logger.error(`❌ Error checking recent data for ${resource.name}:`, error)
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
        const repoPath = this.extractRepoPath(resource.social?.github)
        
        if (!repoPath) continue
        
        // Use repoPath as the unique identifier to avoid conflicts with duplicate resource IDs
        const resourceId = repoPath

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

  // Create daily activity table if it doesn't exist
  async createDailyActivityTable() {
    try {
      const { error } = await supabase.rpc('create_daily_activity_table')
      if (error) {
        logger.error('❌ Failed to create daily activity table:', error)
        return false
      }
      logger.log('✅ Daily activity table created successfully')
      return true
    } catch (error) {
      logger.error('❌ Error creating daily activity table:', error)
      return false
    }
  }

  // Store daily activity data in the new table
  async storeDailyActivity(resourceId, repoPath, dailyData, resource) {
    try {
      // Validate input data
      if (!resourceId || !repoPath || !Array.isArray(dailyData)) {
        logger.error('❌ Invalid input for storeDailyActivity')
        return false
      }

      // Check if this is an organization
      const isOrganization = !repoPath.includes('/')
      
      // Validate each record
      const validateRecord = (day) => {
        return day && 
               typeof day.date === 'string' && 
               typeof day.count === 'number' && 
               day.count >= 0
      }

      // Prepare data for insertion with strict validation
      const activityRecords = dailyData
        .filter(validateRecord)
        .map(day => {
          const date = new Date(day.date)
          const year = date.getFullYear()
          const month = date.getMonth() + 1
          const dayOfMonth = date.getDate()
          
          return {
            resource_id: resourceId,
            repo_path: repoPath,
            date: day.date,
            year: year,
            month: month,
            day: dayOfMonth,
            commit_count: day.count,
            fetched_at: new Date().toISOString()
          }
        })

      if (activityRecords.length === 0) {
        logger.warn(`⚠️ No valid daily records for ${resource?.name || resourceId}`)
        return true
      }

      // CRITICAL FIX: Deduplicate records by date to prevent duplicate key errors
      const uniqueRecords = []
      const seenDates = new Set()
      
      for (const record of activityRecords) {
        const dateKey = `${record.resource_id}-${record.repo_path}-${record.date}`
        if (!seenDates.has(dateKey)) {
          seenDates.add(dateKey)
          uniqueRecords.push(record)
        }
      }

      logger.info(`📊 Daily data summary: ${uniqueRecords.filter(r => r.commit_count > 0).length} days with commits`)
      logger.info(`📅 Date range: ${uniqueRecords[0]?.date} to ${uniqueRecords[uniqueRecords.length - 1]?.date}`)

      // Use upsert with ON CONFLICT DO UPDATE
      const { data, error } = await supabase
        .from('github_daily_activity')
        .upsert(uniqueRecords, {
          onConflict: 'resource_id,repo_path,date',
          ignoreDuplicates: false
        })

      if (error) {
        logger.error(`❌ Failed to store daily activity data for ${resource?.name || resourceId}:`, error)
        logger.error(`🔍 Error details:`, {
          code: error.code,
          message: error.message,
          details: error.details
        })
        return false
      }

      logger.info(`✅ Successfully stored ${uniqueRecords.length} daily records for ${resource?.name || resourceId}`)
      return true

    } catch (error) {
      logger.error(`❌ Exception in storeDailyActivity for ${resource?.name || resourceId}:`, error)
      return false
    }
  }

  // Get daily activity data from the new table
  async getDailyActivity(resourceId, repoPath, days, resource) {
    try {
      if (!resourceId || !repoPath || !days || !resource) {
        logger.error('❌ Invalid input for getDailyActivity')
        return []
      }

      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - days)

      const { data, error } = await supabase
        .from('github_daily_activity')
        .select('*').limit(52)
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .gte('date', daysAgo.toISOString().split('T')[0])
        .order('date', { ascending: true })

      if (error) {
        logger.error(`❌ Failed to retrieve daily activity for ${resource.name}:`, error)
        return []
      }

      logger.log(`📊 Retrieved ${data?.length || 0} daily activity records for ${resource.name} (${days} days requested)`)
      return data || []
    } catch (error) {
      logger.error(`❌ Error retrieving daily activity for ${resource.name}:`, error)
      return []
    }
  }

  // Check if we have recent daily data
  async hasRecentDailyData(resourceId, repoPath, hours = 24) {
    try {
      const threshold = new Date()
      threshold.setHours(threshold.getHours() - hours)

      const { data, error } = await supabase
        .from('github_daily_activity')
        .select('fetched_at')
        .eq('resource_id', resourceId)
        .eq('repo_path', repoPath)
        .gte('fetched_at', threshold.toISOString())
        .limit(1)

      if (error) {
        logger.error('❌ Error checking recent daily data:', error)
        return false
      }

      return data && data.length > 0
    } catch (error) {
      logger.error('❌ Error checking recent daily data:', error)
      return false
    }
  }

  /**
   * Extract repository path from GitHub URL
   * @param {string} githubUrl - GitHub URL
   * @returns {string|null} - Repository path
   */
  extractRepoPath(githubUrl) {
    if (!githubUrl) {
      return null
    }
    
    // Handle organization URLs (e.g., https://github.com/masumi-network)
    const orgMatch = githubUrl.match(/github\.com\/([^\/]+)$/)
    if (orgMatch) {
      const orgPath = orgMatch[1]
      return orgPath
    }
    
    // Handle repository URLs (e.g., https://github.com/owner/repo)
    const repoMatch = githubUrl.match(/github\.com\/([^\/]+\/[^\/]+)/)
    if (repoMatch) {
      const repoPath = repoMatch[1]
      return repoPath
    }
    
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
const storeWeeklyActivity = (resource, weeklyData) => 
  githubActivityService.storeWeeklyActivity(resource, weeklyData)

const getWeeklyActivity = (resource, weeks) => 
  githubActivityService.getWeeklyActivity(resource, weeks)

const getLatestActivity = (resource) => 
  githubActivityService.getLatestActivity(resource)

const hasRecentData = (resource, hours) => 
  githubActivityService.hasRecentData(resource, hours)

const getActivitySummaries = (resources) => 
  githubActivityService.getActivitySummaries(resources)

const createDailyActivityTable = () => 
  githubActivityService.createDailyActivityTable()

const storeDailyActivity = (resourceId, repoPath, dailyData, resource) => 
  githubActivityService.storeDailyActivity(resourceId, repoPath, dailyData, resource)

const getDailyActivity = (resourceId, repoPath, days, resource) => 
  githubActivityService.getDailyActivity(resourceId, repoPath, days, resource)

const hasRecentDailyData = (resourceId, repoPath, hours) => 
  githubActivityService.hasRecentDailyData(resourceId, repoPath, hours)

const transformWeeklyData = (weeklyData) => 
  githubActivityService.transformWeeklyData(weeklyData)

module.exports = {
  storeWeeklyActivity,
  getWeeklyActivity,
  getLatestActivity,
  hasRecentData,
  getActivitySummaries,
  createDailyActivityTable,
  storeDailyActivity,
  getDailyActivity,
  hasRecentDailyData,
  transformWeeklyData,
  default: githubActivityService
} 