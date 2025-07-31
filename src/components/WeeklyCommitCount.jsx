import React, { useState, useEffect } from 'react'
import { GitCommit } from 'lucide-react'
import { fetchGitHubUpdates } from '../services/github'
import { useCommitData } from '../contexts/CommitDataContext'

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
        // Fetch monthly data (4weeks period maps to 'monthly' in the API)
        const data = await fetchGitHubUpdates(resource, '4weeks')
        
        if (data && data.commitsPerWeek !== undefined) {
          // commitsPerWeek from monthly period represents total commits in ~28 days
          // This is effectively commits per month since monthly period = 28 days
          const commits = data.commitsPerWeek || 0
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