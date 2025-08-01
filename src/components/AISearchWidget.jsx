import React, { useState, useEffect, useRef } from 'react'
import { Bot, X, FileText, ExternalLink, Copy, Check, Sparkles } from 'lucide-react'
import { generateMarkdownPlan } from '../services/ai'
import logger from '../utils/logger-frontend'
import Portal from './Portal'
import AISearchInput from './AISearchInput'

const AISearchWidget = ({ isExpanded, onExpand, onCollapse, isAnyExpanded }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [aiResults, setAiResults] = useState(null)
  const [activeTab, setActiveTab] = useState('search')
  const [copied, setCopied] = useState(false)
  const [cachedPlans, setCachedPlans] = useState([])
  const [selectedPlanId, setSelectedPlanId] = useState(null)
  const progressInterval = useRef(null)

  // Cache management functions
  const savePlanToCache = (query, results) => {
    const planId = Date.now().toString()
    const newPlan = {
      id: planId,
      timestamp: Date.now(),
      query: query.trim(),
      results: results,
      title: query.slice(0, 50) + (query.length > 50 ? '...' : '')
    }
    
    try {
      const existingPlans = JSON.parse(localStorage.getItem('aiDevelopmentPlans') || '[]')
      const updatedPlans = [newPlan, ...existingPlans.slice(0, 9)] // Keep last 10 plans
      localStorage.setItem('aiDevelopmentPlans', JSON.stringify(updatedPlans))
      setCachedPlans(updatedPlans)
      return planId
    } catch (error) {
      logger.error('Failed to save plan to cache:', error)
      return null
    }
  }

  const loadCachedPlans = () => {
    try {
      const cached = JSON.parse(localStorage.getItem('aiDevelopmentPlans') || '[]')
      setCachedPlans(cached)
    } catch (error) {
      logger.error('Failed to load cached plans:', error)
      setCachedPlans([])
    }
  }

  const loadPlan = (planId) => {
    const plan = cachedPlans.find(p => p.id === planId)
    if (plan) {
      setAiResults(plan.results)
      setSelectedPlanId(planId)
      setActiveTab('plan')
    }
  }

  const deletePlan = (planId) => {
    try {
      const updatedPlans = cachedPlans.filter(p => p.id !== planId)
      localStorage.setItem('aiDevelopmentPlans', JSON.stringify(updatedPlans))
      setCachedPlans(updatedPlans)
      
      // If deleted plan was currently selected, reset
      if (selectedPlanId === planId) {
        setSelectedPlanId(null)
        setAiResults(null)
        setActiveTab('search')
      }
    } catch (error) {
      logger.error('Failed to delete plan:', error)
    }
  }

  const startNewSearch = () => {
    setSelectedPlanId(null)
    setAiResults(null)
    setActiveTab('search')
  }

  // Load cached plans on component mount
  useEffect(() => {
    loadCachedPlans()
  }, [])

  // Function to handle clicking on a tool name in the development plan
  const handleToolClick = (toolName) => {
    // Switch to tools tab
    setActiveTab('tools')
    
    // Wait for tab switch to complete, then scroll to the specific resource
    setTimeout(() => {
      // Find the resource that matches the tool name
      const matchingResource = aiResults?.recommendedResources?.find(resource => 
        resource.name.toLowerCase().includes(toolName.toLowerCase()) ||
        toolName.toLowerCase().includes(resource.name.toLowerCase())
      )
      
      if (matchingResource) {
        // Find the element and scroll to it
        const resourceElement = document.querySelector(`[data-resource-id="${matchingResource.id}"]`)
        if (resourceElement) {
          resourceElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Add a brief highlight effect
          resourceElement.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.3)'
          setTimeout(() => {
            resourceElement.style.boxShadow = ''
          }, 2000)
        }
      }
    }, 150)
  }

  const handleCopyPlan = async () => {
    try {
      const markdownPlan = generateMarkdownPlan(aiResults)
      await navigator.clipboard.writeText(markdownPlan)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      logger.error('Failed to copy plan:', error)
    }
  }


  // Handle click outside to collapse widget
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isExpanded && !event.target.closest('[data-widget="ai-search"]')) {
        onCollapse();
      }
    };
    
    // Only add the event listener when the widget is expanded
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded, onCollapse]);

  // Group resources by category
  const groupedResources = aiResults ? aiResults.recommendedResources.reduce((acc, resource) => {
    if (!acc[resource.category]) {
      acc[resource.category] = []
    }
    acc[resource.category].push(resource)
    return acc
  }, {}) : {}

  return (
    <>
      {/* Collapsed Floating Button for Sidebar Grouping */}
      {!isExpanded ? (
        <div
          className="relative z-50 w-16 h-16"
          onClick={onExpand}
          data-widget="ai"
        >
                      <div className="flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl">
                              <Sparkles size={24} className="text-teal-400" />
            </div>
        </div>
      ) : (
        /* Expanded Centered Widget */
        <Portal>
          <div className="fixed z-[9999] flex items-center justify-center left-1/2 top-1/2 w-[90vw] max-w-[1200px] max-h-[90vh] min-w-[900px] min-h-[600px] border-radius-[32px] bg-card-bg/40 border border-gray-800 rounded-xl shadow-lg overflow-hidden p-0 animate-modal-enter" style={{ borderRadius: '32px' }}
            data-widget="ai-search">
            <button
              className="absolute top-6 right-6 z-50 text-gray-400 hover:text-white transition-all duration-200"
              onClick={onCollapse}
              aria-label="Close"
            >
              <span style={{fontSize: 24, fontWeight: 'bold', lineHeight: 1}}>×</span>
            </button>
            <div className="w-full h-full p-8 overflow-auto" style={{ maxHeight: '90vh', minHeight: '600px' }}>
              {/* Main Heading */}
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Bot size={20} className="text-teal-400" />
                  <h3 className="text-white font-semibold text-sm">AI Development Assistant</h3>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex space-x-3 mb-6">
                <button
                  onClick={startNewSearch}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border ${
                    activeTab === 'search' 
                      ? 'border-white/50 text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]' 
                      : 'border-gray-600/50 text-gray-300 hover:border-white hover:text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                  }`}
                >
                  Search
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border ${
                    activeTab === 'history' 
                      ? 'border-white/50 text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]' 
                      : 'border-gray-600/50 text-gray-300 hover:border-white hover:text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                  }`}
                >
                  History ({cachedPlans.length})
                </button>
                {aiResults && (
                  <>
                    <button
                      onClick={() => setActiveTab('results')}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border ${
                        activeTab === 'results' 
                          ? 'border-white/50 text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]' 
                          : 'border-gray-600/50 text-gray-300 hover:border-white hover:text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                      }`}
                    >
                      Analysis
                    </button>
                    <button
                      onClick={() => setActiveTab('plan')}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border ${
                        activeTab === 'plan' 
                          ? 'border-white/50 text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]' 
                          : 'border-gray-600/50 text-gray-300 hover:border-white hover:text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                      }`}
                    >
                      Development Plan
                    </button>
                  </>
                )}
              </div>

              {/* Content */}
              <div className="flex-1">
                {activeTab === 'search' && (
                  <div className="max-w-2xl mx-auto">
                    <div className="mb-6">
                      <h2 className="text-white text-lg font-semibold mb-4">What are you building?</h2>
                      <p className="text-gray-400 mb-6">Describe your project and get AI-powered recommendations for Cardano tools and development approaches.</p>
                    </div>
                    
                    <AISearchInput
                      onAnalysisComplete={(results) => {
                        setAiResults(results)
                        // Extract meaningful title from results analysis or use generic title
                        const queryTitle = results.analysis ? 
                          results.analysis.slice(0, 50) + (results.analysis.length > 50 ? '...' : '') :
                          'AI Development Plan'
                        const planId = savePlanToCache(queryTitle, results)
                        setSelectedPlanId(planId)
                        setActiveTab('plan')
                      }}
                      onLoadingChange={setIsAnalyzing}
                    />
                  </div>
                )}

                {activeTab === 'history' && (
                  <div className="max-w-4xl mx-auto">
                    <div className="mb-6">
                      <h2 className="text-white text-lg font-semibold mb-2">Development Plan History</h2>
                      <p className="text-gray-400">Previously generated development plans for your projects.</p>
                    </div>
                    
                    {cachedPlans.length === 0 ? (
                      <div className="text-center py-12">
                        <Bot size={48} className="text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">No development plans saved yet.</p>
                        <p className="text-gray-500">Create your first analysis to see it here!</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {cachedPlans.map((plan) => (
                          <div 
                            key={plan.id} 
                            onClick={() => loadPlan(plan.id)}
                            className={`bg-gray-800/50 rounded-lg p-4 border transition-all duration-200 hover:bg-gray-800/70 cursor-pointer ${
                              selectedPlanId === plan.id ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-gray-700'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1">
                                <h4 className="text-white font-medium mb-1">{plan.title}</h4>
                                <p className="text-gray-300 text-sm mb-2">{plan.query}</p>
                                <div className="flex items-center space-x-4 text-xs text-gray-400">
                                  <span>{new Date(plan.timestamp).toLocaleDateString()}</span>
                                  <span>{new Date(plan.timestamp).toLocaleTimeString()}</span>
                                  <span>{plan.results.recommendedResources?.length || 0} tools recommended</span>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2 ml-4">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deletePlan(plan.id);
                                  }}
                                  className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                                  title="Delete plan"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'results' && aiResults && (
                  <div className="space-y-6">
                    {/* Analysis */}
                    <div className="bg-card-bg/50 backdrop-blur-md border border-gray-700 rounded-xl p-6">
                      <h3 className="text-lg font-semibold text-white mb-3">Project Analysis</h3>
                      <p className="text-gray-300 leading-relaxed">{aiResults.analysis}</p>
                    </div>

                    {/* AI-Recommended Resources */}
                    <div className="space-y-6">
                      {Object.entries(groupedResources).map(([category, resources]) => (
                        <div key={category}>
                          <div className="text-center mb-6">
                            <h3 className="text-xl font-bold text-white mb-2">{category}</h3>
                          </div>
                          
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {resources.map((resource) => (
                              <div key={resource.id} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                                <div className="flex items-start justify-between mb-3">
                                  <h4 className="text-white font-medium">{resource.name}</h4>
                                  <span className={`px-2 py-1 rounded-full text-xs ${
                                    resource.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                                    resource.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-green-500/20 text-green-400'
                                  }`}>
                                    {resource.priority} priority
                                  </span>
                                </div>
                                <p className="text-gray-300 text-sm mb-3">{resource.description}</p>
                                <p className="text-gray-400 text-sm mb-3">
                                  <strong>Why recommended:</strong> {resource.reason}
                                </p>
                                <div className="flex items-center space-x-4 text-sm">
                                  <a
                                    href={resource.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-white hover:text-gray-300 transition-colors"
                                  >
                                    Visit Website
                                  </a>
                                  {resource.docs && (
                                    <a
                                      href={resource.docs}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-white hover:text-gray-300 transition-colors"
                                    >
                                      Documentation
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(activeTab === 'plan' || activeTab === 'tools') && aiResults && (
                  <div className="flex h-[calc(90vh-200px)]">
                    {/* Tabs */}
                    <div className="w-64 border-r border-gray-700 bg-gray-900/50">
                      <div className="p-4">
                        <button
                          onClick={() => setActiveTab('plan')}
                          className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 border ${
                            activeTab === 'plan'
                              ? 'border-white/50 text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                              : 'border-gray-600/50 text-gray-400 hover:border-white hover:text-white hover:bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                          }`}
                        >
                          <FileText size={16} className="inline mr-2" />
                          Development Plan
                        </button>
                        <button
                          onClick={() => setActiveTab('tools')}
                          className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 border mt-2 ${
                            activeTab === 'tools'
                              ? 'border-white/50 text-white shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                              : 'border-gray-600/50 text-gray-400 hover:border-white hover:text-white hover:bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                          }`}
                        >
                          <Bot size={16} className="inline mr-2" />
                          Recommended Tools
                        </button>
                      </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 overflow-y-auto">
                      {activeTab === 'plan' && (
                        <div className="p-6">
                          <div className="flex items-center justify-between mb-6">
                            <div>
                              <h3 className="text-lg font-semibold text-white">Development Plan</h3>
                              {selectedPlanId && (
                                <p className="text-gray-400 text-sm mt-1">
                                  {cachedPlans.find(p => p.id === selectedPlanId) ? 
                                    `Cached plan from ${new Date(cachedPlans.find(p => p.id === selectedPlanId).timestamp).toLocaleDateString()}` : 
                                    'Current analysis'
                                  }
                                </p>
                              )}
                            </div>
                            <button
                              onClick={handleCopyPlan}
                              className="flex items-center space-x-2 px-4 py-2 bg-gray-800/30 text-gray-300 rounded-lg border border-white/50 hover:border-white hover:bg-white/10 transition-all duration-200 shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]"
                            >
                              {copied ? (
                                <>
                                  <Check size={16} className="text-green-400" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={16} />
                                  <span>Copy as Markdown</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Analysis */}
                          <div className="mb-6">
                            <h4 className="text-md font-semibold text-white mb-3">Project Analysis</h4>
                            <p className="text-gray-300 leading-relaxed">{aiResults.analysis}</p>
                          </div>

                          {/* Development Approaches */}
                          <div className="space-y-6">
                            <h4 className="text-md font-semibold text-white">Development Approaches</h4>
                            <p className="text-gray-300 mb-4">{aiResults.developmentPlan.overview}</p>
                            
                            {aiResults.developmentPlan.approaches.map((approach, index) => (
                              <div key={index} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                                <div className="flex items-center justify-between mb-3">
                                  <h5 className="text-white font-medium">{approach.name}</h5>
                                  <div className="flex items-center space-x-2">
                                    <span className={`px-2 py-1 rounded-full text-xs ${
                                      approach.complexity === 'beginner' ? 'bg-green-500/20 text-green-400' :
                                      approach.complexity === 'intermediate' ? 'bg-yellow-500/20 text-yellow-400' :
                                      'bg-red-500/20 text-red-400'
                                    }`}>
                                      {approach.complexity}
                                    </span>
                                    <span className="text-gray-400 text-sm">{approach.estimatedTime}</span>
                                  </div>
                                </div>
                                <p className="text-gray-300 text-sm mb-3">{approach.description}</p>
                                <div>
                                  <span className="text-gray-400 text-sm">Required Tools:</span>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {approach.tools.map((tool, toolIndex) => (
                                      <button
                                        key={toolIndex}
                                        onClick={() => handleToolClick(tool)}
                                        className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-cyan-600/20 hover:text-cyan-300 hover:border-cyan-500/30 border border-transparent transition-all duration-200 cursor-pointer"
                                        title={`Click to view ${tool} details`}
                                      >
                                        {tool}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeTab === 'tools' && (
                        <div className="p-6">
                          <h3 className="text-lg font-semibold text-white mb-6">Recommended Tools</h3>
                          <div className="space-y-4">
                            {aiResults.recommendedResources.map((resource, index) => (
                              <div key={resource.id} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700" data-resource-id={resource.id}>
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-3 mb-2">
                                      <h4 className="text-white font-medium">{resource.name}</h4>
                                      <span className={`px-2 py-1 rounded-full text-xs ${
                                        resource.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                                        resource.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-green-500/20 text-green-400'
                                      }`}>
                                        {resource.priority} priority
                                      </span>
                                    </div>
                                    <p className="text-gray-300 text-sm mb-2">{resource.description}</p>
                                    <p className="text-gray-400 text-sm mb-3">
                                      <strong>Why recommended:</strong> {resource.reason}
                                    </p>
                                    <div className="flex items-center space-x-4 text-sm">
                                      <a
                                        href={resource.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 transition-colors"
                                      >
                                        Visit Website
                                      </a>
                                      {resource.docs && (
                                        <a
                                          href={resource.docs}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-cyan-400 hover:text-cyan-300 transition-colors"
                                        >
                                          Documentation
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}

export default AISearchWidget 