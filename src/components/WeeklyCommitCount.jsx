import React, { useState, useEffect } from 'react'
import { GitCommit } from 'lucide-react'
import { fetchGitHubUpdates } from '../services/github'

const WeeklyCommitCount = ({ resource }) => {
  const [commitsPerMonth, setCommitsPerMonth] = useState(null)
  const [loading, setLoading] = useState(false)

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
          setCommitsPerMonth(data.commitsPerWeek || 0)
        } else {
          setCommitsPerMonth(0)
        }
      } catch (error) {
        console.error('Error fetching commit count:', error)
        setCommitsPerMonth(0)
      } finally {
        setLoading(false)
      }
    }

    fetchCommitCount()
  }, [resource])

  if (!resource.social?.github) return null
  if (loading) return null
  if (commitsPerMonth === null) return null

  return (
    <div className="flex items-center space-x-1 text-xs text-gray-500">
      <GitCommit size={12} />
      <span>{commitsPerMonth}/month</span>
      {resource.social?.github && !resource.social.github.includes('/') && (
        <span className="text-gray-400">(org)</span>
      )}
    </div>
  )
}

export default WeeklyCommitCount 