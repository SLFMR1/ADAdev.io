/**
 * Data Pipeline Health Dashboard Component
 * 
 * Enterprise-level dashboard for monitoring data pipeline health,
 * focusing on the fetch → cache → database storage pipeline.
 * 
 * Features:
 * - Real-time pipeline performance monitoring
 * - Cache hit/miss ratio tracking
 * - Database storage health metrics
 * - API health monitoring and rate limit tracking
 * - Resource coverage analysis
 * - Pipeline error detection and alerting
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertTriangle, CheckCircle, Clock, Database, GitCommit, RefreshCw, TrendingUp, TrendingDown, Activity, Zap } from 'lucide-react'
import { cardanoResources } from '../data/resources';

/**
 * Data Quality Level Color Mapping
 */
const QUALITY_COLORS = {
  EXCELLENT: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
  GOOD: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
  FAIR: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-200' },
  POOR: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' },
  CRITICAL: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200' }
}

const PIPELINE_COLORS = {
  OPTIMAL: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle },
  GOOD: { bg: 'bg-blue-100', text: 'text-blue-800', icon: TrendingUp },
  WARNING: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: AlertTriangle },
  CRITICAL: { bg: 'bg-red-100', text: 'text-red-800', icon: AlertTriangle }
}

/**
 * Utility function to count resources with GitHub links
 */
const getResourcesWithGitHub = () => {
  let count = 0
  Object.values(cardanoResources).forEach(category => {
    category.forEach(resource => {
      if (resource.social && resource.social.github) {
        count++
      }
    })
  })
  return count
}

/**
 * Main Data Quality Dashboard Component
 */
