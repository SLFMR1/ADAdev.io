import React, { useState, useEffect } from 'react'
import { GitCommit } from 'lucide-react'
import { fetchGitHubUpdates } from '../services/github'
import { useCommitData } from '../contexts/CommitDataContext'
import { isCurrentWeek } from '../utils/weekCalculation'

const WeeklyCommitCount = ({ resource }) => {
  const [commitsPerMonth, setCommitsPerMonth] = useState(null)
  const [loading, setLoading] = useState(false)
  const { updateCommitData } = useCommitData()

  useEffect(() => {
    const fetchCommitCount = async () => {
      if (!resource.social?.github) return

      try {
        setLoading(true)
        
        // Use the same historical data approach as ResourceCard
        // Fetch 4-week data (maps to 'monthly' period in the API)
        const data = await fetchGitHubUpdates(resource, '4weeks')
        
        if (data && data.commitsPerWeek !== undefined) {
          // commitsPerWeek from 4-week period actually contains 5 weeks of data from server
          // Filter to only show the last 4 weeks to match user expectations
          let commits = data.commitsPerWeek || 0

          // If we have weeklyData, calculate from the exact weeks we want to display
          if (data.weeklyData && Array.isArray(data.weeklyData)) {
            // For 4-week period: server sends 5 weeks [Oldest, Week2, Week3, Week4, Current]
            // We want the most recent 4 complete weeks - remove the OLDEST week (first one)
            const recent4Weeks = data.weeklyData.slice(1) // Remove first (oldest) week, keep last 4

            commits = recent4Weeks.reduce((sum, week) => sum + (week.count || 0), 0)
          }
          setCommitsPerMonth(commits)
          // Register this data with the global context for sorting (with error handling)
          try {
            updateCommitData(resource.name, commits)
          } catch (error) {
            console.warn('Failed to update commit data context:', error)
          }
        } else {
          setCommitsPerMonth(0)
          try {
            updateCommitData(resource.name, 0)
          } catch (error) {
            console.warn('Failed to update commit data context:', error)
          }
        }
      } catch (error) {
        console.error('Error fetching commit count:', error)
        setCommitsPerMonth(0)
        try {
          updateCommitData(resource.name, 0)
        } catch (contextError) {
          console.warn('Failed to update commit data context on error:', contextError)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchCommitCount()
  }, [resource, updateCommitData])

  if (!resource.social?.github) return null
  if (loading) return null
  if (commitsPerMonth === null) return null

  return (
    <div className="flex items-center space-x-1 text-xs text-gray-500" title="completed weeks">
      <GitCommit size={12} />
      <span>{commitsPerMonth}/month</span>
      {resource.social?.github && !resource.social.github.includes('/') && (
        <span className="text-gray-400">(org)</span>
      )}
    </div>
  )
}

export default WeeklyCommitCount 