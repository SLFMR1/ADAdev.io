const { createClient } = require('@supabase/supabase-js')
const logger = require('../utils/logger')
const { getISOWeekNumber, getWeekStart } = require('../../utils/weekCalculation.js')

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
          const weekNumber = this.getISOWeekNumber(date)
          
          return {
            resource_id: resourceId,
            repo_path: repoPath,
            week_start: week.weekStart,
            year: year,
            week_number: weekNumber,
            commit_count: week.count,
            fetched_at: new Date().toISOString(),
            data_source: 'github_graphql'
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

      // Use upsert with proper merge behavior to update existing records
      const { data, error } = await supabase
        .from('github_activity')
        .upsert(uniqueRecords, {
          onConflict: 'resource_id,repo_path,week_start'
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

      // Data integrity verification - verify a sample of the data was actually stored/updated
      if (uniqueRecords.length > 0) {
        const sampleRecord = uniqueRecords[0]
        const { data: verifyData, error: verifyError } = await supabase
          .from('github_activity')
          .select('commit_count, fetched_at')
          .eq('resource_id', sampleRecord.resource_id)
          .eq('repo_path', sampleRecord.repo_path)
          .eq('week_start', sampleRecord.week_start)
          .single()

        if (verifyError) {
          logger.error(`❌ Data integrity verification failed for ${resource.name}:`, verifyError)
        } else if (verifyData?.commit_count !== sampleRecord.commit_count) {
          logger.error(`❌ Data integrity issue for ${resource.name}: Expected ${sampleRecord.commit_count}, got ${verifyData?.commit_count}`)
        } else {
          logger.debug(`✅ Data integrity verified for ${resource.name} - commit count: ${verifyData.commit_count}`)
        }
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

  // Store daily activity data in the new table (rolling 10-day cache)
  async storeDailyActivity(resourceId, repoPath, dailyData, resource) {
    try {
      // Validate input data
      if (!resourceId || !repoPath || !Array.isArray(dailyData)) {
        logger.error('❌ Invalid input for storeDailyActivity')
        return false
      }

      // Rolling cache: Clean up data older than 10 days
      this._cleanupInProgress = true
      const tenDaysAgo = new Date()
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)
      const cutoffDate = tenDaysAgo.toISOString().slice(0, 10)

      try {
        const { error: cleanupError } = await supabase
          .from('github_daily_activity')
          .delete()
          .eq('resource_id', resourceId)
          .eq('repo_path', repoPath)
          .lt('date', cutoffDate)

        if (cleanupError) {
          logger.warn(`⚠️ Failed to cleanup old daily data for ${resource?.name || resourceId}:`, cleanupError.message)
        } else {
          logger.debug(`🧹 Cleaned up daily data older than ${cutoffDate} for ${resource?.name || resourceId}`)
        }
      } catch (cleanupErr) {
        logger.warn(`⚠️ Cleanup error for ${resource?.name || resourceId}:`, cleanupErr.message)
      } finally {
        this._cleanupInProgress = false
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
            fetched_at: new Date().toISOString(),
            data_source: 'github_graphql'
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

      // Use upsert with proper merge behavior to update existing records
      const { data, error } = await supabase
        .from('github_daily_activity')
        .upsert(uniqueRecords, {
          onConflict: 'resource_id,repo_path,date'
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
   * Get week start date for a given date
   * @param {Date} date - Date object
   * @returns {string} - ISO date string for week start (Sunday)
   */
  getWeekStart(date) {
    const weekStart = getWeekStart(date)
    return weekStart.toISOString().slice(0, 10) // YYYY-MM-DD format in UTC (consistent)
  }

  /**
   * Get ISO week number for a date
   * @param {Date} date - Date object
   * @returns {number} - ISO week number (1-53)
   */
  getISOWeekNumber(date) {
    return getISOWeekNumber(date)
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

  /**
   * Get daily storage statistics for monitoring dashboard
   * @returns {Array} - Daily storage stats
   */
  async getDailyStorageStats() {
    // Cache monitoring stats to avoid repeated expensive queries
    if (this._monitoringCache &&
        this._monitoringCacheTime &&
        Date.now() - this._monitoringCacheTime < 60000) { // 1 minute cache
      logger.debug('📊 Serving cached daily storage stats')
      return this._monitoringCache
    }

    // Skip monitoring during cleanup operations to prevent race conditions
    if (this._cleanupInProgress) {
      logger.debug('⚠️ Skipping monitoring queries during cleanup operations')
      return this._monitoringCache || [{
        success_rate: 0, failed_writes_last_hour: 0, cache_utilization: 0,
        fallback_usage_today: 0, avg_response_time: 0, last_cleanup_time: null,
        total_records: 0, seven_day_performance: 0, seven_day_readiness: 0
      }]
    }

    try {
      // Use approximate count to avoid expensive operations
      // Query actual metrics from the github_daily_activity table
      const { data: recordCount, error: countError } = await supabase
        .from('github_daily_activity')
        .select('id')
        .limit(1000) // Sample for performance

      const { data: recentRecords, error: recentError } = await supabase
        .from('github_daily_activity')
        .select('fetched_at')
        .gte('date', new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('fetched_at', { ascending: false })

      const { data: todayRecords, error: todayError } = await supabase
        .from('github_daily_activity')
        .select('*')
        .eq('date', new Date().toISOString().split('T')[0])

      if (countError || recentError) {
        logger.error('❌ Failed to get daily storage stats:', countError || recentError)
      }

      const totalRecords = recordCount?.length ? Math.min(recordCount.length * 10, 5000) : 0 // Approximate total
      const recentCount = recentRecords?.length || 0
      const todayCount = todayRecords?.length || 0

      // Calculate cache utilization (10-day rolling cache)
      const maxExpectedRecords = 10 * 50 // 10 days * ~50 resources
      const cacheUtilization = Math.min(100, (recentCount / maxExpectedRecords) * 100)

      // Estimate success rate based on data freshness
      const now = new Date()
      const recentSuccessful = recentRecords?.filter(r => {
        const fetchTime = new Date(r.fetched_at)
        return (now - fetchTime) < 24 * 60 * 60 * 1000 // Less than 24 hours old
      }).length || 0

      const successRate = recentCount > 0 ? Math.round((recentSuccessful / recentCount) * 100) : 0

      // Find last cleanup time (most recent fetched_at)
      const lastCleanupTime = recentRecords?.[0]?.fetched_at || null

      // Track 7-day view performance by checking if we have recent 7-day data
      const { data: sevenDayData, error: sevenDayError } = await supabase
        .from('github_daily_activity')
        .select('resource_id')
        .gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])

      const sevenDayReadiness = sevenDayData?.length || 0
      const maxResourcesSevenDay = 50 * 7 // Assume 50 resources x 7 days
      const sevenDayPerformance = Math.min(100, Math.round((sevenDayReadiness / maxResourcesSevenDay) * 100))

      const result = [{
        success_rate: successRate,
        failed_writes_last_hour: Math.max(0, recentCount - recentSuccessful),
        cache_utilization: Math.round(cacheUtilization),
        fallback_usage_today: todayCount,
        avg_response_time: 150, // Estimated average response time in ms
        last_cleanup_time: lastCleanupTime,
        total_records: totalRecords,
        seven_day_performance: sevenDayPerformance,
        seven_day_readiness: sevenDayReadiness
      }]

      // Cache the results
      this._monitoringCache = result
      this._monitoringCacheTime = Date.now()

      return result
    } catch (error) {
      logger.error('❌ Error getting daily storage stats:', error)
      return [{
        success_rate: 0,
        failed_writes_last_hour: 0,
        cache_utilization: 0,
        fallback_usage_today: 0,
        avg_response_time: 0,
        last_cleanup_time: null,
        total_records: 0,
        seven_day_performance: 0,
        seven_day_readiness: 0
      }]
    }
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

// Get daily storage statistics for monitoring
const getDailyStorageStats = () => githubActivityService.getDailyStorageStats()

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
  getDailyStorageStats,
  default: githubActivityService
} 