const DataQualityDashboard = ({ isVisible = true, onClose }) => {
  const [dashboardData, setDashboardData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedResource, setSelectedResource] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [backfillOperations, setBackfillOperations] = useState(new Map())
  const [lastRefresh, setLastRefresh] = useState(null)

  /**
   * Fetch dashboard data from API
   */
  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/data-quality/dashboard')
      if (!response.ok) {
        throw new Error(`Failed to fetch dashboard data: ${response.statusText}`)
      }

      const data = await response.json()
      setDashboardData(data)
      setLastRefresh(new Date())

    } catch (err) {
      setError(err.message)
      console.error('Dashboard data fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Trigger backfill operation for specific resources
   */
  const triggerBackfill = useCallback(async (resourceIds, priority = 'auto') => {
    try {
      setRefreshing(true)

      const response = await fetch('/api/data-quality/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceIds,
          priority,
          forceRefresh: true,
          maxConcurrent: 3
        })
      })

      if (!response.ok) {
        throw new Error(`Backfill failed: ${response.statusText}`)
      }

      const result = await response.json()
      
      // Track backfill operations
      result.operations.forEach(op => {
        setBackfillOperations(prev => new Map(prev.set(op.resourceId, {
          ...op,
          timestamp: new Date().toISOString()
        })))
      })

      // Refresh dashboard data
      setTimeout(() => {
        fetchDashboardData()
        setRefreshing(false)
      }, 2000)

      return result

    } catch (err) {
      setError(`Backfill operation failed: ${err.message}`)
      setRefreshing(false)
      throw err
    }
  }, [fetchDashboardData])

  /**
   * Get detailed analysis for specific resource
   */
  const fetchResourceAnalysis = useCallback(async (resourceId) => {
    try {
      const response = await fetch(`/api/data-quality/analysis?resourceId=${resourceId}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch resource analysis: ${response.statusText}`)
      }
      return await response.json()
    } catch (err) {
      console.error('Resource analysis fetch error:', err)
      return null
    }
  }, [])

  /**
   * Initialize dashboard
   */
  useEffect(() => {
    if (isVisible) {
      fetchDashboardData()
      
      // Set up auto-refresh every 5 minutes
      const interval = setInterval(fetchDashboardData, 5 * 60 * 1000)
      return () => clearInterval(interval)
    }
  }, [isVisible, fetchDashboardData])

  useEffect(() => {
    const handleWheel = (e) => {
      if (isVisible) {
        const dashboardContainer = e.target.closest('.dashboard-container');
        const scrollableContent = e.target.closest('.overflow-y-auto');
        
        // Allow scrolling within the dashboard content area
        if (!dashboardContainer || (dashboardContainer && !scrollableContent)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    const handleKeyDown = (e) => {
      if (isVisible && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        const dashboardContainer = e.target.closest('.dashboard-container');
        const scrollableContent = e.target.closest('.overflow-y-auto');
        
        if (!dashboardContainer || (dashboardContainer && !scrollableContent)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    const handleTouchMove = (e) => {
      if (isVisible) {
        const dashboardContainer = e.target.closest('.dashboard-container');
        const scrollableContent = e.target.closest('.overflow-y-auto');
        
        if (!dashboardContainer || (dashboardContainer && !scrollableContent)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    if (isVisible) {
      document.addEventListener('wheel', handleWheel, { passive: false });
      document.addEventListener('keydown', handleKeyDown, { passive: false });
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('touchmove', handleTouchMove);
      document.body.style.overflow = '';
    };
  }, [isVisible]);

  /**
   * Computed metrics for pipeline health summary
   */
  const summaryMetrics = useMemo(() => {
    if (!dashboardData) return null

    const { overview, pipelineMetrics, cacheMetrics, apiMetrics } = dashboardData
    const validResources = getResourcesWithGitHub()

    return {
      totalResources: overview.totalResources || 0,
      pipelineHealth: pipelineMetrics?.overallHealth || 0,
      cacheHitRate: cacheMetrics?.hitRate || 0,
      apiErrors: apiMetrics?.errorCount || 0,
      resourcesCovered: overview.resourcesCovered || 0,
      criticalIssues: overview.criticalIssues || 0,
      validResources: validResources,
    }
  }, [dashboardData])

  if (!isVisible) return null

  return (
    <div 
      className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4"
      onClick={onClose}
      style={{ overscrollBehavior: 'auto' }}
    >
      <div 
        className="dashboard-container bg-black border border-green-400 rounded-lg shadow-xl shadow-green-400/20 max-w-6xl w-full max-h-[90vh] min-w-0 sm:min-w-[800px] flex flex-col font-mono overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ overscrollBehavior: 'auto' }}
      >
        
        {/* Header */}
        <div className="bg-black border-b border-green-400 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Database className="text-green-400" size={24} />
            <div>
              <h2 className="text-xl font-semibold text-green-400 font-mono tracking-wide">PIPELINE.HEALTH.MONITOR</h2>
              <p className="text-sm text-green-500 font-mono">
                {'>>>'} REAL-TIME MONITORING: FETCH → CACHE → DATABASE
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            {lastRefresh && (
              <span className="text-xs text-green-600 font-mono">
                LAST_SYNC: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchDashboardData}
              disabled={loading || refreshing}
              className="p-2 text-green-400 hover:text-green-300 hover:bg-green-400/10 rounded border border-green-400/30 transition-colors font-mono"
            >
              <RefreshCw size={16} className={loading || refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-green-400 hover:text-green-300 hover:bg-red-400/10 rounded border border-green-400/30 transition-colors font-mono text-lg"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-black" style={{ scrollBehavior: 'smooth', overscrollBehavior: 'auto' }}>
          <div className="p-6">
          {loading && !dashboardData ? (
            <DashboardSkeleton />
          ) : error ? (
            <ErrorState error={error} onRetry={fetchDashboardData} />
          ) : dashboardData ? (
            <>
              {/* Overview Cards */}
              <OverviewCards 
                metrics={summaryMetrics} 
                onTriggerBackfill={triggerBackfill}
                refreshing={refreshing}
              />

              {/* Pipeline Health Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <PipelinePerformanceChart data={dashboardData.pipelineMetrics} />
                <CacheHealthChart data={dashboardData.cacheMetrics} />
              </div>

              {/* Pipeline Issues & API Health */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PipelineIssuesList 
                  issues={dashboardData.pipelineIssues} 
                  onResourceSelect={setSelectedResource}
                  onTriggerBackfill={triggerBackfill}
                />
                <ApiHealthPanel 
                  status={dashboardData.systemStatus}
                  apiMetrics={dashboardData.apiMetrics}
                  backfillOperations={backfillOperations}
                />
              </div>
            </>
          ) : null}
          </div>
        </div>

        {/* Resource Detail Modal */}
        {selectedResource && (
          <ResourceDetailModal 
            resource={selectedResource}
            onClose={() => setSelectedResource(null)}
            onFetchAnalysis={fetchResourceAnalysis}
            onTriggerBackfill={triggerBackfill}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Overview Cards Component
 */
const OverviewCards = ({ metrics, onTriggerBackfill, refreshing }) => {
  if (!metrics) return null

  const cards = [
    {
      title: 'Pipeline Health',
      value: `${metrics.pipelineHealth}%`,
      icon: Activity,
      color: metrics.pipelineHealth >= 90 ? 'green' : metrics.pipelineHealth >= 70 ? 'yellow' : 'red',
      subtitle: 'Fetch → Cache → DB'
    },
    {
      title: 'Cache Hit Rate',
      value: `${metrics.cacheHitRate}%`,
      icon: Zap,
      color: metrics.cacheHitRate >= 80 ? 'green' : metrics.cacheHitRate >= 60 ? 'yellow' : 'red',
      subtitle: 'Cache efficiency'
    },
    {
      title: 'Resource Coverage',
      value: `${metrics.resourcesCovered} / ${metrics.validResources}`,
      icon: Database,
      color: 'blue',
      subtitle: `${Math.round((metrics.resourcesCovered / metrics.validResources) * 100)}% of GitHub-enabled`
    },
    {
      title: 'API Errors',
      value: metrics.apiErrors,
      icon: AlertTriangle,
      color: metrics.apiErrors === 0 ? 'green' : metrics.apiErrors < 10 ? 'yellow' : 'red'
    }
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card, index) => (
        <OverviewCard 
          key={index} 
          {...card} 
          loading={refreshing}
        />
      ))}
    </div>
  )
}

/**
 * Individual Overview Card
 */
const OverviewCard = ({ title, value, icon: Icon, color, subtitle, action, loading }) => {
  const colorClasses = {
    blue: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
    green: 'bg-green-400/10 text-green-400 border-green-400/30',
    yellow: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30',
    red: 'bg-red-400/10 text-red-400 border-red-400/30'
  }

  return (
    <div className="bg-black border border-green-400/30 rounded-lg p-4 hover:border-green-400 transition-colors font-mono">
      <div className="flex items-center justify-between mb-2">
        <div className={`p-2 rounded border ${colorClasses[color]}`}>
          <Icon size={20} />
        </div>
        {action && (
          <button
            onClick={action}
            disabled={loading}
            className="text-xs px-2 py-1 bg-black border border-red-400/50 text-red-400 rounded hover:bg-red-400/10 transition-colors disabled:opacity-50 font-mono"
          >
            [FIX]
          </button>
        )}
      </div>
      
      <div>
        <p className="text-sm text-green-500 mb-1 font-mono tracking-wide">{title.toUpperCase()}</p>
        <p className="text-2xl font-semibold text-green-400 font-mono">
          {loading ? '...' : value}
        </p>
        {subtitle && (
          <p className="text-xs text-green-600 mt-1 font-mono">{'>>>'} {subtitle}</p>
        )}
      </div>
    </div>
  )
}

/**
 * Pipeline Performance Chart
 */
const PipelinePerformanceChart = ({ data }) => {
  if (!data) {
    return (
      <div className="bg-black border border-green-400/30 rounded-lg p-6 font-mono">
        <h3 className="text-lg font-semibold text-green-400 mb-4 tracking-wide">PIPELINE.PERFORMANCE</h3>
        <p className="text-green-500">{'>>>'} NO DATA AVAILABLE</p>
      </div>
    )
  }

  const metrics = [
    {
      label: 'FETCH_SUCCESS_RATE',
      value: data.fetchSuccessRate || 0,
      color: data.fetchSuccessRate >= 95 ? 'green' : data.fetchSuccessRate >= 85 ? 'yellow' : 'red'
    },
    {
      label: 'CACHE_PERFORMANCE',
      value: data.cacheEfficiency || 0,
      color: data.cacheEfficiency >= 80 ? 'green' : data.cacheEfficiency >= 60 ? 'yellow' : 'red'
    },
    {
      label: 'DB_WRITE_SUCCESS',
      value: data.dbWriteSuccess || 0,
      color: data.dbWriteSuccess >= 98 ? 'green' : data.dbWriteSuccess >= 90 ? 'yellow' : 'red'
    },
    {
      label: 'END_TO_END_HEALTH',
      value: data.overallHealth || 0,
      color: data.overallHealth >= 90 ? 'green' : data.overallHealth >= 70 ? 'yellow' : 'red'
    }
  ]

  const colorClasses = {
    green: 'bg-green-400',
    yellow: 'bg-yellow-400',
    red: 'bg-red-400'
  }

  return (
    <div className="bg-black border border-green-400/30 rounded-lg p-6 font-mono">
      <h3 className="text-lg font-semibold text-green-400 mb-4 tracking-wide">PIPELINE.PERFORMANCE</h3>
      
      <div className="space-y-4">
        {metrics.map(({ label, value, color }) => (
          <div key={label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-green-500 font-mono">{label}</span>
              <span className={`text-sm font-medium font-mono ${
                color === 'green' ? 'text-green-400' :
                color === 'yellow' ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {value}%
              </span>
            </div>
            <div className="w-full bg-green-400/10 border border-green-400/20 rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${colorClasses[color]}`}
                style={{ width: `${value}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Flow Indicator */}
      <div className="mt-6 p-3 bg-green-400/5 border border-green-400/20 rounded-lg">
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-blue-400 rounded-full" />
            <span className="text-green-500">FETCH</span>
          </div>
          <div className="flex-1 h-px bg-green-400/30 mx-2" />
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-purple-400 rounded-full" />
            <span className="text-green-500">CACHE</span>
          </div>
          <div className="flex-1 h-px bg-green-400/30 mx-2" />
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-green-400 rounded-full" />
            <span className="text-green-500">DATABASE</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Cache Health Chart
 */
const CacheHealthChart = ({ data }) => {
  if (!data) {
    return (
      <div className="bg-black border border-green-400/30 rounded-lg p-6 font-mono">
        <h3 className="text-lg font-semibold text-green-400 mb-4 tracking-wide">CACHE.HEALTH</h3>
        <p className="text-green-500">{'>>>'} NO DATA AVAILABLE</p>
      </div>
    )
  }

  const cacheMetrics = [
    {
      label: 'HIT_RATE',
      value: data.hitRate || 0,
      icon: Zap,
      description: 'SERVED_FROM_CACHE'
    },
    {
      label: 'MISS_RATE',
      value: data.missRate || 0,
      icon: Clock,
      description: 'FRESH_FETCH_REQUIRED'
    },
    {
      label: 'CACHE_SIZE',
      value: data.activeCacheSize || data.cacheSize || 0,
      icon: Database,
      description: `CACHED_ITEMS (${data.maxCacheSize || 'UNLIMITED'} MAX)`,
      isCount: true
    },
    {
      label: 'EVICTION_RATE',
      value: data.evictionRate || 0,
      icon: RefreshCw,
      description: 'ITEMS_REPLACED'
    }
  ]

  const getStatusColor = (metric, value) => {
    switch (metric) {
      case 'HIT_RATE':
        return value >= 80 ? 'text-green-400' : value >= 60 ? 'text-yellow-400' : 'text-red-400'
      case 'MISS_RATE':
        return value <= 20 ? 'text-green-400' : value <= 40 ? 'text-yellow-400' : 'text-red-400'
      case 'EVICTION_RATE':
        return value <= 10 ? 'text-green-400' : value <= 25 ? 'text-yellow-400' : 'text-red-400'
      default:
        return 'text-blue-400'
    }
  }

  return (
    <div className="bg-black border border-green-400/30 rounded-lg p-6 font-mono">
      <h3 className="text-lg font-semibold text-green-400 mb-4 tracking-wide">CACHE.HEALTH</h3>
      
      <div className="grid grid-cols-2 gap-4">
        {cacheMetrics.map(({ label, value, icon: Icon, description, isCount }) => (
          <div key={label} className="p-3 bg-green-400/5 border border-green-400/20 rounded-lg">
            <div className="flex items-center space-x-2 mb-2">
              <Icon size={16} className="text-green-500" />
              <span className="text-sm font-medium text-green-500 font-mono">{label}</span>
            </div>
            <div className="flex items-baseline space-x-1">
              <span className={`text-xl font-semibold font-mono ${getStatusColor(label, value)}`}>
                {isCount ? value : `${value}%`}
              </span>
            </div>
            <p className="text-xs text-green-600 mt-1 font-mono">{'>>>'} {description}</p>
          </div>
        ))}
      </div>

      {/* Cache Performance Indicator */}
      <div className="mt-4 p-3 bg-green-400/5 border border-green-400/20 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm text-green-500 font-medium font-mono">OVERALL_CACHE_HEALTH</span>
          <span className={`text-sm font-semibold font-mono ${
            data.hitRate >= 80 ? 'text-green-400' :
            data.hitRate >= 60 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {data.hitRate >= 80 ? 'OPTIMAL' :
             data.hitRate >= 60 ? 'GOOD' : 'ATTENTION_REQUIRED'}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Pipeline Issues List
 */
const PipelineIssuesList = ({ issues, onResourceSelect, onTriggerBackfill }) => {
  if (!issues || issues.length === 0) {
    return (
      <div className="bg-black border border-green-400/30 rounded-lg p-6 font-mono">
        <h3 className="text-lg font-semibold text-green-400 mb-4 tracking-wide">PIPELINE.ISSUES</h3>
        <div className="flex items-center space-x-2 text-green-400">
          <CheckCircle size={16} />
          <span className="text-sm font-mono">{'>>>'} ALL SYSTEMS OPERATIONAL</span>
        </div>
      </div>
    )
  }

  const issueTypeIcons = {
    'fetch_error': AlertTriangle,
    'cache_miss': Clock,
    'db_error': Database,
    'rate_limit': RefreshCw,
    'timeout': Clock
  }

  const issueTypeColors = {
    'fetch_error': 'text-red-400 bg-red-400/10 border-red-400/30',
    'cache_miss': 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    'db_error': 'text-red-400 bg-red-400/10 border-red-400/30',
    'rate_limit': 'text-orange-400 bg-orange-400/10 border-orange-400/30',
    'timeout': 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
  }

  return (
    <div className="bg-black border border-green-400/30 rounded-lg p-6 font-mono">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-green-400 tracking-wide">PIPELINE.ISSUES</h3>
      </div>
      
      <div className="space-y-3 max-h-48 overflow-y-auto" style={{ overscrollBehavior: 'auto' }}>
        {issues.map((issue, index) => {
          const Icon = issueTypeIcons[issue.type] || AlertTriangle
          const colorClass = issueTypeColors[issue.type] || 'text-red-400 bg-red-400/10 border-red-400/30'
          
          return (
            <div key={index} className={`flex items-start space-x-3 p-3 rounded border ${colorClass}`}>
              <Icon size={16} className={`${colorClass.split(' ')[0]} mt-0.5 flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium font-mono ${colorClass.split(' ')[0]}`}>
                  {issue.stage.toUpperCase()}: {issue.resourceName}
                </p>
                <p className={`text-xs font-mono ${colorClass.split(' ')[0]}`}>
                  {'>>>'} {issue.description}
                </p>
                {issue.timestamp && (
                  <p className={`text-xs font-mono ${colorClass.split(' ')[0]} mt-1`}>
                    TIMESTAMP: {new Date(issue.timestamp).toLocaleString()}
                  </p>
                )}
              </div>
              <button
                onClick={() => onResourceSelect(issue.resourceName)}
                className={`text-xs font-mono px-2 py-1 border rounded ${colorClass.split(' ')[0]} ${colorClass.split(' ')[2]} hover:bg-opacity-20 transition-colors`}
              >
                [DETAILS]
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * API Health Panel
 */
const ApiHealthPanel = ({ status, apiMetrics, backfillOperations }) => {
  const recentOperations = Array.from(backfillOperations.values())
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5)

  return (
    <div className="bg-black border border-green-400/30 rounded-lg p-6 font-mono">
      <h3 className="text-lg font-semibold text-green-400 mb-4 tracking-wide">API.HEALTH.STATUS</h3>
      
      {/* API Health Metrics */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-green-500 font-mono">GITHUB_API_STATUS</span>
          <span className={`text-xs px-2 py-1 rounded border font-mono ${
            status.githubApiStatus === 'operational' 
              ? 'bg-green-400/10 text-green-400 border-green-400/30' 
              : status.githubApiStatus === 'degraded'
              ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30'
              : 'bg-red-400/10 text-red-400 border-red-400/30'
          }`}>
            {status.githubApiStatus === 'error' ? 'RATE_LIMITED' : status.githubApiStatus.toUpperCase()}
          </span>
        </div>
        
        {/* Rate Limit Warning */}
        {status.githubApiStatus === 'error' && (apiMetrics?.rateLimitRemaining || 0) === 0 && (
          <div className="mt-2 p-2 bg-yellow-400/10 border border-yellow-400/30 rounded">
            <div className="flex items-center space-x-2">
              <AlertTriangle size={14} className="text-yellow-400" />
              <span className="text-xs text-yellow-400 font-mono">
                {'>>>'} GITHUB API RATE LIMIT REACHED. METRICS MAY BE OUTDATED. 
                {apiMetrics?.rateLimitReset && (
                  <span className="block mt-1">
                    RESET_TIME: {new Date(apiMetrics.rateLimitReset).toLocaleTimeString()}
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
        
        <div className="flex items-center justify-between">
          <span className="text-sm text-green-500 font-mono">RATE_LIMIT_STATUS</span>
          <span className={`text-xs px-2 py-1 rounded border font-mono ${
            (apiMetrics?.rateLimitRemaining || 0) > 1000
              ? 'bg-green-400/10 text-green-400 border-green-400/30'
              : (apiMetrics?.rateLimitRemaining || 0) > 100
              ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30'
              : 'bg-red-400/10 text-red-400 border-red-400/30'
          }`}>
            {apiMetrics?.rateLimitRemaining !== undefined ? 
              `${apiMetrics.rateLimitRemaining} REMAINING` : 
              'CHECKING...'
            }
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-sm text-green-500 font-mono">DATABASE_HEALTH</span>
          <span className={`text-xs px-2 py-1 rounded border font-mono ${
            status.databaseHealth === 'healthy' 
              ? 'bg-green-400/10 text-green-400 border-green-400/30' 
              : 'bg-red-400/10 text-red-400 border-red-400/30'
          }`}>
            {status.databaseHealth.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-green-500 font-mono">RESPONSE_TIME</span>
          <span className={`text-xs px-2 py-1 rounded border font-mono ${
            (apiMetrics?.averageResponseTime || 0) < 500
              ? 'bg-green-400/10 text-green-400 border-green-400/30'
              : (apiMetrics?.averageResponseTime || 0) < 1000
              ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30'
              : 'bg-red-400/10 text-red-400 border-red-400/30'
          }`}>
            {apiMetrics?.averageResponseTime !== undefined ? 
              `${apiMetrics.averageResponseTime}MS` : 
              'MEASURING...'
            }
          </span>
        </div>
      </div>

      {/* Pipeline Performance Summary */}
      <div className="p-3 bg-green-400/5 border border-green-400/20 rounded mb-4">
        <h4 className="text-sm font-medium text-green-400 mb-2 font-mono tracking-wide">PIPELINE.PERFORMANCE</h4>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-green-500">SUCCESS_RATE:</span>
            <span className="font-medium text-green-400">{apiMetrics?.successRate || 0}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-500">CACHE_EFFICIENCY:</span>
            <span className="font-medium text-green-400">{apiMetrics?.cacheHitRate || 0}%</span>
          </div>
        </div>
      </div>

      {/* Recent Pipeline Operations */}
      {recentOperations.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-green-400 mb-2 font-mono tracking-wide">RECENT.OPERATIONS</h4>
          <div className="space-y-2 max-h-32 overflow-y-auto" style={{ overscrollBehavior: 'auto' }}>
            {recentOperations.map((op, index) => (
              <div key={index} className="flex items-center space-x-2 text-xs font-mono">
                {op.status === 'completed' ? (
                  <CheckCircle size={12} className="text-green-400" />
                ) : op.status === 'running' ? (
                  <Clock size={12} className="text-blue-400" />
                ) : (
                  <AlertTriangle size={12} className="text-red-400" />
                )}
                <span className="text-green-500 truncate">{op.resourceName}</span>
                <span className={`px-1 py-0.5 rounded border font-mono ${
                  op.status === 'completed' 
                    ? 'bg-green-400/10 text-green-400 border-green-400/30'
                    : op.status === 'running'
                    ? 'bg-blue-400/10 text-blue-400 border-blue-400/30' 
                    : 'bg-red-400/10 text-red-400 border-red-400/30'
                }`}>
                  {op.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Loading skeleton
 */
const DashboardSkeleton = () => (
  <div className="space-y-6">
    <div className="text-green-400 font-mono text-sm mb-4">
      <div className="animate-pulse">{'>>>'} INITIALIZING PIPELINE ANALYSIS...</div>
      <div className="animate-pulse delay-150">{'>>>'} LOADING SYSTEM METRICS...</div>
      <div className="animate-pulse delay-300">{'>>>'} ESTABLISHING DATA CONNECTIONS...</div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-green-400/10 border border-green-400/30 rounded h-24 animate-pulse" />
      ))}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-green-400/10 border border-green-400/30 rounded h-64 animate-pulse" />
      <div className="bg-green-400/10 border border-green-400/30 rounded h-64 animate-pulse" />
    </div>
  </div>
)

/**
 * Error state component
 */
const ErrorState = ({ error, onRetry }) => (
  <div className="text-center py-12">
    <AlertTriangle size={48} className="text-red-400 mx-auto mb-4" />
    <h3 className="text-lg font-semibold text-red-400 mb-2 font-mono tracking-wide">SYSTEM.ERROR.DETECTED</h3>
    <p className="text-green-500 mb-4 font-mono text-sm">{'>>>'} ERROR: {error}</p>
    <button
      onClick={onRetry}
      className="px-4 py-2 bg-black border border-green-400 text-green-400 rounded font-mono hover:bg-green-400/10 transition-colors"
    >
      [RETRY.OPERATION]
    </button>
  </div>
)

/**
 * Resource Detail Modal (placeholder)
 */
const ResourceDetailModal = ({ resource, onClose, onFetchAnalysis, onTriggerBackfill }) => {
  return (
    <div className="fixed inset-0 z-60 bg-black bg-opacity-75 flex items-center justify-center p-4" style={{ overscrollBehavior: 'auto' }}>
      <div className="bg-black border border-green-400 rounded-lg shadow-xl shadow-green-400/20 max-w-2xl w-full max-h-[80vh] overflow-hidden font-mono" style={{ overscrollBehavior: 'auto' }}>
        <div className="bg-black border-b border-green-400/50 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-green-400 tracking-wide">RESOURCE.ANALYSIS: {resource.toUpperCase()}</h3>
          <button
            onClick={onClose}
            className="p-2 text-green-400 hover:text-green-300 hover:bg-green-400/10 rounded border border-green-400/30 transition-colors"
          >
            ×
          </button>
        </div>
        <div className="p-6 bg-black">
          <p className="text-green-500 font-mono">{'>>>'} DETAILED RESOURCE ANALYSIS WILL BE IMPLEMENTED HERE.</p>
          <div className="mt-4 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-black border border-green-400/50 text-green-400 rounded font-mono hover:bg-green-400/10 transition-colors"
            >
              [CLOSE.SESSION]
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DataQualityDashboard