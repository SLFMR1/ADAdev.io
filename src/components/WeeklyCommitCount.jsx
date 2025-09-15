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
        
        // Fetch individual resource data for last 4 weeks
        const response = await fetch(`/api/development-activity?resourceId=${resource.id}&resourceName=${encodeURIComponent(resource.name)}&period=4weeks`)
        const data = await response.json()
        
        if (data && data.weeklyData && Array.isArray(data.weeklyData)) {
          // Server returns 5 weeks of data, we want the most recent 4 weeks (including current)
          const recentWeeks = data.weeklyData.slice(-4) // Take last 4 weeks
          const commits = recentWeeks.reduce((sum, week) => sum + (week.count || 0), 0)
          setCommitsPerMonth(commits)

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