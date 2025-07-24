import React, { useState, useEffect } from 'react'
import { GitCommit } from 'lucide-react'
import githubDataStore from '../services/githubDataStore'

const WeeklyCommitCount = ({ resource }) => {
  const [commitsPerWeek, setCommitsPerWeek] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fetchCommitCount = async () => {
      if (!resource.social?.github) return

      try {
        setLoading(true)
        
        // Get data from shared store
        const data = githubDataStore.getResourceData(resource.id);
        
        if (data) {
          setCommitsPerWeek(data.commitsPerWeek || 0);
        } else {
          // If no data in store, trigger a fetch
          await githubDataStore.fetchAllData();
          const freshData = githubDataStore.getResourceData(resource.id);
          setCommitsPerWeek(freshData?.commitsPerWeek || 0);
        }
      } catch (error) {
        console.error('Error fetching commit count:', error)
        setCommitsPerWeek(0)
      } finally {
        setLoading(false)
      }
    }

    fetchCommitCount()
  }, [resource])

  if (!resource.social?.github) return null
  if (loading) return null
  if (commitsPerWeek === null) return null

  return (
    <div className="flex items-center space-x-1 text-xs text-gray-500">
      <GitCommit size={12} />
      <span>{commitsPerWeek}/week</span>
      {resource.social?.github && !resource.social.github.includes('/') && (
        <span className="text-gray-400">(org)</span>
      )}
    </div>
  )
}

export default WeeklyCommitCount 